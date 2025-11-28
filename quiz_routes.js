/**
 * quiz_routes.js
 * - quizzes テーブルから問題を取得し、解答を受けて採点・報酬付与を行うルート群
 * - server.js にて: require('./quiz_routes')(pool, app, io);
 *
 * 期待する DB 既存テーブル:
 * - users (nickname, balance, is_admin)
 * - history (nickname, quest_id, amount, type, created_at)
 * - quiz_rights (nickname, quest_id)
 * - quizzes (quiz_id, title, data JSONB, reward, is_ex)
 *
 * 注意:
 * - クライアント側には正解情報を返しません。
 * - 正解時はトランザクションで users.balance 更新と history 追加を行います。
 */

module.exports = function(pool, app, io) {
  const NORMAL_QUIZZES = ["quiz01","quiz02","quiz03","quiz04","quiz05"];
  const EX_QUIZZES = ["ex01","ex02","ex03","ex04","ex05","ex06","ex07"];

  // 問題取得（正解は除いて返す）
  app.get('/api/quiz/:quizId', async (req, res) => {
    const quizId = req.params.quizId;
    try {
      const r = await pool.query('SELECT quiz_id, title, data, reward, is_ex FROM quizzes WHERE quiz_id = $1', [quizId]);
      if (r.rowCount === 0) return res.status(404).json({ error: 'quiz not found' });
      const row = r.rows[0];

      // クライアントに返す用に data の中の answer を消す（ネストに応じて）
      const safeData = JSON.parse(JSON.stringify(row.data));
      if (Array.isArray(safeData.questions)) {
        safeData.questions.forEach(q => { delete q.answer; });
      } else {
        delete safeData.answer;
      }

      res.json({
        quizId: row.quiz_id,
        title: row.title,
        data: safeData,
        reward: row.reward,
        is_ex: row.is_ex
      });
    } catch (err) {
      console.error('GET /api/quiz error:', err);
      res.status(500).json({ error: 'database error' });
    }
  });

  // 解答提出
  app.post('/api/quiz/:quizId/submit', async (req, res) => {
    const quizId = req.params.quizId;
    const { nickname, answers } = req.body; // answers は配列または単一値（index）
    if (!nickname) return res.status(400).json({ error: 'nickname required' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // ユーザー存在確認
      const userR = await client.query('SELECT nickname, balance, is_admin FROM users WHERE nickname = $1 FOR UPDATE', [nickname]);
      if (userR.rowCount === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'user not found' });
      }
      const user = userR.rows[0];

      // クイズ存在・内容取得（正解含む）
      const quizR = await client.query('SELECT quiz_id, data, reward, is_ex FROM quizzes WHERE quiz_id = $1', [quizId]);
      if (quizR.rowCount === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'quiz not found' });
      }
      const quiz = quizR.rows[0];

      // アクセス権チェック: quiz_rights または (非EXなら特別扱い?) — 基本は quiz_rights テーブルで確認
      const rightR = await client.query('SELECT 1 FROM quiz_rights WHERE nickname = $1 AND quest_id = $2 LIMIT 1', [nickname, quizId]);
      if (rightR.rowCount === 0) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'no quiz right' });
      }

      // 既に同じクイズをクリアしていないか
      const clearedR = await client.query('SELECT 1 FROM history WHERE nickname = $1 AND quest_id = $2 LIMIT 1', [nickname, quizId]);
      if (clearedR.rowCount > 0) {
        await client.query('ROLLBACK');
        return res.json({ message: 'already cleared' });
      }

      // 採点（単一設問/複数設問）
      const qdata = quiz.data;
      let correct = false;
      if (Array.isArray(qdata.questions) && qdata.questions.length > 0) {
        // 単純: 単一設問の index 比較。拡張はクライアントと合わせて実装してください。
        const correctAnswers = qdata.questions.map(q => q.answer);
        if (Array.isArray(answers)) {
          correct = correctAnswers.length === answers.length &&
            correctAnswers.every((v,i) => Number(v) === Number(answers[i]));
        } else {
          // 1問想定
          correct = Number(correctAnswers[0]) === Number(answers);
        }
      } else if (typeof qdata.answer !== 'undefined') {
        correct = String(qdata.answer) === String(answers);
      } else {
        // 問題形式が未知の場合は不正解扱い
        correct = false;
      }

      let exUnlocked = false;

      if (correct) {
        const reward = Number(quiz.reward) || 0;
        // 残高更新
        await client.query('UPDATE users SET balance = balance + $1 WHERE nickname = $2', [reward, nickname]);

        // 履歴追加
        await client.query(
          `INSERT INTO history (nickname, quest_id, amount, type)
           VALUES ($1, $2, $3, $4)`,
          [nickname, quizId, reward, 'クイズ報酬']
        );

        // ノーマル全クリ -> EX 一括付与
        if (!quiz.is_ex) {
          const normalClear = await client.query(
            "SELECT quest_id FROM history WHERE nickname = $1 AND quest_id = ANY($2::text[])",
            [nickname, NORMAL_QUIZZES]
          );
          const clearedNormalIds = normalClear.rows.map(r => r.quest_id);
          const allNormalDone = NORMAL_QUIZZES.every(id => clearedNormalIds.includes(id));

          if (allNormalDone) {
            await client.query(
              `INSERT INTO quiz_rights (nickname, quest_id)
               SELECT $1, UNNEST($2::text[])
               ON CONFLICT DO NOTHING`,
              [nickname, EX_QUIZZES]
            );
            exUnlocked = true;
          }
        } else {
          // EX 個別クリア -> 全EX確認 & bonus
          const exClear = await client.query(
            "SELECT quest_id FROM history WHERE nickname = $1 AND quest_id = ANY($2::text[])",
            [nickname, EX_QUIZZES]
          );
          const clearedExIds = exClear.rows.map(r => r.quest_id);
          const allExDone = EX_QUIZZES.every(id => clearedExIds.includes(id));
          if (allExDone) {
            const bonus = await client.query("SELECT 1 FROM history WHERE nickname = $1 AND quest_id = 'bonus_ex_all' LIMIT 1", [nickname]);
            if (bonus.rowCount === 0) {
              await client.query("UPDATE users SET balance = balance + 400 WHERE nickname = $1", [nickname]);
              await client.query(
                `INSERT INTO history (nickname, quest_id, amount, type)
                 VALUES ($1, 'bonus_ex_all', 400, '全EXクリアボーナス')`,
                [nickname]
              );
            }
          }
        }
      } else {
        // 不正解の場合、履歴に「attempt」を残す仕様にする場合はこちらを有効化（任意）
        // await client.query(
        //   `INSERT INTO history (nickname, quest_id, amount, type)
        //    VALUES ($1, $2, 0, 'クイズ不正解')`,
        //   [nickname, quizId]
        // );
      }

      await client.query('COMMIT');

      // 更新後残高を取得
      const newBalR = await pool.query('SELECT balance FROM users WHERE nickname = $1', [nickname]);

      // 通知（socket.io が渡されていれば emit）
      if (io) io.emit('update');

      res.json({
        ok: true,
        correct,
        reward: correct ? Number(quiz.reward) : 0,
        balance: newBalR.rows[0].balance,
        exUnlocked
      });

    } catch (err) {
      await client.query('ROLLBACK').catch(()=>{});
      console.error('POST /api/quiz/:quizId/submit error:', err);
      res.status(500).json({ error: 'database error' });
    } finally {
      client.release();
    }
  });
};
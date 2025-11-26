(function (global) {
  const ALL_EX = ["ex01","ex02","ex03","ex04","ex05","ex06","ex07"]; // 実際のEX一覧に合わせる

  function getNicknameOrRedirect() {
    const nickname = localStorage.getItem("nickname");
    if (!nickname) {
      alert("⚠️ ログイン情報がありません。トップからログインしてください。");
      location.href = "/index.html";
      throw new Error("no nickname");
    }
    return nickname;
  }

  async function fetchHistory(nickname) {
    try {
      const res = await fetch(`/history/${encodeURIComponent(nickname)}`);
      if (!res.ok) {
        console.warn("fetchHistory: non-OK response", res.status);
        return [];
      }
      const history = await res.json();
      return Array.isArray(history) ? history : [];
    } catch (err) {
      console.error("履歴取得エラー:", err);
      return [];
    }
  }

  async function isQuestCleared(nickname, questId) {
    const history = await fetchHistory(nickname);
    return history.some(h => h && h.questId === questId);
  }

  // /quest に対して報酬付与リクエストを送る
  async function awardQuest(nickname, questId, amount, type = "EX謎解き") {
    try {
      console.log("awardQuest request:", { nickname, questId, amount, type });
      const res = await fetch("/quest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nickname, amount, type, questId })
      });
      let data;
      try {
        data = await res.json();
      } catch (e) {
        console.warn("awardQuest: response is not JSON", e);
        data = { error: "非JSONレスポンス", status: res.status };
      }
      if (!res.ok || data && data.error) {
        console.error("awardQuest server error:", res.status, data);
        return { error: data && data.error ? data.error : `HTTP ${res.status}`, raw: data };
      }
      return data || {};
    } catch (err) {
      console.error("awardQuest error:", err);
      return { error: "通信エラー" };
    }
  }

  // EX のクリア状況を見て、全問クリアならボーナス(400)を付与する（冪等に動く想定）
async function checkAndAwardExAllBonus(nickname) {
  const history = await fetchHistory(nickname);
  const clearedExIds = history
    .map(h => h && h.questId)
    .filter(Boolean)
    .filter(id => id.startsWith("ex"));

  const allCleared = ALL_EX.every(q => clearedExIds.includes(q));
  const alreadyGotBonus = history.some(h => h && h.questId === "bonus_ex_all");

  // すでにボーナスを取得していたら「already: true」を返す
  if (alreadyGotBonus) {
    return { awarded: false, already: true, points: 0, resp: null };
  }

  // 全問クリアしているが、まだボーナスが付いていない場合
  if (allCleared && !alreadyGotBonus) {
    try {
      const res = await fetch("/quest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nickname,
          amount: 400,
          type: "EX全問クリアボーナス",
          questId: "bonus_ex_all"
        })
      });

      const data = await res.json();

      if (res.ok && data && !data.error) {
        return { awarded: true, already: false, points: 400, resp: data };
      } else {
        return { awarded: false, already: false, points: 0, resp: data || { error: `HTTP ${res.status}` } };
      }
    } catch (err) {
      console.error("bonus award error:", err);
      return { awarded: false, already: false, points: 0, resp: { error: "通信エラー" } };
    }
  }

  // 全問クリアしていない
  return { awarded: false, already: false, points: 0, resp: null };
}

  // --- ここから追加改善: 回答の正規化関数 ---
  function normalizeAns(s) {
    if (!s) return "";
    // Unicode 正規化
    s = s.normalize("NFKC");
    // trim and remove spaces (全角半角)
    s = s.replace(/\s+/g, "");
    // lowercase
    s = s.toLowerCase();
    // convert katakana to hiragana (簡易)
    s = s.replace(/[\u30A1-\u30F6]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60));
    // 長音符と似た記号を統一（ー -> ー）
    s = s.replace(/ー|−|−/g, "ー");
    // 濁点・半濁点を分解して正規化（簡易）
    s = s.normalize("NFKD").replace(/[\u3099\u309A]/g, "");
    // 除外したい句読点等を取り除く
    s = s.replace(/[、。.,\/\\!！\?？\-–—]/g, "");
    return s;
  }

  // ページごとのセットアップ関数を提供
  // options: { correctAnswers: [...], questId: "ex01", rewardAmount: 50 }
  async function setupQuizPage(options) {
    const nickname = getNicknameOrRedirect();
    const { correctAnswers, questId, rewardAmount } = options;
    const resultMsg = document.getElementById("resultMsg");
    const checkBtn = document.getElementById("checkAnswerBtn");
    const clearBtn = document.getElementById("puzzleClearBtn");
    const answerInput = document.getElementById("answerInput");

    // 正規化済みの正解セットを作る
    const normCorrectSet = new Set((correctAnswers || []).map(c => normalizeAns(c)));

    // 初期化: クリア済みチェック
    try {
      const cleared = await isQuestCleared(nickname, questId);
      if (cleared) {
        resultMsg.textContent = "この謎はすでにクリア済みです ✅";
        resultMsg.style.color = "gray";
        checkBtn.disabled = true;
        answerInput.disabled = true;
        clearBtn.style.display = "none";
      }
    } catch (err) {
      console.error(err);
    }

    // 解答判定
    checkBtn.addEventListener("click", () => {
      const raw = (answerInput.value || "").trim();
      if (!raw) {
        resultMsg.textContent = "解答を入力してください。";
        resultMsg.style.color = "gray";
        return;
      }
      const ans = normalizeAns(raw);
      console.log("ユーザー入力:", raw, "正規化:", ans);

      if (normCorrectSet.has(ans)) {
        resultMsg.textContent = "正解です！🎉";
        resultMsg.style.color = "green";
        // 正解後のUI制御
        checkBtn.disabled = true;
        answerInput.disabled = true;
        clearBtn.style.display = "inline-block";
      } else {
        resultMsg.textContent = "不正解です。もう一度考えてみましょう。";
        resultMsg.style.color = "red";
      }
    });

    // クリアボタン押下時の処理（1問分の付与 + 必要なら全問ボーナス）
    clearBtn.addEventListener("click", async () => {
      // 二重送信防止
      clearBtn.disabled = true;
      try {
        // 1) まずはこの問題の報酬申請
        const data = await awardQuest(nickname, questId, rewardAmount, "EX謎解き");
        if (data.error) {
          alert("コイン付与に失敗: " + data.error);
          console.error("awardQuest resp:", data);
          clearBtn.disabled = false;
          return;
        }
        alert(`EX謎解きクリア！${rewardAmount}コイン獲得しました✨`);

        // 2) 履歴を再取得して全問クリアボーナス判定・付与
        const bonusResult = await checkAndAwardExAllBonus(nickname);
        if (bonusResult.awarded || bonusResult.already) {
          alert("🎊 EX全問クリアボーナス達成！400コイン獲得しました！ 🎉");
        }

        // 3) ダッシュボードへ戻す
        location.href = "/dashboard.html";
      } catch (err) {
        console.error(err);
        alert("サーバーエラー: " + err);
        clearBtn.disabled = false;
      }
    });
  }

  // 公開 API
  global.EX = {
    ALL_EX,
    fetchHistory,
    isQuestCleared,
    awardQuest,
    checkAndAwardExAllBonus,
    setupQuizPage
  };
})(window);

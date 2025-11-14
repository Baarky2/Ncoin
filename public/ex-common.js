
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
      if (!res.ok) return [];
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
      const res = await fetch("/quest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nickname, amount, type, questId })
      });
      const data = await res.json();
      return data || {};
    } catch (err) {
      console.error("awardQuest error:", err);
      return { error: "通信エラー" };
    }
  }

  // EX のクリア状況を見て、全問クリアならボーナス(400)を付与する（冪等に動く想定）
  async function checkAndAwardExAllBonus(nickname) {
    const history = await fetchHistory(nickname);
    const clearedExIds = history.map(h => h.questId).filter(Boolean).filter(id => id.startsWith("ex"));
    const allCleared = ALL_EX.every(q => clearedExIds.includes(q));
    const alreadyGotBonus = history.some(h => h.questId === "bonus_ex_all");

    if (allCleared && !alreadyGotBonus) {
      // サーバで冪等に処理されることを期待してリクエストする
      try {
        const res = await fetch("/quest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nickname, amount: 400, type: "EX全問クリアボーナス", questId: "bonus_ex_all" })
        });
        const data = await res.json();
        if (data && !data.error) {
          return { awarded: true, points: 400, resp: data };
        } else {
          // サーバ側が何らかの理由で拒否した（既に付与済み等）
          return { awarded: false, points: 0, resp: data };
        }
      } catch (err) {
        console.error("bonus award error:", err);
        return { awarded: false, points: 0, resp: { error: "通信エラー" } };
      }
    }
    return { awarded: false, points: 0, resp: null };
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
      const ans = (answerInput.value || "").trim();
      if (!ans) {
        resultMsg.textContent = "解答を入力してください。";
        resultMsg.style.color = "gray";
        return;
      }
      if (correctAnswers.includes(ans)) {
        resultMsg.textContent = "正解です！🎉";
        resultMsg.style.color = "green";
        clearBtn.style.display = "inline-block";
      } else {
        resultMsg.textContent = "不正解です。もう一度考えてみましょう。";
        resultMsg.style.color = "red";
      }
    });

    // クリアボタン押下時の処理（1問分の付与 + 必要なら全問ボーナス）
    clearBtn.addEventListener("click", async () => {
      try {
        // 1) まずはこの問題の報酬申請
        const data = await awardQuest(nickname, questId, rewardAmount, "EX謎解き");
        if (data.error) {
          alert("コイン付与に失敗: " + data.error);
          return;
        }
        alert(`EX謎解きクリア！${rewardAmount}コイン獲得しました✨`);

        // 2) 履歴を再取得して全問クリアボーナス判定・付与
        const bonusResult = await checkAndAwardExAllBonus(nickname);
        if (bonusResult.awarded) {
          alert("🎊 EX全問クリアボーナス達成！400コイン獲得しました！ 🎉");
        }

        // 3) ダッシュボードへ戻す
        location.href = "/dashboard.html";
      } catch (err) {
        console.error(err);
        alert("サーバーエラー: " + err);
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
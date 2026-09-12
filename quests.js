// quests.js - محرك المهام باستخدام discord-quests مع Dynamic Import
const config = require("./config");

// تحميل المكتبة ديناميكياً (ESM)
let DiscordQuests = null;

async function loadQuestsLib() {
  if (!DiscordQuests) {
    const mod = await import("discord-quests");
    DiscordQuests = mod.DiscordQuests || mod.default?.DiscordQuests || mod.default;
    if (!DiscordQuests) {
      throw new Error("فشل تحميل DiscordQuests");
    }
  }
  return DiscordQuests;
}

async function solveSequentially(token, onUpdate) {
  const results = [];

  try {
    console.log("[quests] 🚀 بدء جلسة حل المهام...");

    // تحميل المكتبة
    const QuestsClass = await loadQuestsLib();
    const dq = new QuestsClass(token);

    // استخدام solveAll التي تتولى كل شيء
    const solveResults = await dq.solveAll({
      onProgress: ({ taskId, percent }) => {
        if (onUpdate) {
          onUpdate({
            questId: taskId,
            questName: `مهمة ${taskId}`,
            status: "running",
            percent: percent,
          });
        }
      },
      onCompleted: (questId) => {
        if (onUpdate) {
          onUpdate({
            questId: questId,
            questName: `مهمة ${questId}`,
            status: "completed",
            percent: 100,
          });
        }
        console.log(`[quests] ✅ اكتملت: ${questId}`);
      },
      onError: (questId, err) => {
        if (onUpdate) {
          onUpdate({
            questId: questId,
            questName: `مهمة ${questId}`,
            status: "rejected",
            error: err.message,
          });
        }
        console.error(`[quests] ❌ فشلت ${questId}:`, err.message);
      },
    });

    console.log("[quests] 🏁 انتهت الجلسة");
    return { success: true, quests: solveResults || [] };
  } catch (err) {
    console.error("[quests] ❌ خطأ عام:", err.message);
    return { success: false, error: err.message };
  }
}

module.exports = { solveSequentially };
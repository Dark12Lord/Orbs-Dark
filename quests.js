// quests.js - محرك المهام المباشر (Heartbeat + Video Progress)
const axios = require("axios");
const config = require("./config");

const DISCORD_API = "https://discord.com/api/v9";

// Headers أساسية تُستخدم في كل الطلبات
function buildHeaders(token) {
  return {
    Authorization: token,
    "Content-Type": "application/json",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  };
}

// تأخير عشوائي (Jitter)
function jitter(minMs, maxMs) {
  const delay = Math.floor(Math.random() * (maxMs - minMs) + minMs);
  return new Promise((resolve) => setTimeout(resolve, delay));
}

// ===== جلب المهام (معالج بشكل مرن) =====
async function fetchQuests(token) {
  const res = await axios.get(`${DISCORD_API}/quests/@me`, {
    headers: buildHeaders(token),
  });

  const data = res.data;

  // سجل للتشخيص
  console.log("[fetchQuests] type:", typeof data, "| isArray:", Array.isArray(data));
  if (data && !Array.isArray(data)) {
    console.log("[fetchQuests] keys:", Object.keys(data).join(", "));
  }

  // محاولة استخراج المصفوفة من أي مكان محتمل
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.quests)) return data.quests;
  if (data && Array.isArray(data.data)) return data.data;
  if (data && Array.isArray(data.items)) return data.items;

  console.log("[fetchQuests] unexpected shape:", JSON.stringify(data).slice(0, 300));
  return [];
}

// ===== استخراج حالة المهمة =====
function getQuestStatus(quest) {
  const s =
    quest.user_status?.status ||
    quest.userStatus?.status ||
    quest.status ||
    quest.state ||
    "UNKNOWN";
  return String(s).toUpperCase();
}

// ===== استخراج اسم المهمة =====
function getQuestName(quest) {
  return (
    quest.config?.messages?.quest_name ||
    quest.config?.messages?.questName ||
    quest.name ||
    quest.title ||
    quest.id ||
    "quest"
  );
}

// ===== استخراج نوع المهمة =====
function getQuestType(quest) {
  return (
    quest.config?.task_config?.task_type ||
    quest.config?.taskConfig?.taskType ||
    quest.type ||
    "UNKNOWN"
  );
}

// ===== استخراج مكافأة المهمة =====
function getQuestReward(quest) {
  return (
    quest.config?.rewards_config?.orb_reward ||
    quest.config?.rewardsConfig?.orbReward ||
    quest.reward ||
    0
  );
}

// ===== استخراج application_id =====
function getApplicationId(quest) {
  return (
    quest.config?.application?.id ||
    quest.config?.application_id ||
    quest.application_id ||
    null
  );
}

// ===== استخراج مدة المهمة =====
function getDuration(quest) {
  return (
    quest.config?.task_config?.duration ||
    quest.config?.taskConfig?.durationMs ||
    quest.config?.task_config?.video_duration_ms ||
    900000
  );
}

// ===== التسجيل في المهمة (Enroll) =====
async function enrollQuest(token, questId) {
  try {
    await axios.post(
      `${DISCORD_API}/quests/${questId}/enroll`,
      {},
      { headers: buildHeaders(token), timeout: 15000 }
    );
    console.log(`[enroll] ${questId}: enrolled`);
    return true;
  } catch (err) {
    // 400 = مسجل مسبقاً، مو مشكلة
    if (err.response && err.response.status === 400) {
      console.log(`[enroll] ${questId}: already enrolled`);
      return true;
    }
    console.log(`[enroll] ${questId}: failed (${err.response?.status || err.message})`);
    return false;
  }
}

// ===== حل مهمة فيديو =====
async function solveVideoQuest(token, quest, onUpdate) {
  const questId = quest.id;
  const questName = getQuestName(quest);
  const durationMs = getDuration(quest);
  const speedMultiplier = 2.0;
  const intervalMs = 30000;
  const effectiveInterval = intervalMs / speedMultiplier;
  const totalSteps = Math.ceil(durationMs / (intervalMs * speedMultiplier));

  // تسجيل أولاً
  await enrollQuest(token, questId);

  for (let step = 1; step <= totalSteps; step++) {
    if (global.stopFlags && global.stopFlags.has(questId)) {
      throw new Error("تم الإيقاف يدوياً");
    }

    const baseTimestamp = Math.min(step * intervalMs * speedMultiplier, durationMs);
    const timestamp = Math.floor(baseTimestamp + Math.random() * 500);

    try {
      await axios.post(
        `${DISCORD_API}/quests/${questId}/video-progress`,
        { timestamp },
        { headers: buildHeaders(token), timeout: 15000 }
      );
    } catch (err) {
      if (err.response && err.response.status === 429) {
        const retryAfter = (err.response.data?.retry_after || 5) * 1000;
        await new Promise((r) => setTimeout(r, retryAfter));
        continue;
      }
      const status = err.response?.status || "?";
      const msg = err.response?.data?.message || err.message;
      throw new Error(`video-progress failed [${status}]: ${msg}`);
    }

    if (onUpdate) {
      const percent = Math.min(Math.round((step / totalSteps) * 100), 100);
      onUpdate({ questId, questName, status: "running", percent });
    }

    await new Promise((r) => setTimeout(r, effectiveInterval + Math.random() * 3000));
  }

  return true;
}

// ===== حل مهمة لعب =====
async function solveGameQuest(token, quest, onUpdate) {
  const questId = quest.id;
  const questName = getQuestName(quest);
  const applicationId = getApplicationId(quest);
  const durationMs = getDuration(quest);
  const intervalMs = 60000;

  if (!applicationId) {
    throw new Error("application_id غير موجود للمهمة");
  }

  // تسجيل أولاً
  await enrollQuest(token, questId);

  const totalSteps = Math.ceil(durationMs / intervalMs);

  for (let step = 1; step <= totalSteps; step++) {
    if (global.stopFlags && global.stopFlags.has(questId)) {
      throw new Error("تم الإيقاف يدوياً");
    }

    try {
      await axios.post(
        `${DISCORD_API}/quests/${questId}/heartbeat`,
        {
          application_id: applicationId,
          terminal: false,
        },
        { headers: buildHeaders(token), timeout: 15000 }
      );
    } catch (err) {
      if (err.response && err.response.status === 429) {
        const retryAfter = (err.response.data?.retry_after || 5) * 1000;
        await new Promise((r) => setTimeout(r, retryAfter));
        continue;
      }
      const status = err.response?.status || "?";
      const msg = err.response?.data?.message || err.message;
      throw new Error(`heartbeat failed [${status}]: ${msg}`);
    }

    if (onUpdate) {
      const percent = Math.min(Math.round((step / totalSteps) * 100), 100);
      onUpdate({ questId, questName, status: "running", percent });
    }

    await new Promise((r) => setTimeout(r, intervalMs + Math.random() * 7000));
  }

  return true;
}

// ===== المحرك الرئيسي =====
async function solveSequentially(token, onUpdate) {
  const results = [];

  try {
    const quests = await fetchQuests(token);

    if (!Array.isArray(quests)) {
      return { success: false, error: "fetchQuests لم يُرجع مصفوفة" };
    }

    if (quests.length === 0) {
      return { success: true, quests: [], message: "لا توجد مهام متاحة" };
    }

    const pending = quests.filter((q) => {
      const status = getQuestStatus(q);
      return status !== "COMPLETED" && status !== "CLAIMED" && status !== "REJECTED";
    });

    const alreadyDone = quests
      .filter((q) => {
        const status = getQuestStatus(q);
        return status === "COMPLETED" || status === "CLAIMED" || status === "REJECTED";
      })
      .map((q) => ({
        id: q.id,
        name: getQuestName(q),
        type: getQuestType(q),
        status: getQuestStatus(q),
        reward: getQuestReward(q),
      }));

    if (pending.length === 0) {
      return { success: true, quests: alreadyDone, message: "كل المهام مكتملة مسبقاً" };
    }

    for (const quest of pending) {
      const questId = quest.id;
      const questName = getQuestName(quest);
      const questType = getQuestType(quest);

      try {
        if (onUpdate) {
          onUpdate({ questId, questName, status: "running", percent: 0 });
        }

        if (questType === "WATCH_VIDEO" || questType === "WATCH_VIDEO_ON_MOBILE") {
          await solveVideoQuest(token, quest, onUpdate);
        } else if (questType === "PLAY_ON_DESKTOP" || questType === "PLAY_ACTIVITY") {
          await solveGameQuest(token, quest, onUpdate);
        } else {
          throw new Error(`نوع غير مدعوم: ${questType}`);
        }

        results.push({
          id: questId,
          name: questName,
          type: questType,
          status: "COMPLETED",
          reward: getQuestReward(quest),
        });

        if (onUpdate) {
          onUpdate({ questId, questName, status: "completed", percent: 100 });
        }

        await jitter(5000, 15000);
      } catch (err) {
        results.push({
          id: questId,
          name: questName,
          type: questType,
          status: "REJECTED",
          reward: 0,
          error: err.message,
        });

        if (onUpdate) {
          onUpdate({ questId, questName, status: "rejected", error: err.message });
        }
      }
    }

    return { success: true, quests: [...alreadyDone, ...results] };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

module.exports = { solveSequentially };
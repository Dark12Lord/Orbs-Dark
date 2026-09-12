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

// تأخير عشوائي (Jitter) لتجنب الكشف
function jitter(minMs, maxMs) {
  const delay = Math.floor(Math.random() * (maxMs - minMs) + minMs);
  return new Promise((resolve) => setTimeout(resolve, delay));
}

// ===== جلب المهام =====
async function fetchQuests(token) {
  const res = await axios.get(`${DISCORD_API}/quests/@me`, {
    headers: buildHeaders(token),
  });
  return res.data;
}

// ===== حل مهمة فيديو (WATCH_VIDEO) =====
async function solveVideoQuest(token, quest, onUpdate) {
  const questId = quest.id;
  const durationMs = quest.config?.taskConfig?.videoDurationMs || 900000; // 15 دقيقة افتراضي
  const speedMultiplier = 2.0; // تسريع 2x
  const intervalMs = 30000; // 30 ثانية
  const effectiveInterval = intervalMs / speedMultiplier;
  const totalSteps = Math.ceil(durationMs / (intervalMs * speedMultiplier));

  for (let step = 1; step <= totalSteps; step++) {
    // توقف لو المستخدم ضغط إيقاف
    if (global.stopFlags && global.stopFlags.has(questId)) {
      throw new Error("تم الإيقاف يدوياً");
    }

    // حساب التقدم مع jitter
    const baseTimestamp = Math.min(step * intervalMs * speedMultiplier, durationMs);
    const jitterMs = Math.random() * 500; // 0-500ms
    const timestamp = Math.floor(baseTimestamp + jitterMs);

    try {
      await axios.post(
        `${DISCORD_API}/quests/${questId}/video-progress`,
        { timestamp },
        { headers: buildHeaders(token), timeout: 15000 }
      );
    } catch (err) {
      // 429 = Rate Limit، ننتظر ونكمل
      if (err.response && err.response.status === 429) {
        const retryAfter = (err.response.data?.retry_after || 5) * 1000;
        await new Promise((r) => setTimeout(r, retryAfter));
        continue;
      }
      throw err;
    }

    if (onUpdate) {
      const percent = Math.min(Math.round((step / totalSteps) * 100), 100);
      onUpdate({ questId, questName: quest.config?.messages?.questName || questId, status: "running", percent });
    }

    // انتظار مع jitter
    const waitTime = effectiveInterval + Math.random() * 3000;
    await new Promise((r) => setTimeout(r, waitTime));
  }

  return true;
}

// ===== حل مهمة لعب (PLAY_ON_DESKTOP) =====
async function solveGameQuest(token, quest, onUpdate) {
  const questId = quest.id;
  const applicationId = quest.config?.application?.id;
  const durationMs = quest.config?.taskConfig?.durationMs || 900000;
  const intervalMs = 60000; // 60 ثانية

  if (!applicationId) {
    throw new Error("لا يوجد application_id لهذه المهمة");
  }

  const totalSteps = Math.ceil(durationMs / intervalMs);

  for (let step = 1; step <= totalSteps; step++) {
    // توقف لو المستخدم ضغط إيقاف
    if (global.stopFlags && global.stopFlags.has(questId)) {
      throw new Error("تم الإيقاف يدوياً");
    }

    try {
      // إرسال heartbeat مع application_id
      await axios.post(
        `${DISCORD_API}/quests/${questId}/heartbeats`,
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
      throw err;
    }

    if (onUpdate) {
      const percent = Math.min(Math.round((step / totalSteps) * 100), 100);
      onUpdate({ questId, questName: quest.config?.messages?.questName || questId, status: "running", percent });
    }

    // انتظار مع jitter (بين 58-65 ثانية)
    await new Promise((r) => setTimeout(r, intervalMs + Math.random() * 7000));
  }

  return true;
}

// ===== المحرك الرئيسي =====
async function solveSequentially(token, onUpdate) {
  const results = [];

  try {
    // 1. جلب المهام
    const quests = await fetchQuests(token);

    if (!quests || quests.length === 0) {
      return { success: true, quests: [], message: "لا توجد مهام متاحة" };
    }

    // 2. فلترة المهام غير المكتملة
    const pending = quests.filter((q) => {
      const status = String(q.status || q.userStatus?.status || "").toUpperCase();
      return status !== "COMPLETED" && status !== "CLAIMED" && status !== "REJECTED";
    });

    // 3. المهام المكتملة مسبقاً
    const alreadyDone = quests
      .filter((q) => {
        const status = String(q.status || q.userStatus?.status || "").toUpperCase();
        return status === "COMPLETED" || status === "CLAIMED" || status === "REJECTED";
      })
      .map((q) => ({
        id: q.id,
        name: q.config?.messages?.questName || q.id,
        type: q.config?.taskConfig?.taskType || "UNKNOWN",
        status: String(q.status || q.userStatus?.status || "UNKNOWN").toUpperCase(),
        reward: q.config?.rewardsConfig?.orbReward || 0,
      }));

    if (pending.length === 0) {
      return { success: true, quests: alreadyDone, message: "كل المهام مكتملة مسبقاً" };
    }

    // 4. حل المهام واحدة واحدة
    for (const quest of pending) {
      const questId = quest.id;
      const questName = quest.config?.messages?.questName || questId;
      const questType = quest.config?.taskConfig?.taskType || "UNKNOWN";

      try {
        if (onUpdate) {
          onUpdate({ questId, questName, status: "running", percent: 0 });
        }

        if (questType === "WATCH_VIDEO" || questType === "WATCH_VIDEO_ON_MOBILE") {
          await solveVideoQuest(token, quest, onUpdate);
        } else if (questType === "PLAY_ON_DESKTOP") {
          await solveGameQuest(token, quest, onUpdate);
        } else {
          throw new Error(`نوع المهمة غير مدعوم: ${questType}`);
        }

        results.push({
          id: questId,
          name: questName,
          type: questType,
          status: "COMPLETED",
          reward: quest.config?.rewardsConfig?.orbReward || 0,
        });

        if (onUpdate) {
          onUpdate({ questId, questName, status: "completed", percent: 100 });
        }

        // تأخير بين المهام (5-15 ثانية)
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
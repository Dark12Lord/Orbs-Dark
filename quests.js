// quests.js - محرك المهام المباشر مع لوقات تفصيلية
const axios = require("axios");
const crypto = require("crypto");
const config = require("./config");

const DISCORD_API = "https://discord.com/api/v9";

// ===== دوال مساعدة لتوليد الترويسات الأمنية =====
function generateRandomHex(length = 32) {
  return crypto.randomBytes(length).toString("hex");
}

function generateLaunchSignature() {
  const buildNumber = 345678;
  const clientLaunchId = generateRandomHex(16);
  const signature = `${clientLaunchId}.${buildNumber}.${generateRandomHex(8)}`;
  return signature;
}

function buildSuperProperties() {
  const data = {
    os: "Windows",
    browser: "Discord Client",
    release_channel: "stable",
    client_version: "1.0.9174",
    os_version: "10.0.19045",
    os_arch: "x64",
    system_locale: "en-US",
    client_launch_id: generateRandomHex(32),
    launch_signature: generateLaunchSignature(),
    client_heartbeat_session_id: generateRandomHex(16),
    x_installation_id: generateRandomHex(16),
  };
  return Buffer.from(JSON.stringify(data)).toString("base64");
}

function buildHeaders(token) {
  return {
    Authorization: token,
    "Content-Type": "application/json",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) discord/1.0.9174 Chrome/120.0.0.0 Electron/28.0.0 Safari/537.36",
    "X-Super-Properties": buildSuperProperties(),
    "X-Discord-Locale": "en-US",
    "X-Discord-Timezone": "Asia/Riyadh",
    "Accept-Language": "en-US,en;q=0.9",
  };
}

function jitter(minMs, maxMs) {
  const delay = Math.floor(Math.random() * (maxMs - minMs) + minMs);
  return new Promise((resolve) => setTimeout(resolve, delay));
}

// ===== دالة تسجيل موحدة =====
function log(tag, msg, data) {
  const timestamp = new Date().toISOString();
  if (data !== undefined) {
    console.log(`[${timestamp}] [${tag}] ${msg}`, JSON.stringify(data).slice(0, 500));
  } else {
    console.log(`[${timestamp}] [${tag}] ${msg}`);
  }
}

// ===== جلب المهام =====
async function fetchQuests(token) {
  log("fetchQuests", "🔄 جاري جلب المهام من Discord...");
  
  try {
    const res = await axios.get(`${DISCORD_API}/quests/@me`, {
      headers: buildHeaders(token),
      timeout: 15000,
    });

    const data = res.data;
    log("fetchQuests", `✅ تم الجلب - type: ${typeof data}, isArray: ${Array.isArray(data)}`);

    if (data && !Array.isArray(data)) {
      log("fetchQuests", `مفاتيح الرد: ${Object.keys(data).join(", ")}`);
      
      // سجل معلومات إضافية عن الحظر
      if (data.quest_enrollment_blocked_until) {
        log("fetchQuests", `⚠️ الحساب محظور من التسجيل حتى: ${data.quest_enrollment_blocked_until}`);
      }
      if (data.quest_access_suspended_until) {
        log("fetchQuests", `⚠️ الحساب موقوف من الوصول حتى: ${data.quest_access_suspended_until}`);
      }
      if (data.excluded_quests) {
        log("fetchQuests", `عدد المهام المستثناة: ${data.excluded_quests.length}`);
      }
    }

    if (Array.isArray(data)) {
      log("fetchQuests", `تم استخراج ${data.length} مهمة (مصفوفة مباشرة)`);
      return data;
    }
    if (data && Array.isArray(data.quests)) {
      log("fetchQuests", `تم استخراج ${data.quests.length} مهمة (من data.quests)`);
      return data.quests;
    }
    if (data && Array.isArray(data.data)) {
      log("fetchQuests", `تم استخراج ${data.data.length} مهمة (من data.data)`);
      return data.data;
    }

    log("fetchQuests", `❌ شكل غير متوقع: ${JSON.stringify(data).slice(0, 300)}`);
    return [];
  } catch (err) {
    const status = err.response?.status || "?";
    const msg = err.response?.data?.message || err.message;
    log("fetchQuests", `❌ فشل الجلب [${status}]: ${msg}`);
    throw err;
  }
}

// ===== دوال استخراج البيانات =====
function getQuestStatus(quest) {
  const s =
    quest.user_status?.status ||
    quest.userStatus?.status ||
    quest.status ||
    quest.state ||
    "UNKNOWN";
  return String(s).toUpperCase();
}

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

function getQuestType(quest) {
  return (
    quest.config?.task_config?.task_type ||
    quest.config?.taskConfig?.taskType ||
    quest.type ||
    "UNKNOWN"
  );
}

function getQuestReward(quest) {
  return (
    quest.config?.rewards_config?.orb_reward ||
    quest.config?.rewardsConfig?.orbReward ||
    quest.reward ||
    0
  );
}

function getApplicationId(quest) {
  return (
    quest.config?.application?.id ||
    quest.config?.application_id ||
    quest.application_id ||
    null
  );
}

function getDuration(quest) {
  return (
    quest.config?.task_config?.duration ||
    quest.config?.taskConfig?.durationMs ||
    quest.config?.task_config?.video_duration_ms ||
    900000
  );
}

// ===== قبول المهمة =====
async function acceptQuest(token, questId) {
  log("accept", `📝 قبول المهمة ${questId}...`);
  try {
    const res = await axios.post(
      `${DISCORD_API}/quests/${questId}/accept`,
      {},
      { headers: buildHeaders(token), timeout: 15000 }
    );
    log("accept", `✅ تم القبول [${res.status}] ${questId}`);
    return true;
  } catch (err) {
    const status = err.response?.status;
    const msg = err.response?.data?.message || err.message;
    const data = err.response?.data;
    
    if (status === 400) {
      log("accept", `⚠️ مقبولة مسبقاً ${questId}`);
      return true;
    }
    
    log("accept", `❌ فشل القبول [${status}]: ${msg}`);
    if (data && typeof data === "object") {
      log("accept", `تفاصيل الخطأ:`, data);
    }
    throw new Error(`accept failed [${status}]: ${msg}`);
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

  log("video", `🎬 بدء مهمة فيديو: ${questName}`);
  log("video", `المدة: ${durationMs}ms | الخطوات: ${totalSteps} | السرعة: ${speedMultiplier}x`);

  // 1. قبول المهمة
  await acceptQuest(token, questId);

  // 2. إرسال التقدم
  let successCount = 0;
  let failCount = 0;

  for (let step = 1; step <= totalSteps; step++) {
    if (global.stopFlags && global.stopFlags.has(questId)) {
      log("video", `⏹️ تم الإيقاف يدوياً ${questId}`);
      throw new Error("تم الإيقاف يدوياً");
    }

    const baseTimestamp = Math.min(step * intervalMs * speedMultiplier, durationMs);
    const timestamp = Math.floor(baseTimestamp + Math.random() * 500);

    try {
      const res = await axios.post(
        `${DISCORD_API}/quests/${questId}/video-progress`,
        { timestamp },
        { headers: buildHeaders(token), timeout: 15000 }
      );
      
      successCount++;
      
      // سجل كل 5 خطوات عشان ما يتعب اللوق
      if (step === 1 || step === totalSteps || step % 5 === 0) {
        const percent = Math.min(Math.round((step / totalSteps) * 100), 100);
        log("video", `▶️ خطوة ${step}/${totalSteps} (${percent}%) - timestamp: ${timestamp} - status: ${res.status}`);
      }
    } catch (err) {
      const status = err.response?.status;
      const msg = err.response?.data?.message || err.message;
      
      // Rate Limit
      if (status === 429) {
        const retryAfter = (err.response.data?.retry_after || 5) * 1000;
        log("video", `⏸️ Rate limit! ننتظر ${retryAfter}ms`);
        await new Promise((r) => setTimeout(r, retryAfter));
        continue;
      }
      
      failCount++;
      log("video", `❌ فشل خطوة ${step}/${totalSteps} [${status}]: ${msg}`);
      
      // لو 3 أخطاء متتالية، نوقف
      if (failCount >= 3) {
        log("video", `❌ 3 أخطاء متتالية، إيقاف المهمة`);
        throw new Error(`video-progress failed [${status}]: ${msg}`);
      }
      
      // انتظر قبل المحاولة الثانية
      await new Promise((r) => setTimeout(r, 5000));
      continue;
    }

    if (onUpdate) {
      const percent = Math.min(Math.round((step / totalSteps) * 100), 100);
      onUpdate({ questId, questName, status: "running", percent });
    }

    await new Promise((r) => setTimeout(r, effectiveInterval + Math.random() * 3000));
  }

  log("video", `✅ اكتملت مهمة الفيديو ${questId} - نجح: ${successCount}, فشل: ${failCount}`);
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
    log("game", `❌ لا يوجد application_id للمهمة ${questId}`);
    throw new Error("application_id غير موجود للمهمة");
  }

  log("game", `🎮 بدء مهمة لعب: ${questName}`);
  log("game", `application_id: ${applicationId} | المدة: ${durationMs}ms`);

  // 1. قبول المهمة
  await acceptQuest(token, questId);

  // 2. إرسال النبضات
  const totalSteps = Math.ceil(durationMs / intervalMs);
  let successCount = 0;
  let failCount = 0;

  for (let step = 1; step <= totalSteps; step++) {
    if (global.stopFlags && global.stopFlags.has(questId)) {
      log("game", `⏹️ تم الإيقاف يدوياً ${questId}`);
      throw new Error("تم الإيقاف يدوياً");
    }

    try {
      const res = await axios.post(
        `${DISCORD_API}/quests/${questId}/heartbeat`,
        {
          application_id: applicationId,
          terminal: false,
        },
        { headers: buildHeaders(token), timeout: 15000 }
      );
      
      successCount++;
      
      if (step === 1 || step === totalSteps || step % 3 === 0) {
        const percent = Math.min(Math.round((step / totalSteps) * 100), 100);
        log("game", `💓 نبضة ${step}/${totalSteps} (${percent}%) - status: ${res.status}`);
      }
    } catch (err) {
      const status = err.response?.status;
      const msg = err.response?.data?.message || err.message;
      
      if (status === 429) {
        const retryAfter = (err.response.data?.retry_after || 5) * 1000;
        log("game", `⏸️ Rate limit! ننتظر ${retryAfter}ms`);
        await new Promise((r) => setTimeout(r, retryAfter));
        continue;
      }
      
      failCount++;
      log("game", `❌ فشل نبضة ${step}/${totalSteps} [${status}]: ${msg}`);
      
      if (failCount >= 3) {
        log("game", `❌ 3 أخطاء متتالية، إيقاف المهمة`);
        throw new Error(`heartbeat failed [${status}]: ${msg}`);
      }
      
      await new Promise((r) => setTimeout(r, 5000));
      continue;
    }

    if (onUpdate) {
      const percent = Math.min(Math.round((step / totalSteps) * 100), 100);
      onUpdate({ questId, questName, status: "running", percent });
    }

    await new Promise((r) => setTimeout(r, intervalMs + Math.random() * 7000));
  }

  log("game", `✅ اكتملت مهمة اللعب ${questId} - نجح: ${successCount}, فشل: ${failCount}`);
  return true;
}

// ===== المحرك الرئيسي =====
async function solveSequentially(token, onUpdate) {
  const results = [];
  const startTime = Date.now();

  log("main", "🚀 بدء جلسة حل المهام");

  try {
    const quests = await fetchQuests(token);

    if (!Array.isArray(quests)) {
      log("main", "❌ fetchQuests لم يُرجع مصفوفة");
      return { success: false, error: "fetchQuests لم يُرجع مصفوفة" };
    }

    log("main", `📋 إجمالي المهام: ${quests.length}`);

    if (quests.length === 0) {
      log("main", "✅ لا توجد مهام متاحة");
      return { success: true, quests: [], message: "لا توجد مهام متاحة" };
    }

    // تصنيف المهام
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

    log("main", `📊 معلقة: ${pending.length} | مكتملة مسبقاً: ${alreadyDone.length}`);

    // تفصيل الأنواع
    const typeCounts = {};
    for (const q of pending) {
      const t = getQuestType(q);
      typeCounts[t] = (typeCounts[t] || 0) + 1;
    }
    log("main", `📈 أنواع المهام المعلقة:`, typeCounts);

    if (pending.length === 0) {
      log("main", "✅ كل المهام مكتملة مسبقاً");
      return { success: true, quests: alreadyDone, message: "كل المهام مكتملة مسبقاً" };
    }

    // حل المهام
    for (let i = 0; i < pending.length; i++) {
      const quest = pending[i];
      const questId = quest.id;
      const questName = getQuestName(quest);
      const questType = getQuestType(quest);

      log("main", `\n[${i + 1}/${pending.length}] ▶️ ${questName} (${questType})`);

      try {
        if (onUpdate) {
          onUpdate({ questId, questName, status: "running", percent: 0 });
        }

        if (questType === "WATCH_VIDEO" || questType === "WATCH_VIDEO_ON_MOBILE") {
          await solveVideoQuest(token, quest, onUpdate);
        } else if (questType === "PLAY_ON_DESKTOP" || questType === "PLAY_ACTIVITY") {
          await solveGameQuest(token, quest, onUpdate);
        } else {
          log("main", `⏭️ نوع غير مدعوم: ${questType}`);
          throw new Error(`نوع غير مدعوم: ${questType}`);
        }

        results.push({
          id: questId,
          name: questName,
          type: questType,
          status: "COMPLETED",
          reward: getQuestReward(quest),
        });

        log("main", `✅ اكتملت: ${questName}`);

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

        log("main", `❌ فشلت: ${questName} - ${err.message}`);

        if (onUpdate) {
          onUpdate({ questId, questName, status: "rejected", error: err.message });
        }
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const succeeded = results.filter((r) => r.status === "COMPLETED").length;
    const failed = results.filter((r) => r.status === "REJECTED").length;

    log("main", `\n🏁 انتهت الجلسة - نجح: ${succeeded}, فشل: ${failed}, الوقت: ${elapsed}s`);

    return { success: true, quests: [...alreadyDone, ...results] };
  } catch (err) {
    log("main", `❌ خطأ عام: ${err.message}`);
    return { success: false, error: err.message };
  }
}

module.exports = { solveSequentially };
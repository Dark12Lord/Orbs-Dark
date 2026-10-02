// quests.js - محرك المهام مع دعم task_config_v2 (تحديث أكتوبر 2026)
const axios = require("axios");
const crypto = require("crypto");
let DiscordQuests = null;

async function loadQuestsLib() {
    if (!DiscordQuests) {
        const mod = await import("discord-quests");
        DiscordQuests = mod.DiscordQuests || mod.default?.DiscordQuests || mod.default;
        if (!DiscordQuests) throw new Error("فشل تحميل DiscordQuests");
    }
    return DiscordQuests;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const DISCORD_API = "https://discord.com/api/v9";

// ✅ ترويسات كاملة مع client_launch_id و launch_signature
function buildHeaders(token) {
    const clientLaunchId = crypto.randomBytes(16).toString("hex");
    const launchSignature = `${clientLaunchId}.345678.${crypto.randomBytes(8).toString("hex")}`;
    const superProps = {
        os: "Windows", browser: "Discord Client", release_channel: "stable",
        client_version: "1.0.9174", os_version: "10.0.19045", os_arch: "x64",
        system_locale: "en-US", client_launch_id: clientLaunchId,
        launch_signature: launchSignature,
        client_heartbeat_session_id: crypto.randomBytes(16).toString("hex"),
        x_installation_id: crypto.randomBytes(16).toString("hex"),
    };
    return {
        Authorization: token,
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) discord/1.0.9174 Chrome/120.0.0.0 Electron/28.0.0 Safari/537.36",
        "X-Super-Properties": Buffer.from(JSON.stringify(superProps)).toString("base64"),
        "X-Discord-Locale": "en-US",
        "X-Discord-Timezone": "Asia/Riyadh",
        "Accept-Language": "en-US,en;q=0.9",
        Referer: "https://discord.com/quest-home",
    };
}

function renderProgressBar(percent, width = 20) {
    const filled = Math.round((percent / 100) * width);
    return `[${'█'.repeat(filled)}${'░'.repeat(width - filled)}] ${percent}%`;
}

const SUPPORTED_TYPES = ['WATCH_VIDEO', 'PLAY_ON_DESKTOP'];

// ✅ استخراج taskConfig من task_config_v2 (المسار الصحيح)
function getTaskConfig(quest) {
    return quest.config?.task_config_v2 || quest.config?.taskConfigV2 || null;
}

// ✅ استخراج اسم المهمة
function extractTaskName(quest) {
    const tc = getTaskConfig(quest);
    if (!tc?.tasks) return 'UNKNOWN';
    for (const k of Object.keys(tc.tasks)) {
        if (SUPPORTED_TYPES.includes(k)) return k;
    }
    const keys = Object.keys(tc.tasks);
    return keys.length > 0 ? keys[0] : 'UNKNOWN';
}

// ✅ استخراج application_id من task_config_v2 (المسار الصحيح)
function extractApplicationId(quest, taskName) {
    const tc = getTaskConfig(quest);
    if (tc?.tasks?.[taskName]?.applications?.[0]?.id) {
        return tc.tasks[taskName].applications[0].id;
    }
    // fallback للمسار القديم
    if (quest.config?.application?.id) return quest.config.application.id;
    return null;
}

// ✅ استخراج مدة الفيديو بالثواني
function extractVideoDurationSeconds(quest, taskName) {
    const tc = getTaskConfig(quest);
    const task = tc?.tasks?.[taskName];
    if (task?.target) return task.target;
    if (task?.video_duration_ms) return Math.round(task.video_duration_ms / 1000);
    return 900;
}

function normalizeStatus(status) {
    const s = String(status || '').toLowerCase();
    if (['completed', 'already_completed', 'claimed'].includes(s)) return 'COMPLETED';
    if (['rejected', 'error', 'enroll_failed', 'failed'].includes(s)) return 'REJECTED';
    if (['running', 'in_progress'].includes(s)) return 'running';
    if (['unsupported'].includes(s)) return 'UNSUPPORTED';
    return 'PENDING';
}

function toQuestShape(raw, extra = {}) {
    return {
        id: raw.id || raw.questId || extra.id || '',
        name: raw.name || raw.questName || extra.name || raw.id || 'مهمة',
        type: extractTaskName(raw) !== 'UNKNOWN' ? extractTaskName(raw) : (extra.type || 'UNKNOWN'),
        status: normalizeStatus(raw.status || extra.status),
        percent: typeof raw.percent === 'number' ? raw.percent : (extra.percent || 0),
        error: raw.error || extra.error || null,
    };
}

// ✅ إرسال video-progress مع timestamp بالثواني
async function sendVideoProgress(token, questId, timestampSec) {
    const headers = buildHeaders(token);
    const res = await axios.post(
        `${DISCORD_API}/quests/${questId}/video-progress`,
        { timestamp: timestampSec },
        { headers, timeout: 20000 }
    );
    return res.data;
}

// ✅ إرسال heartbeat لمهام اللعب
async function sendHeartbeat(token, questId, applicationId) {
    const headers = buildHeaders(token);
    const res = await axios.post(
        `${DISCORD_API}/quests/${questId}/heartbeat`,
        { application_id: applicationId, terminal: false },
        { headers, timeout: 20000 }
    );
    return res.data;
}

async function solveSequentially(token, onUpdate, signal = {}) {
    const results = [];
    console.log('\n' + '='.repeat(50));
    console.log('🚀 Dark Orbs - بدء جلسة حل المهام');
    console.log('='.repeat(50) + '\n');

    try {
        const QuestsClass = await loadQuestsLib();
        const dq = new QuestsClass(token);

        if (typeof dq.validateToken === 'function') {
            const valid = await dq.validateToken();
            if (!valid) {
                console.log('❌ التوكن غير صالح');
                return { success: false, error: 'التوكن غير صالح' };
            }
            console.log('✅ تم التحقق من التوكن\n');
        }

        if (signal.stopped) return { success: false, error: 'stopped' };

        const statusList = await dq.getStatus();
        console.log(`📊 إجمالي المهام: ${statusList.length}\n`);

        // ✅ طباعة بنية أول مهمة (للتشخيص)
        if (statusList.length > 0) {
            console.log('═══════════════════════════════════════════════');
            console.log('🔍 بنية أول مهمة (للتشخيص):');
            console.log(JSON.stringify(statusList[0], null, 2).slice(0, 3000));
            console.log('═══════════════════════════════════════════════\n');
        }

        const supported = [];
        const skippedDone = [];
        const skippedType = [];

        for (const s of statusList) {
            if (s.completed) { skippedDone.push(s); continue; }
            if (s.solvable === false) { skippedType.push(s); continue; }
            const type = extractTaskName(s);
            if (SUPPORTED_TYPES.includes(type)) supported.push(s);
            else skippedType.push(s);
        }

        console.log(`✅ مهام قابلة للحل: ${supported.length}`);
        console.log(`✔️ مكتملة: ${skippedDone.length}`);
        console.log(`⏭️ أنواع غير مدعومة: ${skippedType.length}\n`);

        const skippedResults = [
            ...skippedDone.map(s => ({ id: s.id, name: s.name || s.id, type: extractTaskName(s), status: 'COMPLETED', percent: 100, error: null })),
            ...skippedType.map(s => ({ id: s.id, name: s.name || s.id, type: extractTaskName(s), status: 'UNSUPPORTED', percent: 0, error: null })),
        ];

        if (supported.length === 0) {
            console.log('ℹ️ لا توجد مهام قابلة للحل.');
            if (onUpdate) skippedResults.forEach(r => onUpdate(r));
            return { success: true, quests: skippedResults };
        }

        for (let i = 0; i < supported.length; i++) {
            if (signal.stopped) {
                console.log(`\n⏹️ تم الإيقاف عند المهمة ${i + 1}`);
                break;
            }

            const quest = supported[i];
            const questId = quest.id;
            const questName = quest.name || questId;
            const taskName = extractTaskName(quest);

            console.log(`\n[${i + 1}/${supported.length}] ═══════════════════`);
            console.log(`   📌 ${questName} (${taskName})`);

            if (onUpdate) onUpdate(toQuestShape(quest, { status: 'running', percent: 0 }));

            try {
                // Enroll أولاً
                try {
                    await axios.post(`${DISCORD_API}/quests/${questId}/enroll`, {}, {
                        headers: buildHeaders(token), timeout: 15000
                    });
                    console.log(`   ✅ تم التسجيل`);
                } catch (e) {
                    if (e.response?.status === 400) console.log(`   ⚠️ مسجل مسبقاً`);
                    else console.log(`   ⚠️ التسجيل: ${e.response?.status} ${e.message}`);
                }

                const TIMEOUT_MS = 25 * 60 * 1000;
                const startTime = Date.now();

                if (taskName === 'WATCH_VIDEO') {
                    const durationSec = extractVideoDurationSeconds(quest, 'WATCH_VIDEO');
                    const enrolledAt = quest.userStatus?.enrolledAt || quest.user_status?.enrolled_at;
                    const enrolledMs = enrolledAt ? new Date(enrolledAt).getTime() : Date.now();
                    
                    let secondsDone = quest.userStatus?.progress?.WATCH_VIDEO?.value || 0;
                    const speed = 7; // 7 ثواني لكل طلب
                    const intervalMs = 8000; // 8 ثواني بين الطلبات
                    
                    console.log(`   🎬 مدة: ${Math.round(durationSec/60)} دقيقة | متقدم: ${secondsDone}s`);

                    while (secondsDone < durationSec) {
                        if (signal.stopped) throw new Error('تم الإيقاف يدوياً');
                        if (Date.now() - startTime > TIMEOUT_MS) throw new Error('تجاوز الوقت');

                        // حساب الحد الأقصى المسموح (لمنع الكشف)
                        const elapsedSec = Math.floor((Date.now() - enrolledMs) / 1000);
                        const maxAllowed = elapsedSec + 10; // هامش 10 ثواني
                        
                        if (secondsDone >= maxAllowed) {
                            await sleep(2000);
                            continue;
                        }

                        const nextTimestamp = Math.min(durationSec, secondsDone + speed);
                        
                        try {
                            const result = await sendVideoProgress(token, questId, nextTimestamp);
                            
                            if (result?.completed_at) {
                                console.log(`\n   ✅ اكتملت فعلياً`);
                                break;
                            }
                            
                            secondsDone = nextTimestamp;
                            const percent = Math.min(Math.round((secondsDone / durationSec) * 100), 100);
                            process.stdout.write(`\r   ${renderProgressBar(percent)}`);
                            if (onUpdate) onUpdate(toQuestShape(quest, { status: 'running', percent }));
                        } catch (e) {
                            const status = e.response?.status;
                            const msg = e.response?.data?.message || e.message;
                            
                            if (status === 429) {
                                const retry = (e.response.data?.retry_after || 5) * 1000;
                                console.log(`   ⏸️ Rate limit: ${retry}ms`);
                                await sleep(retry);
                                continue;
                            }
                            throw new Error(`video-progress [${status}]: ${msg}`);
                        }
                        
                        await sleep(intervalMs);
                    }

                } else if (taskName === 'PLAY_ON_DESKTOP') {
                    const appId = extractApplicationId(quest, 'PLAY_ON_DESKTOP');
                    
                    if (!appId) {
                        console.log(`   ❌ application_id غير موجود في task_config_v2`);
                        throw new Error('application_id غير موجود');
                    }

                    const durationSec = 900;
                    const intervalSec = 60;
                    const totalSteps = Math.ceil(durationSec / intervalSec);
                    console.log(`   🎮 App: ${appId} | خطوات: ${totalSteps}`);

                    for (let step = 1; step <= totalSteps; step++) {
                        if (signal.stopped) throw new Error('تم الإيقاف يدوياً');
                        if (Date.now() - startTime > TIMEOUT_MS) throw new Error('تجاوز الوقت');

                        try {
                            await sendHeartbeat(token, questId, appId);
                        } catch (e) {
                            const status = e.response?.status;
                            const msg = e.response?.data?.message || e.message;

                            if (status === 429) {
                                const retry = (e.response.data?.retry_after || 5) * 1000;
                                console.log(`   ⏸️ Rate limit: ${retry}ms`);
                                await sleep(retry);
                                step--; continue;
                            }
                            throw new Error(`heartbeat [${status}]: ${msg}`);
                        }

                        const percent = Math.min(Math.round((step / totalSteps) * 100), 100);
                        process.stdout.write(`\r   ${renderProgressBar(percent)}`);
                        if (onUpdate) onUpdate(toQuestShape(quest, { status: 'running', percent }));
                        await sleep(intervalSec * 1000);
                    }
                }

                results.push(toQuestShape(quest, { status: 'COMPLETED', percent: 100 }));
                if (onUpdate) onUpdate(toQuestShape(quest, { status: 'COMPLETED', percent: 100 }));
                console.log(`\n   ✅ اكتملت: ${questName}`);

                if (i < supported.length - 1) {
                    const delay = 5000 + Math.random() * 5000;
                    console.log(`   ⏳ انتظار ${Math.round(delay/1000)} ثانية...`);
                    await sleep(delay);
                }

            } catch (err) {
                console.log(`\n   ❌ فشلت: ${err.message}`);
                const failed = toQuestShape(quest, { status: 'REJECTED', percent: 0, error: err.message });
                results.push(failed);
                if (onUpdate) onUpdate(failed);
                await sleep(5000);
            }
        }

        const succeeded = results.filter(r => r.status === 'COMPLETED').length;
        const failed = results.filter(r => r.status === 'REJECTED').length;

        console.log('\n' + '='.repeat(50));
        console.log(`🏁 انتهت - نجح: ${succeeded}, فشل: ${failed}`);
        console.log('='.repeat(50) + '\n');

        return { success: true, quests: [...results, ...skippedResults], stopped: signal.stopped };

    } catch (err) {
        console.error(`\n❌ خطأ عام: ${err.message}`);
        return { success: false, error: err.message };
    }
}

async function fetchQuestsOnly(token) {
    try {
        const QuestsClass = await loadQuestsLib();
        const dq = new QuestsClass(token);
        const statusList = await dq.getStatus();
        const mapped = statusList.map(s => ({
            id: s.id, name: s.name || s.id, type: extractTaskName(s),
            status: s.completed ? 'COMPLETED' : (s.solvable === false ? 'UNSUPPORTED' : 'PENDING'),
            percent: s.completed ? 100 : 0, error: null,
        }));
        const valid = mapped.filter(q => q.status === 'PENDING' && SUPPORTED_TYPES.includes(q.type));
        return { success: true, allQuests: mapped, valid };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

module.exports = { solveSequentially, fetchQuestsOnly, toQuestShape, normalizeStatus, extractTaskName };

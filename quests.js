// quests.js - محرك المهام مع Heartbeat يدوي وتشخيص كامل
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

function normalizeType(quest) {
    if (!quest) return 'UNKNOWN';
    if (typeof quest.type === 'string') return quest.type;
    if (Array.isArray(quest.tasks) && quest.tasks[0]?.id) return quest.tasks[0].id;
    if (quest.tasks && typeof quest.tasks === 'object') {
        const keys = Object.keys(quest.tasks);
        if (keys.length) return keys[0];
    }
    return 'UNKNOWN';
}

// ✅ استخراج application_id من أماكن متعددة
function extractApplicationId(quest) {
    // محاولات متعددة
    const paths = [
        () => quest.tasks?.PLAY_ON_DESKTOP?.applications?.[0]?.id,
        () => quest.tasks?.PLAY_ON_DESKTOP?.application_id,
        () => quest.config?.task_config_v2?.tasks?.PLAY_ON_DESKTOP?.applications?.[0]?.id,
        () => quest.config?.taskConfigV2?.tasks?.PLAY_ON_DESKTOP?.applications?.[0]?.id,
        () => quest.config?.application?.id,
        () => quest.application?.id,
        () => quest.application_id,
        () => quest._raw?.config?.application?.id,
        () => quest._raw?.config?.task_config_v2?.tasks?.PLAY_ON_DESKTOP?.applications?.[0]?.id,
    ];
    for (const fn of paths) {
        try {
            const v = fn();
            if (v) return v;
        } catch (e) {}
    }
    return null;
}

// ✅ استخراج مدة الفيديو بالثواني
function extractVideoDurationSeconds(quest) {
    const paths = [
        () => quest.tasks?.WATCH_VIDEO?.videoDurationMs,
        () => quest.tasks?.WATCH_VIDEO?.video_duration_ms,
        () => quest.config?.task_config_v2?.tasks?.WATCH_VIDEO?.video_duration_ms,
        () => quest.config?.taskConfigV2?.tasks?.WATCH_VIDEO?.video_duration_ms,
        () => quest._raw?.config?.task_config_v2?.tasks?.WATCH_VIDEO?.video_duration_ms,
    ];
    for (const fn of paths) {
        try {
            const v = fn();
            if (v && typeof v === 'number' && v > 0) {
                return Math.round(v / 1000); // نحوّل لثواني
            }
        } catch (e) {}
    }
    return 900; // 15 دقيقة افتراضي
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
        type: normalizeType(raw) !== 'UNKNOWN' ? normalizeType(raw) : (extra.type || 'UNKNOWN'),
        status: normalizeStatus(raw.status || extra.status),
        percent: typeof raw.percent === 'number' ? raw.percent : (extra.percent || 0),
        error: raw.error || extra.error || null,
    };
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

        // ✅ طباعة بنية أول مهمة في كل تشغيل (للتشخيص)
        if (statusList.length > 0) {
            console.log('═══════════════════════════════════════════════');
            console.log('🔍 بنية أول مهمة (للتشخيص):');
            console.log(JSON.stringify(statusList[0], null, 2).slice(0, 2500));
            console.log('═══════════════════════════════════════════════\n');
        }

        const supported = [];
        const skippedDone = [];
        const skippedType = [];

        for (const s of statusList) {
            if (s.completed) { skippedDone.push(s); continue; }
            if (s.solvable === false) { skippedType.push(s); continue; }
            const type = normalizeType(s);
            if (SUPPORTED_TYPES.includes(type)) supported.push(s);
            else skippedType.push(s);
        }

        console.log(`✅ مهام قابلة للحل: ${supported.length}`);
        console.log(`✔️ مكتملة: ${skippedDone.length}`);
        console.log(`⏭️ أنواع غير مدعومة: ${skippedType.length}\n`);

        const skippedResults = [
            ...skippedDone.map(s => ({ id: s.id, name: s.name || s.id, type: normalizeType(s), status: 'COMPLETED', percent: 100, error: null })),
            ...skippedType.map(s => ({ id: s.id, name: s.name || s.id, type: normalizeType(s), status: 'UNSUPPORTED', percent: 0, error: null })),
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
            const questType = normalizeType(quest);

            console.log(`\n[${i + 1}/${supported.length}] ═══════════════════`);
            console.log(`   📌 ${questName} (${questType})`);

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

                const TIMEOUT_MS = 20 * 60 * 1000;
                const startTime = Date.now();

                if (questType === 'WATCH_VIDEO') {
                    // ✅ timestamp بالثواني (وليس ms)
                    const durationSec = extractVideoDurationSeconds(quest);
                    const intervalSec = 30;
                    const totalSteps = Math.ceil(durationSec / intervalSec);
                    console.log(`   🎬 مدة: ${Math.round(durationSec/60)} دقيقة | خطوات: ${totalSteps}`);

                    for (let step = 1; step <= totalSteps; step++) {
                        if (signal.stopped) throw new Error('تم الإيقاف يدوياً');
                        if (Date.now() - startTime > TIMEOUT_MS) throw new Error('تجاوز الوقت');

                        // ✅ timestamp بالثواني
                        const timestampSec = Math.min(step * intervalSec, durationSec);
                        
                        try {
                            await axios.post(`${DISCORD_API}/quests/${questId}/video-progress`,
                                { timestamp: timestampSec },
                                { headers: buildHeaders(token), timeout: 15000 });
                        } catch (e) {
                            const status = e.response?.status;
                            const msg = e.response?.data?.message || e.message;
                            
                            if (status === 429) {
                                const retry = (e.response.data?.retry_after || 5) * 1000;
                                console.log(`   ⏸️ Rate limit: ${retry}ms`);
                                await sleep(retry);
                                step--; continue;
                            }
                            throw new Error(`video-progress [${status}]: ${msg} (timestamp=${timestampSec}s)`);
                        }

                        const percent = Math.min(Math.round((step / totalSteps) * 100), 100);
                        process.stdout.write(`\r   ${renderProgressBar(percent)}`);
                        if (onUpdate) onUpdate(toQuestShape(quest, { status: 'running', percent }));
                        await sleep(intervalSec * 1000);
                    }

                } else if (questType === 'PLAY_ON_DESKTOP') {
                    // ✅ نستخرج application_id من مسارات متعددة
                    const appId = extractApplicationId(quest);
                    
                    if (!appId) {
                        console.log(`   ❌ application_id غير موجود`);
                        console.log(`   🔍 quest.tasks keys:`, Object.keys(quest.tasks || {}));
                        console.log(`   🔍 quest.config keys:`, Object.keys(quest.config || {}));
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
                            await axios.post(`${DISCORD_API}/quests/${questId}/heartbeat`,
                                { application_id: appId, terminal: false },
                                { headers: buildHeaders(token), timeout: 20000 });
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
                    const delay = 2000 + Math.random() * 3000;
                    console.log(`   ⏳ انتظار ${Math.round(delay/1000)} ثانية...`);
                    await sleep(delay);
                }

            } catch (err) {
                console.log(`\n   ❌ فشلت: ${err.message}`);
                const failed = toQuestShape(quest, { status: 'REJECTED', percent: 0, error: err.message });
                results.push(failed);
                if (onUpdate) onUpdate(failed);
                await sleep(2000);
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
            id: s.id, name: s.name || s.id, type: normalizeType(s),
            status: s.completed ? 'COMPLETED' : (s.solvable === false ? 'UNSUPPORTED' : 'PENDING'),
            percent: s.completed ? 100 : 0, error: null,
        }));
        const valid = mapped.filter(q => q.status === 'PENDING' && SUPPORTED_TYPES.includes(q.type));
        return { success: true, allQuests: mapped, valid };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

module.exports = { solveSequentially, fetchQuestsOnly, toQuestShape, normalizeStatus, normalizeType };

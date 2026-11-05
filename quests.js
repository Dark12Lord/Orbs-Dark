// quests.js - محرك Discord Quests المباشر
// مع دعم البروكسي عبر proxy.js (تدوير تلقائي)
// مع تحديث دوري لبصمة X-Super-Properties

const crypto = require('crypto');
const axios = require('axios');
const { getProxyAgent, PROXIES } = require('./proxy');

const DISCORD_API = 'https://discord.com/api/v10';

const SUPPORTED_TYPES = ['PLAY_ON_DESKTOP', 'WATCH_VIDEO'];
const TASK_PRIORITY = ['PLAY_ON_DESKTOP', 'WATCH_VIDEO'];

const HEARTBEAT_INTERVAL_MS = 20_000;
const VIDEO_TICK_MS = 1_000;
const VIDEO_STEP_SECONDS = 7;
const VIDEO_MAX_FUTURE_SECONDS = 10;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 5;
const QUEST_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_NO_PROGRESS_HEARTBEATS = 10;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function sleepWithSignal(ms, signal) {
    if (!signal || !signal.stopped) return sleep(ms);
    return Promise.resolve();
}

function renderProgressBar(percent, width = 20) {
    const safe = Math.max(0, Math.min(100, Number(percent) || 0));
    const filled = Math.round((safe / 100) * width);
    return `[${'█'.repeat(filled)}${'░'.repeat(width - filled)}] ${Math.round(safe)}%`;
}

function makeError(message, details = {}) {
    const err = new Error(message);
    Object.assign(err, details);
    return err;
}

function buildSuperProperties() {
    const userAgent =
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) discord/1.0.9215 Chrome/138.0.7204.251 ' +
        'Electron/37.6.0 Safari/537.36';

    const properties = {
        os: 'Windows',
        browser: 'Discord Client',
        release_channel: 'stable',
        client_version: '1.0.9215',
        os_version: '10.0.19045',
        os_arch: 'x64',
        app_arch: 'x64',
        system_locale: 'en-US',
        has_client_mods: false,
        client_launch_id: crypto.randomUUID(),
        browser_user_agent: userAgent,
        browser_version: '37.6.0',
        os_sdk_version: '19045',
        client_build_number: 471091,
        native_build_number: 72186,
        client_event_source: null,
    };

    return Buffer.from(JSON.stringify(properties)).toString('base64');
}

function buildHeaders(token) {
    if (typeof token !== 'string' || !token.trim()) {
        throw new Error('توكن Discord غير موجود');
    }

    return {
        Authorization: token.trim(),
        'Content-Type': 'application/json',
        'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
            '(KHTML, like Gecko) discord/1.0.9215 Chrome/138.0.7204.251 ' +
            'Electron/37.6.0 Safari/537.36',
        'X-Super-Properties': buildSuperProperties(),
        'X-Discord-Locale': 'en-US',
        Origin: 'https://discord.com',
        Referer: 'https://discord.com/channels/@me',
    };
}

class DiscordQuestClient {
    constructor(token) {
        this.token = token;
        this.headers = buildHeaders(token);
        this._lastHeaderRefresh = Date.now();
        this._agent = getProxyAgent();
        this._proxyRotations = 0;
    }

    _refreshHeadersIfNeeded() {
        if (Date.now() - this._lastHeaderRefresh > 10 * 60 * 1000) {
            this.headers = buildHeaders(this.token);
            this._lastHeaderRefresh = Date.now();
        }
    }

    _rotateProxy() {
        if (PROXIES.length <= 1) return false;
        if (this._proxyRotations >= 3) return false;
        this._agent = getProxyAgent();
        this._proxyRotations++;
        console.log(`[proxy] 🔄 تدوير بروكسي (${this._proxyRotations}/3) بعد خطأ شبكة`);
        return true;
    }

    async request(method, path, body = undefined) {
        let lastError = null;

        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
            this._refreshHeadersIfNeeded();

            const axiosConfig = {
                method,
                url: `${DISCORD_API}${path}`,
                headers: this.headers,
                data: body,
                timeout: REQUEST_TIMEOUT_MS,
                validateStatus: () => true,
                responseType: 'text',
            };

            if (this._agent) {
                axiosConfig.httpsAgent = this._agent;
                axiosConfig.httpAgent = this._agent;
            }

            try {
                const response = await axios(axiosConfig);

                let data = {};
                const rawText = typeof response.data === 'string' ? response.data : '';
                if (rawText) {
                    try {
                        data = JSON.parse(rawText);
                    } catch {
                        data = { raw: rawText };
                    }
                }

                this._proxyRotations = 0;

                if (response.status === 429) {
                    const retryAfter = Number(data?.retry_after || response.headers['retry-after'] || 5);
                    lastError = makeError(`Rate limited: ${retryAfter}s`, {
                        status: 429,
                        retryAfter,
                        responseData: data,
                    });
                    await sleep((retryAfter * 1000) + 500);
                    continue;
                }

                if (response.status >= 500) {
                    lastError = makeError(`${method} ${path} -> HTTP ${response.status}`, {
                        status: response.status,
                        responseData: data,
                    });
                    if (attempt < MAX_RETRIES - 1) await sleep(1000 * (attempt + 1));
                    continue;
                }

                if (response.status < 200 || response.status >= 300) {
                    throw makeError(
                        `${method} ${path} -> HTTP ${response.status}: ${extractDiscordError(data, rawText)}`,
                        { status: response.status, responseData: data }
                    );
                }

                return data;
            } catch (err) {
                if (err?.status === 429 || (err?.status >= 500 && err?.status < 600)) {
                    lastError = err;
                    continue;
                }

                const isNetworkError =
                    err.code === 'ECONNABORTED' ||
                    err.code === 'ETIMEDOUT' ||
                    err.code === 'ECONNREFUSED' ||
                    err.code === 'ENOTFOUND' ||
                    err.code === 'ECONNRESET' ||
                    (err.request && !err.response);

                if (isNetworkError) {
                    lastError = makeError(`${method} ${path} -> Network: ${err.message}`, { status: 0 });
                    if (attempt < MAX_RETRIES - 1) {
                        this._rotateProxy();
                        await sleep(1000 * (attempt + 1));
                        continue;
                    }
                } else {
                    throw err;
                }
            }
        }

        throw lastError || new Error(`${method} ${path} failed`);
    }

    async me() {
        return this.request('GET', '/users/@me');
    }

    async quests() {
        const data = await this.request('GET', '/quests/@me');
        return Array.isArray(data?.quests) ? data.quests : [];
    }

    async enroll(quest) {
        const body = {
            location: 11,
            is_targeted: false,
            metadata_raw: null,
        };
        for (const key of ['traffic_metadata_raw', 'traffic_metadata_sealed']) {
            if (quest?.[key] != null) body[key] = quest[key];
        }
        const data = await this.request('POST', `/quests/${quest.id}/enroll`, body);
        return data?.user_status || data;
    }

    async heartbeat(questId, applicationId, terminal = false) {
        const data = await this.request('POST', `/quests/${questId}/heartbeat`, {
            application_id: String(applicationId),
            terminal: Boolean(terminal),
        });
        return data?.user_status || data;
    }

    async videoProgress(questId, timestamp) {
        const data = await this.request('POST', `/quests/${questId}/video-progress`, {
            timestamp,
        });
        return data?.user_status || data;
    }
}

function extractDiscordError(data, rawText = '') {
    if (!data) return rawText || 'Unknown Discord error';
    if (typeof data.message === 'string' && data.message) return data.message;
    if (typeof data.code !== 'undefined') return `code=${data.code}`;
    return rawText || JSON.stringify(data).slice(0, 300);
}

function taskEntries(tasks) {
    if (!tasks) return [];
    if (tasks instanceof Map) return Array.from(tasks.entries());
    if (typeof tasks === 'object') return Object.entries(tasks);
    return [];
}

function selectTaskConfig(quest) {
    const config = quest?.config || {};
    const v2 = config.task_config_v2 || config.taskConfigV2;
    const legacy = config.task_config || config.taskConfig;
    if (taskEntries(v2?.tasks).length > 0) return v2;
    if (taskEntries(legacy?.tasks).length > 0) return legacy;
    return v2 || legacy || null;
}

function getTaskMap(quest) {
    return selectTaskConfig(quest)?.tasks || {};
}

function extractTaskName(quest) {
    const tasks = getTaskMap(quest);
    for (const taskName of TASK_PRIORITY) {
        if (tasks?.[taskName]) return taskName;
    }
    if (tasks?.WATCH_VIDEO_ON_MOBILE) return 'WATCH_VIDEO_ON_MOBILE';
    const keys = taskEntries(tasks).map(([key]) => key);
    return keys[0] || 'UNKNOWN';
}

function extractApplicationId(quest, taskName = extractTaskName(quest)) {
    const task = getTaskMap(quest)?.[taskName] || {};
    const appId = task?.applications?.find(app => app?.id)?.id;
    if (appId) return String(appId);
    const legacy = quest?.config?.application?.id;
    return legacy ? String(legacy) : null;
}

function extractTaskTarget(quest, taskName = extractTaskName(quest)) {
    const task = getTaskMap(quest)?.[taskName] || {};
    const direct = Number(task.target);
    if (Number.isFinite(direct) && direct > 0) return direct;
    const milliseconds = Number(task.video_duration_ms);
    if (Number.isFinite(milliseconds) && milliseconds > 0) {
        return Math.max(1, Math.round(milliseconds / 1000));
    }
    return taskName === 'WATCH_VIDEO' ? 60 : 900;
}

function getQuestName(quest) {
    const config = quest?.config || {};
    return (
        quest?.name ||
        quest?.quest_name ||
        config?.messages?.quest_name ||
        config?.messages?.questName ||
        config?.application?.name ||
        quest?.id ||
        'مهمة'
    );
}

function getUserStatus(quest) {
    return quest?.user_status || quest?.userStatus || {};
}

function isQuestDone(quest) {
    const status = getUserStatus(quest);
    return Boolean(
        status.completed_at ||
        status.completedAt ||
        status.claimed_at ||
        status.claimedAt ||
        quest?.completed === true,
    );
}

function isQuestEnrolled(quest) {
    const status = getUserStatus(quest);
    return Boolean(status.enrolled_at || status.enrolledAt);
}

function getEnrolledAt(quest) {
    const status = getUserStatus(quest);
    return status.enrolled_at || status.enrolledAt || null;
}

function parseTime(value) {
    if (!value) return 0;
    const parsed = Date.parse(String(value));
    return Number.isFinite(parsed) ? parsed : 0;
}

function getQuestExpiresAt(quest) {
    return quest?.config?.expires_at || quest?.config?.expiresAt || null;
}

function getQuestStartsAt(quest) {
    return quest?.config?.starts_at || quest?.config?.startsAt || null;
}

function isExpired(quest) {
    const value = parseTime(getQuestExpiresAt(quest));
    return value > 0 && value < Date.now();
}

function isNotStarted(quest) {
    const value = parseTime(getQuestStartsAt(quest));
    return value > Date.now();
}

function getTaskProgress(quest, taskName) {
    const status = getUserStatus(quest);
    const progress = status.progress || {};
    const candidates = [taskName, 'PLAY_ON_DESKTOP', 'WATCH_VIDEO'];
    for (const key of candidates) {
        const value = Number(progress?.[key]?.value);
        if (Number.isFinite(value) && value >= 0) return value;
    }
    return 0;
}

function getProgressFromStatus(status, taskName) {
    const progress = status?.progress || {};
    const candidates = [taskName, 'PLAY_ON_DESKTOP', 'WATCH_VIDEO'];
    for (const key of candidates) {
        const value = Number(progress?.[key]?.value);
        if (Number.isFinite(value) && value >= 0) return value;
    }
    return null;
}

function getCompletionFromStatus(status) {
    return Boolean(status?.completed_at || status?.completedAt);
}

function normalizeStatus(status) {
    const s = String(status || '').toLowerCase();
    if (['completed', 'already_completed', 'claimed'].includes(s)) return 'COMPLETED';
    if (['rejected', 'error', 'enroll_failed', 'failed'].includes(s)) return 'REJECTED';
    if (['running', 'in_progress'].includes(s)) return 'running';
    if (['unsupported'].includes(s)) return 'UNSUPPORTED';
    return 'PENDING';
}

function toQuestShape(quest, extra = {}) {
    const type = extra.type || extractTaskName(quest);
    let percent = typeof extra.percent === 'number' ? extra.percent : 0;
    if (typeof quest?.percent === 'number') percent = quest.percent;

    const target = extractTaskTarget(quest, type);
    const serverProgress = getTaskProgress(quest, type);
    if (!extra.percent && target > 0 && serverProgress > 0) {
        percent = Math.min(100, Math.round((serverProgress / target) * 100));
    }

    return {
        id: quest?.id || '',
        name: getQuestName(quest),
        type,
        status: normalizeStatus(extra.status || (isQuestDone(quest) ? 'COMPLETED' : 'PENDING')),
        percent: Math.max(0, Math.min(100, percent)),
        error: extra.error || null,
    };
}

function chooseSupportedTask(quest) {
    const tasks = getTaskMap(quest);
    for (const taskName of TASK_PRIORITY) {
        if (tasks?.[taskName]) return taskName;
    }
    return null;
}

async function waitUntilEnrolled(client, questId, signal) {
    while (!signal?.stopped) {
        const fresh = (await client.quests()).find(q => q.id === questId);
        if (fresh && isQuestEnrolled(fresh)) return fresh;
        await sleepWithSignal(10_000, signal);
    }
    return null;
}

async function refreshQuest(client, questId) {
    const quests = await client.quests();
    return quests.find(q => q.id === questId) || null;
}

async function completeWatchVideo(client, quest, taskName, onUpdate, signal) {
    const questId = quest.id;
    const target = extractTaskTarget(quest, taskName);
    const enrolledAt = getEnrolledAt(quest);
    const enrolledMs = parseTime(enrolledAt) || Date.now();

    let progress = getTaskProgress(quest, taskName);
    let completed = isQuestDone(quest);
    const started = Date.now();

    if (!enrolledAt) {
        const fresh = await refreshQuest(client, questId);
        if (fresh) {
            quest = fresh;
            progress = getTaskProgress(quest, taskName);
            completed = isQuestDone(quest);
        }
    }

    console.log(`   🎬 الهدف: ${target}s | تقدم Discord: ${Math.floor(progress)}s`);

    while (!completed && progress < target) {
        if (signal?.stopped) return { stopped: true, completed: false, progress };
        if (Date.now() - started > QUEST_TIMEOUT_MS) {
            throw new Error('تجاوز الحد الزمني للمهمة');
        }

        const elapsedSec = Math.max(0, Math.floor((Date.now() - enrolledMs) / 1000));
        const maxAllowed = elapsedSec + VIDEO_MAX_FUTURE_SECONDS;
        const nextTimestamp = Math.min(target, progress + VIDEO_STEP_SECONDS);

        if (nextTimestamp > maxAllowed) {
            await sleepWithSignal(VIDEO_TICK_MS, signal);
            continue;
        }

        let result;
        try {
            result = await client.videoProgress(questId, Number(nextTimestamp.toFixed(3)));
        } catch (err) {
            if (err.status === 429) continue;
            throw err;
        }

        if (getCompletionFromStatus(result)) {
            completed = true;
            progress = Math.max(progress, target);
        } else {
            const serverProgress = getProgressFromStatus(result, taskName);
            if (serverProgress !== null) {
                progress = Math.max(progress, serverProgress);
            } else {
                progress = Math.max(progress, Math.min(nextTimestamp, maxAllowed));
            }
        }

        const percent = Math.min(100, Math.round((progress / target) * 100));
        process.stdout.write(`\r   ${renderProgressBar(percent)} | ${Math.floor(progress)}/${target}s`);
        if (onUpdate) onUpdate(toQuestShape(quest, { status: 'running', percent, type: taskName }));

        if (progress >= target) break;
        await sleepWithSignal(VIDEO_TICK_MS, signal);
    }

    if (!completed && !signal?.stopped) {
        const final = await client.videoProgress(questId, target);
        completed = getCompletionFromStatus(final) || getProgressFromStatus(final, taskName) >= target;
        const finalProgress = getProgressFromStatus(final, taskName);
        if (finalProgress !== null) progress = Math.max(progress, finalProgress);
    }

    return { stopped: Boolean(signal?.stopped), completed, progress };
}

async function completePlayOnDesktop(client, quest, taskName, onUpdate, signal) {
    const questId = quest.id;
    const target = extractTaskTarget(quest, taskName);
    const appId = extractApplicationId(quest, taskName);

    if (!appId) throw new Error('application_id غير موجود');

    let progress = getTaskProgress(quest, taskName);
    let completed = isQuestDone(quest);
    let noProgressCount = 0;
    const started = Date.now();

    console.log(`   🎮 App: ${appId} | الهدف: ${target}s | تقدم Discord: ${Math.floor(progress)}s`);

    while (!completed && progress < target) {
        if (signal?.stopped) return { stopped: true, completed: false, progress };
        if (Date.now() - started > QUEST_TIMEOUT_MS) {
            throw new Error('تجاوز الحد الزمني للمهمة');
        }

        const previousProgress = progress;
        const status = await client.heartbeat(questId, appId, false);

        if (getCompletionFromStatus(status)) {
            completed = true;
        }

        const serverProgress = getProgressFromStatus(status, taskName);
        if (serverProgress !== null) {
            progress = Math.max(progress, serverProgress);
        }

        if (progress <= previousProgress && !completed) {
            noProgressCount++;
            console.log(`\n   ⚠️ Discord لم يزد التقدم (${noProgressCount}/${MAX_NO_PROGRESS_HEARTBEATS})`);
        } else {
            noProgressCount = 0;
        }

        const percent = Math.min(100, Math.round((progress / target) * 100));
        process.stdout.write(`\r   ${renderProgressBar(percent)} | ${Math.floor(progress)}/${target}s`);
        if (onUpdate) onUpdate(toQuestShape(quest, { status: 'running', percent, type: taskName }));

        if (completed || progress >= target) break;
        if (noProgressCount >= MAX_NO_PROGRESS_HEARTBEATS) {
            throw new Error('Discord لم يمنح أي تقدم بعد عدة heartbeats');
        }

        await sleepWithSignal(HEARTBEAT_INTERVAL_MS, signal);
    }

    if (!completed && !signal?.stopped) {
        const final = await client.heartbeat(questId, appId, true);
        completed = getCompletionFromStatus(final) || getProgressFromStatus(final, taskName) >= target;
        const finalProgress = getProgressFromStatus(final, taskName);
        if (finalProgress !== null) progress = Math.max(progress, finalProgress);
    }

    if (completed && !signal?.stopped) {
        const fresh = await refreshQuest(client, questId);
        if (fresh) completed = isQuestDone(fresh) || getTaskProgress(fresh, taskName) >= target;
    }

    return { stopped: Boolean(signal?.stopped), completed, progress };
}

async function enrollIfNeeded(client, quest) {
    if (isQuestEnrolled(quest)) return quest;
    try {
        const userStatus = await client.enroll(quest);
        if (userStatus && typeof userStatus === 'object') {
            quest.user_status = userStatus;
        }
        return quest;
    } catch (err) {
        if ([400, 409].includes(err.status)) {
            const fresh = await refreshQuest(client, quest.id);
            if (fresh && isQuestEnrolled(fresh)) return fresh;
        }
        throw err;
    }
}

function classifyQuests(allQuests) {
    const supported = [];
    const skippedDone = [];
    const skippedType = [];

    for (const quest of allQuests) {
        const name = getQuestName(quest);
        if (isQuestDone(quest)) {
            skippedDone.push({ quest, name, type: extractTaskName(quest) });
            continue;
        }

        const type = chooseSupportedTask(quest);
        if (!type) {
            skippedType.push({ quest, name, type: extractTaskName(quest) });
            continue;
        }

        supported.push({ quest, type });
    }

    supported.sort((a, b) => TASK_PRIORITY.indexOf(a.type) - TASK_PRIORITY.indexOf(b.type));
    return { supported, skippedDone, skippedType };
}

async function solveSequentially(token, onUpdate, signal = {}) {
    const results = [];

    console.log('\n' + '='.repeat(55));
    console.log('🚀 Dark Orbs - بدء جلسة حل المهام المباشر');
    console.log('='.repeat(55) + '\n');

    try {
        const client = new DiscordQuestClient(token);

        const me = await client.me();
        if (!me?.id) {
            return { success: false, error: 'تعذر التحقق من حساب Discord' };
        }
        console.log(`✅ الحساب: ${me.username || me.global_name || me.id}\n`);

        if (signal.stopped) {
            return { success: true, quests: [], stopped: true };
        }

        console.log('🔍 جاري جلب المهام من Discord API v10...');
        const allQuests = await client.quests();
        console.log(`📊 إجمالي المهام: ${allQuests.length}\n`);

        const activeQuests = allQuests.filter(q => !isExpired(q) && !isNotStarted(q));
        const hiddenCount = allQuests.length - activeQuests.length;
        if (hiddenCount) console.log(`🕒 تم تجاهل ${hiddenCount} مهمة منتهية أو لم تبدأ بعد.\n`);

        const { supported, skippedDone, skippedType } = classifyQuests(activeQuests);

        console.log(`✅ مهام قابلة للحل: ${supported.length}`);
        console.log(`✔️ مكتملة/مستلمة: ${skippedDone.length}`);
        console.log(`⏭️ غير مدعومة/متجاهلة: ${skippedType.length}\n`);

        skippedDone.forEach((s, i) => {
            const shape = toQuestShape(s.quest, { status: 'COMPLETED', percent: 100, type: s.type });
            console.log(`[completed ${i + 1}] ${s.name}: COMPLETED 100%`);
            results.push(shape);
            if (onUpdate) onUpdate(shape);
        });

        skippedType.forEach((s, i) => {
            const shape = toQuestShape(s.quest, { status: 'UNSUPPORTED', percent: 0, type: s.type });
            console.log(`[skip ${i + 1}] ${s.name}: UNSUPPORTED (${s.type})`);
            results.push(shape);
            if (onUpdate) onUpdate(shape);
        });

        if (supported.length === 0) {
            console.log('ℹ️ لا توجد مهام قابلة للحل.');
            return { success: true, quests: results, stopped: false };
        }

        console.log('\n📋 قائمة المهام القابلة للحل:');
        supported.forEach((item, i) => {
            const target = extractTaskTarget(item.quest, item.type);
            console.log(`   ${i + 1}. ${getQuestName(item.quest)} [${item.type}] target=${target}`);
        });

        for (let i = 0; i < supported.length; i++) {
            if (signal.stopped) {
                console.log(`\n⏹️ تم الإيقاف قبل المهمة ${i + 1}`);
                break;
            }

            const item = supported[i];
            let quest = item.quest;
            const questId = quest.id;
            let taskName = chooseSupportedTask(quest);

            const freshBefore = await refreshQuest(client, questId);
            if (freshBefore) {
                quest = freshBefore;
                taskName = chooseSupportedTask(quest);
            }

            if (!taskName) {
                const skipped = toQuestShape(quest, { status: 'UNSUPPORTED', percent: 0 });
                results.push(skipped);
                if (onUpdate) onUpdate(skipped);
                continue;
            }

            const questName = getQuestName(quest);
            console.log(`\n[${i + 1}/${supported.length}] ═══════════════════════════════`);
            console.log(`   📌 ${questName}`);
            console.log(`   🧩 Task: ${taskName} | target=${extractTaskTarget(quest, taskName)}`);

            if (onUpdate) onUpdate(toQuestShape(quest, { status: 'running', percent: 0, type: taskName }));

            try {
                if (!isQuestEnrolled(quest)) {
                    quest = await enrollIfNeeded(client, quest);
                    console.log('   ✅ تم التسجيل/التأكد من التسجيل');
                } else {
                    console.log('   ✅ مسجل مسبقًا');
                }

                const refreshed = await refreshQuest(client, questId);
                if (refreshed) quest = refreshed;

                let outcome;
                if (taskName === 'WATCH_VIDEO') {
                    outcome = await completeWatchVideo(client, quest, taskName, onUpdate, signal);
                } else if (taskName === 'PLAY_ON_DESKTOP') {
                    outcome = await completePlayOnDesktop(client, quest, taskName, onUpdate, signal);
                } else {
                    outcome = { stopped: false, completed: false, progress: 0 };
                }

                if (outcome.stopped || signal.stopped) {
                    const percent = Math.min(100, Math.round((outcome.progress / extractTaskTarget(quest, taskName)) * 100));
                    const stopped = toQuestShape(quest, { status: 'PENDING', percent, type: taskName, error: null });
                    results.push(stopped);
                    if (onUpdate) onUpdate(stopped);
                    console.log(`\n   ⏹️ تم إيقاف المهمة عند ${Math.floor(outcome.progress)}s`);
                    break;
                }

                if (!outcome.completed) {
                    throw new Error('انتهى التنفيذ لكن Discord لم يؤكد اكتمال المهمة');
                }

                const completed = toQuestShape(quest, { status: 'COMPLETED', percent: 100, type: taskName });
                results.push(completed);
                if (onUpdate) onUpdate(completed);
                console.log(`\n   ✅ اكتملت فعليًا على Discord: ${questName}`);

                if (i < supported.length - 1 && !signal.stopped) {
                    const delay = 5000 + Math.floor(Math.random() * 5000);
                    console.log(`   ⏳ انتظار ${Math.round(delay / 1000)} ثواني...`);
                    await sleepWithSignal(delay, signal);
                }
            } catch (err) {
                if (signal.stopped) break;

                console.log(`\n   ❌ فشلت: ${err.message}`);
                const failed = toQuestShape(quest, {
                    status: 'REJECTED',
                    percent: Math.round((getTaskProgress(quest, taskName) / extractTaskTarget(quest, taskName)) * 100),
                    type: taskName,
                    error: err.message,
                });
                results.push(failed);
                if (onUpdate) onUpdate(failed);

                if (i < supported.length - 1 && !signal.stopped) {
                    await sleepWithSignal(5000, signal);
                }
            }
        }

        const succeeded = results.filter(r => r.status === 'COMPLETED').length;
        const failed = results.filter(r => r.status === 'REJECTED').length;

        console.log('\n' + '='.repeat(55));
        console.log(`🏁 انتهت - نجح: ${succeeded}, فشل: ${failed}${signal.stopped ? '، تم الإيقاف' : ''}`);
        console.log('='.repeat(55) + '\n');

        return {
            success: true,
            quests: results,
            stopped: Boolean(signal.stopped),
        };
    } catch (err) {
        console.error(`\n❌ خطأ عام: ${err.message}`);
        return { success: false, error: err.message };
    }
}

async function fetchQuestsOnly(token) {
    try {
        const client = new DiscordQuestClient(token);
        const all = await client.quests();
        const active = all.filter(q => !isExpired(q) && !isNotStarted(q));
        const mapped = active.map(q => {
            const done = isQuestDone(q);
            const type = extractTaskName(q);
            return {
                id: q.id,
                name: getQuestName(q),
                type,
                status: done ? 'COMPLETED' : (SUPPORTED_TYPES.includes(type) ? 'PENDING' : 'UNSUPPORTED'),
                percent: done ? 100 : Math.min(100, Math.round((getTaskProgress(q, type) / extractTaskTarget(q, type)) * 100)),
                error: null,
            };
        });

        const valid = mapped.filter(q => q.status === 'PENDING');
        return { success: true, allQuests: mapped, valid };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

module.exports = {
    solveSequentially,
    fetchQuestsOnly,
    toQuestShape,
    normalizeStatus,
    extractTaskName,
    extractApplicationId,
    extractTaskTarget,
};

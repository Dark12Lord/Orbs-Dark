// quests.js - محرك المهام
// يعتمد على DiscordQuests في الجلب والتنفيذ، ولا يعيد تنفيذ Discord Quest API يدويًا.
// WATCH_VIDEO_ON_MOBILE متجاهلة عمدًا حسب إعداد Dark Orbs.

let DiscordQuests = null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const SUPPORTED_TYPES = new Set([
    'WATCH_VIDEO',
    'PLAY_ON_DESKTOP',
]);

// ترتيب الاختيار عند وجود أكثر من Task في نفس Quest.
const TASK_PRIORITY = [
    'WATCH_VIDEO',
    'PLAY_ON_DESKTOP',
];

const SOLVER_TIMEOUT_MS = 30 * 60 * 1000;
const QUEST_DELAY_MIN = 5000;
const QUEST_DELAY_MAX = 10000;

async function loadQuestsLib() {
    if (!DiscordQuests) {
        const mod = await import('discord-quests');
        DiscordQuests = mod.DiscordQuests || mod.default?.DiscordQuests || mod.default;
        if (!DiscordQuests) throw new Error('فشل تحميل DiscordQuests');
    }
    return DiscordQuests;
}

function renderProgressBar(percent, width = 20) {
    const safe = Math.max(0, Math.min(100, Number(percent) || 0));
    const filled = Math.round((safe / 100) * width);
    return `[${'█'.repeat(filled)}${'░'.repeat(width - filled)}] ${Math.round(safe)}%`;
}

function normalizeStatus(status) {
    const s = String(status || '').toLowerCase();
    if (['completed', 'already_completed', 'claimed'].includes(s)) return 'COMPLETED';
    if (['rejected', 'error', 'enroll_failed', 'failed'].includes(s)) return 'REJECTED';
    if (['running', 'in_progress'].includes(s)) return 'running';
    if (['unsupported'].includes(s)) return 'UNSUPPORTED';
    if (['stopped', 'cancelled', 'canceled'].includes(s)) return 'PENDING';
    return 'PENDING';
}

function getQuestTasks(quest) {
    return Array.isArray(quest?.tasks) ? quest.tasks : [];
}

function isQuestDone(quest) {
    if (quest?.completed === true) return true;

    const tasks = getQuestTasks(quest);
    const incompleteSupported = tasks.some((task) =>
        SUPPORTED_TYPES.has(String(task?.id || '')) && task?.completed !== true
    );

    // لا نعتبر Quest مكتملة فقط لأن كل المهام غير المدعومة؛ هذا مهم حتى لا تختفي من التشخيص.
    return tasks.length > 0 && !incompleteSupported && tasks.every((task) => task?.completed === true);
}

function getTaskProgress(task) {
    if (!task) return 0;
    if (typeof task.percent === 'number') return Math.max(0, Math.min(100, Math.round(task.percent)));

    const current = Number(task.current);
    const target = Number(task.target);
    if (Number.isFinite(current) && Number.isFinite(target) && target > 0) {
        return Math.max(0, Math.min(100, Math.round((current / target) * 100)));
    }
    return 0;
}

function selectTask(quest, { allowCompleted = false } = {}) {
    const tasks = getQuestTasks(quest).filter((task) => task && task.id);

    for (const type of TASK_PRIORITY) {
        const found = tasks.find((task) =>
            String(task.id) === type && (allowCompleted || task.completed !== true)
        );
        if (found) return found;
    }

    return null;
}

// يحافظ على اسم الدالة القديم حتى لا تنكسر أي استدعاءات خارجية.
function extractTaskName(quest) {
    const selected = selectTask(quest);
    if (selected) return String(selected.id);

    const first = getQuestTasks(quest)[0];
    return first?.id ? String(first.id) : 'UNKNOWN';
}

function toQuestShape(raw, extra = {}) {
    const task = extra.task || selectTask(raw, { allowCompleted: true });
    const status = normalizeStatus(extra.status ?? raw?.status);
    const percent = extra.percent !== undefined
        ? Number(extra.percent)
        : getTaskProgress(task);

    return {
        id: raw?.id || raw?.questId || extra.id || '',
        name: raw?.name || raw?.questName || extra.name || raw?.id || 'مهمة',
        type: String(extra.type || task?.id || extractTaskName(raw)),
        status,
        percent: Math.max(0, Math.min(100, Math.round(Number(percent) || 0))),
        error: extra.error || raw?.error || null,
    };
}

async function fetchAllQuests(dq) {
    if (typeof dq.fetchQuests !== 'function') {
        throw new Error('مكتبة discord-quests لا توفر fetchQuests()');
    }

    const quests = await dq.fetchQuests();
    if (!Array.isArray(quests)) {
        throw new Error('fetchQuests() أعادت بيانات غير صالحة');
    }

    console.log(`   📡 fetchQuests: ${quests.length} مهمة نشطة`);
    return { quests, source: 'fetchQuests' };
}

function watchForStop(solver, signal) {
    return setInterval(() => {
        if (!signal?.stopped) return;
        try { solver.stop(); } catch {}
    }, 250);
}

function solverProgressHandler(quest, onUpdate) {
    return (event = {}) => {
        const percent = typeof event.percent === 'number'
            ? event.percent
            : (Number(event.target) > 0 ? (Number(event.current || 0) / Number(event.target)) * 100 : 0);

        const update = toQuestShape(quest, {
            task: {
                id: event.taskId || extractTaskName(quest),
                current: event.current,
                target: event.target,
                percent,
            },
            type: event.taskId || extractTaskName(quest),
            status: 'running',
            percent,
        });

        process.stdout.write(`\r   ${renderProgressBar(update.percent)}`);
        if (onUpdate) onUpdate(update);
    };
}

async function solveOneQuest(dq, quest, onUpdate, signal) {
    const questName = quest?.name || quest?.id || 'مهمة';
    const task = selectTask(quest);

    if (!task) {
        const firstType = getQuestTasks(quest)[0]?.id || 'UNKNOWN';
        return {
            id: quest?.id,
            name: questName,
            type: firstType,
            status: 'UNSUPPORTED',
            percent: 0,
            error: null,
        };
    }

    if (signal?.stopped) return { stopped: true };

    if (onUpdate) {
        onUpdate(toQuestShape(quest, {
            task,
            type: task.id,
            status: 'running',
            percent: getTaskProgress(task),
        }));
    }

    console.log(`\n   📌 ${questName}`);
    console.log(`   🧩 Task: ${task.id} | ${getTaskProgress(task)}% | target=${task.target ?? 'N/A'}`);

    let enrolled = quest.enrolled === true;
    if (!enrolled && typeof dq.enroll === 'function') {
        const enrollResult = await dq.enroll(quest.id);
        if (!enrollResult?.success) {
            return {
                id: quest.id,
                name: questName,
                type: task.id,
                status: 'REJECTED',
                percent: getTaskProgress(task),
                error: 'فشل تسجيل المهمة',
            };
        }
        enrolled = true;
        console.log(`   ✅ تم التسجيل`);
    }

    // نعيد جلب Quest بعد التسجيل حتى يعمل الـsolver على آخر progress/config.
    let freshQuest = quest;
    if (typeof dq.fetchQuest === 'function') {
        try {
            freshQuest = await dq.fetchQuest(quest.id);
        } catch (err) {
            console.log(`   ⚠️ تعذر تحديث بيانات المهمة بعد التسجيل: ${err.message}`);
        }
    }

    const freshTask = selectTask(freshQuest, { allowCompleted: false }) || task;
    if (freshQuest.completed === true || freshTask.completed === true) {
        const done = toQuestShape(freshQuest, {
            task: freshTask,
            type: freshTask.id,
            status: 'COMPLETED',
            percent: 100,
        });
        if (onUpdate) onUpdate(done);
        return done;
    }

    if (typeof dq.createSolver !== 'function') {
        throw new Error('مكتبة discord-quests لا توفر createSolver()');
    }

    const solver = dq.createSolver(freshQuest, freshTask.id);
    if (!solver || typeof solver.start !== 'function') {
        throw new Error(`تعذر إنشاء Solver لنوع ${freshTask.id}`);
    }

    let completed = false;
    let solverError = null;
    let stopWatcher = null;
    let timeout = null;

    const onProgress = solverProgressHandler(freshQuest, onUpdate);
    const onCompleted = () => {
        completed = true;
        console.log(`\n   ✅ DiscordQuests أكد اكتمال المهمة`);
    };
    const onError = (_questId, error) => {
        solverError = error instanceof Error ? error : new Error(String(error || 'خطأ غير معروف من Solver'));
    };

    solver.on?.('progress', onProgress);
    solver.on?.('completed', onCompleted);
    solver.on?.('error', onError);

    try {
        stopWatcher = watchForStop(solver, signal);
        timeout = setTimeout(() => {
            try { solver.stop(); } catch {}
        }, SOLVER_TIMEOUT_MS);

        await solver.start();

        if (signal?.stopped && !completed) {
            return { stopped: true };
        }

        if (solverError) throw solverError;

        if (!completed) {
            // بعض نسخ الـsolver تكمل بدون event مكتمل؛ نتحقق من الحالة النهائية بدل التخمين.
            try {
                const finalQuest = typeof dq.fetchQuest === 'function'
                    ? await dq.fetchQuest(quest.id)
                    : freshQuest;
                const finalTask = selectTask(finalQuest, { allowCompleted: true });
                if (finalQuest.completed === true || finalTask?.completed === true || getTaskProgress(finalTask) >= 100) {
                    completed = true;
                }

                if (completed) {
                    freshQuest = finalQuest;
                }
            } catch (err) {
                console.log(`   ⚠️ تعذر التحقق النهائي: ${err.message}`);
            }
        }

        if (!completed) {
            throw new Error('انتهى Solver بدون تأكيد اكتمال المهمة');
        }

        const result = toQuestShape(freshQuest, {
            task: freshTask,
            type: freshTask.id,
            status: 'COMPLETED',
            percent: 100,
        });
        if (onUpdate) onUpdate(result);
        return result;
    } finally {
        if (timeout) clearTimeout(timeout);
        if (stopWatcher) clearInterval(stopWatcher);
        // لا نحتاج انتظار stopWatcher؛ التحقق نفسه polling خفيف، وسيحاول الإيقاف فقط عند signal.
        if (signal?.stopped) {
            try { solver.stop(); } catch {}
        }
    }
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

        if (signal.stopped) return { success: false, error: 'stopped', stopped: true, quests: [] };

        console.log('🔍 جاري جلب المهام...');
        const { quests: allQuests, source } = await fetchAllQuests(dq);
        console.log(`📊 إجمالي المهام: ${allQuests.length} (من ${source})\n`);

        if (allQuests.length > 0) {
            const sample = allQuests[0];
            console.log('═══════════════════════════════════════════════');
            console.log('🔍 بنية أول مهمة من discord-quests:');
            console.log(JSON.stringify({
                id: sample.id,
                name: sample.name,
                enrolled: sample.enrolled,
                completed: sample.completed,
                applicationId: sample.application?.id || null,
                tasks: getQuestTasks(sample).map((t) => ({
                    id: t.id,
                    current: t.current,
                    target: t.target,
                    percent: t.percent,
                    completed: t.completed,
                    enrolled: t.enrolled,
                    type: t.type,
                })),
            }, null, 2).slice(0, 5000));
            console.log('═══════════════════════════════════════════════\n');
        }

        const supported = [];
        const skippedDone = [];
        const skippedType = [];

        for (const quest of allQuests) {
            const name = quest?.name || quest?.id || 'مهمة';
            const done = isQuestDone(quest);
            const task = selectTask(quest);

            if (done) {
                const completedTask = selectTask(quest, { allowCompleted: true });
                skippedDone.push({
                    id: quest.id,
                    name,
                    type: completedTask?.id || getQuestTasks(quest)[0]?.id || 'UNKNOWN',
                });
                continue;
            }

            if (!task || !SUPPORTED_TYPES.has(String(task.id))) {
                skippedType.push({
                    id: quest.id,
                    name,
                    type: task?.id || getQuestTasks(quest)[0]?.id || 'UNKNOWN',
                });
                continue;
            }

            supported.push(quest);
        }

        console.log(`✅ مهام قابلة للحل: ${supported.length}`);
        console.log(`✔️ مكتملة/مستلمة: ${skippedDone.length}`);
        console.log(`⏭️ أنواع غير مدعومة: ${skippedType.length}\n`);

        const skippedResults = [
            ...skippedDone.map((s) => ({
                id: s.id,
                name: s.name,
                type: s.type,
                status: 'COMPLETED',
                percent: 100,
                error: null,
            })),
            ...skippedType.map((s) => ({
                id: s.id,
                name: s.name,
                type: s.type,
                status: 'UNSUPPORTED',
                percent: 0,
                error: null,
            })),
        ];

        if (onUpdate) skippedResults.forEach(onUpdate);

        if (supported.length === 0) {
            console.log('ℹ️ لا توجد مهام قابلة للحل.');
            return { success: true, quests: skippedResults, stopped: false };
        }

        console.log('📋 قائمة المهام القابلة للحل:');
        supported.forEach((quest, index) => {
            const task = selectTask(quest);
            console.log(`   ${index + 1}. ${quest.name || quest.id} [${task?.id || 'UNKNOWN'}]`);
        });
        console.log('');

        for (let i = 0; i < supported.length; i++) {
            if (signal.stopped) {
                console.log(`\n⏹️ تم الإيقاف عند المهمة ${i + 1}`);
                break;
            }

            const quest = supported[i];
            let result;

            console.log(`\n[${i + 1}/${supported.length}] ═══════════════════`);

            try {
                result = await solveOneQuest(dq, quest, onUpdate, signal);
            } catch (err) {
                result = toQuestShape(quest, {
                    task: selectTask(quest, { allowCompleted: true }),
                    type: extractTaskName(quest),
                    status: 'REJECTED',
                    percent: getTaskProgress(selectTask(quest, { allowCompleted: true })),
                    error: err.message,
                });
                console.log(`\n   ❌ فشلت: ${err.message}`);
                if (onUpdate) onUpdate(result);
            }

            if (result?.stopped) {
                console.log('\n⏹️ توقف التنفيذ قبل إكمال المهمة الحالية');
                break;
            }

            if (result) results.push(result);

            if (!signal.stopped && i < supported.length - 1) {
                const delay = QUEST_DELAY_MIN + Math.random() * (QUEST_DELAY_MAX - QUEST_DELAY_MIN);
                console.log(`   ⏳ انتظار ${Math.round(delay / 1000)} ثواني...`);
                await sleep(delay);
            }
        }

        const succeeded = results.filter((r) => r.status === 'COMPLETED').length;
        const failed = results.filter((r) => r.status === 'REJECTED').length;

        console.log('\n' + '='.repeat(50));
        console.log(`🏁 انتهت - نجح: ${succeeded}, فشل: ${failed}`);
        console.log('='.repeat(50) + '\n');

        return {
            success: true,
            quests: [...results, ...skippedResults],
            stopped: !!signal.stopped,
        };
    } catch (err) {
        console.error(`\n❌ خطأ عام: ${err.message}`);
        return { success: false, error: err.message, stopped: !!signal.stopped };
    }
}

async function fetchQuestsOnly(token) {
    try {
        const QuestsClass = await loadQuestsLib();
        const dq = new QuestsClass(token);
        const { quests: allQuests } = await fetchAllQuests(dq);

        const mapped = allQuests.map((quest) => {
            const done = isQuestDone(quest);
            const task = selectTask(quest, { allowCompleted: true });
            const type = task?.id || getQuestTasks(quest)[0]?.id || 'UNKNOWN';

            return {
                id: quest.id,
                name: quest.name || quest.id,
                type,
                status: done ? 'COMPLETED' : (SUPPORTED_TYPES.has(type) ? 'PENDING' : 'UNSUPPORTED'),
                percent: done ? 100 : getTaskProgress(task),
                error: null,
            };
        });

        const valid = mapped.filter((quest) => quest.status === 'PENDING');
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
};

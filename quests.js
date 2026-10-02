// quests.js - محرك المهام مع دعم الإيقاف وتوحيد البيانات
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

function renderProgressBar(percent, width = 20) {
    const filled = Math.round((percent / 100) * width);
    const empty = width - filled;
    return `[${'█'.repeat(filled)}${'░'.repeat(empty)}] ${percent}%`;
}

// ✅ توحيد نوع المهمة
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

// ✅ توحيد حالة المهمة (lowercase للحية، UPPERCASE للمخزنة)
function normalizeStatus(status) {
    const s = String(status || '').toLowerCase();
    if (['completed', 'already_completed', 'claimed'].includes(s)) return 'COMPLETED';
    if (['rejected', 'error', 'enroll_failed', 'failed'].includes(s)) return 'REJECTED';
    if (['running', 'in_progress'].includes(s)) return 'running';
    if (['unsupported'].includes(s)) return 'UNSUPPORTED';
    return 'PENDING';
}

// ✅ توحيد شكل المهمة
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

// ✅ دالة الحل الرئيسية
async function solveSequentially(token, onUpdate, signal = {}) {
    const results = [];
    const solvers = [];  // نحفظ الـ solvers عشان نقدر نوقفها
    
    console.log('\n' + '='.repeat(50));
    console.log('🚀 Dark Orbs - بدء جلسة حل المهام');
    console.log('='.repeat(50) + '\n');

    try {
        const QuestsClass = await loadQuestsLib();
        const dq = new QuestsClass(token);

        // 1. التحقق من التوكن
        if (typeof dq.validateToken === 'function') {
            const valid = await dq.validateToken();
            if (!valid) {
                console.log('❌ التوكن غير صالح');
                return { success: false, error: 'التوكن غير صالح' };
            }
            console.log('✅ تم التحقق من التوكن\n');
        }

        // 2. جلب المهام
        if (signal.stopped) return { success: false, error: 'stopped' };
        
        const quests = await dq.fetchQuests();
        console.log(`📊 عدد المهام الصالحة: ${quests.length}\n`);

        if (!quests || quests.length === 0) {
            console.log('ℹ️ لا توجد مهام صالحة حالياً.');
            return { success: true, quests: [] };
        }

        // 3. عرض القائمة
        console.log('📋 قائمة المهام:');
        quests.forEach((q, i) => {
            const type = normalizeType(q);
            console.log(`   ${i + 1}. ${q.name || q.id} [${type}]`);
        });
        console.log('');

        // 4. حل المهام واحدة واحدة
        for (let i = 0; i < quests.length; i++) {
            if (signal.stopped) {
                console.log(`\n⏹️ تم الإيقاف يدوياً عند المهمة ${i + 1}`);
                break;
            }

            const quest = quests[i];
            const questId = quest.id;
            const questName = quest.name || questId;
            const questType = normalizeType(quest);

            console.log(`\n[${i + 1}/${quests.length}] ═══════════════════`);
            console.log(`   📌 ${questName} (${questType})`);

            // إرسال حالة "running" للوحة التحكم
            if (onUpdate) onUpdate(toQuestShape(quest, { status: 'running', percent: 0 }));

            try {
                let solver = null;

                // محاولة استخدام createSolver (الأفضل - يدعم stop)
                if (typeof dq.createSolver === 'function') {
                    solver = dq.createSolver(quest);
                    solvers.push(solver);

                    // نحدث التقدم بشكل دوري أثناء انتظار solver
                    const solverPromise = solver.solve ? solver.solve() : solver.run ? solver.run() : solver;
                    
                    // مراقبة التقدم
                    let lastPercent = 0;
                    const progressInterval = setInterval(() => {
                        if (signal.stopped && solver.stop) {
                            try { solver.stop(); } catch (e) {}
                            clearInterval(progressInterval);
                            return;
                        }
                        // نحدث التقدم بناءً على حالة الـ solver إن أمكن
                        if (solver.percent !== undefined) {
                            const p = Math.min(100, Math.round(solver.percent));
                            if (p !== lastPercent) {
                                lastPercent = p;
                                process.stdout.write(`\r   ${renderProgressBar(p)}`);
                                if (onUpdate) onUpdate(toQuestShape(quest, { status: 'running', percent: p }));
                            }
                        }
                    }, 2000);

                    const result = await solverPromise;
                    clearInterval(progressInterval);

                    const finalStatus = normalizeStatus(result?.status || 'completed');
                    results.push(toQuestShape(quest, { status: finalStatus, percent: 100 }));
                    
                    if (onUpdate) onUpdate(toQuestShape(quest, { status: finalStatus, percent: 100 }));
                    console.log(`\n   ${finalStatus === 'COMPLETED' ? '✅' : '❌'} ${questName}`);

                } else if (typeof dq.solve === 'function') {
                    // fallback: solve مباشر (بدون دعم إيقاف حقيقي)
                    const result = await dq.solve(quest);
                    const finalStatus = normalizeStatus(result?.status || 'completed');
                    results.push(toQuestShape(quest, { status: finalStatus, percent: 100 }));
                    if (onUpdate) onUpdate(toQuestShape(quest, { status: finalStatus, percent: 100 }));
                    console.log(`\n   ✅ ${questName}`);

                } else {
                    throw new Error('لا توجد دالة حل مناسبة في المكتبة');
                }

                // تأخير بسيط بين المهام
                if (i < quests.length - 1 && !signal.stopped) {
                    const delay = 2000 + Math.random() * 3000;
                    console.log(`   ⏳ انتظار ${Math.round(delay / 1000)} ثانية...`);
                    await sleep(delay);
                }

            } catch (err) {
                console.log(`\n   ❌ فشلت: ${err.message}`);
                const failed = toQuestShape(quest, { 
                    status: 'REJECTED', 
                    percent: 0, 
                    error: err.message 
                });
                results.push(failed);
                if (onUpdate) onUpdate(failed);
                await sleep(2000);
            }
        }

        // ملخص
        const succeeded = results.filter(r => r.status === 'COMPLETED').length;
        const failed = results.filter(r => r.status === 'REJECTED').length;
        const stopped = signal.stopped ? ' (متوقف يدوياً)' : '';

        console.log('\n' + '='.repeat(50));
        console.log(`🏁 انتهت الجلسة - نجح: ${succeeded}, فشل: ${failed}${stopped}`);
        console.log('='.repeat(50) + '\n');

        return { success: true, quests: results, stopped: signal.stopped };

    } catch (err) {
        console.error(`\n❌ خطأ عام: ${err.message}`);
        return { success: false, error: err.message };
    }
}

// ✅ جلب المهام فقط (للـ Refresh)
async function fetchQuestsOnly(token) {
    try {
        const QuestsClass = await loadQuestsLib();
        const dq = new QuestsClass(token);

        // جرب getStatus أولاً (يعطي معلومات أكمل)
        if (typeof dq.getStatus === 'function') {
            const status = await dq.getStatus();
            const mapped = status.map(s => toQuestShape(s));
            const valid = mapped.filter(q => q.status === 'PENDING' || q.status === 'running');
            return { success: true, allQuests: mapped, valid };
        }

        // fallback: fetchQuests
        const quests = await dq.fetchQuests();
        const mapped = quests.map(q => toQuestShape(q));
        const valid = mapped.filter(q => q.status === 'PENDING');
        return { success: true, allQuests: mapped, valid };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

module.exports = { solveSequentially, fetchQuestsOnly, toQuestShape, normalizeStatus, normalizeType };
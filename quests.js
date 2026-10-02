// quests.js - محرك المهام مع فلترة يدوية للمهام المكتملة
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

// ✅ دالة الفحص الحقيقي: هل المهمة مكتملة أو مستلمة؟
function isQuestDoneOrClaimed(quest) {
    // ابحث في كل الأماكن المحتملة
    const us = quest.userStatus || quest.user_status || quest._raw?.userStatus || quest._raw?.user_status;
    if (!us) return false;
    
    // مكتملة
    if (us.completed_at) return true;
    // مستلمة (الـ Orbs مأخوذة)
    if (us.claimed_at) return true;
    // أخذ الجائزة
    if (us.orb_quantity_claimed && us.orb_quantity_claimed > 0) return true;
    // tier مستلم
    if (us.claimed_tier !== null && us.claimed_tier !== undefined) return true;
    
    return false;
}

async function solveSequentially(token, onUpdate, signal = {}) {
    const results = [];
    const solvers = [];
    
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
        
        const allQuests = await dq.fetchQuests();
        console.log(`📊 إجمالي المهام: ${allQuests.length}\n`);

        // ✅ فلترة ثلاثية: مكتملة + نوع مدعوم
        const supported = [];
        const skippedDone = [];
        const skippedType = [];
        
        for (const q of allQuests) {
            const name = q.name || q.id;
            const type = normalizeType(q);
            
            // 1. فحص الاكتمال أولاً
            if (isQuestDoneOrClaimed(q)) {
                skippedDone.push({ name, type });
                continue;
            }
            
            // 2. فحص النوع
            if (!SUPPORTED_TYPES.includes(type)) {
                skippedType.push({ name, type });
                continue;
            }
            
            supported.push(q);
        }
        
        console.log(`✅ مهام قابلة للحل: ${supported.length}`);
        console.log(`✔️ مكتملة/مستلمة: ${skippedDone.length}`);
        console.log(`⏭️ أنواع غير مدعومة: ${skippedType.length}\n`);
        
        if (skippedDone.length > 0) {
            console.log('✔️ المهام المكتملة/المستلمة:');
            skippedDone.forEach((s, i) => {
                console.log(`   ${i + 1}. ${s.name} [${s.type}]`);
            });
            console.log('');
        }
        
        if (skippedType.length > 0) {
            console.log('⏭️ المهام المتخطاة (نوع):');
            skippedType.forEach((s, i) => {
                console.log(`   ${i + 1}. ${s.name} [${s.type}]`);
            });
            console.log('');
        }

        // نبني نتائج المهام المتخطاة (للحفظ في الـ DB)
        const skippedResults = [
            ...skippedDone.map(s => ({
                id: s.name, name: s.name, type: s.type,
                status: 'COMPLETED', percent: 100, error: null
            })),
            ...skippedType.map(s => ({
                id: s.name, name: s.name, type: s.type,
                status: 'UNSUPPORTED', percent: 0, error: null
            })),
        ];

        if (supported.length === 0) {
            console.log('ℹ️ لا توجد مهام قابلة للحل حالياً.');
            if (onUpdate) {
                skippedResults.forEach(r => onUpdate(r));
            }
            return { success: true, quests: skippedResults };
        }

        console.log('📋 قائمة المهام القابلة للحل:');
        supported.forEach((q, i) => {
            const type = normalizeType(q);
            console.log(`   ${i + 1}. ${q.name || q.id} [${type}]`);
        });
        console.log('');

        for (let i = 0; i < supported.length; i++) {
            if (signal.stopped) {
                console.log(`\n⏹️ تم الإيقاف يدوياً عند المهمة ${i + 1}`);
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
                let solver = null;
                const TIMEOUT_MS = 20 * 60 * 1000;

                if (typeof dq.createSolver === 'function') {
                    solver = dq.createSolver(quest);
                    solvers.push(solver);

                    const solverPromise = solver.solve ? solver.solve() : solver.run ? solver.run() : solver;
                    
                    let lastPercent = 0;
                    const progressInterval = setInterval(() => {
                        if (signal.stopped && solver.stop) {
                            try { solver.stop(); } catch (e) {}
                            clearInterval(progressInterval);
                            return;
                        }
                        if (solver.percent !== undefined) {
                            const p = Math.min(100, Math.round(solver.percent));
                            if (p !== lastPercent) {
                                lastPercent = p;
                                process.stdout.write(`\r   ${renderProgressBar(p)}`);
                                if (onUpdate) onUpdate(toQuestShape(quest, { status: 'running', percent: p }));
                            }
                        }
                    }, 2000);

                    const result = await Promise.race([
                        solverPromise,
                        sleep(TIMEOUT_MS).then(() => ({ timeout: true })),
                    ]);
                    
                    clearInterval(progressInterval);
                    
                    if (result && result.timeout) {
                        if (solver.stop) try { solver.stop(); } catch (e) {}
                        throw new Error(`تجاوز الحد الأقصى (${TIMEOUT_MS / 60000} دقيقة)`);
                    }

                    const finalStatus = normalizeStatus(result?.status || 'completed');
                    results.push(toQuestShape(quest, { status: finalStatus, percent: 100 }));
                    if (onUpdate) onUpdate(toQuestShape(quest, { status: finalStatus, percent: 100 }));
                    console.log(`\n   ${finalStatus === 'COMPLETED' ? '✅' : '❌'} ${questName}`);

                } else if (typeof dq.solve === 'function') {
                    const result = await Promise.race([
                        dq.solve(quest),
                        sleep(TIMEOUT_MS).then(() => ({ timeout: true })),
                    ]);
                    
                    if (result && result.timeout) {
                        throw new Error(`تجاوز الحد الأقصى`);
                    }
                    
                    const finalStatus = normalizeStatus(result?.status || 'completed');
                    results.push(toQuestShape(quest, { status: finalStatus, percent: 100 }));
                    if (onUpdate) onUpdate(toQuestShape(quest, { status: finalStatus, percent: 100 }));
                    console.log(`\n   ✅ ${questName}`);

                } else {
                    throw new Error('لا توجد دالة حل مناسبة في المكتبة');
                }

                if (i < supported.length - 1 && !signal.stopped) {
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

        const succeeded = results.filter(r => r.status === 'COMPLETED').length;
        const failed = results.filter(r => r.status === 'REJECTED').length;
        const stopped = signal.stopped ? ' (متوقف يدوياً)' : '';

        console.log('\n' + '='.repeat(50));
        console.log(`🏁 انتهت الجلسة - نجح: ${succeeded}, فشل: ${failed}${stopped}`);
        console.log('='.repeat(50) + '\n');

        return { 
            success: true, 
            quests: [...results, ...skippedResults], 
            stopped: signal.stopped 
        };

    } catch (err) {
        console.error(`\n❌ خطأ عام: ${err.message}`);
        return { success: false, error: err.message };
    }
}

async function fetchQuestsOnly(token) {
    try {
        const QuestsClass = await loadQuestsLib();
        const dq = new QuestsClass(token);

        const allQuests = await dq.fetchQuests();
        
        // فلترة المهام المكتملة/المستلمة
        const mapped = allQuests.map(q => {
            const done = isQuestDoneOrClaimed(q);
            const type = normalizeType(q);
            return {
                id: q.id,
                name: q.name || q.id,
                type: type,
                status: done ? 'COMPLETED' : 'PENDING',
                percent: done ? 100 : 0,
                error: null,
            };
        });

        // المهام الصالحة للحل
        const valid = mapped.filter(q => 
            q.status === 'PENDING' && SUPPORTED_TYPES.includes(q.type)
        );

        return { success: true, allQuests: mapped, valid };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

module.exports = { solveSequentially, fetchQuestsOnly, toQuestShape, normalizeStatus, normalizeType };

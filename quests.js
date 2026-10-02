// quests.js - محرك المهام مع دعم التشخيص المتقدم
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

// ✅ الأنواع اللي نركز عليها حالياً
const SUPPORTED_TYPES = ['WATCH_VIDEO', 'PLAY_ON_DESKTOP'];
const SKIPPED_TYPES = ['WATCH_VIDEO_ON_MOBILE', 'PLAY_ACTIVITY', 'ACHIEVEMENT_IN_ACTIVITY', 'STREAM_ON_DESKTOP'];

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

// ✅ دالة الحل مع timeout
async function solveSequentially(token, onUpdate, signal = {}) {
    const results = [];
    const solvers = [];
    
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
        
        const allQuests = await dq.fetchQuests();
        console.log(`📊 إجمالي المهام: ${allQuests.length}\n`);

        // ✅ فلترة الأنواع
        const supported = [];
        const skipped = [];
        
        for (const q of allQuests) {
            const type = normalizeType(q);
            if (SUPPORTED_TYPES.includes(type)) {
                supported.push(q);
            } else {
                skipped.push({ name: q.name || q.id, type });
            }
        }
        
        console.log(`✅ مهام مدعومة: ${supported.length}`);
        console.log(`⏭️ مهام متخطاة: ${skipped.length}\n`);
        
        if (skipped.length > 0) {
            console.log('⏭️ المتخطاة:');
            skipped.forEach((s, i) => {
                console.log(`   ${i + 1}. ${s.name} [${s.type}]`);
            });
            console.log('');
        }

        if (supported.length === 0) {
            console.log('ℹ️ لا توجد مهام مدعومة حالياً.');
            return { success: true, quests: skipped.map(s => ({
                id: s.name, name: s.name, type: s.type, 
                status: 'UNSUPPORTED', percent: 0, error: null
            })) };
        }

        // 3. عرض القائمة
        console.log('📋 قائمة المهام المدعومة:');
        supported.forEach((q, i) => {
            const type = normalizeType(q);
            console.log(`   ${i + 1}. ${q.name || q.id} [${type}]`);
        });
        console.log('');

        // 4. حل المهام واحدة واحدة
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
            console.log(`   🆔 ${questId}`);

            if (onUpdate) onUpdate(toQuestShape(quest, { status: 'running', percent: 0 }));

            try {
                // ✅ محاولة التسجيل (Enroll) يدوياً قبل الحل
                if (typeof dq.enroll === 'function') {
                    try {
                        console.log(`   📝 محاولة التسجيل...`);
                        await dq.enroll(questId);
                        console.log(`   ✅ تم التسجيل`);
                    } catch (e) {
                        if (e.message.includes('already') || e.message.includes('400')) {
                            console.log(`   ⚠️ مسجل مسبقاً`);
                        } else {
                            console.log(`   ⚠️ التسجيل: ${e.message}`);
                        }
                    }
                }

                let solver = null;
                const TIMEOUT_MS = 20 * 60 * 1000; // 20 دقيقة حد أقصى للمهمة

                // ✅ محاولة createSolver أولاً
                if (typeof dq.createSolver === 'function') {
                    console.log(`   🔧 استخدام createSolver...`);
                    solver = dq.createSolver(quest);
                    solvers.push(solver);

                    // ✅ حل مع timeout
                    const solverPromise = solver.solve ? solver.solve() : solver.run ? solver.run() : solver;
                    
                    let lastPercent = 0;
                    let lastLogTime = Date.now();
                    
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
                        } else {
                            // ما فيه percent، نطبع نقطة كل 30 ثانية
                            if (Date.now() - lastLogTime > 30000) {
                                process.stdout.write(`\r   ⏳ شغالة... (${Math.round((Date.now() - lastLogTime) / 1000)}s من آخر تحديث)`);
                                lastLogTime = Date.now();
                            }
                        }
                    }, 2000);

                    // ✅ Timeout race
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
                    console.log(`   🔧 استخدام solve مباشر...`);
                    const result = await Promise.race([
                        dq.solve(quest),
                        sleep(TIMEOUT_MS).then(() => ({ timeout: true })),
                    ]);
                    
                    if (result && result.timeout) {
                        throw new Error(`تجاوز الحد الأقصى (${TIMEOUT_MS / 60000} دقيقة)`);
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

        // أضف المتخطاة للنتائج
        const skippedResults = skipped.map(s => ({
            id: s.name, name: s.name, type: s.type,
            status: 'UNSUPPORTED', percent: 0, error: null
        }));

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
        console.error(err.stack);
        return { success: false, error: err.message };
    }
}

async function fetchQuestsOnly(token) {
    try {
        const QuestsClass = await loadQuestsLib();
        const dq = new QuestsClass(token);

        if (typeof dq.getStatus === 'function') {
            const status = await dq.getStatus();
            const mapped = status.map(s => toQuestShape(s));
            const valid = mapped.filter(q => q.status === 'PENDING' || q.status === 'running');
            return { success: true, allQuests: mapped, valid };
        }

        const quests = await dq.fetchQuests();
        const mapped = quests.map(q => toQuestShape(q));
        const valid = mapped.filter(q => q.status === 'PENDING');
        return { success: true, allQuests: mapped, valid };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

module.exports = { solveSequentially, fetchQuestsOnly, toQuestShape, normalizeStatus, normalizeType };

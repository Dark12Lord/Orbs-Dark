const config = require('./config');

// ===== تحميل مكتبة discord-quests (ESM) ديناميكياً =====
let DiscordQuests = null;

async function loadQuestsLib() {
    if (!DiscordQuests) {
        const mod = await import('discord-quests');
        // المكتبة قد تصدر الكلاس مباشرة أو داخل default
        DiscordQuests = mod.DiscordQuests || mod.default?.DiscordQuests || mod.default;
        
        if (!DiscordQuests) {
            throw new Error('فشل تحميل DiscordQuests من المكتبة');
        }
    }
    return DiscordQuests;
}

// ===== انتظار عشوائي بين المهام =====
function randomDelay() {
    const delay = Math.floor(
        Math.random() * (config.questDelayMax - config.questDelayMin) + config.questDelayMin
    );
    return new Promise(resolve => setTimeout(resolve, delay));
}

// ===== استخراج حالة المهمة بشكل موحد =====
function normalizeStatus(quest) {
    const status = quest.status || quest.state || 'UNKNOWN';
    return String(status).toUpperCase();
}

// ===== استخراج اسم المهمة =====
function getQuestName(quest) {
    return quest.name || quest.title || quest.id || 'مهمة بدون اسم';
}

// ===== استخراج مكافأة المهمة =====
function getQuestReward(quest) {
    if (quest.reward) return quest.reward;
    if (quest.rewards && Array.isArray(quest.rewards)) {
        return quest.rewards.reduce((sum, r) => sum + (r.amount || r.orb || 0), 0);
    }
    if (quest.orbReward) return quest.orbReward;
    return 0;
}

// ===== حل المهام بالتسلسل (واحدة واحدة) =====
async function solveSequentially(token, onUpdate) {
    const results = [];

    try {
        // تحميل المكتبة
        const QuestsClass = await loadQuestsLib();
        const dq = new QuestsClass({ token });

        // ===== جلب المهام المتاحة =====
        let quests;
        if (typeof dq.getQuests === 'function') {
            quests = await dq.getQuests();
        } else if (typeof dq.fetchQuests === 'function') {
            quests = await dq.fetchQuests();
        } else if (typeof dq.solveAll === 'function' && !onUpdate) {
            // حل كل المهام دفعة وحدة (احتياطي)
            const res = await dq.solveAll();
            return { success: true, quests: res || [] };
        } else {
            throw new Error('المكتبة ما تدعم جلب المهام');
        }

        if (!quests || quests.length === 0) {
            return { success: true, quests: [], message: 'لا توجد مهام متاحة' };
        }

        // ===== فلترة المهام غير المكتملة =====
        const pending = quests.filter(q => {
            const s = normalizeStatus(q);
            return s !== 'COMPLETED' && s !== 'REJECTED' && s !== 'CLAIMED';
        });

        // ===== المهام المكتملة مسبقاً =====
        const alreadyDone = quests.filter(q => {
            const s = normalizeStatus(q);
            return s === 'COMPLETED' || s === 'REJECTED' || s === 'CLAIMED';
        }).map(q => ({
            id: q.id,
            name: getQuestName(q),
            type: q.type || q.taskType || 'UNKNOWN',
            status: normalizeStatus(q),
            reward: getQuestReward(q),
        }));

        if (pending.length === 0) {
            return {
                success: true,
                quests: alreadyDone,
                message: 'كل المهام مكتملة مسبقاً',
            };
        }

        // ===== حل المهام واحدة واحدة =====
        for (const quest of pending) {
            const questName = getQuestName(quest);

            try {
                if (onUpdate) {
                    onUpdate({
                        questId: quest.id,
                        questName: questName,
                        status: 'running',
                    });
                }

                // محاولة الحل بالطرق المختلفة
                if (typeof dq.solve === 'function') {
                    await dq.solve(quest.id);
                } else if (typeof dq.completeQuest === 'function') {
                    await dq.completeQuest(quest.id);
                } else if (typeof dq.solveQuest === 'function') {
                    await dq.solveQuest(quest);
                } else {
                    throw new Error('المكتبة ما تدعم حل المهام الفردية');
                }

                results.push({
                    id: quest.id,
                    name: questName,
                    type: quest.type || quest.taskType || 'UNKNOWN',
                    status: 'COMPLETED',
                    reward: getQuestReward(quest),
                });

                if (onUpdate) {
                    onUpdate({
                        questId: quest.id,
                        questName: questName,
                        status: 'completed',
                    });
                }

                // تأخير عشوائي بين المهام
                await randomDelay();

            } catch (err) {
                results.push({
                    id: quest.id,
                    name: questName,
                    type: quest.type || quest.taskType || 'UNKNOWN',
                    status: 'REJECTED',
                    reward: 0,
                    error: err.message,
                });

                if (onUpdate) {
                    onUpdate({
                        questId: quest.id,
                        questName: questName,
                        status: 'rejected',
                        error: err.message,
                    });
                }
            }
        }

        return {
            success: true,
            quests: [...alreadyDone, ...results],
        };

    } catch (err) {
        return { success: false, error: err.message };
    }
}

module.exports = { solveSequentially };
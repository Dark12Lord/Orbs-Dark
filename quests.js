const { DiscordQuests } = require('discord-quests');
const config = require('./config');

// انتظار عشوائي
function randomDelay() {
    const delay = Math.floor(
        Math.random() * (config.questDelayMax - config.questDelayMin) + config.questDelayMin
    );
    return new Promise(resolve => setTimeout(resolve, delay));
}

// حل المهام بالتسلسل (واحدة واحدة)
async function solveSequentially(token, onUpdate) {
    const dq = new DiscordQuests(token);
    const results = [];
    
    try {
        // جلب المهام المتاحة
        const quests = await dq.getQuests();
        
        if (!quests || quests.length === 0) {
            return { success: true, quests: [], message: 'لا توجد مهام متاحة' };
        }

        // فلترة المهام غير المكتملة
        const pending = quests.filter(q => 
            q.status !== 'COMPLETED' && q.status !== 'REJECTED'
        );

        if (pending.length === 0) {
            return { 
                success: true, 
                quests: quests.map(q => ({
                    id: q.id,
                    name: q.name || q.title,
                    type: q.type,
                    status: q.status,
                    reward: q.reward || 0,
                })),
                message: 'كل المهام مكتملة' 
            };
        }

        // حل المهام واحدة واحدة
        for (const quest of pending) {
            try {
                if (onUpdate) {
                    onUpdate({
                        questId: quest.id,
                        questName: quest.name || quest.title,
                        status: 'running',
                    });
                }

                await dq.solve(quest.id);
                
                results.push({
                    id: quest.id,
                    name: quest.name || quest.title,
                    type: quest.type,
                    status: 'COMPLETED',
                    reward: quest.reward || 0,
                });

                // تأخير بين المهام (عشوائي)
                await randomDelay();

            } catch (err) {
                results.push({
                    id: quest.id,
                    name: quest.name || quest.title,
                    type: quest.type,
                    status: 'REJECTED',
                    error: err.message,
                });
            }
        }

        // المهام المكتملة مسبقاً
        const completed = quests.filter(q => 
            q.status === 'COMPLETED' || q.status === 'REJECTED'
        );

        const allQuests = [
            ...completed.map(q => ({
                id: q.id,
                name: q.name || q.title,
                type: q.type,
                status: q.status,
                reward: q.reward || 0,
            })),
            ...results,
        ];

        return { success: true, quests: allQuests };

    } catch (err) {
        return { success: false, error: err.message };
    }
}

module.exports = { solveSequentially };
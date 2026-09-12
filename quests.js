// quests.js - محرك المهام باستخدام مكتبة discord-quests
const { DiscordQuests } = require('discord-quests');
const config = require('./config');

/**
 * حل جميع المهام المتاحة لحساب معين باستخدام المكتبة.
 * @param {string} token - توكن الحساب.
 * @param {function} onUpdate - دالة يتم استدعاؤها عند تحديث حالة المهمة.
 * @returns {Promise<object>} - كائن يحتوي على نتائج المهام.
 */
async function solveSequentially(token, onUpdate) {
    try {
        console.log('[quests] 🚀 بدء جلسة حل المهام باستخدام مكتبة discord-quests...');

        // 1. إنشاء نسخة من المكتبة مع التوكن
        const dq = new DiscordQuests(token);

        // 2. استدعاء دالة solveAll التي تتولى كل شيء
        //    (جلب المهام، التسجيل، الحل، معالجة الأخطاء)
        const results = await dq.solveAll({
            onProgress: ({ taskId, percent }) => {
                // هذه الدالة تُستدعى أثناء تقدم المهمة
                if (onUpdate) {
                    onUpdate({
                        questId: taskId,
                        questName: `مهمة ${taskId}`, // يمكننا محاولة جلب الاسم لاحقاً
                        status: 'running',
                        percent: percent,
                    });
                }
            },
            onCompleted: (questId) => {
                // هذه الدالة تُستدعى عند اكتمال المهمة
                if (onUpdate) {
                    onUpdate({
                        questId: questId,
                        questName: `مهمة ${questId}`,
                        status: 'completed',
                        percent: 100,
                    });
                }
                console.log(`[quests] ✅ اكتملت المهمة: ${questId}`);
            },
            onError: (questId, err) => {
                // هذه الدالة تُستدعى عند فشل مهمة
                if (onUpdate) {
                    onUpdate({
                        questId: questId,
                        questName: `مهمة ${questId}`,
                        status: 'rejected',
                        error: err.message,
                    });
                }
                console.error(`[quests] ❌ فشلت المهمة ${questId}:`, err.message);
            },
        });

        console.log('[quests] 🏁 انتهت الجلسة. النتائج:', JSON.stringify(results, null, 2));

        // إعادة النتائج بتنسيق يفهمه bot.js
        return { success: true, quests: results };

    } catch (err) {
        console.error('[quests] ❌ خطأ عام في solveSequentially:', err.message);
        return { success: false, error: err.message };
    }
}

module.exports = { solveSequentially };
// quests.js - محرك المهام باستخدام discord.js-selfbot-v13
const { Client } = require('discord.js-selfbot-v13');
const config = require('./config');

// دالة مساعدة للتأخير
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function solveSequentially(token, onUpdate) {
    const results = [];
    console.log('[quests] 🚀 بدء جلسة حل المهام...');

    // 1. إنشاء عميل Selfbot جديد
    const client = new Client();

    try {
        // 2. تسجيل الدخول باستخدام التوكن
        await client.login(token);
        console.log(`[quests] ✅ تم تسجيل الدخول كـ ${client.user.username}`);

        // 3. جلب قائمة المهام النشطة
        // ملاحظة: هذه المهام تأتي من API الداخلي لديسكورد
        const quests = await client.quests.fetchQuests(); 
        // ملاحظة: قد تحتاج للتأكد من اسم الدالة الصحيح في المكتبة (مثلاً fetchActiveQuests)

        if (!quests || quests.length === 0) {
            console.log('[quests] ℹ️ لا توجد مهام نشطة.');
            return { success: true, quests: [] };
        }

        console.log(`[quests] 📋 تم العثور على ${quests.length} مهمة.`);

        // 4. حل كل مهمة واحدة تلو الأخرى
        for (const quest of quests) {
            const questId = quest.id;
            const questName = quest.config?.messages?.questName || questId;
            const questType = quest.config?.taskConfigV2?.tasks ? Object.keys(quest.config.taskConfigV2.tasks)[0] : 'UNKNOWN';

            try {
                console.log(`[quests] ▶️ بدء حل: ${questName} (${questType})`);
                if (onUpdate) onUpdate({ questId, questName, status: 'running', percent: 0 });

                // 4.1. التسجيل في المهمة (Enroll)
                // يتم ذلك عادةً بشكل تلقائي عند بدء حل المهمة في هذه المكتبة
                
                // 4.2. حل المهمة حسب نوعها
                if (questType === 'WATCH_VIDEO' || questType === 'WATCH_VIDEO_ON_MOBILE') {
                    await solveVideoQuest(client, quest, onUpdate);
                } else if (questType === 'PLAY_ON_DESKTOP') {
                    await solveGameQuest(client, quest, onUpdate);
                } else {
                    console.log(`[quests] ⏭️ نوع غير مدعوم حالياً: ${questType}`);
                    throw new Error(`نوع غير مدعوم: ${questType}`);
                }

                results.push({ id: questId, name: questName, type: questType, status: 'COMPLETED', reward: 0 });
                console.log(`[quests] ✅ اكتملت: ${questName}`);
                if (onUpdate) onUpdate({ questId, questName, status: 'completed', percent: 100 });

                // تأخير بين المهام
                await sleep(5000 + Math.random() * 10000);

            } catch (err) {
                console.error(`[quests] ❌ فشلت ${questName}:`, err.message);
                results.push({ id: questId, name: questName, type: questType, status: 'REJECTED', reward: 0, error: err.message });
                if (onUpdate) onUpdate({ questId, questName, status: 'rejected', error: err.message });
            }
        }

        console.log('[quests] 🏁 انتهت الجلسة.');
        return { success: true, quests: results };

    } catch (err) {
        console.error('[quests] ❌ خطأ عام:', err.message);
        return { success: false, error: err.message };
    } finally {
        // 5. تدمير العميل بعد الانتهاء
        if (client && client.destroy) {
            client.destroy();
            console.log('[quests] 🔌 تم إغلاق الاتصال.');
        }
    }
}

// دالة لحل مهام الفيديو
async function solveVideoQuest(client, quest, onUpdate) {
    const questId = quest.id;
    const questName = quest.config?.messages?.questName || questId;
    const durationMs = quest.config?.taskConfigV2?.tasks?.WATCH_VIDEO?.videoDurationMs || 900000; // 15 دقيقة افتراضياً
    const steps = Math.ceil(durationMs / 30000); // خطوة كل 30 ثانية
    
    for (let i = 1; i <= steps; i++) {
        const timestamp = Math.min(i * 30000, durationMs);
        await client.quests.videoProgress(questId, timestamp); // دالة افتراضية
        if (onUpdate) {
            const percent = Math.round((i / steps) * 100);
            onUpdate({ questId, questName, status: 'running', percent });
        }
        await sleep(30000 + Math.random() * 5000); // تأخير عشوائي
    }
}

// دالة لحل مهام اللعب
async function solveGameQuest(client, quest, onUpdate) {
    const questId = quest.id;
    const questName = quest.config?.messages?.questName || questId;
    const applicationId = quest.config?.taskConfigV2?.tasks?.PLAY_ON_DESKTOP?.applications?.[0]?.id;
    
    if (!applicationId) {
        throw new Error('لم يتم العثور على application_id');
    }

    const durationMs = 900000; // 15 دقيقة افتراضياً
    const steps = Math.ceil(durationMs / 60000); // نبضة كل دقيقة

    for (let i = 1; i <= steps; i++) {
        await client.quests.heartbeat(questId, applicationId); // دالة افتراضية
        if (onUpdate) {
            const percent = Math.round((i / steps) * 100);
            onUpdate({ questId, questName, status: 'running', percent });
        }
        await sleep(60000 + Math.random() * 7000);
    }
}

module.exports = { solveSequentially };
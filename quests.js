// quests.js - محرك المهام باستخدام discord.js-selfbot-v13
const { Client } = require('discord.js-selfbot-v13');

async function solveSequentially(token, onUpdate) {
    const results = [];
    console.log('[quests] 🚀 بدء جلسة حل المهام...');

    const client = new Client();

    try {
        await client.login(token);
        console.log(`[quests] ✅ تم تسجيل الدخول كـ ${client.user.username}`);

        // ✅ الدالة الصحيحة هي get() وليس fetchQuests()
        await client.quests.get();
        console.log('[quests] 📋 تم جلب المهام بنجاح');

        // ✅ فلترة المهام الصالحة (غير منتهية وغير مكتملة)
        const validQuests = client.quests.filterQuestsValid();
        console.log(`[quests] 📊 عدد المهام الصالحة: ${validQuests.length}`);

        if (validQuests.length === 0) {
            console.log('[quests] ℹ️ لا توجد مهام صالحة للحل حالياً.');
            return { success: true, quests: [] };
        }

        // ✅ حل كل مهمة صالحة واحدة تلو الأخرى
        for (const quest of validQuests) {
            const questId = quest.id;
            const questName = quest.config?.messages?.questName || questId;

            try {
                console.log(`[quests] ▶️ بدء حل: ${questName}`);
                if (onUpdate) onUpdate({ questId, questName, status: 'running', percent: 0 });

                // ✅ doingQuest() تتولى التسجيل + الحل + الانتظار تلقائياً
                await client.quests.doingQuest(quest);

                results.push({ id: questId, name: questName, status: 'COMPLETED' });
                console.log(`[quests] ✅ اكتملت: ${questName}`);
                if (onUpdate) onUpdate({ questId, questName, status: 'completed', percent: 100 });

            } catch (err) {
                console.error(`[quests] ❌ فشلت ${questName}:`, err.message);
                results.push({ id: questId, name: questName, status: 'REJECTED', error: err.message });
                if (onUpdate) onUpdate({ questId, questName, status: 'rejected', error: err.message });
            }
        }

        console.log('[quests] 🏁 انتهت الجلسة.');
        return { success: true, quests: results };

    } catch (err) {
        console.error('[quests] ❌ خطأ عام:', err.message);
        return { success: false, error: err.message };
    } finally {
        if (client && client.destroy) {
            client.destroy();
            console.log('[quests] 🔌 تم إغلاق الاتصال.');
        }
    }
}

module.exports = { solveSequentially };
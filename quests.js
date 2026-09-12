// quests.js - محرك المهام باستخدام djs-selfbot-v13
const { Client } = require('djs-selfbot-v13');

// ===== دالة رسم شريط التقدم =====
function renderProgressBar(percent, width = 20) {
    const filled = Math.round((percent / 100) * width);
    const empty = width - filled;
    return `[${'█'.repeat(filled)}${'░'.repeat(empty)}] ${percent}%`;
}

// ===== دالة تأخير =====
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ===== استخراج اسم المهمة =====
function getQuestName(quest) {
    return quest.config?.messages?.questName || quest.config?.messages?.quest_name || quest.id;
}

// ===== المحرك الرئيسي =====
async function solveSequentially(token, onUpdate) {
    const results = [];
    console.log('\n' + '='.repeat(50));
    console.log('🚀 Dark Orbs - بدء جلسة حل المهام');
    console.log('='.repeat(50) + '\n');

    const client = new Client();

    try {
        // ✅ تسجيل الدخول (djs-selfbot-v13 يحدّث build number و User-Agent تلقائياً)
        await client.login(token);
        console.log(`✅ تم تسجيل الدخول كـ ${client.user.username}\n`);

        // ✅ جلب المهام الصالحة (غير منتهية وغير مكتملة)
        await client.quests.get();
        const validQuests = client.quests.filterQuestsValid();

        console.log(`📊 عدد المهام الصالحة: ${validQuests.length}\n`);

        if (validQuests.length === 0) {
            console.log('ℹ️ لا توجد مهام صالحة حالياً.');
            return { success: true, quests: [] };
        }

        // عرض ملخص المهام
        console.log('📋 قائمة المهام:');
        validQuests.forEach((q, i) => {
            console.log(`   ${i + 1}. ${getQuestName(q)}`);
        });
        console.log('');

        // ✅ حل المهام واحدة تلو الأخرى
        for (let i = 0; i < validQuests.length; i++) {
            const quest = validQuests[i];
            const questId = quest.id;
            const questName = getQuestName(quest);

            console.log(`\n[${i + 1}/${validQuests.length}] ═══════════════════`);
            console.log(`   📌 ${questName}`);

            try {
                if (onUpdate) onUpdate({ questId, questName, status: 'running', percent: 0 });

                // ✅ doingQuest تتولى التسجيل + الحل + الانتظار تلقائياً
                console.log(`   ⏳ جاري الحل...`);
                await client.quests.doingQuest(quest);

                // بعد اكتمال المهمة، نعرض التقدم النهائي
                process.stdout.write(`\r   ${renderProgressBar(100)}`);

                results.push({ id: questId, name: questName, status: 'COMPLETED' });
                console.log(`\n   ✅ اكتملت: ${questName}`);

                if (onUpdate) onUpdate({ questId, questName, status: 'completed', percent: 100 });

                // تأخير بين المهام (5-15 ثانية عشوائية)
                if (i < validQuests.length - 1) {
                    const delay = 5000 + Math.random() * 10000;
                    console.log(`   ⏳ انتظار ${Math.round(delay / 1000)} ثانية قبل التالية...`);
                    await sleep(delay);
                }

            } catch (err) {
                console.log(`\n   ❌ فشلت: ${err.message}`);
                results.push({ id: questId, name: questName, status: 'REJECTED', error: err.message });
                if (onUpdate) onUpdate({ questId, questName, status: 'rejected', error: err.message });
            }
        }

        // ملخص نهائي
        const succeeded = results.filter(r => r.status === 'COMPLETED').length;
        const failed = results.filter(r => r.status === 'REJECTED').length;

        console.log('\n' + '='.repeat(50));
        console.log(`🏁 انتهت الجلسة - نجح: ${succeeded}, فشل: ${failed}`);
        console.log('='.repeat(50) + '\n');

        return { success: true, quests: results };

    } catch (err) {
        console.error(`\n❌ خطأ عام: ${err.message}`);
        return { success: false, error: err.message };
    } finally {
        if (client && client.destroy) {
            client.destroy();
            console.log('🔌 تم إغلاق الاتصال.');
        }
    }
}

module.exports = { solveSequentially };
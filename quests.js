// quests.js - محرك المهام مع تقدم مرئي (taskConfigV2 compatible)
const { Client } = require('discord.js-selfbot-v13');

// ===== دالة رسم شريط التقدم =====
function renderProgressBar(percent, width = 20) {
    const filled = Math.round((percent / 100) * width);
    const empty = width - filled;
    const bar = '█'.repeat(filled) + '░'.repeat(empty);
    return `[${bar}] ${percent}%`;
}

// ===== دالة تأخير =====
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ===== استخراج application_id من البنية الجديدة =====
function getApplicationId(quest) {
    // البنية الجديدة (يوليو 2026+)
    const taskConfig = quest.config?.taskConfigV2 || quest.config?.taskConfig || quest.config?.task_config;
    if (!taskConfig || !taskConfig.tasks) return null;
    
    const taskTypes = ['PLAY_ON_DESKTOP', 'STREAM_ON_DESKTOP', 'PLAY_ACTIVITY'];
    for (const type of taskTypes) {
        if (taskConfig.tasks[type]?.applications?.[0]?.id) {
            return taskConfig.tasks[type].applications[0].id;
        }
    }
    return null;
}

// ===== استخراج نوع المهمة =====
function getQuestType(quest) {
    const taskConfig = quest.config?.taskConfigV2 || quest.config?.taskConfig || quest.config?.task_config;
    if (!taskConfig || !taskConfig.tasks) return 'UNKNOWN';
    
    const types = ['WATCH_VIDEO', 'WATCH_VIDEO_ON_MOBILE', 'PLAY_ON_DESKTOP', 'STREAM_ON_DESKTOP', 'PLAY_ACTIVITY', 'ACHIEVEMENT_IN_ACTIVITY'];
    for (const type of types) {
        if (taskConfig.tasks[type] != null) return type;
    }
    return 'UNKNOWN';
}

// ===== استخراج اسم المهمة =====
function getQuestName(quest) {
    return quest.config?.messages?.questName || quest.config?.messages?.quest_name || quest.id;
}

// ===== استخراج المدة =====
function getDurationMs(quest, questType) {
    const taskConfig = quest.config?.taskConfigV2 || quest.config?.taskConfig || quest.config?.task_config;
    if (!taskConfig || !taskConfig.tasks) return 900000;
    
    const task = taskConfig.tasks[questType];
    if (!task) return 900000;
    
    return task.videoDurationMs || task.durationMs || task.duration || 900000;
}

// ===== حل مهمة فيديو مع تقدم مرئي =====
async function solveVideoQuest(client, quest, onUpdate) {
    const questId = quest.id;
    const questName = getQuestName(quest);
    const durationMs = getDurationMs(quest, 'WATCH_VIDEO');
    const speedMultiplier = 2.0;
    const intervalMs = 30000;
    const effectiveInterval = intervalMs / speedMultiplier;
    const totalSteps = Math.ceil(durationMs / (intervalMs * speedMultiplier));

    console.log(`\n🎬 بدء: ${questName}`);
    console.log(`   المدة: ${Math.round(durationMs / 60000)} دقيقة | السرعة: ${speedMultiplier}x`);
    console.log(`   ${renderProgressBar(0)}`);

    // التسجيل في المهمة
    try {
        await client.quests.videoProgress(questId, 0);
    } catch (err) {
        if (err.message.includes('already enrolled') || err.message.includes('400')) {
            console.log('   ⚠️ مسجل مسبقاً');
        }
    }

    for (let step = 1; step <= totalSteps; step++) {
        const timestamp = Math.min(step * intervalMs * speedMultiplier, durationMs);

        try {
            await client.quests.videoProgress(questId, timestamp);
        } catch (err) {
            if (err.message.includes('429')) {
                console.log('   ⏸️ Rate limit، انتظار...');
                await sleep(10000);
                step--;
                continue;
            }
            throw err;
        }

        const percent = Math.min(Math.round((step / totalSteps) * 100), 100);
        // تحديث شريط التقدم في نفس السطر
        process.stdout.write(`\r   ${renderProgressBar(percent)}`);
        
        if (onUpdate) onUpdate({ questId, questName, status: 'running', percent });

        await sleep(effectiveInterval + Math.random() * 2000);
    }

    console.log(`\n   ✅ اكتملت: ${questName}`);
    return true;
}

// ===== حل مهمة لعب مع تقدم مرئي =====
async function solveGameQuest(client, quest, onUpdate) {
    const questId = quest.id;
    const questName = getQuestName(quest);
    const applicationId = getApplicationId(quest);
    const durationMs = getDurationMs(quest, 'PLAY_ON_DESKTOP');
    const intervalMs = 60000;

    if (!applicationId) {
        throw new Error('لا يوجد application_id');
    }

    console.log(`\n🎮 بدء: ${questName}`);
    console.log(`   App: ${applicationId} | المدة: ${Math.round(durationMs / 60000)} دقيقة`);
    console.log(`   ${renderProgressBar(0)}`);

    const totalSteps = Math.ceil(durationMs / intervalMs);

    for (let step = 1; step <= totalSteps; step++) {
        try {
            await client.quests.heartbeat(questId, applicationId);
        } catch (err) {
            if (err.message.includes('429')) {
                console.log('   ⏸️ Rate limit، انتظار...');
                await sleep(10000);
                step--;
                continue;
            }
            throw err;
        }

        const percent = Math.min(Math.round((step / totalSteps) * 100), 100);
        process.stdout.write(`\r   ${renderProgressBar(percent)}`);
        
        if (onUpdate) onUpdate({ questId, questName, status: 'running', percent });

        await sleep(intervalMs + Math.random() * 5000);
    }

    console.log(`\n   ✅ اكتملت: ${questName}`);
    return true;
}

// ===== المحرك الرئيسي =====
async function solveSequentially(token, onUpdate) {
    const results = [];
    console.log('\n' + '='.repeat(50));
    console.log('🚀 Dark Orbs - بدء جلسة حل المهام');
    console.log('='.repeat(50) + '\n');

    const client = new Client();

    try {
        await client.login(token);
        console.log(`✅ تم تسجيل الدخول كـ ${client.user.username}\n`);

        // جلب المهام
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
            const type = getQuestType(q);
            console.log(`   ${i + 1}. ${getQuestName(q)} [${type}]`);
        });
        console.log('');

        // حل المهام
        for (let i = 0; i < validQuests.length; i++) {
            const quest = validQuests[i];
            const questId = quest.id;
            const questName = getQuestName(quest);
            const questType = getQuestType(quest);

            console.log(`\n[${i + 1}/${validQuests.length}] ═══════════════════`);

            try {
                if (onUpdate) onUpdate({ questId, questName, status: 'running', percent: 0 });

                if (questType === 'WATCH_VIDEO' || questType === 'WATCH_VIDEO_ON_MOBILE') {
                    await solveVideoQuest(client, quest, onUpdate);
                } else if (questType === 'PLAY_ON_DESKTOP' || questType === 'PLAY_ACTIVITY') {
                    await solveGameQuest(client, quest, onUpdate);
                } else {
                    console.log(`   ⏭️ نوع غير مدعوم: ${questType}`);
                    throw new Error(`نوع غير مدعوم: ${questType}`);
                }

                results.push({ id: questId, name: questName, type: questType, status: 'COMPLETED' });
                if (onUpdate) onUpdate({ questId, questName, status: 'completed', percent: 100 });

                // تأخير بين المهام
                if (i < validQuests.length - 1) {
                    const delay = 5000 + Math.random() * 10000;
                    console.log(`   ⏳ انتظار ${Math.round(delay / 1000)} ثانية قبل التالية...`);
                    await sleep(delay);
                }

            } catch (err) {
                console.log(`   ❌ فشلت: ${err.message}`);
                results.push({ id: questId, name: questName, type: questType, status: 'REJECTED', error: err.message });
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
// quests.js - محرك المهام باستخدام djs-selfbot-v13
const { Client } = require('djs-selfbot-v13');

function renderProgressBar(percent, width = 20) {
    const filled = Math.round((percent / 100) * width);
    const empty = width - filled;
    return `[${'█'.repeat(filled)}${'░'.repeat(empty)}] ${percent}%`;
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function getQuestName(quest) {
    return quest.config?.messages?.questName || quest.config?.messages?.quest_name || quest.id;
}

function getQuestType(quest) {
    const taskConfig = quest.config?.taskConfigV2 || quest.config?.taskConfig || quest.config?.task_config;
    if (!taskConfig?.tasks) return 'UNKNOWN';
    if (taskConfig.tasks.WATCH_VIDEO || taskConfig.tasks.WATCH_VIDEO_ON_MOBILE) return 'WATCH_VIDEO';
    if (taskConfig.tasks.PLAY_ON_DESKTOP) return 'PLAY_ON_DESKTOP';
    if (taskConfig.tasks.PLAY_ACTIVITY) return 'PLAY_ACTIVITY';
    return 'UNKNOWN';
}

function getVideoDuration(quest) {
    const taskConfig = quest.config?.taskConfigV2 || quest.config?.taskConfig || quest.config?.task_config;
    return taskConfig?.tasks?.WATCH_VIDEO?.videoDurationMs || 
           taskConfig?.tasks?.WATCH_VIDEO_ON_MOBILE?.videoDurationMs || 
           900000;
}

function getApplicationId(quest) {
    const taskConfig = quest.config?.taskConfigV2 || quest.config?.taskConfig || quest.config?.task_config;
    return taskConfig?.tasks?.PLAY_ON_DESKTOP?.applications?.[0]?.id || null;
}

async function solveSequentially(token, onUpdate) {
    const results = [];
    console.log('\n' + '='.repeat(50));
    console.log('🚀 Dark Orbs - بدء جلسة حل المهام');
    console.log('='.repeat(50) + '\n');

    const client = new Client();

    try {
        await client.login(token);
        console.log(`✅ تم تسجيل الدخول كـ ${client.user.username}\n`);

        await client.quests.get();
        const validQuests = client.quests.filterQuestsValid();
        console.log(`📊 عدد المهام الصالحة: ${validQuests.length}\n`);

        if (validQuests.length === 0) {
            console.log('ℹ️ لا توجد مهام صالحة حالياً.');
            return { success: true, quests: [] };
        }

        console.log('📋 قائمة المهام:');
        validQuests.forEach((q, i) => {
            console.log(`   ${i + 1}. ${getQuestName(q)} [${getQuestType(q)}]`);
        });
        console.log('');

        for (let i = 0; i < validQuests.length; i++) {
            const quest = validQuests[i];
            const questId = quest.id;
            const questName = getQuestName(quest);
            const questType = getQuestType(quest);

            console.log(`\n[${i + 1}/${validQuests.length}] ═══════════════════`);
            console.log(`   📌 ${questName} (${questType})`);

            try {
                if (onUpdate) onUpdate({ questId, questName, status: 'running', percent: 0 });

                if (questType === 'WATCH_VIDEO') {
                    const durationMs = getVideoDuration(quest);
                    const speedMultiplier = 2.0;
                    const intervalMs = 30000;
                    const totalSteps = Math.ceil(durationMs / (intervalMs * speedMultiplier));

                    console.log(`   ⏳ مدة: ${Math.round(durationMs / 60000)} دقيقة | خطوات: ${totalSteps}`);

                    for (let step = 1; step <= totalSteps; step++) {
                        const timestamp = Math.min(step * intervalMs * speedMultiplier, durationMs);
                        await client.quests.videoProgress(questId, timestamp);

                        const percent = Math.min(Math.round((step / totalSteps) * 100), 100);
                        process.stdout.write(`\r   ${renderProgressBar(percent)}`);
                        if (onUpdate) onUpdate({ questId, questName, status: 'running', percent });

                        await sleep(intervalMs / speedMultiplier + Math.random() * 2000);
                    }
                } else if (questType === 'PLAY_ON_DESKTOP' || questType === 'PLAY_ACTIVITY') {
                    const appId = getApplicationId(quest);
                    if (!appId) throw new Error('application_id غير موجود');

                    const durationMs = 900000;
                    const intervalMs = 60000;
                    const totalSteps = Math.ceil(durationMs / intervalMs);

                    console.log(`   🎮 App: ${appId} | خطوات: ${totalSteps}`);

                    for (let step = 1; step <= totalSteps; step++) {
                        await client.quests.heartbeat(questId, appId);

                        const percent = Math.min(Math.round((step / totalSteps) * 100), 100);
                        process.stdout.write(`\r   ${renderProgressBar(percent)}`);
                        if (onUpdate) onUpdate({ questId, questName, status: 'running', percent });

                        await sleep(intervalMs + Math.random() * 5000);
                    }
                } else {
                    throw new Error(`نوع غير مدعوم: ${questType}`);
                }

                results.push({ id: questId, name: questName, status: 'COMPLETED' });
                console.log(`\n   ✅ اكتملت: ${questName}`);
                if (onUpdate) onUpdate({ questId, questName, status: 'completed', percent: 100 });

                if (i < validQuests.length - 1) {
                    const delay = 5000 + Math.random() * 10000;
                    console.log(`   ⏳ انتظار ${Math.round(delay / 1000)} ثانية...`);
                    await sleep(delay);
                }

            } catch (err) {
                console.log(`\n   ❌ فشلت: ${err.message}`);
                results.push({ id: questId, name: questName, status: 'REJECTED', error: err.message });
                if (onUpdate) onUpdate({ questId, questName, status: 'rejected', error: err.message });
            }
        }

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

// ✅ التصدير الصحيح
module.exports = { solveSequentially };
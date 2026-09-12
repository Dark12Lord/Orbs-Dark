// quests.js - محرك المهام باستخدام djs-selfbot-v13 (نسخة مُحسَّنة)
const { Client } = require('djs-selfbot-v13');

function renderProgressBar(percent, width = 20) {
    const filled = Math.round((percent / 100) * width);
    const empty = width - filled;
    return `[${'█'.repeat(filled)}${'░'.repeat(empty)}] ${percent}%`;
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function getQuestName(quest) {
    return quest.config?.messages?.quest_name || quest.config?.messages?.questName || quest.id;
}

function getTaskConfig(quest) {
    const cfg = quest.config || quest._raw?.config;
    return cfg?.task_config_v2 || cfg?.taskConfigV2 || null;
}

function getQuestType(quest) {
    const taskConfig = getTaskConfig(quest);
    if (!taskConfig || !taskConfig.tasks) return 'UNKNOWN';
    
    const tasks = taskConfig.tasks;
    if (tasks.WATCH_VIDEO || tasks.WATCH_VIDEO_ON_MOBILE) return 'WATCH_VIDEO';
    if (tasks.PLAY_ON_DESKTOP) return 'PLAY_ON_DESKTOP';
    if (tasks.PLAY_ACTIVITY) return 'PLAY_ACTIVITY';
    if (tasks.ACHIEVEMENT_IN_ACTIVITY) return 'ACHIEVEMENT_IN_ACTIVITY';
    if (tasks.STREAM_ON_DESKTOP) return 'STREAM_ON_DESKTOP';
    
    return 'UNKNOWN';
}

function getApplicationId(quest) {
    const taskConfig = getTaskConfig(quest);
    if (!taskConfig || !taskConfig.tasks) return null;
    
    const tasks = taskConfig.tasks;
    return tasks.PLAY_ON_DESKTOP?.applications?.[0]?.id ||
           tasks.PLAY_ACTIVITY?.applications?.[0]?.id ||
           quest.config?.application?.id || null;
}

function getVideoDuration(quest) {
    const taskConfig = getTaskConfig(quest);
    if (!taskConfig || !taskConfig.tasks) return 900000;
    
    const tasks = taskConfig.tasks;
    return tasks.WATCH_VIDEO?.video_duration_ms || 
           tasks.WATCH_VIDEO_ON_MOBILE?.video_duration_ms ||
           900000;
}

// ✅ جلب التقدم الحقيقي من ديسكورد
async function getQuestProgress(client, questId) {
    try {
        const quest = client.quests.find(q => q.id === questId);
        if (!quest) return 0;
        
        const userStatus = quest.userStatus || quest.user_status;
        const progress = userStatus?.progress || {};
        
        const taskConfig = getTaskConfig(quest);
        if (!taskConfig?.tasks) return 0;
        
        const tasks = taskConfig.tasks;
        
        if (tasks.WATCH_VIDEO || tasks.WATCH_VIDEO_ON_MOBILE) {
            const durationMs = getVideoDuration(quest);
            const watchedMs = progress.video_progress_ms || 0;
            return Math.min(Math.round((watchedMs / durationMs) * 100), 100);
        }
        
        if (tasks.PLAY_ON_DESKTOP || tasks.PLAY_ACTIVITY) {
            const durationMs = tasks.PLAY_ON_DESKTOP?.duration_ms || 
                             tasks.PLAY_ACTIVITY?.duration_ms || 900000;
            const playedMs = progress.activity_progress_ms || 0;
            return Math.min(Math.round((playedMs / durationMs) * 100), 100);
        }
        
        return 0;
    } catch (err) {
        console.error(`[progress] فشل جلب التقدم:`, err.message);
        return 0;
    }
}

// ✅ التحقق من الاكتمال الحقيقي
async function isQuestCompleted(client, questId) {
    try {
        const quest = client.quests.find(q => q.id === questId);
        if (!quest) return false;
        
        const userStatus = quest.userStatus || quest.user_status;
        return userStatus?.completed_at !== null && userStatus?.completed_at !== undefined;
    } catch (err) {
        console.error(`[verify] فشل التحقق:`, err.message);
        return false;
    }
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

                // ✅ تخطي مهام النشاط التي تحتاج تدخل يدوي
                if (questType === 'PLAY_ACTIVITY' || questType === 'ACHIEVEMENT_IN_ACTIVITY') {
                    throw new Error(`نوع يحتاج تدخل يدوي: ${questType}`);
                }

                // محاولة accept
                try {
                    await client.quests.acceptQuest(questId);
                    console.log(`   ✅ تم قبول المهمة`);
                } catch (e) {
                    console.log(`   ⚠️ القبول: ${e.message}`);
                }

                if (questType === 'WATCH_VIDEO' || questType === 'WATCH_VIDEO_ON_MOBILE') {
                    const durationMs = getVideoDuration(quest);
                    const speedMultiplier = 3.0; // ✅ زد السرعة إلى 3x
                    const intervalMs = 30000;
                    const totalSteps = Math.ceil(durationMs / (intervalMs * speedMultiplier));
                    
                    for (let step = 1; step <= totalSteps; step++) {
                        const timestamp = Math.min(step * intervalMs * speedMultiplier, durationMs);
                        await client.quests.videoProgress(questId, timestamp);
                        
                        // ✅ جلب التقدم الحقيقي
                        const realProgress = await getQuestProgress(client, questId);
                        process.stdout.write(`\r   ${renderProgressBar(realProgress)}`);
                        if (onUpdate) onUpdate({ questId, questName, status: 'running', percent: realProgress });
                        
                        await sleep(intervalMs / speedMultiplier + Math.random() * 1000);
                    }
                } else if (questType === 'PLAY_ON_DESKTOP') {
                    const appId = getApplicationId(quest);
                    if (!appId) throw new Error('application_id غير موجود');
                    
                    const durationMs = 900000;
                    const intervalMs = 30000; // ✅ قلل إلى 30 ثانية
                    const totalSteps = Math.ceil(durationMs / intervalMs);
                    
                    for (let step = 1; step <= totalSteps; step++) {
                        await client.quests.heartbeat(questId, appId);
                        
                        const realProgress = await getQuestProgress(client, questId);
                        process.stdout.write(`\r   ${renderProgressBar(realProgress)}`);
                        if (onUpdate) onUpdate({ questId, questName, status: 'running', percent: realProgress });
                        
                        await sleep(intervalMs + Math.random() * 3000);
                    }
                } else {
                    throw new Error(`نوع غير مدعوم: ${questType}`);
                }

                // ✅ التحقق من الاكتمال الحقيقي
                await sleep(2000);
                const isCompleted = await isQuestCompleted(client, questId);
                
                if (!isCompleted) {
                    throw new Error(`لم تكتمل المهمة فعلياً (completed_at = null)`);
                }

                results.push({ id: questId, name: questName, status: 'COMPLETED' });
                console.log(`\n   ✅ اكتملت: ${questName}`);
                if (onUpdate) onUpdate({ questId, questName, status: 'completed', percent: 100 });

                if (i < validQuests.length - 1) {
                    const delay = 2000 + Math.random() * 3000; // ✅ قلل التأخير
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

module.exports = { solveSequentially };

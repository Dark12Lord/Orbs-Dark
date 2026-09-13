// quests.js - محرك المهام المُصلح (djs-selfbot-v13)
const { Client } = require('djs-selfbot-v13');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function renderProgressBar(percent, width = 20) {
    const filled = Math.round((percent / 100) * width);
    const empty = width - filled;
    return `[${'█'.repeat(filled)}${'░'.repeat(empty)}] ${percent}%`;
}

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
async function getRealProgress(client, questId) {
    try {
        const quest = client.quests.find(q => q.id === questId);
        if (!quest) return { percent: 0, completed: false };
        
        const userStatus = quest.userStatus || quest.user_status;
        if (!userStatus) return { percent: 0, completed: false };
        
        const progress = userStatus.progress || {};
        const completed = userStatus.completed_at !== null && userStatus.completed_at !== undefined;
        
        const taskConfig = getTaskConfig(quest);
        if (!taskConfig?.tasks) return { percent: 0, completed };
        
        const tasks = taskConfig.tasks;
        
        // لمهام الفيديو
        if (tasks.WATCH_VIDEO || tasks.WATCH_VIDEO_ON_MOBILE) {
            const durationMs = getVideoDuration(quest);
            const watchedMs = progress.video_progress_ms || 0;
            return {
                percent: Math.min(Math.round((watchedMs / durationMs) * 100), 100),
                completed,
            };
        }
        
        // لمهام اللعب (Desktop فقط، مو Activity)
        if (tasks.PLAY_ON_DESKTOP) {
            const durationMs = tasks.PLAY_ON_DESKTOP?.duration_ms || 900000;
            const playedMs = progress.activity_progress_ms || 0;
            return {
                percent: Math.min(Math.round((playedMs / durationMs) * 100), 100),
                completed,
            };
        }
        
        return { percent: 0, completed };
    } catch (err) {
        return { percent: 0, completed: false };
    }
}

// ✅ معالجة مهام الفيديو مع التتبع الحقيقي
async function solveVideoQuest(client, quest, onUpdate) {
    const questId = quest.id;
    const questName = getQuestName(quest);
    const durationMs = getVideoDuration(quest);
    const intervalMs = 30000; // 30 ثانية (الافتراضي في ديسكورد)[reference:3]
    
    console.log(`   🎬 مدة: ${Math.round(durationMs / 1000)} ثانية`);
    
    // قبول المهمة أولاً
    try {
        await client.quests.acceptQuest(questId);
        console.log(`   ✅ تم القبول`);
    } catch (e) {
        console.log(`   ⚠️ القبول: ${e.message}`);
    }
    
    const startTime = Date.now();
    const totalSteps = Math.ceil(durationMs / intervalMs);
    
    for (let step = 1; step <= totalSteps; step++) {
        // إرسال timestamp متزايد (يتوافق مع الوقت الحقيقي)
        const timestamp = Math.min(step * intervalMs, durationMs);
        await client.quests.videoProgress(questId, timestamp);
        
        // ✅ جلب التقدم الحقيقي من ديسكورد
        await client.quests.get(); // تحديث البيانات
        const { percent, completed } = await getRealProgress(client, questId);
        
        process.stdout.write(`\r   ${renderProgressBar(percent)}`);
        if (onUpdate) onUpdate({ questId, questName, status: 'running', percent });
        
        if (completed) {
            console.log(`\n   ✅ اكتملت فعلياً (completed_at مُعيّن)`);
            return true;
        }
        
        // انتظار 30 ثانية (يتوافق مع المدة الحقيقية)
        await sleep(intervalMs);
    }
    
    // التحقق النهائي
    await sleep(2000);
    await client.quests.get();
    const finalCheck = await getRealProgress(client, questId);
    
    if (finalCheck.completed) {
        return true;
    }
    
    throw new Error(`لم تكتمل بعد ${Math.round(durationMs / 1000)} ثانية (completed_at = null)`);
}

// ✅ معالجة مهام اللعب (Desktop فقط)
async function solveGameQuest(client, quest, onUpdate) {
    const questId = quest.id;
    const questName = getQuestName(quest);
    const appId = getApplicationId(quest);
    const durationMs = 900000; // 15 دقيقة افتراضي
    const intervalMs = 60000; // 60 ثانية (الافتراضي في ديسكورد)[reference:4]
    
    if (!appId) throw new Error('application_id غير موجود');
    
    console.log(`   🎮 App: ${appId} | مدة: 15 دقيقة`);
    
    try {
        await client.quests.acceptQuest(questId);
        console.log(`   ✅ تم القبول`);
    } catch (e) {
        console.log(`   ⚠️ القبول: ${e.message}`);
    }
    
    const totalSteps = Math.ceil(durationMs / intervalMs);
    
    for (let step = 1; step <= totalSteps; step++) {
        await client.quests.heartbeat(questId, appId);
        
        await client.quests.get();
        const { percent, completed } = await getRealProgress(client, questId);
        
        process.stdout.write(`\r   ${renderProgressBar(percent)}`);
        if (onUpdate) onUpdate({ questId, questName, status: 'running', percent });
        
        if (completed) {
            console.log(`\n   ✅ اكتملت فعلياً`);
            return true;
        }
        
        await sleep(intervalMs);
    }
    
    await sleep(2000);
    await client.quests.get();
    const finalCheck = await getRealProgress(client, questId);
    
    if (finalCheck.completed) return true;
    
    throw new Error(`لم تكتمل المهمة فعلياً`);
}

// ✅ المحرك الرئيسي
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
            return { success: true, quests: [] };
        }

        // عرض القائمة
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

                // ✅ تخطي المهام التي تحتاج تدخل يدوي
                if (questType === 'PLAY_ACTIVITY' || questType === 'ACHIEVEMENT_IN_ACTIVITY') {
                    throw new Error(`يحتاج تدخل يدوي (OAuth) - تم التخطي`);
                }

                if (questType === 'WATCH_VIDEO' || questType === 'WATCH_VIDEO_ON_MOBILE') {
                    await solveVideoQuest(client, quest, onUpdate);
                } else if (questType === 'PLAY_ON_DESKTOP') {
                    await solveGameQuest(client, quest, onUpdate);
                } else {
                    throw new Error(`نوع غير مدعوم: ${questType}`);
                }

                results.push({ id: questId, name: questName, status: 'COMPLETED' });
                console.log(`\n   ✅ اكتملت: ${questName}`);
                if (onUpdate) onUpdate({ questId, questName, status: 'completed', percent: 100 });

                // ✅ تأخير بسيط عشوائي بين المهام (2-5 ثواني فقط)
                if (i < validQuests.length - 1) {
                    const delay = 2000 + Math.random() * 3000;
                    console.log(`   ⏳ انتظار ${Math.round(delay / 1000)} ثانية...`);
                    await sleep(delay);
                }

            } catch (err) {
                console.log(`\n   ❌ فشلت: ${err.message}`);
                results.push({ id: questId, name: questName, status: 'REJECTED', error: err.message });
                if (onUpdate) onUpdate({ questId, questName, status: 'rejected', error: err.message });
                
                // تأخير قصير حتى بعد الفشل
                await sleep(2000);
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
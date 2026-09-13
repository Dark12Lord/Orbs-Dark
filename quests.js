// quests.js - محرك المهام (djs-selfbot-v13)
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

// ✅ التحقق إذا المهمة مكتملة أو مستلمة مسبقاً
function isQuestDone(quest) {
    const userStatus = quest.userStatus || quest.user_status;
    if (!userStatus) return false;
    
    // مكتملة
    if (userStatus.completed_at) return true;
    // مستلمة (الـ Orbs مأخوذة)
    if (userStatus.claimed_at) return true;
    // أخذ الجائزة
    if (userStatus.orb_quantity_claimed) return true;
    
    return false;
}

// ✅ جلب التقدم الحقيقي
async function getRealProgress(client, questId) {
    try {
        const quest = client.quests.find(q => q.id === questId);
        if (!quest) return { percent: 0, completed: false };
        
        const userStatus = quest.userStatus || quest.user_status;
        if (!userStatus) return { percent: 0, completed: false };
        
        const progress = userStatus.progress || {};
        const completed = !!userStatus.completed_at;
        
        const taskConfig = getTaskConfig(quest);
        if (!taskConfig?.tasks) return { percent: 0, completed };
        
        const tasks = taskConfig.tasks;
        
        if (tasks.WATCH_VIDEO || tasks.WATCH_VIDEO_ON_MOBILE) {
            const durationMs = getVideoDuration(quest);
            const watchedMs = progress.video_progress_ms || 0;
            return {
                percent: Math.min(Math.round((watchedMs / durationMs) * 100), 100),
                completed,
            };
        }
        
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

// ===== حل مهمة فيديو =====
async function solveVideoQuest(client, quest, onUpdate) {
    const questId = quest.id;
    const questName = getQuestName(quest);
    const durationMs = getVideoDuration(quest);
    const intervalMs = 30000;
    
    console.log(`   🎬 مدة: ${Math.round(durationMs / 1000)} ثانية`);
    
    try {
        await client.quests.acceptQuest(questId);
        console.log(`   ✅ تم القبول`);
    } catch (e) {
        console.log(`   ⚠️ القبول: ${e.message}`);
    }
    
    const totalSteps = Math.ceil(durationMs / intervalMs);
    
    for (let step = 1; step <= totalSteps; step++) {
        const timestamp = Math.min(step * intervalMs, durationMs);
        await client.quests.videoProgress(questId, timestamp);
        
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
    
    throw new Error(`لم تكتمل بعد ${Math.round(durationMs / 1000)} ثانية`);
}

// ===== حل مهمة لعب =====
async function solveGameQuest(client, quest, onUpdate) {
    const questId = quest.id;
    const questName = getQuestName(quest);
    const appId = getApplicationId(quest);
    const durationMs = 900000;
    const intervalMs = 60000;
    
    if (!appId) throw new Error('application_id غير موجود');
    
    console.log(`   🎮 App: ${appId}`);
    
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
    
    throw new Error(`لم تكتمل المهمة`);
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

        await client.quests.get();
        
        // ✅ فلترة إضافية: تخطي المهام المكتملة والمستلمة
        const libraryValid = client.quests.filterQuestsValid();
        const validQuests = libraryValid.filter(q => {
            if (isQuestDone(q)) {
                console.log(`   ⏭️ تخطي (مكتملة/مستلمة): ${getQuestName(q)}`);
                return false;
            }
            return true;
        });
        
        console.log(`\n📊 عدد المهام الصالحة: ${validQuests.length}\n`);

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

                // تخطي المهام التي تحتاج تدخل يدوي
                if (questType === 'PLAY_ACTIVITY' || questType === 'ACHIEVEMENT_IN_ACTIVITY') {
                    throw new Error(`يحتاج تدخل يدوي (OAuth) - تخطي`);
                }

                if (questType === 'WATCH_VIDEO' || questType === 'WATCH_VIDEO_ON_MOBILE') {
                    await solveVideoQuest(client, quest, onUpdate);
                } else if (questType === 'PLAY_ON_DESKTOP') {
                    await solveGameQuest(client, quest, onUpdate);
                } else {
                    // ✅ سجل بنية المهمة UNKNOWN للمساعدة في التصحيح
                    if (!global._loggedUnknown) {
                        global._loggedUnknown = true;
                        console.log('\n🔍 بنية مهمة UNKNOWN:');
                        console.log(JSON.stringify(getTaskConfig(quest), null, 2).slice(0, 2000));
                        console.log('');
                    }
                    throw new Error(`نوع غير مدعوم: ${questType}`);
                }

                results.push({ id: questId, name: questName, status: 'COMPLETED' });
                console.log(`\n   ✅ اكتملت: ${questName}`);
                if (onUpdate) onUpdate({ questId, questName, status: 'completed', percent: 100 });

                // تأخير قصير بين المهام (2-5 ثواني فقط)
                if (i < validQuests.length - 1) {
                    const delay = 2000 + Math.random() * 3000;
                    await sleep(delay);
                }

            } catch (err) {
                console.log(`\n   ❌ فشلت: ${err.message}`);
                results.push({ id: questId, name: questName, status: 'REJECTED', error: err.message });
                if (onUpdate) onUpdate({ questId, questName, status: 'rejected', error: err.message });
                
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
        }
    }
}

// ✅ دالة منفصلة لجلب المهام فقط (بدون حل) - للـ Refresh
async function fetchQuestsOnly(token) {
    const client = new Client();
    try {
        await client.login(token);
        await client.quests.get();
        
        const libraryValid = client.quests.filterQuestsValid();
        const allQuests = client.quests.map(q => {
            const userStatus = q.userStatus || q.user_status;
            return {
                id: q.id,
                name: getQuestName(q),
                type: getQuestType(q),
                status: userStatus?.completed_at ? 'COMPLETED' 
                       : userStatus?.claimed_at ? 'CLAIMED'
                       : 'PENDING',
                completed: !!userStatus?.completed_at,
                claimed: !!userStatus?.claimed_at,
            };
        });
        
        const valid = libraryValid.filter(q => !isQuestDone(q)).map(q => ({
            id: q.id,
            name: getQuestName(q),
            type: getQuestType(q),
            status: 'PENDING',
            completed: false,
            claimed: false,
        }));
        
        return { success: true, allQuests, valid };
    } catch (err) {
        return { success: false, error: err.message };
    } finally {
        if (client && client.destroy) client.destroy();
    }
}

module.exports = { solveSequentially, fetchQuestsOnly };
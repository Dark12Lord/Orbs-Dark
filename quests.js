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

// ✅ جلب userStatus من أي مكان محتمل
function getUserStatus(quest) {
    return quest.userStatus || quest.user_status || quest._raw?.userStatus || null;
}

// ✅ فحص شامل: هل المهمة مكتملة أو مستلمة؟
function isQuestDone(quest) {
    const us = getUserStatus(quest);
    if (!us) return false;
    
    // أي من هذه الحقول يعني أن المهمة لا تحتاج حل
    if (us.completed_at) return true;
    if (us.claimed_at) return true;
    if (us.claimed_tier !== null && us.claimed_tier !== undefined) return true;
    if (us.orb_quantity_claimed) return true;
    
    return false;
}

// ✅ فحص: هل المهمة قيد التشغيل فعلياً (نستخدمه لمنع التكرار)
function isQuestRunning(quest) {
    const us = getUserStatus(quest);
    if (!us) return false;
    return us.enrolled_at && !us.completed_at;
}

// ✅ فحص حالة المهمة الحقيقية
function getQuestRealStatus(quest) {
    const us = getUserStatus(quest);
    if (!us) return 'UNKNOWN';
    
    if (us.claimed_at) return 'CLAIMED';
    if (us.completed_at) return 'COMPLETED';
    if (us.enrolled_at) return 'IN_PROGRESS';
    return 'PENDING';
}

// ✅ جلب التقدم الحقيقي
async function getRealProgress(client, questId) {
    try {
        const quest = client.quests.find(q => q.id === questId);
        if (!quest) return { percent: 0, completed: false };
        
        const us = getUserStatus(quest);
        if (!us) return { percent: 0, completed: false };
        
        const progress = us.progress || {};
        const completed = !!us.completed_at;
        
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

// ✅ قبول المهمة (بشكل آمن - يتجاهل "مسجل مسبقاً")
async function safeAccept(client, questId) {
    try {
        await client.quests.acceptQuest(questId);
        console.log(`   ✅ تم القبول`);
        return true;
    } catch (e) {
        const msg = e.message || '';
        if (msg.includes('400') || msg.includes('already') || msg.includes('enrolled')) {
            console.log(`   ⚠️ مسجل مسبقاً (متابعة)`);
            return true;
        }
        console.log(`   ⚠️ القبول: ${msg}`);
        return true;
    }
}

// ✅ حل مهمة فيديو (مع إصلاح 400)
async function solveVideoQuest(client, quest, onUpdate) {
    const questId = quest.id;
    const questName = getQuestName(quest);
    const durationMs = getVideoDuration(quest);
    const intervalMs = 30000;
    
    console.log(`   🎬 مدة: ${Math.round(durationMs / 1000)} ثانية`);
    
    await safeAccept(client, questId);
    
    // ✅ إرسال timestamp=0 أولاً (بداية الفيديو)
    try {
        await client.quests.videoProgress(questId, 0);
        console.log(`   ▶️ بدء الفيديو`);
        await sleep(2000);
    } catch (e) {
        console.log(`   ⚠️ بدء: ${e.message}`);
    }
    
    const totalSteps = Math.ceil(durationMs / intervalMs);
    
    for (let step = 1; step <= totalSteps; step++) {
        const timestamp = Math.min(step * intervalMs, durationMs);
        
        try {
            await client.quests.videoProgress(questId, timestamp);
        } catch (err) {
            console.log(`\n   ⚠️ خطوة ${step}: ${err.message}`);
            // في حالة 400، جرب timestamp أصغر
            if (err.message.includes('400')) {
                try {
                    await client.quests.videoProgress(questId, Math.max(0, timestamp - 5000));
                } catch (e2) {
                    // تجاهل واستمر
                }
            }
        }
        
        // تحديث التقدم
        try {
            await client.quests.get();
        } catch (e) {}
        
        const { percent, completed } = await getRealProgress(client, questId);
        
        process.stdout.write(`\r   ${renderProgressBar(percent)}`);
        if (onUpdate) onUpdate({ questId, questName, status: 'running', percent });
        
        if (completed) {
            console.log(`\n   ✅ اكتملت فعلياً`);
            return true;
        }
        
        await sleep(intervalMs);
    }
    
    // التحقق النهائي
    await sleep(2000);
    try { await client.quests.get(); } catch (e) {}
    const finalCheck = await getRealProgress(client, questId);
    
    if (finalCheck.completed) return true;
    
    throw new Error(`لم تكتمل بعد ${Math.round(durationMs / 1000)} ثانية`);
}

// ✅ حل مهمة لعب
async function solveGameQuest(client, quest, onUpdate) {
    const questId = quest.id;
    const questName = getQuestName(quest);
    const appId = getApplicationId(quest);
    const durationMs = 900000;
    const intervalMs = 60000;
    
    if (!appId) throw new Error('application_id غير موجود');
    
    console.log(`   🎮 App: ${appId}`);
    
    await safeAccept(client, questId);
    
    const totalSteps = Math.ceil(durationMs / intervalMs);
    
    for (let step = 1; step <= totalSteps; step++) {
        try {
            await client.quests.heartbeat(questId, appId);
        } catch (err) {
            if (!err.message.includes('400')) {
                console.log(`\n   ⚠️ نبضة ${step}: ${err.message}`);
            }
        }
        
        try { await client.quests.get(); } catch (e) {}
        
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
    try { await client.quests.get(); } catch (e) {}
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
        
        // ✅ الحصول على كل المهام (بدون فلترة المكتبة)
        const allQuests = Array.from(client.quests.values ? client.quests.values() : client.quests);
        
        console.log(`📋 إجمالي المهام في النظام: ${allQuests.length}\n`);
        
        // ✅ فلترة يدوية دقيقة
        const validQuests = [];
        const skipped = [];
        
        for (const q of allQuests) {
            const status = getQuestRealStatus(q);
            const name = getQuestName(q);
            const type = getQuestType(q);
            
            if (status === 'COMPLETED' || status === 'CLAIMED') {
                skipped.push({ name, type, status });
                continue;
            }
            
            // تخطي المهام التي تحتاج تدخل يدوي
            if (type === 'PLAY_ACTIVITY' || type === 'ACHIEVEMENT_IN_ACTIVITY') {
                skipped.push({ name, type, status: 'NEEDS_MANUAL' });
                continue;
            }
            
            // تخطي UNKNOWN
            if (type === 'UNKNOWN') {
                skipped.push({ name, type, status: 'UNSUPPORTED' });
                continue;
            }
            
            validQuests.push(q);
        }
        
        console.log(`✅ مهام صالحة للحل: ${validQuests.length}`);
        console.log(`⏭️ مهام متخطاة: ${skipped.length}\n`);
        
        if (skipped.length > 0) {
            console.log('⏭️ قائمة المتخطاة:');
            skipped.forEach((s, i) => {
                console.log(`   ${i + 1}. ${s.name} [${s.type}] (${s.status})`);
            });
            console.log('');
        }

        if (validQuests.length === 0) {
            console.log('ℹ️ لا توجد مهام صالحة للحل حالياً.');
            return { success: true, quests: [] };
        }

        console.log('📋 قائمة المهام للحل:');
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

// ✅ جلب المهام فقط (للـ Refresh)
async function fetchQuestsOnly(token) {
    const client = new Client();
    try {
        await client.login(token);
        await client.quests.get();
        
        const allQuests = Array.from(client.quests.values ? client.quests.values() : client.quests);
        
        const mapped = allQuests.map(q => {
            const status = getQuestRealStatus(q);
            return {
                id: q.id,
                name: getQuestName(q),
                type: getQuestType(q),
                status: status === 'IN_PROGRESS' ? 'PENDING' : status,
                completed: status === 'COMPLETED' || status === 'CLAIMED',
                claimed: status === 'CLAIMED',
            };
        });
        
        const valid = mapped.filter(q => 
            q.status === 'PENDING' && 
            q.type !== 'PLAY_ACTIVITY' && 
            q.type !== 'ACHIEVEMENT_IN_ACTIVITY' &&
            q.type !== 'UNKNOWN'
        );
        
        return { success: true, allQuests: mapped, valid };
    } catch (err) {
        return { success: false, error: err.message };
    } finally {
        if (client && client.destroy) client.destroy();
    }
}

module.exports = { solveSequentially, fetchQuestsOnly };
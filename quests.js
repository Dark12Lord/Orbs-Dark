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

        for (let i = 0; i < validQuests.length; i++) {
            const quest = validQuests[i];
            const questId = quest.id;
            const questName = getQuestName(quest);
            const taskConfig = quest.config?.taskConfigV2 || quest.config?.taskConfig || quest.config?.task_config;
            
            // تحديد نوع المهمة
            let questType = 'UNKNOWN';
            if (taskConfig?.tasks?.WATCH_VIDEO || taskConfig?.tasks?.WATCH_VIDEO_ON_MOBILE) {
                questType = 'WATCH_VIDEO';
            } else if (taskConfig?.tasks?.PLAY_ON_DESKTOP) {
                questType = 'PLAY_ON_DESKTOP';
            }

            console.log(`\n[${i + 1}/${validQuests.length}] ═══════════════════`);
            console.log(`   📌 ${questName} (${questType})`);

            try {
                if (onUpdate) onUpdate({ questId, questName, status: 'running', percent: 0 });

                // ✅ قبول المهمة أولاً
                try {
                    await client.quests.acceptQuest(questId);
                    console.log(`   ✅ تم قبول المهمة`);
                } catch (e) {
                    console.log(`   ⚠️ القبول: ${e.message}`);
                }

                if (questType === 'WATCH_VIDEO') {
                    // ✅ مهام الفيديو: إرسال videoProgress
                    const durationMs = taskConfig?.tasks?.WATCH_VIDEO?.videoDurationMs || 900000;
                    const totalSteps = Math.ceil(durationMs / 30000);
                    
                    for (let step = 1; step <= totalSteps; step++) {
                        const timestamp = Math.min(step * 30000, durationMs);
                        await client.quests.videoProgress(questId, timestamp);
                        
                        const percent = Math.round((step / totalSteps) * 100);
                        process.stdout.write(`\r   ${renderProgressBar(percent)}`);
                        if (onUpdate) onUpdate({ questId, questName, status: 'running', percent });
                        
                        await sleep(30000 + Math.random() * 3000);
                    }
                } else if (questType === 'PLAY_ON_DESKTOP') {
                    // ✅ مهام اللعب: إرسال heartbeat
                    const appId = taskConfig?.tasks?.PLAY_ON_DESKTOP?.applications?.[0]?.id;
                    const durationMs = 900000;
                    const totalSteps = Math.ceil(durationMs / 60000);
                    
                    for (let step = 1; step <= totalSteps; step++) {
                        await client.quests.heartbeat(questId, appId);
                        
                        const percent = Math.round((step / totalSteps) * 100);
                        process.stdout.write(`\r   ${renderProgressBar(percent)}`);
                        if (onUpdate) onUpdate({ questId, questName, status: 'running', percent });
                        
                        await sleep(60000 + Math.random() * 5000);
                    }
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
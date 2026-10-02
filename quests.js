// quests.js - محرك المهام باستخدام discord-quests
let DiscordQuests = null;

async function loadQuestsLib() {
    if (!DiscordQuests) {
        const mod = await import("discord-quests");
        DiscordQuests = mod.DiscordQuests || mod.default?.DiscordQuests || mod.default;
        if (!DiscordQuests) throw new Error("فشل تحميل DiscordQuests");
    }
    return DiscordQuests;
}

function renderProgressBar(percent, width = 20) {
    const filled = Math.round((percent / 100) * width);
    const empty = width - filled;
    return `[${'█'.repeat(filled)}${'░'.repeat(empty)}] ${percent}%`;
}

async function solveSequentially(token, onUpdate) {
    const results = [];
    console.log('\n' + '='.repeat(50));
    console.log('🚀 Dark Orbs - بدء جلسة حل المهام (discord-quests)');
    console.log('='.repeat(50) + '\n');

    try {
        const QuestsClass = await loadQuestsLib();
        const dq = new QuestsClass(token);

        // ✅ التحقق من التوكن
        const valid = await dq.validateToken();
        if (!valid) {
            console.log('❌ التوكن غير صالح!');
            return { success: false, error: 'التوكن غير صالح' };
        }
        console.log('✅ تم التحقق من التوكن\n');

        // ✅ جلب المهام
        const quests = await dq.fetchQuests();
        console.log(`📊 عدد المهام الصالحة: ${quests.length}\n`);

        if (quests.length === 0) {
            console.log('ℹ️ لا توجد مهام صالحة حالياً.');
            return { success: true, quests: [] };
        }

        console.log('📋 قائمة المهام:');
        quests.forEach((q, i) => {
            console.log(`   ${i + 1}. ${q.name} [${q.tasks?.[0]?.id || 'UNKNOWN'}]`);
        });
        console.log('');

        // ✅ حل جميع المهام
        console.log('🎯 بدء حل المهام...\n');
        const solveResults = await dq.solveAll({
            onProgress: ({ taskId, current, target, percent }) => {
                process.stdout.write(`\r   [${taskId}] ${renderProgressBar(percent)}`);
                if (onUpdate) onUpdate({ questId: taskId, questName: taskId, status: 'running', percent });
            },
            onCompleted: (questId) => {
                console.log(`\n   ✅ اكتملت: ${questId}`);
                if (onUpdate) onUpdate({ questId, questName: questId, status: 'completed', percent: 100 });
            },
            onError: (questId, err) => {
                console.log(`\n   ❌ فشلت ${questId}: ${err.message}`);
                if (onUpdate) onUpdate({ questId, questName: questId, status: 'rejected', error: err.message });
            },
            onLog: (msg) => console.log(`   ℹ️ ${msg}`),
        });

        // ✅ ملخص النتائج
        const succeeded = solveResults.filter(r => r.status === 'completed' || r.status === 'already_completed').length;
        const failed = solveResults.filter(r => r.status === 'error' || r.status === 'enroll_failed').length;
        const unsupported = solveResults.filter(r => r.status === 'unsupported').length;

        console.log('\n' + '='.repeat(50));
        console.log(`🏁 انتهت الجلسة - نجح: ${succeeded}, فشل: ${failed}, غير مدعوم: ${unsupported}`);
        console.log('='.repeat(50) + '\n');

        return { success: true, quests: solveResults };

    } catch (err) {
        console.error(`\n❌ خطأ عام: ${err.message}`);
        return { success: false, error: err.message };
    }
}

// ✅ جلب المهام فقط (للـ Refresh)
async function fetchQuestsOnly(token) {
    try {
        const QuestsClass = await loadQuestsLib();
        const dq = new QuestsClass(token);
        const status = await dq.getStatus();

        const mapped = status.map(s => ({
            id: s.id,
            name: s.name,
            type: s.tasks?.[0]?.id || 'UNKNOWN',
            status: s.completed ? 'COMPLETED' : s.solvable ? 'PENDING' : 'UNSUPPORTED',
            completed: s.completed,
        }));

        const valid = mapped.filter(q => q.status === 'PENDING');
        return { success: true, allQuests: mapped, valid };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

module.exports = { solveSequentially, fetchQuestsOnly };
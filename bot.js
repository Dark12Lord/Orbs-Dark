const database = require('./database');
const { solveSequentially, toQuestShape } = require('./quests');

class QuestBot {
    constructor(accountId) {
        this.accountId = accountId;
        this.running = false;
        this.status = 'IDLE';
        this.currentQuests = [];
        this.signal = { stopped: false };  // ✅ إشارة الإيقاف الحقيقية
        this.startedAt = null;
    }

    async start(onUpdate) {
        if (this.running) {
            return { success: false, error: 'البوت شغال مسبقاً' };
        }

        const account = await database.getAccount(this.accountId);
        if (!account) return { success: false, error: 'الحساب غير موجود' };

        this.running = true;
        this.status = 'RUNNING';
        this.signal = { stopped: false };
        this.startedAt = new Date().toISOString();
        this.currentQuests = [];

        // حافظ على المهام السابقة إن وجدت (C5)
        const previousQuests = (account.quests || []).filter(q => 
            q.status === 'COMPLETED' || q.status === 'CLAIMED'
        );

        await database.updateAccount(this.accountId, { status: 'RUNNING' });

        try {
            const result = await solveSequentially(
                account.token,
                async (update) => {
                    // دمج المهام الجديدة مع القديمة
                    const existing = this.currentQuests.find(q => q.id === update.id);
                    if (existing) {
                        Object.assign(existing, update);
                    } else {
                        this.currentQuests.push(update);
                    }
                    // ادمج المهام المكتملة سابقاً
                    const merged = [...previousQuests, ...this.currentQuests];
                    // إزالة التكرار
                    const unique = Array.from(new Map(merged.map(q => [q.id, q])).values());
                    await database.updateQuests(this.accountId, unique);
                    if (onUpdate) onUpdate(update);
                },
                this.signal  // ✅ نمرر الإشارة
            );

            // ✅ C4: افحص success
            if (!result.success) {
                this.running = false;
                this.status = 'ERROR';
                await database.updateAccount(this.accountId, {
                    status: 'ERROR',
                    lastRun: this.startedAt,
                });
                // لا تمسح المهام الموجودة
                console.log(`[bot] ❌ فشل التشغيل: ${result.error}`);
                return { success: false, error: result.error };
            }

            // ادمج النتائج النهائية مع السابقة
            const finalQuests = [...previousQuests, ...(result.quests || [])];
            const uniqueQuests = Array.from(new Map(finalQuests.map(q => [q.id, q])).values());

            await database.updateQuests(this.accountId, uniqueQuests);

            this.running = false;
            // ✅ C6: لا تكتب DONE لو تم الإيقاف يدوياً
            this.status = result.stopped ? 'IDLE' : 'DONE';
            await database.updateAccount(this.accountId, {
                status: this.status,
                lastRun: this.startedAt,
            });

            return {
                success: true,
                quests: uniqueQuests,
                message: result.stopped ? 'تم الإيقاف' : 'خلصت المهام',
            };

        } catch (err) {
            this.running = false;
            this.status = 'ERROR';
            await database.updateAccount(this.accountId, { status: 'ERROR' });
            console.error(`[bot] ❌ خطأ: ${err.message}`);
            return { success: false, error: err.message };
        }
    }

    // ✅ C6: إيقاف حقيقي
    stop() {
        if (!this.running) {
            return { success: false, error: 'البوت مو شغال' };
        }
        this.signal.stopped = true;
        this.running = false;
        this.status = 'IDLE';
        console.log(`[bot] ⏹️ تم إرسال إشارة الإيقاف للحساب ${this.accountId}`);
        return { success: true, message: 'تم الإيقاف' };
    }

    getStatus() {
        return {
            running: this.running,
            status: this.status,
            startedAt: this.startedAt,
        };
    }
}

module.exports = QuestBot;
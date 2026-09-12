const database = require('./database');
const { solveSequentially } = require('./quests');

class QuestBot {
    constructor(accountId) {
        this.accountId = accountId;
        this.running = false;
        this.status = 'IDLE';
        this.currentQuests = [];
    }

    async start(onUpdate) {
        if (this.running) {
            return { success: false, error: 'البوت شغال مسبقاً' };
        }

        const account = database.getAccount(this.accountId);
        if (!account) {
            return { success: false, error: 'الحساب غير موجود' };
        }

        this.running = true;
        this.status = 'RUNNING';
        database.updateAccount(this.accountId, { status: 'RUNNING' });

        // ✅ مخزن مؤقت للمهام المحدثة
        this.currentQuests = [];

        try {
            const result = await solveSequentially(account.token, (update) => {
                // ✅ 1. تحديث المخزن المؤقت
                const existing = this.currentQuests.find(q => q.id === update.questId);
                if (existing) {
                    existing.status = update.status;
                    if (update.percent !== undefined) existing.percent = update.percent;
                    if (update.error) existing.error = update.error;
                } else {
                    this.currentQuests.push({
                        id: update.questId,
                        name: update.questName,
                        status: update.status,
                        percent: update.percent || 0,
                        error: update.error || null,
                    });
                }

                // ✅ 2. حفظ في قاعدة البيانات فوراً (عشان لوحة التحكم تشوفه)
                database.updateQuests(this.accountId, this.currentQuests);

                // ✅ 3. استدعاء callback الأصلي
                if (onUpdate) onUpdate(update);
            });

            if (result.success) {
                // تحديث المهام النهائية
                database.updateQuests(this.accountId, result.quests);

                const hasPending = result.quests.some(
                    q => q.status !== 'COMPLETED' && q.status !== 'REJECTED'
                );

                this.running = false;
                this.status = hasPending ? 'IDLE' : 'DONE';
                database.updateAccount(this.accountId, { status: this.status });

                return {
                    success: true,
                    quests: result.quests,
                    message: hasPending ? 'تمت المعالجة' : 'خلصت كل المهام',
                };
            } else {
                this.running = false;
                this.status = 'ERROR';
                database.updateAccount(this.accountId, { status: 'ERROR' });
                return { success: false, error: result.error };
            }
        } catch (err) {
            this.running = false;
            this.status = 'ERROR';
            database.updateAccount(this.accountId, { status: 'ERROR' });
            return { success: false, error: err.message };
        }
    }

    stop() {
        this.running = false;
        this.status = 'IDLE';
        database.updateAccount(this.accountId, { status: 'IDLE' });
        return { success: true, message: 'تم الإيقاف' };
    }

    getStatus() {
        return { running: this.running, status: this.status };
    }
}

module.exports = QuestBot;
const database = require('./database');
const { solveSequentially } = require('./quests');

class QuestBot {
    constructor(accountId) {
        this.accountId = accountId;
        this.running = false;
        this.status = 'IDLE';
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

        try {
            const result = await solveSequentially(account.token, onUpdate);

            if (result.success) {
                // تحديث المهام في قاعدة البيانات
                database.updateQuests(this.accountId, result.quests);

                // تحديد الحالة النهائية
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
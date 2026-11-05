const database = require('./database');
const { solveSequentially } = require('./quests');

class QuestBot {
    constructor(accountId) {
        this.accountId = accountId;
        this.running = false;
        this.status = 'IDLE';
        this.currentQuests = [];
        this.signal = { stopped: false };
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

        const previousQuests = (account.quests || []).filter(q =>
            q.status === 'COMPLETED' || q.status === 'CLAIMED'
        );

        await database.updateAccount(this.accountId, { status: 'RUNNING' });
        await database.saveRunState(this.accountId, {
            status: 'RUNNING',
            started_at: this.startedAt,
        });

        try {
            const result = await solveSequentially(
                account.token,
                async (update) => {
                    const existing = this.currentQuests.find(q => q.id === update.id);
                    if (existing) {
                        Object.assign(existing, update);
                    } else {
                        this.currentQuests.push(update);
                    }
                    const merged = [...previousQuests, ...this.currentQuests];
                    const unique = Array.from(new Map(merged.map(q => [q.id, q])).values());
                    await database.updateQuests(this.accountId, unique);
                    if (onUpdate) onUpdate(update);
                },
                this.signal
            );

            if (!result.success) {
                this.running = false;
                this.status = 'ERROR';
                await database.updateAccount(this.accountId, {
                    status: 'ERROR',
                    lastRun: this.startedAt,
                });
                console.log(`[bot] ❌ فشل التشغيل: ${result.error}`);
                return { success: false, error: result.error };
            }

            const finalQuests = [...previousQuests, ...(result.quests || [])];
            const uniqueQuests = Array.from(new Map(finalQuests.map(q => [q.id, q])).values());

            await database.updateQuests(this.accountId, uniqueQuests);

            this.running = false;
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
        } finally {
            await database.clearRunState(this.accountId).catch(e =>
                console.warn(`[bot] ⚠️ clearRunState: ${e.message}`)
            );
        }
    }

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
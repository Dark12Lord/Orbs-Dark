const QuestBot = require('./bot');
const database = require('./database');

// تخزين البوتات النشطة
const activeBots = new Map();

// تشغيل حساب
async function startAccount(accountId, onUpdate) {
    if (activeBots.has(accountId)) {
        return { success: false, error: 'الحساب شغال مسبقاً' };
    }

    const bot = new QuestBot(accountId);
    activeBots.set(accountId, bot);

    try {
        const result = await bot.start(onUpdate);
        return result;
    } finally {
        // إزالة البوت من القائمة بعد الانتهاء
        activeBots.delete(accountId);
    }
}

// إيقاف حساب
function stopAccount(accountId) {
    const bot = activeBots.get(accountId);
    if (!bot) {
        return { success: false, error: 'الحساب مو شغال' };
    }
    return bot.stop();
}

// حالة حساب
function getAccountStatus(accountId) {
    const bot = activeBots.get(accountId);
    if (bot) {
        return bot.getStatus();
    }
    const account = database.getAccount(accountId);
    return {
        running: false,
        status: account ? account.status : 'UNKNOWN',
    };
}

// الحصول على كل الحسابات النشطة
function getActiveBots() {
    return Array.from(activeBots.keys());
}

module.exports = {
    startAccount,
    stopAccount,
    getAccountStatus,
    getActiveBots,
};
const QuestBot = require('./bot');
const database = require('./database');

const activeBots = new Map();

async function startAccount(accountId, onUpdate) {
    if (activeBots.has(accountId)) {
        return { success: false, error: 'الحساب شغال مسبقاً' };
    }

    const bot = new QuestBot(accountId);
    activeBots.set(accountId, bot);

    try {
        console.log(`[manager] ▶️ بدء تشغيل الحساب ${accountId}`);
        const result = await bot.start(onUpdate);
        console.log(`[manager] ${result.success ? '✅' : '❌'} انتهى: ${result.message || result.error}`);
        return result;
    } finally {
        activeBots.delete(accountId);
    }
}

function stopAccount(accountId) {
    const bot = activeBots.get(accountId);
    if (!bot) {
        return { success: false, error: 'الحساب مو شغال' };
    }
    return bot.stop();
}

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

function getActiveBots() {
    return Array.from(activeBots.keys());
}

module.exports = {
    startAccount,
    stopAccount,
    getAccountStatus,
    getActiveBots,
};
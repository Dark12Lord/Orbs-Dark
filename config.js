require('dotenv').config();

const isProd = process.env.NODE_ENV === 'production';

if (isProd) {
    if (!process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY.length < 32) {
        console.error('❌ ENCRYPTION_KEY مطلوب (32 حرف على الأقل) في production');
        process.exit(1);
    }
    if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 16) {
        console.error('❌ SESSION_SECRET مطلوب (16 حرف على الأقل) في production');
        process.exit(1);
    }
    if (!process.env.ADMIN_PASSWORD) {
        console.error('❌ ADMIN_PASSWORD مطلوب في production');
        process.exit(1);
    }
}

module.exports = {
    port: parseInt(process.env.PORT || '3000', 10),
    adminPassword: process.env.ADMIN_PASSWORD || 'admin123',
    sessionSecret: process.env.SESSION_SECRET || require('crypto').randomBytes(32).toString('hex'),
    encryptionKey: process.env.ENCRYPTION_KEY || 'default_key_32_chars_long_here!!',
    dataFile: process.env.DATA_FILE || './data.json',

    questDelayMin: parseInt(process.env.QUEST_DELAY_MIN || '5000', 10),
    questDelayMax: parseInt(process.env.QUEST_DELAY_MAX || '15000', 10),
    refreshInterval: parseInt(process.env.REFRESH_INTERVAL || '300000', 10),

    autoSchedule: process.env.AUTO_SCHEDULE === 'true',
    scheduleIntervalMinutes: parseInt(process.env.SCHEDULE_INTERVAL_MINUTES || '30', 10),

    proxyList: process.env.PROXY_LIST || process.env.PROXY_URL || '',
    webhookUrl: process.env.WEBHOOK_URL || '',
};
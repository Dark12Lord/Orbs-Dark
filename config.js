require('dotenv').config();

module.exports = {
    port: process.env.PORT || 3000,
    adminPassword: process.env.ADMIN_PASSWORD || 'admin123',
    sessionSecret: process.env.SESSION_SECRET || 'dark-orbs-secret',
    encryptionKey: process.env.ENCRYPTION_KEY || 'default_key_32_chars_long_here!!',
    dataFile: './data.json',
    
    // إعدادات المهام
    questDelayMin: 5000,      // 5 ثواني بين المهام
    questDelayMax: 15000,     // 15 ثانية بين المهام
    refreshInterval: 300000,  // 5 دقائق (لو استخدمت التحديث التلقائي)
};
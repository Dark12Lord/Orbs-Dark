const fs = require('fs');
const crypto = require('crypto');
const config = require('./config');

const ALGORITHM = 'aes-256-cbc';

// اشتقاق مفتاح 32 بايت من المفتاح النصي
function getKey() {
    return crypto.createHash('sha256').update(config.encryptionKey).digest();
}

// تشفير التوكن
function encrypt(text) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
}

// فك تشفير التوكن
function decrypt(encryptedText) {
    const parts = encryptedText.split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const encrypted = parts[1];
    const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}

// قراءة البيانات
function load() {
    if (!fs.existsSync(config.dataFile)) {
        return { accounts: [] };
    }
    try {
        const raw = fs.readFileSync(config.dataFile, 'utf8');
        return JSON.parse(raw);
    } catch (err) {
        console.error('خطأ في قراءة البيانات:', err.message);
        return { accounts: [] };
    }
}

// حفظ البيانات
function save(data) {
    fs.writeFileSync(config.dataFile, JSON.stringify(data, null, 2), 'utf8');
}

// إضافة حساب
function addAccount(token, name) {
    const data = load();
    const id = crypto.randomBytes(4).toString('hex');
    const account = {
        id,
        name: name || `حساب_${data.accounts.length + 1}`,
        token: encrypt(token),
        status: 'IDLE',
        lastRun: null,
        quests: [],
        createdAt: new Date().toISOString(),
    };
    data.accounts.push(account);
    save(data);
    return { id, name: account.name };
}

// حذف حساب
function removeAccount(id) {
    const data = load();
    data.accounts = data.accounts.filter(a => a.id !== id);
    save(data);
}

// الحصول على حساب
function getAccount(id) {
    const data = load();
    const account = data.accounts.find(a => a.id === id);
    if (!account) return null;
    return {
        ...account,
        token: decrypt(account.token), // فك التشفير عند الاستخدام
    };
}

// الحصول على كل الحسابات (بدون توكن)
function getAllAccounts() {
    const data = load();
    return data.accounts.map(a => ({
        id: a.id,
        name: a.name,
        status: a.status,
        lastRun: a.lastRun,
        quests: a.quests,
    }));
}

// تحديث حالة حساب
function updateAccount(id, updates) {
    const data = load();
    const index = data.accounts.findIndex(a => a.id === id);
    if (index === -1) return false;
    data.accounts[index] = { ...data.accounts[index], ...updates };
    save(data);
    return true;
}

// تحديث المهام
function updateQuests(id, quests) {
    return updateAccount(id, {
        quests,
        lastRun: new Date().toISOString(),
    });
}

module.exports = {
    addAccount,
    removeAccount,
    getAccount,
    getAllAccounts,
    updateAccount,
    updateQuests,
};
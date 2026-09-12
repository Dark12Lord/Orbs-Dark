const express = require('express');
const router = express.Router();
const database = require('./database');
const manager = require('./manager');
const config = require('./config');

// Middleware للتحقق من الجلسة
function requireAuth(req, res, next) {
    if (req.session && req.session.authenticated) {
        return next();
    }
    res.status(401).json({ error: 'غير مصرح' });
}

// ============ المصادقة ============

// تسجيل الدخول
router.post('/api/login', (req, res) => {
    const { password } = req.body;
    if (password === config.adminPassword) {
        req.session.authenticated = true;
        return res.json({ success: true });
    }
    res.status(401).json({ success: false, error: 'كلمة المرور غلط' });
});

// تسجيل الخروج
router.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

// التحقق من الجلسة
router.get('/api/check', (req, res) => {
    res.json({ authenticated: !!(req.session && req.session.authenticated) });
});

// ============ الحسابات ============

// عرض كل الحسابات
router.get('/api/accounts', requireAuth, (req, res) => {
    const accounts = database.getAllAccounts();
    const withStatus = accounts.map(a => ({
        ...a,
        liveStatus: manager.getAccountStatus(a.id).status,
    }));
    res.json(withStatus);
});

// إضافة حساب
router.post('/api/accounts', requireAuth, (req, res) => {
    const { token, name } = req.body;
    if (!token || token.trim().length < 20) {
        return res.status(400).json({ error: 'التوكن غير صالح' });
    }
    const result = database.addAccount(token.trim(), name);
    res.json({ success: true, ...result });
});

// حذف حساب
router.delete('/api/accounts/:id', requireAuth, (req, res) => {
    database.removeAccount(req.params.id);
    res.json({ success: true });
});

// تفاصيل حساب (المهام)
router.get('/api/accounts/:id/quests', requireAuth, (req, res) => {
    const account = database.getAccount(req.params.id);
    if (!account) {
        return res.status(404).json({ error: 'الحساب غير موجود' });
    }
    res.json({
        id: account.id,
        name: account.name,
        status: account.status,
        lastRun: account.lastRun,
        quests: account.quests || [],
    });
});

// ============ التحكم ============

// تشغيل المهام
router.post('/api/accounts/:id/start', requireAuth, async (req, res) => {
    const accountId = req.params.id;
    const account = database.getAccount(accountId);
    if (!account) {
        return res.status(404).json({ error: 'الحساب غير موجود' });
    }

    // تشغيل في الخلفية
    res.json({ success: true, message: 'بدأ التشغيل' });

    manager.startAccount(accountId, (update) => {
        console.log(`[${account.name}] ${update.questName}: ${update.status}`);
    }).then(result => {
        console.log(`[${account.name}] انتهى:`, result.message || result.error);
    }).catch(err => {
        console.error(`[${account.name}] خطأ:`, err.message);
    });
});

// إيقاف المهام
router.post('/api/accounts/:id/stop', requireAuth, (req, res) => {
    const result = manager.stopAccount(req.params.id);
    res.json(result);
});

// ============ Health Check (لـ UptimeRobot) ============

router.get('/health', (req, res) => {
    res.status(200).send('OK');
});

module.exports = router;
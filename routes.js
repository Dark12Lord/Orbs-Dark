const express = require("express");
const router = express.Router();
const database = require("./database");
const manager = require("./manager");
const config = require("./config");

function requireAuth(req, res, next) {
    if (req.session && req.session.authenticated) {
        return next();
    }
    res.status(401).json({ error: "غير مصرح" });
}

// ✅ Middleware لمنع كاش API
function noCache(req, res, next) {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    next();
}

router.use(noCache);

// ============ المصادقة ============

router.post("/api/login", (req, res) => {
    const { password } = req.body;
    if (password === config.adminPassword) {
        req.session.authenticated = true;
        return res.json({ success: true });
    }
    res.status(401).json({ success: false, error: "كلمة المرور غلط" });
});

router.post("/api/logout", (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

router.get("/api/check", (req, res) => {
    res.json({ authenticated: !!(req.session && req.session.authenticated) });
});

// ============ الحسابات ============

router.get("/api/accounts", requireAuth, (req, res) => {
    const accounts = database.getAllAccounts();
    const withStatus = accounts.map((a) => ({
        ...a,
        liveStatus: manager.getAccountStatus(a.id).status,
    }));
    res.json(withStatus);
});

router.post("/api/accounts", requireAuth, async (req, res) => {
    const { token, name } = req.body;
    if (!token || token.trim().length < 20) {
        return res.status(400).json({ error: "التوكن غير صالح" });
    }
    try {
        const result = await database.addAccount(token.trim(), name);
        res.json({ success: true, id: result.id, name: result.name });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.delete("/api/accounts/:id", requireAuth, (req, res) => {
    database.removeAccount(req.params.id);
    res.json({ success: true });
});

router.get("/api/accounts/:id/quests", requireAuth, (req, res) => {
    const account = database.getAccount(req.params.id);
    if (!account) {
        return res.status(404).json({ error: "الحساب غير موجود" });
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

router.post("/api/accounts/:id/start", requireAuth, async (req, res) => {
    const accountId = req.params.id;
    const account = database.getAccount(accountId);
    if (!account) {
        return res.status(404).json({ error: "الحساب غير موجود" });
    }

    res.json({ success: true, message: "بدأ التشغيل" });

    manager
        .startAccount(accountId, (update) => {
            const percent = update.percent !== undefined ? ` ${update.percent}%` : '';
            console.log(`[${account.name}] ${update.questName}: ${update.status}${percent}`);
        })
        .then((result) => {
            console.log(`[${account.name}] done: ${result.message || result.error}`);
        })
        .catch((err) => {
            console.error(`[${account.name}] error: ${err.message}`);
        });
});

router.post("/api/accounts/:id/stop", requireAuth, (req, res) => {
    const result = manager.stopAccount(req.params.id);
    res.json(result);
});

// ============ Health Check ============

router.get("/health", (req, res) => {
    res.status(200).send("OK");
});

module.exports = router;
const express = require("express");
const router = express.Router();
const database = require("./database");
const manager = require("./manager");
const config = require("./config");
const { fetchQuestsOnly } = require("./quests");

function requireAuth(req, res, next) {
    if (req.session && req.session.authenticated) return next();
    res.status(401).json({ error: "غير مصرح" });
}
function noCache(req, res, next) {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    next();
}
router.use(noCache);

router.post("/api/login", (req, res) => {
    const { password } = req.body;
    if (password === config.adminPassword) { req.session.authenticated = true; return res.json({ success: true }); }
    res.status(401).json({ success: false, error: "كلمة المرور غلط" });
});
router.post("/api/logout", (req, res) => { req.session.destroy(); res.json({ success: true }); });
router.get("/api/check", (req, res) => res.json({ authenticated: !!(req.session && req.session.authenticated) }));

router.get("/api/accounts", requireAuth, async (req, res) => {
    try {
        const accounts = await database.getAllAccounts();
        res.json(accounts.map(a => ({ ...a, liveStatus: manager.getAccountStatus(a.id).status })));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post("/api/accounts", requireAuth, async (req, res) => {
    const { token, name } = req.body;
    if (!token || token.trim().length < 20) return res.status(400).json({ error: "التوكن غير صالح" });
    try {
        const result = await database.addAccount(token.trim(), name);
        res.json({ success: true, ...result });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete("/api/accounts/:id", requireAuth, async (req, res) => {
    try { await database.removeAccount(req.params.id); res.json({ success: true }); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

router.post("/api/accounts/:id/refresh", requireAuth, async (req, res) => {
    try {
        const account = await database.getAccount(req.params.id);
        if (!account) return res.status(404).json({ error: "الحساب غير موجود" });
        const result = await fetchQuestsOnly(account.token);
        if (!result.success) return res.status(500).json({ error: result.error });
        const questsForDb = result.allQuests.map(q => ({
            id: q.id, name: q.name, type: q.type,
            status: q.completed ? 'COMPLETED' : q.status,
            percent: q.completed ? 100 : 0, error: null,
        }));
        await database.updateQuests(req.params.id, questsForDb);
        res.json({ success: true, total: result.allQuests.length, valid: result.valid.length, quests: questsForDb });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post("/api/accounts/:id/start", requireAuth, async (req, res) => {
    const accountId = req.params.id;
    try {
        const account = await database.getAccount(accountId);
        if (!account) return res.status(404).json({ error: "الحساب غير موجود" });
        res.json({ success: true, message: "بدأ التشغيل" });
        manager.startAccount(accountId, (update) => {
            console.log(`[${account.name}] ${update.questName}: ${update.status} ${update.percent || 0}%`);
        }).then(r => console.log(`[${account.name}] done: ${r.message || r.error}`))
          .catch(e => console.error(`[${account.name}] error: ${e.message}`));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post("/api/accounts/:id/stop", requireAuth, (req, res) => {
    res.json(manager.stopAccount(req.params.id));
});

router.get("/health", (req, res) => res.status(200).send("OK"));

module.exports = router;
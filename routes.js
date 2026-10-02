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
    req.session.destroy(() => {
        res.clearCookie('connect.sid');
        res.json({ success: true });
    });
});

router.get("/api/check", (req, res) => {
    res.json({ authenticated: !!(req.session && req.session.authenticated) });
});

// ============ الحسابات ============

// ✅ C3: استخدام status من الصف بدل استعلام إضافي
router.get("/api/accounts", requireAuth, async (req, res) => {
    try {
        const accounts = await database.getAllAccounts();
        const withStatus = accounts.map((a) => {
            const live = manager.isRunning(a.id);
            return {
                ...a,
                liveStatus: live ? 'RUNNING' : a.status,
            };
        });
        res.json(withStatus);
    } catch (err) {
        console.error('[api] getAllAccounts:', err.message);
        res.status(503).json({ error: 'تعذر جلب الحسابات' });
    }
});

router.post("/api/accounts", requireAuth, async (req, res) => {
    const { token, name } = req.body;
    if (typeof token !== 'string' || token.trim().length < 20) {
        return res.status(400).json({ error: "التوكن غير صالح" });
    }
    const safeName = typeof name === 'string' ? name.trim().slice(0, 40) : '';
    try {
        const result = await database.addAccount(token.trim(), safeName);
        res.json({ success: true, id: result.id, name: result.name });
    } catch (err) {
        console.error('[api] addAccount:', err.message);
        res.status(500).json({ error: 'فشلت الإضافة' });
    }
});

router.delete("/api/accounts/:id", requireAuth, async (req, res) => {
    try {
        await database.removeAccount(req.params.id);
        res.json({ success: true });
    } catch (err) {
        console.error('[api] removeAccount:', err.message);
        res.status(500).json({ error: 'فشل الحذف' });
    }
});

router.post("/api/accounts/:id/refresh", requireAuth, async (req, res) => {
    try {
        const account = await database.getAccount(req.params.id);
        if (!account) return res.status(404).json({ error: "الحساب غير موجود" });

        // C8: نرفض التحديث لو الحساب شغال
        if (manager.isRunning(req.params.id)) {
            return res.status(409).json({ error: 'الحساب شغال الآن، انتظر' });
        }

        const result = await fetchQuestsOnly(account.token);
        if (!result.success) {
            return res.status(500).json({ error: result.error });
        }

        // دمج مع المهام الحالية بدل الاستبدال
        const existing = account.quests || [];
        const existingMap = new Map(existing.map(q => [q.id, q]));
        const merged = result.allQuests.map(q => {
            const prev = existingMap.get(q.id);
            if (prev && (prev.status === 'COMPLETED' || prev.status === 'CLAIMED')) {
                return { ...q, status: prev.status, percent: 100 };
            }
            return q;
        });
        // أضف المهام القديمة اللي ما رجعها الـ refresh
        for (const old of existing) {
            if (!merged.find(q => q.id === old.id)) merged.push(old);
        }

        await database.updateQuests(req.params.id, merged);

        res.json({
            success: true,
            total: merged.length,
            valid: result.valid.length,
            quests: merged,
        });
    } catch (err) {
        console.error('[api] refresh:', err.message);
        res.status(500).json({ error: 'فشل التحديث' });
    }
});

router.post("/api/accounts/:id/start", requireAuth, async (req, res) => {
    const accountId = req.params.id;
    try {
        if (manager.isRunning(accountId)) {
            return res.status(409).json({ success: false, error: 'الحساب شغال مسبقاً' });
        }

        const account = await database.getAccount(accountId);
        if (!account) return res.status(404).json({ error: "الحساب غير موجود" });

        res.json({ success: true, message: "بدأ التشغيل" });

        // تشغيل في الخلفية
        manager.startAccount(accountId, (update) => {
            const percent = update.percent !== undefined ? ` ${update.percent}%` : '';
            console.log(`[${account.name}] ${update.name}: ${update.status}${percent}`);
        }).then((result) => {
            console.log(`[${account.name}] done: ${result.message || result.error}`);
        }).catch((err) => {
            console.error(`[${account.name}] error: ${err.message}`);
        });
    } catch (err) {
        console.error('[api] start:', err.message);
        res.status(500).json({ error: 'فشل التشغيل' });
    }
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
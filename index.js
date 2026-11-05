const express = require('express');
const session = require('express-session');
const path = require('path');
const config = require('./config');
const routes = require('./routes');
const database = require('./database');
const manager = require('./manager');
const scheduler = require('./scheduler');
const { getProxyInfo } = require('./proxy');

const app = express();

app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 },
}));

app.use(routes);

app.get('/', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.sendFile(path.join(__dirname, 'views', 'dashboard.html'));
});

app.listen(config.port, async () => {
    console.log(`🟣 Dark Orbs شغال على المنفذ ${config.port}`);
    console.log(`📡 Health Check: http://localhost:${config.port}/health`);

    const pi = getProxyInfo();
    if (pi.hasProxies) {
        console.log(`🌐 ${pi.total} بروكسي مهيأ`);
    } else {
        console.log('⚠️ لا توجد بروكسيات — قد يُحظر من Cloudflare على Render');
    }

    // 1. استئناف الحسابات التي كانت شغالة
    try {
        const stale = await database.getStaleRuns();
        if (stale.length > 0) {
            console.log(`[resume] 🔄 ${stale.length} حساب كان شغالاً قبل إعادة التشغيل`);
            for (const run of stale) {
                console.log(`[resume] ▶️ استئناف ${run.account_id}`);
                manager.startAccount(run.account_id).catch(err =>
                    console.error(`[resume] ❌ ${run.account_id}: ${err.message}`)
                );
                await new Promise(r => setTimeout(r, 3000));
            }
        }
    } catch (err) {
        console.warn(`[resume] ⚠️ فشل: ${err.message}`);
    }

    // 2. تشغيل الجدولة التلقائية
    if (config.autoSchedule) {
        scheduler.start(config.scheduleIntervalMinutes);
    } else {
        console.log('[scheduler] ℹ️ AUTO_SCHEDULE=false — الجدولة معطلة');
    }
});
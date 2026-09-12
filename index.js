const express = require('express');
const session = require('express-session');
const path = require('path');
const config = require('./config');
const routes = require('./routes');

const app = express();

// ✅ منع الكاش لكل الطلبات
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
    cookie: {
        secure: false,
        maxAge: 24 * 60 * 60 * 1000,
    },
}));

app.use(routes);

app.get('/', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.sendFile(path.join(__dirname, 'views', 'dashboard.html'));
});

app.listen(config.port, () => {
    console.log(`🟣 Dark Orbs شغال على المنفذ ${config.port}`);
    console.log(`📡 Health Check: http://localhost:${config.port}/health`);
});
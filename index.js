const express = require('express');
const session = require('express-session');
const path = require('path');
const config = require('./config');
const routes = require('./routes');

const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: false, // Render يوفر HTTPS، بس نخليه false عشان يشتغل محلياً
        maxAge: 24 * 60 * 60 * 1000, // 24 ساعة
    },
}));

// المسارات
app.use(routes);

// صفحة الداشبورد
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'dashboard.html'));
});

// تشغيل السيرفر
app.listen(config.port, () => {
    console.log(`🟣 Dark Orbs شغال على المنفذ ${config.port}`);
    console.log(`📡 Health Check: http://localhost:${config.port}/health`);
});
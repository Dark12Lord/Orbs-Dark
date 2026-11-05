// proxy.js
// ============================================================
// إدارة البروكسيات: تحليل، تدوير، وتوفير agents
// يدعم عدة صيغ:
//   - IP:PORT:USER:PASS  (WebShare)
//   - http://USER:PASS@IP:PORT
//   - IP:PORT (بدون auth)
// الفصل بفاصلة أو سطر جديد
// ============================================================

const { HttpsProxyAgent } = require('https-proxy-agent');

function parseProxyString(raw) {
    const list = [];
    if (!raw || !raw.trim()) return list;

    const entries = raw.split(/[,\n]/).map(p => p.trim()).filter(Boolean);

    for (const entry of entries) {
        try {
            if (/^(https?|socks\d?):\/\//i.test(entry)) {
                list.push(entry);
                continue;
            }

            const parts = entry.split(':');

            if (parts.length === 4) {
                const [host, port, user, pass] = parts;
                list.push(`http://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}:${port}`);
                continue;
            }

            if (parts.length === 2) {
                const [host, port] = parts;
                list.push(`http://${host}:${port}`);
                continue;
            }

            console.warn(`[proxy] ⚠️ صيغة غير معروفة: ${entry.slice(0, 30)}...`);
        } catch (err) {
            console.warn(`[proxy] ⚠️ فشل تحليل: ${entry.slice(0, 30)}...`);
        }
    }

    return list;
}

const PROXIES = parseProxyString(process.env.PROXY_LIST || process.env.PROXY_URL || '');
let currentIndex = 0;

function getNextProxy() {
    if (PROXIES.length === 0) return null;
    const proxy = PROXIES[currentIndex % PROXIES.length];
    currentIndex++;
    return proxy;
}

function getProxyAgent() {
    const proxyUrl = getNextProxy();
    if (!proxyUrl) return null;
    try {
        return new HttpsProxyAgent(proxyUrl);
    } catch (err) {
        console.error(`[proxy] ❌ فشل إنشاء agent: ${err.message}`);
        return null;
    }
}

function getProxyInfo() {
    return {
        total: PROXIES.length,
        currentIndex,
        next: PROXIES.length > 0 ? PROXIES[currentIndex % PROXIES.length] : null,
        hasProxies: PROXIES.length > 0,
    };
}

if (PROXIES.length > 0) {
    console.log(`[proxy] ✅ تم تحميل ${PROXIES.length} بروكسي`);
    PROXIES.forEach((p, i) => {
        const safe = p.replace(/\/\/([^:]+):([^@]+)@/, '//***:***@');
        console.log(`   [${i + 1}] ${safe}`);
    });
} else {
    console.log('[proxy] ⚠️ لا توجد بروكسيات مهيأة — ستعمل الأداة بدون بروكسي');
}

module.exports = { getProxyAgent, getNextProxy, getProxyInfo, PROXIES, parseProxyString };
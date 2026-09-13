const fs = require("fs");
const crypto = require("crypto");
const axios = require("axios");
const config = require("./config");

let supabase = null;

// ===== تهيئة Supabase =====
function initSupabase() {
    if (supabase !== null) return supabase;
    
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_KEY;
    
    if (!url || !key) {
        console.log('[db] ⚠️ Supabase غير مهيأ: SUPABASE_URL أو SUPABASE_KEY مفقود');
        supabase = false;
        return false;
    }
    
    try {
        const { createClient } = require('@supabase/supabase-js');
        supabase = createClient(url, key);
        console.log('[db] ✅ Supabase متصل بنجاح');
        return supabase;
    } catch (err) {
        console.error('[db] ❌ فشل تهيئة Supabase:', err.message);
        supabase = false;
        return false;
    }
}

// ✅ دالة مساعدة لإعادة المحاولة عند فشل الاتصال بـ Supabase
async function supabaseWithRetry(operation, maxRetries = 3, operationName = 'unknown') {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const result = await operation();
            // لو النتيجة فيها error، نتحقق منه
            if (result && result.error) {
                // لو خطأ Gateway Timeout أو شبكة، نعيد المحاولة
                const errMsg = result.error.message || '';
                if (errMsg.includes('Timeout') || errMsg.includes('timeout') || errMsg.includes('fetch')) {
                    if (attempt < maxRetries) {
                        const waitTime = 1000 * attempt;
                        console.log(`[db] ⚠️ ${operationName}: محاولة ${attempt} فشلت (${errMsg})، إعادة بعد ${waitTime}ms`);
                        await new Promise(r => setTimeout(r, waitTime));
                        continue;
                    }
                }
            }
            return result;
        } catch (err) {
            const errMsg = err.message || '';
            if (attempt < maxRetries) {
                const waitTime = 1000 * attempt;
                console.log(`[db] ⚠️ ${operationName}: محاولة ${attempt} فشلت (${errMsg})، إعادة بعد ${waitTime}ms`);
                await new Promise(r => setTimeout(r, waitTime));
                continue;
            }
            throw err;
        }
    }
}

// ===== التشفير =====
const ALGORITHM = "aes-256-cbc";

function getKey() {
    return crypto.createHash("sha256").update(config.encryptionKey).digest();
}

function encrypt(text) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
    let encrypted = cipher.update(text, "utf8", "hex");
    encrypted += cipher.final("hex");
    return iv.toString("hex") + ":" + encrypted;
}

function decrypt(encryptedText) {
    const parts = encryptedText.split(":");
    const iv = Buffer.from(parts[0], "hex");
    const encrypted = parts[1];
    const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
}

// ===== JSON Fallback =====
function loadJSON() {
    if (!fs.existsSync(config.dataFile)) return { accounts: [] };
    try {
        return JSON.parse(fs.readFileSync(config.dataFile, "utf8"));
    } catch (err) {
        console.error("Error reading JSON:", err.message);
        return { accounts: [] };
    }
}

function saveJSON(data) {
    fs.writeFileSync(config.dataFile, JSON.stringify(data, null, 2), "utf8");
}

// ===== جلب اسم المستخدم من التوكن =====
async function fetchUsername(token) {
    try {
        const res = await axios.get("https://discord.com/api/v9/users/@me", {
            headers: {
                Authorization: token,
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            },
            timeout: 10000,
        });
        return res.data.username || res.data.global_name || null;
    } catch (err) {
        console.error("Failed to fetch username:", err.message);
        return null;
    }
}

// ===== إضافة حساب =====
async function addAccount(token, name) {
    const id = crypto.randomBytes(4).toString("hex");
    
    let finalName = name;
    if (!finalName || finalName.trim() === "") {
        const fetched = await fetchUsername(token);
        finalName = fetched || "حساب_" + id;
    }

    const account = {
        id: id,
        name: finalName,
        token: encrypt(token),
        status: "IDLE",
        last_run: null,
        quests: [],
        created_at: new Date().toISOString(),
    };

    const sb = initSupabase();
    if (sb) {
        console.log('[db] 🔍 جرب الحفظ في Supabase...');
        const { error } = await supabaseWithRetry(
            async () => await sb.from('accounts').insert(account),
            3,
            'addAccount'
        );
        if (error) {
            console.error('[db] ❌ فشل الحفظ:', error.message);
            throw new Error('Supabase insert failed: ' + error.message);
        }
        console.log(`[db] ✅ حساب ${finalName} محفوظ في Supabase`);
    } else {
        console.log('[db] ⚠️ استخدام الحفظ المحلي (JSON)');
        const data = loadJSON();
        data.accounts.push(account);
        saveJSON(data);
    }
    
    return { id, name: finalName };
}

// ===== حذف حساب =====
async function removeAccount(id) {
    const sb = initSupabase();
    if (sb) {
        const { error } = await supabaseWithRetry(
            async () => await sb.from('accounts').delete().eq('id', id),
            3,
            'removeAccount'
        );
        if (error) console.error('[db] فشل الحذف:', error.message);
    } else {
        const data = loadJSON();
        data.accounts = data.accounts.filter(a => a.id !== id);
        saveJSON(data);
    }
}

// ===== جلب حساب واحد =====
async function getAccount(id) {
    const sb = initSupabase();
    let account;
    
    if (sb) {
        const { data, error } = await supabaseWithRetry(
            async () => await sb.from('accounts').select('*').eq('id', id).single(),
            3,
            'getAccount'
        );
        if (error || !data) {
            if (error) console.error('[db] getAccount failed:', error.message);
            return null;
        }
        account = data;
    } else {
        const data = loadJSON();
        account = data.accounts.find(a => a.id === id);
        if (!account) return null;
    }
    
    return {
        ...account,
        token: decrypt(account.token),
    };
}

// ===== جلب كل الحسابات =====
async function getAllAccounts() {
    const sb = initSupabase();
    let accounts;
    
    if (sb) {
        const { data, error } = await supabaseWithRetry(
            async () => await sb.from('accounts').select('*').order('created_at', { ascending: true }),
            3,
            'getAllAccounts'
        );
        if (error) {
            console.error('[db] Supabase select failed:', error.message);
            return [];
        }
        accounts = data || [];
    } else {
        accounts = loadJSON().accounts;
    }
    
    return accounts.map(a => ({
        id: a.id,
        name: a.name,
        status: a.status,
        lastRun: a.last_run,
        quests: a.quests || [],
    }));
}

// ===== تحديث حساب =====
async function updateAccount(id, updates) {
    const dbUpdates = { ...updates };
    if (updates.lastRun !== undefined) {
        dbUpdates.last_run = updates.lastRun;
        delete dbUpdates.lastRun;
    }
    
    const sb = initSupabase();
    if (sb) {
        const { error } = await supabaseWithRetry(
            async () => await sb.from('accounts').update(dbUpdates).eq('id', id),
            3,
            'updateAccount'
        );
        if (error) {
            console.error('[db] updateAccount failed:', error.message);
            return false;
        }
        return true;
    } else {
        const data = loadJSON();
        const index = data.accounts.findIndex(a => a.id === id);
        if (index === -1) return false;
        data.accounts[index] = { ...data.accounts[index], ...dbUpdates };
        saveJSON(data);
        return true;
    }
}

// ===== تحديث المهام =====
async function updateQuests(id, quests) {
    return updateAccount(id, {
        quests: quests,
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
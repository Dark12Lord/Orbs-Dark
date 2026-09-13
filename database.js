const fs = require("fs");
const crypto = require("crypto");
const axios = require("axios");
const config = require("./config");

let supabase = null;

function initSupabase() {
    if (supabase !== null) return supabase;
    
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_KEY;
    
    if (!url || !key) {
        console.log('[db] ⚠️ Supabase غير مهيأ');
        supabase = false;
        return false;
    }
    
    try {
        const { createClient } = require('@supabase/supabase-js');
        supabase = createClient(url, key);
        console.log('[db] ✅ Supabase متصل');
        return supabase;
    } catch (err) {
        console.error('[db] ❌ فشل تهيئة Supabase:', err.message);
        supabase = false;
        return false;
    }
}

async function supabaseWithRetry(operation, maxRetries = 3, operationName = 'unknown') {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const result = await operation();
            if (result && result.error) {
                const errMsg = result.error.message || '';
                if ((errMsg.includes('Timeout') || errMsg.includes('timeout') || errMsg.includes('fetch')) && attempt < maxRetries) {
                    const waitTime = 1000 * attempt;
                    console.log(`[db] ⚠️ ${operationName}: محاولة ${attempt} فشلت، إعادة بعد ${waitTime}ms`);
                    await new Promise(r => setTimeout(r, waitTime));
                    continue;
                }
            }
            return result;
        } catch (err) {
            if (attempt < maxRetries) {
                const waitTime = 1000 * attempt;
                console.log(`[db] ⚠️ ${operationName}: محاولة ${attempt} فشلت، إعادة بعد ${waitTime}ms`);
                await new Promise(r => setTimeout(r, waitTime));
                continue;
            }
            throw err;
        }
    }
}

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

function loadJSON() {
    if (!fs.existsSync(config.dataFile)) return { accounts: [] };
    try {
        return JSON.parse(fs.readFileSync(config.dataFile, "utf8"));
    } catch (err) {
        return { accounts: [] };
    }
}

function saveJSON(data) {
    fs.writeFileSync(config.dataFile, JSON.stringify(data, null, 2), "utf8");
}

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
        return null;
    }
}

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
        // ✅ فحص إذا الحساب موجود مسبقاً (نفس التوكن)
        const existing = await supabaseWithRetry(
            async () => await sb.from('accounts').select('id, name'),
            3,
            'checkExisting'
        );
        
        if (existing.data) {
            for (const acc of existing.data) {
                const accData = await supabaseWithRetry(
                    async () => await sb.from('accounts').select('token').eq('id', acc.id).single(),
                    3,
                    'checkToken'
                );
                if (accData.data && decrypt(accData.data.token) === token) {
                    console.log(`[db] ⚠️ الحساب موجود مسبقاً: ${acc.name}`);
                    return { id: acc.id, name: acc.name, existing: true };
                }
            }
        }
        
        const { error } = await supabaseWithRetry(
            async () => await sb.from('accounts').insert(account),
            3,
            'addAccount'
        );
        if (error) throw new Error('Supabase insert failed: ' + error.message);
        console.log(`[db] ✅ حساب ${finalName} محفوظ`);
    } else {
        const data = loadJSON();
        // فحص مكرر
        for (const acc of data.accounts) {
            if (decrypt(acc.token) === token) {
                console.log(`[db] ⚠️ الحساب موجود مسبقاً`);
                return { id: acc.id, name: acc.name, existing: true };
            }
        }
        data.accounts.push(account);
        saveJSON(data);
    }
    
    return { id, name: finalName };
}

async function removeAccount(id) {
    const sb = initSupabase();
    if (sb) {
        await supabaseWithRetry(
            async () => await sb.from('accounts').delete().eq('id', id),
            3,
            'removeAccount'
        );
    } else {
        const data = loadJSON();
        data.accounts = data.accounts.filter(a => a.id !== id);
        saveJSON(data);
    }
}

// ✅ إصلاح: استخدام maybeSingle بدل single
async function getAccount(id) {
    const sb = initSupabase();
    let account;
    
    if (sb) {
        const { data, error } = await supabaseWithRetry(
            async () => await sb.from('accounts').select('*').eq('id', id).maybeSingle(),
            3,
            'getAccount'
        );
        if (error) {
            console.error('[db] getAccount error:', error.message);
            return null;
        }
        if (!data) return null;
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
            console.error('[db] getAllAccounts error:', error.message);
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
        return !error;
    } else {
        const data = loadJSON();
        const index = data.accounts.findIndex(a => a.id === id);
        if (index === -1) return false;
        data.accounts[index] = { ...data.accounts[index], ...dbUpdates };
        saveJSON(data);
        return true;
    }
}

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
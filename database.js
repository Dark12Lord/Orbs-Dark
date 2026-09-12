const fs = require("fs");
const crypto = require("crypto");
const axios = require("axios");
const config = require("./config");

const ALGORITHM = "aes-256-cbc";

// اشتقاق مفتاح 32 بايت من المفتاح النصي
function getKey() {
  return crypto.createHash("sha256").update(config.encryptionKey).digest();
}

// تشفير التوكن
function encrypt(text) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  return iv.toString("hex") + ":" + encrypted;
}

// فك تشفير التوكن
function decrypt(encryptedText) {
  const parts = encryptedText.split(":");
  const iv = Buffer.from(parts[0], "hex");
  const encrypted = parts[1];
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

// قراءة البيانات
function load() {
  if (!fs.existsSync(config.dataFile)) {
    return { accounts: [] };
  }
  try {
    const raw = fs.readFileSync(config.dataFile, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    console.error("Error reading data:", err.message);
    return { accounts: [] };
  }
}

// حفظ البيانات
function save(data) {
  fs.writeFileSync(config.dataFile, JSON.stringify(data, null, 2), "utf8");
}

// جلب اسم المستخدم من التوكن
async function fetchUsername(token) {
  try {
    const res = await axios.get("https://discord.com/api/v9/users/@me", {
      headers: {
        Authorization: token,
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      timeout: 10000,
    });
    return res.data.username || res.data.global_name || null;
  } catch (err) {
    console.error("Failed to fetch username:", err.message);
    return null;
  }
}

// إضافة حساب (async - تجيب اسم اليوزر تلقائياً)
async function addAccount(token, name) {
  const data = load();
  const id = crypto.randomBytes(4).toString("hex");

  // لو ما في اسم، اجيبه من ديسكورد
  let finalName = name;
  if (!finalName || finalName.trim() === "") {
    const fetched = await fetchUsername(token);
    finalName = fetched || "حساب_" + (data.accounts.length + 1);
  }

  const account = {
    id: id,
    name: finalName,
    token: encrypt(token),
    status: "IDLE",
    lastRun: null,
    quests: [],
    createdAt: new Date().toISOString(),
  };

  data.accounts.push(account);
  save(data);
  return { id: id, name: account.name };
}

// حذف حساب
function removeAccount(id) {
  const data = load();
  data.accounts = data.accounts.filter((a) => a.id !== id);
  save(data);
}

// الحصول على حساب (مع فك التشفير)
function getAccount(id) {
  const data = load();
  const account = data.accounts.find((a) => a.id === id);
  if (!account) return null;
  return {
    ...account,
    token: decrypt(account.token),
  };
}

// الحصول على كل الحسابات (بدون توكن)
function getAllAccounts() {
  const data = load();
  return data.accounts.map((a) => ({
    id: a.id,
    name: a.name,
    status: a.status,
    lastRun: a.lastRun,
    quests: a.quests,
  }));
}

// تحديث حالة حساب
function updateAccount(id, updates) {
  const data = load();
  const index = data.accounts.findIndex((a) => a.id === id);
  if (index === -1) return false;
  data.accounts[index] = { ...data.accounts[index], ...updates };
  save(data);
  return true;
}

// تحديث المهام
function updateQuests(id, quests) {
  return updateAccount(id, {
    quests: quests,
    lastRun: new Date().toISOString(),
  });
}

module.exports = {
  addAccount: addAccount,
  removeAccount: removeAccount,
  getAccount: getAccount,
  getAllAccounts: getAllAccounts,
  updateAccount: updateAccount,
  updateQuests: updateQuests,
};
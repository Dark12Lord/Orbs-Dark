// scheduler.js
// ============================================================
// جدولة تلقائية: كل X دقيقة، اكتشف المهام لكل حساب وحلها
// يتوقف عند "COMPLETED" (جاهزة للاستلام) — لا يستلم تلقائياً
// ============================================================

const database = require('./database');
const manager = require('./manager');

const DELAY_BETWEEN_ACCOUNTS_MS = 5000;
const COOLDOWN_SUCCESS_MS = 5 * 60 * 1000;
const COOLDOWN_ERROR_MS = 10 * 60 * 1000;

let timer = null;
let running = false;
let lastCycleAt = null;
const lastAttempt = new Map();
const stats = { cycles: 0, questsCompleted: 0, errors: 0, runs: 0 };

function log(msg) {
    console.log(`[scheduler ${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

async function runCycle() {
    if (running) {
        log('⏭️ الدورة السابقة لم تنتهِ بعد، تجاوز');
        return;
    }
    running = true;
    stats.cycles++;
    lastCycleAt = new Date().toISOString();

    try {
        const accounts = await database.getAllAccounts();
        log(`🔄 دورة #${stats.cycles} — ${accounts.length} حساب`);

        for (const acc of accounts) {
            if (!acc || !acc.id) continue;

            if (manager.isRunning(acc.id)) {
                log(`  ⏳ ${acc.name || acc.id}: شغال الآن، تجاوز`);
                continue;
            }

            const last = lastAttempt.get(acc.id) || 0;
            const sinceLast = Date.now() - last;
            const cooldown = acc.status === 'ERROR' ? COOLDOWN_ERROR_MS : COOLDOWN_SUCCESS_MS;

            if (sinceLast < cooldown) {
                const mins = Math.ceil((cooldown - sinceLast) / 60000);
                log(`  ⏭️ ${acc.name || acc.id}: انتظار ${mins} دقيقة (cooldown)`);
                continue;
            }

            lastAttempt.set(acc.id, Date.now());
            stats.runs++;

            try {
                log(`  ▶️ ${acc.name || acc.id}: بدء الحل`);
                const result = await manager.startAccount(acc.id);
                if (result.success) {
                    const done = (result.quests || []).filter(q => q.status === 'COMPLETED').length;
                    stats.questsCompleted += done;
                    log(`  ✅ ${acc.name || acc.id}: ${done} مهمة مكتملة`);
                } else {
                    stats.errors++;
                    log(`  ❌ ${acc.name || acc.id}: ${result.error}`);
                }
            } catch (err) {
                stats.errors++;
                log(`  ❌ ${acc.name || acc.id}: ${err.message}`);
            }

            await new Promise(r => setTimeout(r, DELAY_BETWEEN_ACCOUNTS_MS));
        }
    } catch (err) {
        stats.errors++;
        log(`❌ خطأ في الدورة: ${err.message}`);
    } finally {
        running = false;
    }
}

function start(intervalMinutes = 30) {
    if (timer) {
        log('⚠️ الجدولة شغالة مسبقاً');
        return { success: false, error: 'الجدولة شغالة' };
    }

    const intervalMs = Math.max(1, intervalMinutes) * 60 * 1000;
    log(`🚀 بدء الجدولة كل ${intervalMinutes} دقيقة`);

    setTimeout(() => runCycle().catch(err => log(`❌ ${err.message}`)), 15_000);

    timer = setInterval(() => {
        runCycle().catch(err => log(`❌ ${err.message}`));
    }, intervalMs);

    return { success: true, intervalMinutes };
}

function stop() {
    if (!timer) return { success: false, error: 'الجدولة متوقفة' };
    clearInterval(timer);
    timer = null;
    log('⏹️ تم إيقاف الجدولة');
    return { success: true };
}

function getStatus() {
    return {
        running: !!timer,
        cycleInProgress: running,
        lastCycleAt,
        stats,
    };
}

module.exports = { start, stop, getStatus, runCycle };
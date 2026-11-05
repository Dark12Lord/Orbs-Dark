-- ============================================================
-- Dark Orbs - Supabase Schema
-- ============================================================

-- جدول الحسابات
CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    token TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'IDLE',
    last_run TIMESTAMPTZ,
    quests JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- جدول حالة التشغيل (لتتبع ما كان شغالاً قبل إعادة التشغيل)
CREATE TABLE IF NOT EXISTS active_runs (
    account_id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    started_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- فهارس لتحسين الأداء
CREATE INDEX IF NOT EXISTS idx_accounts_status ON accounts(status);
CREATE INDEX IF NOT EXISTS idx_accounts_created_at ON accounts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_active_runs_updated_at ON active_runs(updated_at DESC);

-- تعليقات توضيحية
COMMENT ON TABLE accounts IS 'حسابات Discord المحفوظة (توكنات مشفرة)';
COMMENT ON TABLE active_runs IS 'تتبع الحسابات التي كانت شغالة قبل إعادة التشغيل';
COMMENT ON COLUMN accounts.token IS 'التوكن مشفر بـ AES-256-CBC';
COMMENT ON COLUMN accounts.quests IS 'قائمة المهام بصيغة JSON';
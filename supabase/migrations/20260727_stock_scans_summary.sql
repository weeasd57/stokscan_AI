-- ============================================================
-- EGX Bots: stock_scans_summary Table Migration
-- Professional Accumulation & Distribution Scanner Results
-- ============================================================
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS stock_scans_summary (
    id                     BIGSERIAL PRIMARY KEY,
    symbol                 TEXT NOT NULL,
    scan_date              DATE NOT NULL,

    -- Core Signal
    signal                 TEXT NOT NULL DEFAULT 'neutral',
    -- Values: 'accumulation' | 'strong_accumulation' | 'distribution' | 'strong_distribution' 
    --         | 'weak_accumulation' | 'weak_distribution' | 'neutral'

    wyckoff_phase          TEXT NOT NULL DEFAULT 'neutral',
    -- Wyckoff classification

    -- Scoring (0-100)
    acc_score              NUMERIC(5,1) DEFAULT 0,
    dist_score             NUMERIC(5,1) DEFAULT 0,

    -- Volume Analysis
    vol_ratio              NUMERIC(8,3) DEFAULT 0,   -- volume / vol_sma20 (latest day)
    vol_ratio_5d           NUMERIC(8,3) DEFAULT 0,   -- avg vol ratio over 5 days
    volume                 BIGINT DEFAULT 0,
    vol_sma20              BIGINT DEFAULT 0,

    -- OBV (On Balance Volume) change %
    obv_change_pct         NUMERIC(8,2) DEFAULT 0,

    -- Consecutive Days
    consecutive_acc_days   SMALLINT DEFAULT 0,
    consecutive_dist_days  SMALLINT DEFAULT 0,

    -- Technical
    rsi_14                 NUMERIC(6,2) DEFAULT 50,
    macd_signal            NUMERIC(10,4) DEFAULT 0,
    change_pct             NUMERIC(8,4) DEFAULT 0,

    -- Metadata
    created_at             TIMESTAMPTZ DEFAULT NOW(),
    updated_at             TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE (symbol, scan_date)
);

-- Indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_scans_summary_date   ON stock_scans_summary (scan_date DESC);
CREATE INDEX IF NOT EXISTS idx_scans_summary_signal ON stock_scans_summary (signal, scan_date DESC);
CREATE INDEX IF NOT EXISTS idx_scans_summary_score  ON stock_scans_summary (acc_score DESC, scan_date DESC);
CREATE INDEX IF NOT EXISTS idx_scans_summary_symbol ON stock_scans_summary (symbol, scan_date DESC);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
   NEW.updated_at = NOW();
   RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_stock_scans_summary_updated_at ON stock_scans_summary;
CREATE TRIGGER update_stock_scans_summary_updated_at
    BEFORE UPDATE ON stock_scans_summary
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Enable Row Level Security
ALTER TABLE stock_scans_summary ENABLE ROW LEVEL SECURITY;

-- Allow anonymous reads (public data)
CREATE POLICY IF NOT EXISTS "stock_scans_summary_public_read"
    ON stock_scans_summary
    FOR SELECT
    USING (true);

-- Allow service_role writes only (scanner script)
CREATE POLICY IF NOT EXISTS "stock_scans_summary_service_write"
    ON stock_scans_summary
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- ============================================================
-- Useful queries for the AI bot (tools.ts):
-- ============================================================

-- Top 10 accumulation stocks for latest scan date:
-- SELECT s.symbol, st.name, s.acc_score, s.vol_ratio, s.consecutive_acc_days, s.change_pct, s.rsi_14
-- FROM stock_scans_summary s
-- LEFT JOIN stocks st ON st.symbol = s.symbol
-- WHERE s.scan_date = (SELECT MAX(scan_date) FROM stock_scans_summary)
--   AND s.signal = 'accumulation'
-- ORDER BY s.acc_score DESC
-- LIMIT 10;

-- Top distribution stocks:
-- SELECT * FROM stock_scans_summary
-- WHERE scan_date = (SELECT MAX(scan_date) FROM stock_scans_summary)
--   AND signal IN ('distribution', 'strong_distribution')
-- ORDER BY dist_score DESC
-- LIMIT 10;

CREATE TABLE IF NOT EXISTS queries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,            -- 查詢時間 (ms)
  addresses TEXT NOT NULL,        -- 查了哪些地址（空白分隔）
  handle TEXT,                    -- 分享卡署名（有填才有）
  tokens INTEGER,                 -- 幣種數
  cost_usd REAL,
  ideal_usd REAL,                 -- 神之手
  actual_usd REAL,                -- 實際拿到
  missed_usd REAL,                -- 錯過總額
  big_rate REAL,                  -- 大金狗捕獲率
  small_rate REAL,
  efficiency REAL                 -- 神化率
);
CREATE INDEX IF NOT EXISTS idx_queries_ts ON queries (ts);
CREATE INDEX IF NOT EXISTS idx_queries_missed ON queries (missed_usd);

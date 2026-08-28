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

-- 幣的區間最高價資料庫：大家查過的幣存起來，之後同一隻幣不用再燒 API
-- 每筆記錄的意思是「從 from_day 起算到當時為止，最高價是 peak（發生在 peak_ts）」
-- 命中條件：新查詢的起算日 >= from_day 且 peak_ts >= 新查詢起算日
--   → 最高點就落在新查詢的區間內，那個值對新查詢是精確答案
CREATE TABLE IF NOT EXISTS token_peaks (
  mint     TEXT    NOT NULL,
  from_day INTEGER NOT NULL,      -- 記錄當時的起算日（對齊到日）
  peak     REAL    NOT NULL,
  peak_ts  INTEGER NOT NULL,
  mcap     REAL,
  updated  INTEGER NOT NULL,      -- 最後更新時間（秒）
  PRIMARY KEY (mint, from_day)
);
CREATE INDEX IF NOT EXISTS idx_token_peaks_lookup ON token_peaks (mint, peak_ts, from_day);

-- 計數器（月額度、每 IP 限流）放這裡而不是 KV：
-- KV 免費額度只有 1,000 次寫入/天，而每個請求都要記數 —— 一次大查詢就爆掉，
-- 寫入失敗會讓 Worker 直接回 500。D1 免費額度是 10 萬次寫入/天，綽綽有餘。
CREATE TABLE IF NOT EXISTS counters (
  name TEXT PRIMARY KEY,
  n    INTEGER NOT NULL DEFAULT 0,
  ts   INTEGER NOT NULL DEFAULT 0    -- 最後更新時間（秒），限流列用來清舊資料
);
CREATE INDEX IF NOT EXISTS idx_counters_ts ON counters (ts);

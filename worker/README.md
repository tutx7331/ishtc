# ISHTC 代理 Worker

讓訪客**不用自備 API key** 就能查詢：key 藏在這支 Worker 的環境變數裡，
網頁改打 Worker，由它代打 Helius / Solana Tracker。
同時內建最高價快取（熱門幣一次查詢供所有人共用）、每月額度守門、
每 IP 限流，以及查詢記錄（之後做排行榜用）。

## 部署（約 10 分鐘）

1. 註冊 [Cloudflare](https://dash.cloudflare.com)（免費）
2. 安裝並登入 wrangler：
   ```
   npm i -g wrangler
   wrangler login
   ```
3. 建 KV 並把 id 貼進 `wrangler.toml`：
   ```
   wrangler kv namespace create CACHE
   ```
4. 存入兩把 key（不會出現在任何程式碼裡）：
   ```
   wrangler secret put HELIUS_KEY
   wrangler secret put ST_KEY
   ```
5. 部署：
   ```
   wrangler deploy
   ```
   會得到一個網址，例如 `https://ishtc-proxy.你的帳號.workers.dev`
6. 打開 `app.js`，把最上面的 `DEFAULT_PROXY` 改成那個網址，重新發佈網頁。

## 查詢記錄（選用）

```
wrangler d1 create ishtc-logs
wrangler d1 execute ishtc-logs --file=schema.sql --remote
```
然後把 `wrangler.toml` 裡 D1 那段的註解拿掉、貼上 database_id，重新 `wrangler deploy`。
沒設 D1 也能正常運作，只是不記錄。

看記錄：
```
wrangler d1 execute ishtc-logs --remote --command "SELECT datetime(ts/1000,'unixepoch') t, addresses, handle, tokens, missed_usd FROM queries ORDER BY ts DESC LIMIT 20"
```

## 升級額度

升級 Helius / Solana Tracker 方案後（同一把 key、額度變大），
改 `wrangler.toml` 的 `HELIUS_MONTHLY_CREDITS` / `ST_MONTHLY_LIMIT`，
再 `wrangler deploy` 即可，前端不用動。

## 額度用完會怎樣

Worker 回 429 + `x-cooldown` 標頭，網頁顯示
「查詢用量過大，暫時冷卻中」並開放訪客自填免費 key 繼續使用。

## 看目前用量

打開 `https://你的worker網址/health`

# ISHTC — I Should Hold The Coin

輸入一個或多個 Solana 地址，算出你買過的每一隻 memecoin **買進之後最多能吃到幾倍（MFE）**，
以及那句所有人都不敢問的話：**如果我都不賣，我現在會有多少錢？**

純前端、零後端、零成本。整個網頁就三個檔案，直接丟 GitHub Pages 就能用。

---

## 它算什麼

| 指標 | 定義 |
|---|---|
| **MFE**（最大有利波動） | 你第一次買進之後，該幣曾經到過的最高價 ÷ 你的平均買入成本。這是你「最多能吃到幾 %」的上限。 |
| **神之手價值** | 假設你買進的每一顆都精準賣在最高點，總共會拿到多少錢。 |
| **實際拿到** | 已賣出所得 + 目前還持有的市值。 |
| **賣飛金額** | 神之手價值 − 實際拿到。你錯過的數字。 |
| **神化率** | 實際 ÷ 神之手。100% 是神，5% 是正常人。 |
| **大金狗捕獲率** | MFE ≥ 100x **且**該幣最高市值 ≥ $10M 的比例。 |
| **小金狗捕獲率** | MFE ≥ 10x **且**最高市值 ≥ $1M 的比例。 |
| **漲幅命中率** | 買過的幣裡，曾經漲到 2x / 5x / 10x / 50x / 100x 的比例（不看市值）。 |
| **全損率** | 現價不到你買入均價 5% 的比例（你在這筆上幾乎全賠）。 |
| **已死率** | 池子流動性低於 $1,000，或現價從自己的歷史高點跌掉 99%。這是幣的狀態，跟你買在哪無關。 |

還有：平均從買入到見頂要幾天、各地址分開比較、可下載的 CSV，以及**可自訂背景圖與 logo 的分享卡**。

賣飛排行榜每個欄位都能點著排序，每頁 10 筆分頁顯示。

**支援多地址**：一行貼一個。多個地址會合併成一個總表，錢包之間互轉會自動抵銷，不會被誤算成賣出。

---

## 怎麼用

### 線上版

打開 GitHub Pages 網址 → 貼地址 → 貼 Helius key → 開始算帳。

### 本機跑

```bash
git clone https://github.com/<your-name>/sol-fomo.git
```

然後用瀏覽器打開 `index.html` 就好，不需要 build、不需要 npm、不需要 server。

---

## 只需要一把免費的 Solana Tracker API Key

免費申請 → [solanatracker.io/data-api](https://www.solanatracker.io/data-api)（10,000 次/月、3 req/秒）。

兩把 key 各司其職，建議都填：

| key | 負責 | 為什麼 |
|---|---|---|
| **Helius** | 你買過哪些幣 | 從錢包**原始餘額變化**推算，任何程式搬動代幣都跑不掉。覆蓋率最完整。 |
| **Solana Tracker** | 買入後最高漲到哪 | `/price/history/range` 直接回傳區間最高價與**最高點當下的真實市值**，比其他家快 3–6 倍。 |

**為什麼不能只用 Solana Tracker 一把搞定？**
它的 `/wallet/{owner}/trades` 成交索引只涵蓋整合過的 DEX，
走冷門路由或 launchpad 的交易（bags.fm、部分 Token-2022 代幣）會整批漏掉。
實測某錢包用 bags.fm 買的 8 隻幣全部缺席。所以交易紀錄還是走 Helius。

只填其中一把也能跑，報告會標明用了哪條路以及可能的缺口。

---

## 替代方案：Helius + GeckoTerminal

**錢包交易紀錄沒有任何一家是免費且免金鑰的**（Solscan、Birdeye、Solana Tracker 全都要 key），
所以這裡採 BYOK：你用你自己的 key，key 只存在你自己瀏覽器的 `localStorage`，
repo 裡沒有任何金鑰，也不會送到任何第三方伺服器。

申請要 30 秒：

1. 到 [dashboard.helius.dev](https://dashboard.helius.dev) 用 GitHub / email 註冊
2. 免費方案每月 1,000,000 credits，個人用綽綽有餘
3. 複製 API key 貼進網頁

歷史價格的部分（DexScreener、GeckoTerminal）**完全免費且不需要金鑰**。

### Birdeye Key（選填，但建議填）

免費申請 → [bds.birdeye.so](https://bds.birdeye.so)。填了有兩個好處：

- **算得更準**：Birdeye 是按代幣地址查 K 線、涵蓋所有池子，補得到 pump.fun 遷移前 bonding curve 那段行情。GeckoTerminal 只能查單一池子，早期買進的幣 MFE 會被低估。
- **跑得更快**：限速 60/min vs GeckoTerminal 的 30/min，速度大約快一倍。

不填也能用，會自動走 GeckoTerminal。Birdeye 查不到或額度用完時也會自動退回。

---

## 資料來源

| 用途 | 服務 | 要金鑰 |
|---|---|---|
| 成交紀錄 + 買入後最高價（**一把搞定**） | [Solana Tracker](https://www.solanatracker.io/data-api) | ✅ 免費方案 |
| 錢包交易紀錄（沒填 Solana Tracker 時的替代） | [Helius](https://helius.dev) Enhanced Transactions | ✅ 免費方案 |
| 池子位址、現價、代幣符號 | [DexScreener](https://docs.dexscreener.com/api/reference) | ❌ |
| SOL 歷史匯率（把成本換算成美元） | Binance → Coinbase → GeckoTerminal 依序嘗試 | ❌ |
| 買入後最高價（備援，選填） | [Birdeye](https://bds.birdeye.so) OHLCV | ✅ 免費方案 |
| 買入後最高價（沒填 key 時的預設） | [GeckoTerminal](https://www.geckoterminal.com/dex-api) OHLCV | ❌ |

最高價那一步是一隻幣一次呼叫，所以速度由限速決定：

| | 限速 | 300 隻 | 1000 隻 | 每月額度 |
|---|---|---|---|---|
| GeckoTerminal（無金鑰） | 30/min | 約 12 分 | 約 40 分 | 無限 |
| Birdeye（免費） | 60/min | 約 6 分 | 約 20 分 | 30K CU |
| **Solana Tracker（免費）** | **180/min** | **約 2 分** | **約 7 分** | 10K 次 |

Solana Tracker 快的原因不只是限速：它有 `/price/history/range` 端點，
**直接回傳「這段時間內的最高價與當下市值」**，不用抓 1000 根 K 線再自己取最大值。
順帶連最高市值都是真實值，不需要用 `fdv ÷ 現價` 反推流通量。

程式內建節流器與 6 小時本機快取，輸入框下方會即時顯示預估耗時。
**中途按「停止」會保留已經算完的部分**，報告開頭會標明分母只有這幾隻。

---

## 已知誤差

這是一份估算，不是會計報表。已知會不準的地方：

- **沒填 Birdeye key 時，pump.fun 遷移前的價格抓不到**。GeckoTerminal 只能查單一池子，最高價取自目前流動性最深的那個，bonding curve 階段的行情不在裡面，早期買進的幣 MFE 會被低估。填了 Birdeye key 就沒這問題。
- **最高市值是推算的**。用目前市值 ÷ 目前價格反推流通量，再乘上歷史最高價。假設流通量沒變過，遇到增發或大額燒毀會失真。
- **成本以錢包淨變化估算**。買入成本 = 該筆交易錢包淨減少的 SOL / USDC / USDT，SOL 用當日收盤價換算美元，跟當下實際成交價會有小幅差異。
- **轉出到沒填進來的地址不算賣出**。如果你有其他錢包，一起貼上，不然數字會偏低。
- **完全下架的幣查不到**。DexScreener 找不到池子的幣不會列入報告。
- 掃描筆數與幣種數量有上限（進階設定可調），預設分析買入成本前 300 名、最小成本 $0.1。**最小成本調太低會把測試單也算進分母、稀釋金狗率**，想看真實選幣品味建議調到 $5–$20。

報告底部的「數據怎麼算的 / 哪裡會不準」會列出這次分析實際觸發了哪幾條。

---

## 隱私

- 全程在瀏覽器裡執行，沒有後端。
- 地址與 API key 只寫進你自己的 `localStorage`。
- 只會直接打 Helius / DexScreener / GeckoTerminal / Birdeye，沒有任何分析或追蹤。
- 分享卡的背景圖與 logo 只在你的瀏覽器裡處理，不會上傳到任何地方。

---

## 檔案

```
index.html   版面
style.css    樣式
app.js       全部邏輯（抓資料、算 MFE、統計、畫分享圖）
```

---

## 授權

MIT。這不是投資建議，只是一份帳單。

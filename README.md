# 賣飛計算機 (SOL FOMO Calculator)

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
| **出場效率** | 實際 ÷ 神之手。100% 是神，5% 是正常人。 |
| **金狗命中率** | 買過的幣裡，曾經漲到 2x / 5x / 10x / 50x / 100x 的比例。 |
| **歸零率** | 現價低於買入均價 5% 的比例。 |

還有：平均從買入到見頂要幾天、賣飛排行榜、各地址分開比較、可下載的分享圖與 CSV。

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

## 需要一把免費的 Helius API Key

**錢包交易紀錄沒有任何一家是免費且免金鑰的**（Solscan、Birdeye、Solana Tracker 全都要 key），
所以這裡採 BYOK：你用你自己的 key，key 只存在你自己瀏覽器的 `localStorage`，
repo 裡沒有任何金鑰，也不會送到任何第三方伺服器。

申請要 30 秒：

1. 到 [dashboard.helius.dev](https://dashboard.helius.dev) 用 GitHub / email 註冊
2. 免費方案每月 1,000,000 credits，個人用綽綽有餘
3. 複製 API key 貼進網頁

歷史價格的部分（DexScreener、GeckoTerminal）**完全免費且不需要金鑰**。

---

## 資料來源

| 用途 | 服務 | 要金鑰 |
|---|---|---|
| 錢包交易紀錄 | [Helius](https://helius.dev) Enhanced Transactions | ✅ 免費方案 |
| 池子位址、現價、代幣符號 | [DexScreener](https://docs.dexscreener.com/api/reference) | ❌ |
| 歷史 K 線（算最高價） | [GeckoTerminal](https://www.geckoterminal.com/dex-api) | ❌ |

GeckoTerminal 無金鑰限速 30 req/min，程式內建 25/min 的節流器與 6 小時本機快取。
分析 80 隻幣大約要 3 分鐘，過程有進度條跟剩餘時間，可以隨時中斷。

---

## 已知誤差

這是一份估算，不是會計報表。已知會不準的地方：

- **pump.fun 遷移前的價格抓不到**。最高價取自目前流動性最深的那個池子，bonding curve 階段的行情不在裡面，所以早期買進的幣 MFE 可能被低估。
- **成本以錢包淨變化估算**。買入成本 = 該筆交易錢包淨減少的 SOL / USDC / USDT，SOL 用當日收盤價換算美元，跟當下實際成交價會有小幅差異。
- **轉出到沒填進來的地址不算賣出**。如果你有其他錢包，一起貼上，不然數字會偏低。
- **完全下架的幣查不到**。DexScreener 找不到池子的幣不會列入報告。
- 掃描筆數與幣種數量有上限（可在進階設定調整），預設只分析買入成本前 80 名。

報告底部的「數據怎麼算的 / 哪裡會不準」會列出這次分析實際觸發了哪幾條。

---

## 隱私

- 全程在瀏覽器裡執行，沒有後端。
- 地址與 API key 只寫進你自己的 `localStorage`。
- 只會直接打 Helius / DexScreener / GeckoTerminal 三個 API，沒有任何分析或追蹤。

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

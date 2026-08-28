/* ISHTC 中英雙語
 *
 * 用法：
 *   t('key', { n: 3 })            取字串，{n} 會被代換
 *   I18N.set('en')                切語言（存 localStorage，重新套用整頁）
 *   I18N.apply()                  套用 data-i18n / data-i18n-ph 標記的靜態文字
 *   I18N.onChange(fn)             語言變更時要重畫的東西登記在這裡
 *
 * 字典是單一物件：key → { zh, en }。缺 key 時回傳 key 本身（不會炸掉畫面）。
 */
(function () {
  'use strict';

  const DICT = {
    // ---------- 首頁 ----------
    'hero.eyebrow': { zh: '─── SOLANA · 賣飛體檢 ───', en: '─── SOLANA · PAPER HANDS CHECK ───' },
    'hero.tagline': { zh: 'I SHOULD HOLD THE COIN', en: 'I SHOULD HOLD THE COIN' },
    'hero.ask': { zh: '你 2026 賣飛了多少錢？', en: 'How much did you paper in 2026?' },
    'hero.addr': { zh: '貼上 Solana 地址（可多個，用空格分隔）', en: 'Paste Solana address (multiple OK, space-separated)' },
    'hero.nick': { zh: '暱稱（選填，會與查詢一起記錄）', en: 'Nickname (optional, saved with your query)' },
    'hero.run': { zh: '查詢', en: 'Check' },
    'hero.note': { zh: '免註冊 · 免 API key · 貼上就查', en: 'No signup · No API key · Just paste' },
    'foot.sources': { zh: '這不是投資建議，只是一份帳單。', en: 'Not investment advice — just the bill.' },

    // ---------- 進階區 ----------
    'adv.summary': { zh: '進階查詢 · 自備 API key · 掃描設定', en: 'Advanced · Your own API keys · Scan settings' },
    'adv.addrLabel': { zh: 'Solana 地址', en: 'Solana address' },
    'adv.addrHint': { zh: '一行一個，可查多個', en: 'One per line, multiple allowed' },
    'adv.cooldown': { zh: '查詢用量過大，暫時冷卻中', en: 'Usage limit reached — cooling down' },
    'adv.cooldownTail': { zh: '—— 等 DEV 充值，或在下方填入自己的免費 API key 繼續查詢。', en: '— wait for the dev to top up, or paste your own free API key below.' },
    'adv.proxyNote': { zh: '本站已代付查詢額度，貼上地址即可查詢。查詢紀錄（地址、統計、暱稱）會保存下來供排行榜與後續功能使用。', en: 'Queries are on the house — just paste an address. Each query (address, stats, nickname) is recorded for the leaderboard and future features.' },
    'adv.showKeys': { zh: '改用自己的 API key', en: 'Use my own API key' },
    'adv.optional': { zh: '選填', en: 'optional' },
    'adv.altKeys': { zh: '備援來源（選填）', en: 'Backup sources (optional)' },
    'adv.maxTokens': { zh: '最多分析幾隻幣', en: 'Max tokens to analyze' },
    'adv.minCost': { zh: '最小買入成本 (USD)', en: 'Min buy cost (USD)' },
    'adv.maxTx': { zh: '最多掃描交易筆數', en: 'Max transactions to scan' },
    'adv.run': { zh: '開始分析', en: 'Analyze' },
    'adv.cancel': { zh: '停止', en: 'Stop' },
    'adv.clearCache': { zh: '清除快取', en: 'Clear cache' },
    'adv.cleared': { zh: '已清除', en: 'Cleared' },

    // ---------- 場景 ----------
    'scene.back': { zh: '↩ 查詢', en: '↩ Search' },
    'scene.board': { zh: '🏆 排行榜', en: '🏆 Leaderboard' },
    'scr.1': { zh: '02 · 漲幅命中率', en: '02 · MULTIPLE HIT RATE' },
    'scr.2': { zh: '03 · 賣飛排行榜', en: '03 · SOLD-TOO-EARLY TABLE' },
    'scr.3': { zh: 'MAIN · 總結', en: 'MAIN · SUMMARY' },
    'scr.4': { zh: '04 · 分享', en: '04 · SHARE' },
    'scene.standby': { zh: '● STANDBY', en: '● STANDBY' },
    'room.hint': {
      zh: '金色是金狗，戴皇冠的是大金狗，全場還有一隻失意貓。滑過看幣名，抓起來丟也可以。',
      en: 'Gold = winner, crowned = big winner, and one dazed cat somewhere. Hover for the ticker, or grab and throw them.',
    },
    'room.count': { zh: '　共 {n} 隻{gold}。', en: '　{n} tokens{gold}.' },
    'room.golds': { zh: '，其中 {n} 隻金狗', en: ', {n} of them winners' },
    'room.overflow': { zh: '　房間塞不下，只顯示 {shown} / {total} 隻（金狗優先）。', en: '　Room is full — showing {shown} / {total} (winners first).' },
    'cat.sym': { zh: '失意貓', en: 'Forgor Cat' },

    // ---------- 總結 ----------
    'sum.verdictBig': { zh: '你買過 {n} 隻幣，如果每一隻都賣在最高點<br>你會有 <em>{ideal}</em>。', en: 'You bought {n} tokens. Sell every one at its peak<br>and you would have <em>{ideal}</em>.' },
    'sum.verdictSub': { zh: '你實際拿到 {actual}，也就是說你錯過了 <b>{missed}</b>。{grade}', en: 'You actually got {actual} — you missed <b>{missed}</b>. {grade}' },
    'grade.god': { zh: '你是神。', en: 'You are a god.' },
    'grade.good': { zh: '你算會賣的。', en: 'You actually know when to sell.' },
    'grade.normal': { zh: '正常人水準。', en: 'Pretty normal, honestly.' },
    'grade.bad': { zh: '你就是那個一賣就漲的人。', en: 'You are the reason it pumped after you sold.' },
    'stat.missed': { zh: '錯過的錢', en: 'MONEY MISSED' },
    'stat.cost': { zh: '總投入成本', en: 'Total invested' },
    'stat.costSub': { zh: '{year} 年 · {n} 筆交易', en: '{year} · {n} transactions' },
    'stat.pnl': { zh: '實際損益', en: 'Actual P&L' },
    'stat.pnlSub': { zh: '已實現 + 現有持倉', en: 'Realized + current holdings' },
    'stat.ideal': { zh: '神之手總值', en: 'God-hands total' },
    'stat.idealSub': { zh: '每隻都賣在最高點', en: 'Every token sold at its peak' },
    'stat.eff': { zh: '神化率', en: 'God ratio' },
    'stat.effSub': { zh: '實際 ÷ 神之手', en: 'Actual ÷ god-hands' },
    'rate.big': { zh: '大金狗', en: 'Big winners' },
    'rate.small': { zh: '小金狗', en: 'Small winners' },

    // ---------- 命中率 ----------
    'golden.row': { zh: '{n} 隻 · {pct}', en: '{n} · {pct}' },

    // ---------- 表格 ----------
    'col.symbol': { zh: '幣', en: 'Token' },
    'col.addr': { zh: '買入地址', en: 'Bought by' },
    'col.cost': { zh: '成本', en: 'Cost' },
    'col.mfe': { zh: '最高倍數', en: 'Peak' },
    'col.actual': { zh: '實際拿到', en: 'Got' },
    'col.missed': { zh: '錯過總額', en: 'Missed' },
    'badge.big': { zh: '大金狗', en: 'BIG WIN' },
    'badge.small': { zh: '小金狗', en: 'WIN' },
    'pager.info': { zh: '{from}–{to} / {total}　第 {page} / {pages} 頁', en: '{from}–{to} of {total}　page {page} / {pages}' },

    // ---------- 各地址 ----------
    'addr.title': { zh: '各地址表現', en: 'Per-address breakdown' },
    'addr.col.addr': { zh: '地址', en: 'Address' },
    'addr.col.n': { zh: '幣數', en: 'Tokens' },
    'addr.col.cost': { zh: '總成本', en: 'Cost' },
    'addr.col.ideal': { zh: '神之手價值', en: 'God-hands' },
    'addr.col.actual': { zh: '實際', en: 'Actual' },
    'addr.col.eff': { zh: '神化率', en: 'God ratio' },
    'addr.col.hit': { zh: '10x 命中率', en: '10x hit rate' },

    // ---------- 分享 ----------
    'share.title': { zh: '分享', en: 'Share' },
    'share.bg': { zh: '背景圖', en: 'Background' },
    'share.pick': { zh: '選擇圖片', en: 'Choose image' },
    'share.remove': { zh: '移除', en: 'Remove' },
    'share.bgHint': { zh: '自動鋪滿並壓暗', en: 'Auto-fills and dims' },
    'share.handle': { zh: '署名', en: 'Signature' },
    'share.handleHint': { zh: '留空不顯示', en: 'Leave blank to hide' },
    'share.dim': { zh: '背景暗度', en: 'Background dimming' },
    'share.download': { zh: '分享', en: 'Share' },
    'share.copyLink': { zh: '複製查詢連結', en: 'Copy query link' },
    'share.copied': { zh: '已複製', en: 'Copied' },
    'share.csv': { zh: '下載 CSV', en: 'Download CSV' },

    // ---------- 分享卡 ----------
    'card.eyebrow': { zh: 'I SHOULD HOLD THE COIN', en: 'I SHOULD HOLD THE COIN' },
    'card.missed': { zh: '我錯過了', en: 'I MISSED' },
    'card.eff': { zh: '神化率', en: 'GOD RATIO' },
    'card.godHands': { zh: '神之手', en: 'God-hands' },
    'card.got': { zh: '實際拿到', en: 'Actually got' },
    'card.cost': { zh: '總投入成本', en: 'Total invested' },
    'card.pnl': { zh: '實際損益', en: 'Actual P&L' },
    'card.paper': { zh: '賣飛金額', en: 'Sold too early' },
    'card.days': { zh: '平均到頂', en: 'Avg days to peak' },
    'card.bigDogs': { zh: '大金狗', en: 'Big winners' },
    'card.smallDogs': { zh: '小金狗', en: 'Small winners' },
    'card.over10': { zh: '10X 以上', en: 'Over 10x' },
    'card.over100': { zh: '100X 以上', en: 'Over 100x' },
    'card.tokens': { zh: '{n} 隻', en: '{n}' },
    'card.days.unit': { zh: '{n} 天', en: '{n} d' },
    'card.top5': { zh: 'TOP5', en: 'TOP 5' },
    'card.top5Sub': { zh: '· 最痛的五隻', en: '· the five that hurt most' },
    'card.col.cost': { zh: '成本', en: 'Cost' },
    'card.col.got': { zh: '實拿', en: 'Got' },
    'card.col.missed': { zh: '賣飛', en: 'Missed' },
    'card.col.mult': { zh: '倍數', en: 'Multiple' },
    'card.stampPaper': { zh: '紙 手 認 證', en: 'CERTIFIED' },
    'card.stampHunter': { zh: '金 狗 獵 人', en: 'CERTIFIED' },
    'card.stampDiamond': { zh: '鑽 石 手', en: 'CERTIFIED' },
    'card.wallet': { zh: '{n} 個地址', en: '{n} WALLET' },
    'card.wallets': { zh: '{n} 個地址', en: '{n} WALLETS' },
    'card.tokenCount': { zh: '{n} 隻幣', en: '{n} TOKENS' },
    'card.footTag': { zh: '你 2026 賣飛了多少錢？', en: 'How much did you paper in 2026?' },
    'card.footNote': { zh: '鏈上交易 × 歷史K線 自動生成 · 僅供娛樂', en: 'On-chain trades × price history · for fun only' },

    // ---------- 排行榜 ----------
    'board.title': { zh: 'HALL OF PAIN · 全站排行榜', en: 'HALL OF PAIN · GLOBAL LEADERBOARD' },
    'board.money': { zh: '💸 金額榜', en: '💸 Money board' },
    'board.moneySub': { zh: '錯過最多錢', en: 'most money missed' },
    'board.pain': { zh: '💔 痛苦指數榜', en: '💔 Pain index' },
    'board.painSub': { zh: '小額大賣飛', en: 'small buy, huge miss' },
    'board.dogs': { zh: '🐕 金狗榜', en: '🐕 Winner board' },
    'board.dogsSub': { zh: '至少 10 隻幣', en: '10+ tokens required' },
    'board.loading': { zh: '載入中…', en: 'Loading…' },
    'board.empty': { zh: '還沒有人上榜', en: 'Nobody here yet' },
    'board.emptyFirst': { zh: '還沒有人上榜，快查一筆', en: 'Nobody here yet — run a query' },
    'board.emptyDogs': { zh: '還沒有人抓到大金狗', en: 'No big winners caught yet' },
    'board.needProxy': { zh: '排行榜需要連上代理伺服器', en: 'Leaderboard needs the proxy server' },
    'board.cooldown': { zh: '用量冷卻中，等 DEV 充值', en: 'Cooling down — waiting for the dev to top up' },
    'board.error': { zh: '排行榜暫時拿不到', en: 'Leaderboard unavailable' },
    'board.costOf': { zh: '成本 {cost} · {n} 隻幣', en: 'cost {cost} · {n} tokens' },
    'board.dogCount': { zh: '{n} 隻大金狗', en: '{n} big winners' },
    'board.dogSub': { zh: '{pct} · {n} 隻幣', en: '{pct} · {n} tokens' },
    'toast.copiedAddr': { zh: '已複製地址', en: 'Address copied' },
    'board.queryHint': { zh: '點擊查詢這個地址', en: 'Click to check this address' },
    'board.copyHint': { zh: '複製地址', en: 'Copy address' },

    // ---------- 進度 ----------
    'prog.solPrice': { zh: '抓 SOL 歷史價…', en: 'Fetching SOL price history…' },
    'prog.txs': { zh: '[{i}/{total}] 抓 {addr} 的交易紀錄…', en: '[{i}/{total}] Fetching transactions for {addr}…' },
    'prog.trades': { zh: '[{i}/{total}] 抓 {addr} 的成交紀錄…', en: '[{i}/{total}] Fetching trades for {addr}…' },
    'prog.rebuild': { zh: '重建買賣紀錄…', en: 'Rebuilding buy/sell history…' },
    'prog.pools': { zh: '查池子與現價…', en: 'Looking up pools and prices…' },
    'prog.peak': { zh: '算最高價 {i}/{total}（{sym}）… 剩 {eta}', en: 'Peak price {i}/{total} ({sym})… {eta} left' },
    'prog.done': { zh: '完成', en: 'Done' },
    'eta.min': { zh: '約 {n} 分', en: 'about {n} min' },
    'eta.sec': { zh: '約 {n} 秒', en: 'about {n} s' },
    'eta.hour': { zh: '約 {n} 小時', en: 'about {n} h' },

    // ---------- 錯誤 ----------
    'err.noAddr': { zh: '請至少輸入一個 Solana 地址。', en: 'Enter at least one Solana address.' },
    'err.badAddr': { zh: '這些看起來不是 Solana 地址：\n', en: 'These do not look like Solana addresses:\n' },
    'err.noKey': { zh: '請至少填一把 API key（建議 Helius + Solana Tracker 都填）。', en: 'Add at least one API key (Helius + Solana Tracker recommended).' },
    'err.noTx': { zh: '這些地址沒有任何交易紀錄。', en: 'No transactions found for these addresses.' },
    'err.noBuys': { zh: '找不到符合條件的買入紀錄（最小成本 ${n}）。試著把「最小買入成本」調低。', en: 'No buys matched the filter (min cost ${n}). Try lowering the minimum buy cost.' },
    'err.nothingDone': { zh: '還沒算完任何一隻就停止了，沒有結果可以顯示。', en: 'Stopped before finishing any token — nothing to show.' },
    'err.cooldown': { zh: '⚠ 查詢用量過大，暫時冷卻中 —— 等 DEV 充值，或自備 API key。', en: '⚠ Usage limit reached — wait for the dev to top up, or use your own API key.' },
    'err.solPrice': { zh: '三個來源都抓不到 SOL 歷史價（Binance / Coinbase / GeckoTerminal），稍後再試。', en: 'Could not fetch SOL price history from any source (Binance / Coinbase / GeckoTerminal). Try again later.' },
    'err.exportFail': { zh: '分享圖匯出失敗：請改用 http:// 網址開啟（直接雙擊 index.html 會被瀏覽器擋）。', en: 'Image export failed — open the page over http:// (opening index.html directly is blocked by the browser).' },
    'err.net': { zh: '網路錯誤，連不到 {host}', en: 'Network error — cannot reach {host}' },
    'err.upstream': { zh: '{host} 暫時出問題（HTTP {status}），重試 {tries} 次都沒過', en: '{host} is having trouble (HTTP {status}) — {tries} retries all failed' },
    'err.http': { zh: '{host} 回應 HTTP {status}', en: '{host} returned HTTP {status}' },
    'err.rate': { zh: '{host} 暫時限流中，請稍後再試。', en: '{host} is rate-limiting — try again shortly.' },
    'prog.got': { zh: '{addr} — 已抓 {n} 筆', en: '{addr} — {n} records so far' },
    'err.cooldownShort': { zh: '查詢用量過大，暫時冷卻中 —— 等 DEV 充值', en: 'Usage limit reached — waiting for the dev to top up' },
    'err.keyHelius': { zh: 'Helius API key 無效或已停用。', en: 'Helius API key is invalid or disabled.' },
    'err.quotaHelius': { zh: 'Helius 額度用完或被限流，稍後再試。', en: 'Helius quota exhausted or rate-limited — try again later.' },
    'err.keySt': { zh: 'Solana Tracker API key 無效或已停用。', en: 'Solana Tracker API key is invalid or disabled.' },
    'err.keyStAlt': { zh: 'Solana Tracker API key 無效。清空該欄位就會改用其他來源。', en: 'Solana Tracker API key is invalid. Clear the field to fall back to other sources.' },
    'err.keyBirdeye': { zh: 'Birdeye API key 無效。清空該欄位就會改用免金鑰的 GeckoTerminal。', en: 'Birdeye API key is invalid. Clear the field to fall back to keyless GeckoTerminal.' },
    'prog.solPriceSrc': { zh: '抓 SOL 歷史價（{src}）…', en: 'Fetching SOL price history ({src})…' },
    'quota.birdeye': { zh: '　Birdeye 剩 {n}', en: '　Birdeye left {n}' },
    'adv.etaHint': { zh: '上限；實際只算你買過的幣。跑滿 {n} 隻約 {eta}。', en: 'Cap; only tokens you actually bought are counted. Full {n} takes about {eta}.' },
    'err.copyPrompt': { zh: '複製這段文字：', en: 'Copy this:' },

    // ---------- 資料說明 ----------
    'cav.aborted': { zh: '<b>中途停止</b>：預計 {planned} 隻，只算完 {done} 隻，比率分母以此為準。', en: '<b>Stopped early</b>: {planned} planned, {done} finished — rates use the finished count.' },
    'cav.partial': { zh: '{addrs} 的紀錄沒抓完（資料源暫時故障），稍後重跑即可。', en: 'Records for {addrs} are incomplete (data source hiccup) — rerun later.' },
    'cav.scanned': { zh: '掃描 <b>{n}</b> 筆交易', en: 'scanned <b>{n}</b> transactions' },
    'cav.touched': { zh: '碰過 <b>{n}</b> 隻幣', en: 'touched <b>{n}</b> tokens' },
    'cav.neverBought': { zh: '<b>{n}</b> 隻只收到沒買過', en: '<b>{n}</b> only received, never bought' },
    'cav.belowMin': { zh: '<b>{n}</b> 隻成本低於 ${min}', en: '<b>{n}</b> below ${min} cost' },
    'cav.lostToMulti': { zh: '<b>{n}</b> 隻被多幣交易讓位', en: '<b>{n}</b> lost to multi-token swaps' },
    'cav.counted': { zh: '計入 <b>{n}</b> 隻', en: '<b>{n}</b> counted' },
    'cav.truncated': { zh: '另有 {n} 隻沒算（可調高上限）', en: '{n} more skipped (raise the limit)' },
    'cav.noPool': { zh: '<b>{n}</b> 隻查不到池子', en: '<b>{n}</b> with no pool found' },
    'cav.solStale': { zh: '<b>{n} 隻</b>的買入早於匯率資料起點（{date}），成本為估算值。', en: '<b>{n}</b> bought before the FX data starts ({date}) — cost is estimated.' },
    'cav.stSrc': { zh: '成交紀錄來自 Solana Tracker，冷門路由的交易可能有漏；補一把 Helius key 可完整覆蓋。', en: 'Trades come from Solana Tracker; exotic routes may be missed. Add a Helius key for full coverage.' },
    'cav.underwater': { zh: '{n} 隻最高倍數低於 1x，來自滑價與手續費。', en: '{n} tokens peaked below 1x — slippage and fees.' },
    'cav.peakFixed': { zh: '{n} 隻的最高價為錯誤報價，已用市值回推修正。', en: '{n} tokens had bad peak quotes — corrected from market cap.' },
    'cav.mcapEst': { zh: '{prefix}最高市值為推算值（以現市值反推流通量）。', en: '{prefix}Peak market cap is estimated (supply derived from current cap).' },
    'cav.mcapPrefix': { zh: '{n} 隻的', en: 'For {n} tokens: ' },
    'cav.starMark': { zh: '標 <b>*</b> 的幣，K 線未完整涵蓋買入時間，最高價可能被低估。', en: 'Tokens marked <b>*</b>: candles do not fully cover the buy window, so the peak may be understated.' },
    'cav.noPeak': { zh: '{n} 隻抓不到歷史 K 線，以現價與均價較高者代替。', en: '{n} tokens had no price history — using the higher of current and average price.' },
    'cav.transferOut': { zh: '轉出到未列入的地址不算賣出 —— 有其他錢包記得一起貼上。', en: 'Transfers to addresses not listed here do not count as sells — paste your other wallets too.' },
    'intro.title': { zh: '這工具在算什麼', en: 'What this tool measures' },
    'intro.mfe': { zh: '<b>最高倍數</b>：買入後曾漲到的最高價 ÷ 你的買入均價。', en: '<b>Peak multiple</b>: highest price after you bought ÷ your average buy price.' },
    'intro.ideal': { zh: '<b>神之手價值</b>：每一隻都賣在最高點能拿到的錢。', en: '<b>God-hands value</b>: what you would have if every token was sold at its peak.' },
    'intro.missed': { zh: '<b>錯過總額</b> ＝ 神之手 − 實際拿到 ＝ <b>賣飛</b> ＋ <b>雲霄飛車</b>。', en: '<b>Total missed</b> = god-hands − what you got = <b>sold too early</b> + <b>round trip</b>.' },
    'intro.eff': { zh: '<b>神化率</b>：實際 ÷ 神之手。100% 是神，5% 是正常人。', en: '<b>God ratio</b>: actual ÷ god-hands. 100% is divine, 5% is normal.' },
    'intro.scope': { zh: '<b>只算 2026 年</b>：2026/1/1 之後的買賣才計入，更早的歷史不列入。', en: '<b>2026 only</b>: trades from Jan 1 2026 onward are counted; earlier history is excluded.' },
    'intro.dogs': { zh: '<b>大金狗</b>：≥ 100x 且最高市值 ≥ $10M；<b>小金狗</b>：≥ 10x 且 ≥ $1M。', en: '<b>Big winner</b>: ≥ 100x and peak market cap ≥ $10M. <b>Small winner</b>: ≥ 10x and ≥ $1M.' },
    'intro.privacy': { zh: '自備 key 時全程在你的瀏覽器執行；用本站額度時查詢經過本站代理，查詢的地址、統計與你填的暱稱會被保存（排行榜上只顯示地址）。圖片僅在本機處理。', en: 'With your own keys everything runs in your browser. Using the site quota, queries go through our proxy, and the address, stats and any nickname you enter are saved (the leaderboard shows addresses only). Images never leave your device.' },
    'donate.label': { zh: '☕ 請 DEV 喝杯咖啡', en: '☕ Buy the dev a coffee' },
    'donate.copy': { zh: '點擊複製地址', en: 'Click to copy address' },
    'donate.note': { zh: 'SOL · 這個工具免費、無廣告，靠自費的 API 額度在跑', en: 'SOL · Free, no ads — running on API quota paid out of pocket' },
    'donate.copied': { zh: '已複製 ✓', en: 'Copied ✓' },
    'foot.line': { zh: 'Helius · Solana Tracker · DexScreener · GeckoTerminal · Birdeye　—　這不是投資建議，只是一份帳單。', en: 'Helius · Solana Tracker · DexScreener · GeckoTerminal · Birdeye　—　Not investment advice, just the bill.' },
    'key.helius': { zh: '交易紀錄', en: 'transactions' },
    'key.heliusHint': { zh: '免費申請 → <a href="https://dashboard.helius.dev" target="_blank" rel="noopener">dashboard.helius.dev</a>。負責交易紀錄，覆蓋最完整。', en: 'Free key → <a href="https://dashboard.helius.dev" target="_blank" rel="noopener">dashboard.helius.dev</a>. Powers transaction history — the most complete source.' },
    'key.heliusPh': { zh: 'Helius API key，或整條 https://mainnet.helius-rpc.com/?api-key=…', en: 'Helius API key, or the full https://mainnet.helius-rpc.com/?api-key=… URL' },
    'key.st': { zh: '最高價', en: 'peak price' },
    'key.stHint': { zh: '免費申請 → <a href="https://www.solanatracker.io/data-api" target="_blank" rel="noopener">solanatracker.io/data-api</a>。負責最高價，最快最準。', en: 'Free key → <a href="https://www.solanatracker.io/data-api" target="_blank" rel="noopener">solanatracker.io/data-api</a>. Powers peak prices — fastest and most accurate.' },
    'key.stPh': { zh: '貼上你的 Solana Tracker API key', en: 'Paste your Solana Tracker API key' },
    'key.beHint': { zh: '免費申請 → <a href="https://bds.birdeye.so" target="_blank" rel="noopener">bds.birdeye.so</a>（Security 分頁產生 key）。最高價備援。', en: 'Free key → <a href="https://bds.birdeye.so" target="_blank" rel="noopener">bds.birdeye.so</a> (generate under Security). Backup for peak prices.' },
    'key.bePh': { zh: '留空即可，不影響使用', en: 'Leave blank — not required' },
    'adv.settings': { zh: '進階設定', en: 'Advanced settings' },
    'adv.dust': { zh: '過濾空投與塵埃', en: 'Filters airdrops and dust' },
    'adv.cache': { zh: '使用本機快取（K 線資料）', en: 'Use local cache (price candles)' },
    'sum.verdictBig1': { zh: '你買過 {n} 隻幣，如果每一隻都賣在最高點<br>你會有 <em>{ideal}</em>。', en: 'You bought {n} token. Sell it at its peak<br>and you would have <em>{ideal}</em>.' },
    'cav.title': { zh: '資料說明', en: 'Data notes' },
  };

  const LANGS = ['zh', 'en'];
  let lang = 'zh';
  try {
    const saved = localStorage.getItem('fomo:lang');
    if (saved && LANGS.indexOf(saved) >= 0) lang = saved;
    else if (typeof navigator !== 'undefined' && navigator.language
      && !/^zh/i.test(navigator.language)) lang = 'en';
  } catch (e) {}

  function t(key, vars) {
    const row = DICT[key];
    let s = row ? (row[lang] != null ? row[lang] : row.zh) : key;
    if (vars) {
      s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : ''));
    }
    return s;
  }

  const listeners = [];

  function apply(root) {
    const scope = root || (typeof document !== 'undefined' ? document : null);
    if (!scope || !scope.querySelectorAll) return;
    scope.querySelectorAll('[data-i18n]').forEach((el) => {
      el.innerHTML = t(el.getAttribute('data-i18n'));
    });
    scope.querySelectorAll('[data-i18n-ph]').forEach((el) => {
      el.setAttribute('placeholder', t(el.getAttribute('data-i18n-ph')));
    });
    scope.querySelectorAll('[data-i18n-title]').forEach((el) => {
      el.setAttribute('title', t(el.getAttribute('data-i18n-title')));
    });
    if (typeof document !== 'undefined' && document.documentElement) {
      document.documentElement.setAttribute('lang', lang === 'en' ? 'en' : 'zh-Hant');
    }
  }

  function set(next) {
    if (LANGS.indexOf(next) < 0 || next === lang) return;
    lang = next;
    try { localStorage.setItem('fomo:lang', lang); } catch (e) {}
    apply();
    listeners.forEach((fn) => { try { fn(lang); } catch (e) {} });
  }

  const I18N = {
    t: t,
    apply: apply,
    set: set,
    onChange: (fn) => { listeners.push(fn); },
    get lang() { return lang; },
    other: () => (lang === 'zh' ? 'en' : 'zh'),
    _dict: DICT,
  };

  if (typeof window !== 'undefined') {
    window.I18N = I18N;
    window.t = t;
  }
  if (typeof globalThis !== 'undefined') {
    globalThis.I18N = I18N;
    globalThis.t = t;
  }
})();

/* ISHTC — I Should Hold The Coin
 * Solana wallet MFE / FOMO report
 * 純前端。Helius(BYOK) 抓交易、DexScreener 抓池子與現價、GeckoTerminal 抓歷史 K 線。
 */
'use strict';

// ---------- 常數 ----------
const WSOL  = 'So11111111111111111111111111111111111111112';
const USDC  = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDT  = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
// 這些不算 memecoin，從報告排除。
// 穩定幣特別重要：它們的價格常有離譜的錯誤報價（USD1 就出現過 $999 的假高點），
// 不排掉會被算成幾百倍的假金狗。
const EXCLUDE = new Set([
  WSOL, USDC, USDT,
  'USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB',  // USD1 (World Liberty Financial)
  'JuprjznTrTSp2UFa3ZBUFgwdAmtZCq4MQCwysN55USD',  // JupUSD
  '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo', // PYUSD
  'USDSwr9ApdHk5bvJKMjzff41FfuX8bSxdKcR81vTwcA',  // USDS
  '9zNQRsGLjNKwCUU5Gq5LR8beUCPzQMVMqKAi3SSZh54u', // FDUSD
  'DEkqHyPN7GMRJ5cArtQFAWefqbZb33Hyf6s5iCwjEonT', // USDe
  '2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH', // USDG
  'HzwqbKZw8HxMN6bF2yFZNrht3c2iXXzpKcFu7uBEDKtr', // EURC
  'A1KLoBrKBde8Ty9qtNQUtq3C2ortoC3u7twggz7sEto6', // USDY
  'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So',  // mSOL
  'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn', // jitoSOL
  'bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1',  // bSOL
  '7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj', // stSOL
  'jupSoLaHXQiZZTSfEWMTRRgpnyFm8f6sZdosWBjx93v',  // jupSOL
]);
// ---------- 代理模式 ----------
// 站長部署 worker/ 之後把網址填進 DEFAULT_PROXY，訪客就不用自備 API key。
// 留空 = 純 BYOK 模式（現在的行為）。也可用 localStorage 的 fomo:proxy 覆寫（測試用）。
const DEFAULT_PROXY = 'https://ishtc-proxy.ishouldholdthecoin.workers.dev';

/** 狗房模組（dogs.js）。測試環境沒有 window，一律經過這個取用 */
function dogRoom() {
  try { return (typeof window !== 'undefined' && window.DogRoom) || null; }
  catch (e) { return null; }
}
// localStorage 的 fomo:proxy 可覆寫；設成 'off' 可強制關閉代理（站長測 BYOK 模式用）
const PROXY_URL = (function () {
  try {
    const v = (localStorage.getItem('fomo:proxy') || '').trim();
    if (v === 'off') return '';
    return v || DEFAULT_PROXY;
  } catch (e) { return DEFAULT_PROXY; }
})().replace(/\/+$/, '');

const GT = 'https://api.geckoterminal.com/api/v2';
const DS = 'https://api.dexscreener.com';
const BE = 'https://public-api.birdeye.so';
const ST = 'https://data.solanatracker.io';
const DEAD_LIQ = 1000;   // 流動性低於這個數字視為這隻幣已經沒人玩了
const CACHE_PREFIX = 'fomo:gt:';
const CACHE_TTL = 6 * 3600 * 1000;
const CACHE_MAX = 500;

// ---------- 小工具 ----------
const $ = (s) => document.querySelector(s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

function fmtUSD(n) {
  if (!isFinite(n)) return '—';
  const s = n < 0 ? '-' : '';
  const a = Math.abs(n);
  if (a >= 1e9) return s + '$' + (a / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return s + '$' + (a / 1e6).toFixed(2) + 'M';
  if (a >= 1e3) return s + '$' + (a / 1e3).toFixed(1) + 'K';
  if (a >= 1)   return s + '$' + a.toFixed(2);
  if (a === 0)  return '$0';
  return s + '$' + a.toFixed(4);
}

function fmtPrice(p) {
  if (!isFinite(p) || p <= 0) return '—';
  if (p >= 1) return '$' + p.toFixed(4);
  const exp = Math.floor(Math.log10(p));
  if (exp >= -4) return '$' + p.toFixed(Math.min(8, -exp + 3));
  const zeros = -exp - 1;
  const digits = Math.round(p * Math.pow(10, zeros + 4));
  return '$0.0(' + zeros + ')' + digits;
}

function fmtX(x) {
  if (!isFinite(x)) return '—';
  if (x >= 100) return Math.round(x) + 'x';
  if (x >= 10) return x.toFixed(1) + 'x';
  return x.toFixed(2) + 'x';
}

function fmtPct(x) { return (isFinite(x) ? (x * 100).toFixed(1) : '—') + '%'; }

/** n 隻幣要多久。速率取決於走 Birdeye(50/min) 還是 GeckoTerminal(25/min) */
function etaText(n, perMin) {
  const secs = Math.round((n * 60) / (perMin || 25));
  if (secs >= 3600) return '約 ' + (secs / 3600).toFixed(1) + ' 小時';
  if (secs >= 60) return '約 ' + Math.ceil(secs / 60) + ' 分';
  return '約 ' + secs + ' 秒';
}
function shortAddr(a) { return a.slice(0, 4) + '…' + a.slice(-4); }
function isSolAddress(s) { return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s); }

/** 允許直接貼整條 Helius endpoint URL，自動把 api-key 拆出來 */
function normalizeKey(raw) {
  const s = String(raw || '').trim().replace(/^["']|["']$/g, '');
  const m = s.match(/api[-_]?key=([0-9a-fA-F-]{20,})/);
  if (m) return m[1];
  const uuid = s.match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/);
  if (uuid) return uuid[0];
  return s;
}

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- 速率限制器 ----------
class Limiter {
  constructor(perMin) { this.gap = 60000 / perMin; this.next = 0; }
  async take() {
    const now = Date.now();
    const at = Math.max(now, this.next);
    this.next = at + this.gap;
    if (at > now) await sleep(at - now);
  }
}
const gtLimit = new Limiter(25);   // GeckoTerminal 無 key 上限 30/min，留餘裕
const dsLimit = new Limiter(240);  // DexScreener token 端點 300/min
const beLimit = new Limiter(50);   // Birdeye 免費方案 1 rps，留餘裕
const stLimit = new Limiter(150);  // Solana Tracker 免費方案 3 rps，留餘裕

let abortFlag = false;
let birdeyeKey = '';   // 選填。有填就用 Birdeye 抓最高價，涵蓋範圍與速度都比較好
let stKey = '';        // 選填。Solana Tracker，直接回傳區間最高價與當下市值，最快也最準
let beQuota = null;    // Birdeye 回傳的剩餘額度，從 response header 讀來的

function quotaText() {
  if (!beQuota || !isFinite(beQuota.remaining)) return '';
  return '　Birdeye 剩 ' + beQuota.remaining.toLocaleString()
    + (isFinite(beQuota.limit) ? ' / ' + beQuota.limit.toLocaleString() : '');
}

async function getJSON(url, opts) {
  const { limiter, tries = 3, headers } = opts || {};
  const host = new URL(url).host;
  let sawRateLimit = false;
  for (let i = 0; i < tries; i++) {
    if (abortFlag) throw new Error('__ABORT__');
    if (limiter) await limiter.take();
    let res;
    try {
      res = await fetch(url, { headers: Object.assign({ Accept: 'application/json' }, headers) });
    } catch (e) {
      if (i === tries - 1) throw new Error('網路錯誤，連不到 ' + host);
      await sleep(800 * (i + 1));
      continue;
    }
    // Birdeye 會把額度資訊放在 header 且允許跨網域讀取，順手記下來給進度列顯示
    if (host.indexOf('birdeye') >= 0) {
      const rem = res.headers.get('x-ratelimit-remaining');
      const lim = res.headers.get('x-ratelimit-limit');
      if (rem !== null) beQuota = { remaining: Number(rem), limit: lim === null ? NaN : Number(lim) };
    }
    if (res.status === 429) {
      // 代理的額度守門：不是暫時限流，是這個月共用額度用完了，重試沒有意義
      if (res.headers.get('x-cooldown')) {
        const err = new Error('查詢用量過大，暫時冷卻中');
        err.cooldown = true;
        throw err;
      }
      sawRateLimit = true; await sleep(4000 * (i + 1)); continue;
    }
    if (res.status === 404) return null;
    if (!res.ok) {
      // 5xx 是對方伺服器暫時出問題，值得等久一點再試；4xx 再試也沒用
      const transient = res.status >= 500;
      if (i === tries - 1) {
        const err = new Error(transient
          ? host + ' 暫時出問題（HTTP ' + res.status + '），重試 ' + tries + ' 次都沒過'
          : host + ' 回應 HTTP ' + res.status);
        err.status = res.status;
        throw err;
      }
      await sleep((transient ? 2500 : 700) * (i + 1));
      continue;
    }
    return res.json();
  }
  // 重試次數用完了。是被限流還是單純沒資料，錯誤訊息要說得清楚
  if (sawRateLimit) {
    const err = new Error(host + ' 暫時限流中，請稍後再試。');
    err.status = 429;
    throw err;
  }
  return null;
}

// ---------- 本機快取 ----------
const cacheOn = () => $('#use-cache').checked;

function cacheGet(key) {
  if (!cacheOn()) return null;
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (Date.now() - o.t > CACHE_TTL) return null;
    return o.v;
  } catch (e) { return null; }
}

function cacheSet(key, v) {
  if (!cacheOn()) return;
  try {
    const keys = Object.keys(localStorage).filter((k) => k.startsWith(CACHE_PREFIX));
    if (keys.length > CACHE_MAX) {
      keys.slice(0, keys.length - CACHE_MAX + 50).forEach((k) => localStorage.removeItem(k));
    }
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ t: Date.now(), v }));
  } catch (e) { /* quota 滿了就算了 */ }
}

// ---------- 1. Helius：抓交易 ----------
async function fetchWalletTxs(address, key, maxTx, onTick) {
  const out = [];
  let before = '';
  while (out.length < maxTx) {
    if (abortFlag) throw new Error('__ABORT__');
    const url = key
      ? 'https://api.helius.xyz/v0/addresses/' + address + '/transactions'
        + '?api-key=' + encodeURIComponent(key) + '&limit=100'
        + (before ? '&before=' + before : '')
      : PROXY_URL + '/helius/txs?address=' + address + (before ? '&before=' + before : '');
    let batch;
    try {
      batch = await getJSON(url, { tries: 5 });
    } catch (e) {
      if (e.message === '__ABORT__') throw e;
      if (e.status === 401) throw new Error('Helius API key 無效或已停用。');
      if (e.status === 429) throw new Error('Helius 額度用完或被限流，稍後再試。');
      // 翻到一半掛掉：已經抓到的先留著
      if (out.length) { out.partial = true; break; }
      throw e;
    }
    // 只有回傳空陣列才代表到底了。
    // Helius 是掃一個簽章視窗再回傳解析得出來的那些，某一頁不足 100 筆
    // 不代表沒有更舊的交易 —— 早期在這裡 break 會把後面的歷史整段丟掉。
    if (!Array.isArray(batch) || batch.length === 0) break;
    out.push.apply(out, batch);
    const next = batch[batch.length - 1].signature;
    if (next === before) break;   // 游標沒前進，避免無限迴圈
    before = next;
    onTick(out.length);
  }
  return out;
}

// ---------- 1b. Solana Tracker：抓成交紀錄 ----------
// 比 Helius 那條路好在每筆成交本身就附了美元價格，
// 不用從 SOL 差額推算、也不用查當日 SOL 匯率。

async function fetchWalletTradesST(address, maxTx, onTick) {
  const out = [];
  let cursor = '';
  let partial = false;   // 中途被伺服器打斷，資料不完整
  while (out.length < maxTx) {
    if (abortFlag) throw new Error('__ABORT__');
    const url = ST + '/wallet/' + address + '/trades'
      + (cursor ? '?cursor=' + encodeURIComponent(cursor) : '');
    let j;
    try {
      j = await getJSON(url, { limiter: stLimit, tries: 5, headers: { 'x-api-key': stKey } });
    } catch (e) {
      if (e.message === '__ABORT__') throw e;
      if (e.status === 401) throw new Error('Solana Tracker API key 無效或已停用。');
      // 翻到一半掛掉：已經抓到的先留著，整份丟掉更糟
      if (out.length) { partial = true; break; }
      throw e;
    }
    const batch = (j && j.trades) || [];
    if (!batch.length) break;
    out.push.apply(out, batch);
    onTick(out.length);
    if (!j.hasNextPage || j.nextCursor === undefined || j.nextCursor === null) break;
    const next = String(j.nextCursor);
    if (next === cursor) break;   // 游標沒前進
    cursor = next;
  }
  if (partial) out.partial = true;
  return out;
}

/**
 * 把 Solana Tracker 的成交紀錄整理成跟 buildPositions 一樣的部位表。
 * 判定規則：換出去的是報價幣就是買，換進來的是報價幣就是賣，
 * 幣換幣則同時算成賣掉一隻、買進另一隻。
 */
function buildPositionsFromTrades(trades, minCost) {
  const pos = new Map();
  const touched = new Set();

  const get = (mint, tok) => {
    let p = pos.get(mint);
    if (!p) {
      p = { mint: mint, boughtAmt: 0, costUSD: 0, soldAmt: 0, proceedsUSD: 0,
            netAmt: 0, firstBuyTs: 0, lastTs: 0, buys: 0, sells: 0, movedOut: 0,
            decimals: (tok && tok.decimals) || 0, symbol: (tok && tok.symbol) || '' };
      pos.set(mint, p);
    }
    // DexScreener 查不到池子的幣就靠這個名字，不然只能顯示地址
    if (!p.symbol && tok && tok.symbol) p.symbol = tok.symbol;
    return p;
  };

  const sorted = trades.slice().sort((a, b) => (a.time || 0) - (b.time || 0));
  for (const t of sorted) {
    const from = t.from || {};
    const to = t.to || {};
    const ts = Math.floor((t.time || 0) / 1000);
    const usd = Number(t.volume && t.volume.usd) || 0;
    if (!from.address || !to.address) continue;

    const fromQuote = EXCLUDE.has(from.address);
    const toQuote = EXCLUDE.has(to.address);
    if (fromQuote && toQuote) continue;          // SOL↔USDC 之類，與 memecoin 無關

    if (!toQuote) {                              // 買進 to.address
      touched.add(to.address);
      const p = get(to.address, to.token);
      const amt = Number(to.amount) || 0;
      if (amt > 0 && usd > 0) {
        p.boughtAmt += amt;
        p.costUSD += usd;
        p.netAmt += amt;
        p.buys++;
        if (!p.firstBuyTs) p.firstBuyTs = ts;
        p.lastTs = Math.max(p.lastTs, ts);
      }
    }
    if (!fromQuote) {                            // 賣出 from.address
      touched.add(from.address);
      const p = get(from.address, from.token);
      const amt = Number(from.amount) || 0;
      if (amt > 0 && usd > 0) {
        p.soldAmt += amt;
        p.proceedsUSD += usd;
        p.netAmt -= amt;
        p.sells++;
        p.lastTs = Math.max(p.lastTs, ts);
      }
    }
  }

  let neverBought = 0;
  let belowMinCost = 0;
  for (const [m, p] of Array.from(pos)) {
    if (p.boughtAmt <= 0) { neverBought++; pos.delete(m); }
    else if (p.costUSD < minCost) { belowMinCost++; pos.delete(m); }
    else p.avgBuy = p.costUSD / p.boughtAmt;
  }
  return {
    pos: pos, skippedMulti: 0, trades: sorted.length,
    touched: touched.size, lostToMulti: 0,
    neverBought: neverBought, belowMinCost: belowMinCost,
  };
}

// ---------- 2. 從交易推出買賣 ----------
function walletDeltas(tx, walletSet, decimalsOut) {
  let sol = 0;
  const tokens = new Map();
  const accs = tx.accountData || [];
  for (let i = 0; i < accs.length; i++) {
    const ad = accs[i];
    if (walletSet.has(ad.account)) sol += (ad.nativeBalanceChange || 0) / 1e9;
    const tbs = ad.tokenBalanceChanges || [];
    for (let j = 0; j < tbs.length; j++) {
      const tb = tbs[j];
      if (!walletSet.has(tb.userAccount)) continue;
      const rt = tb.rawTokenAmount || {};
      const dec = Number(rt.decimals || 0);
      const amt = Number(rt.tokenAmount || 0) / Math.pow(10, dec);
      if (!isFinite(amt) || amt === 0) continue;
      if (decimalsOut) decimalsOut.set(tb.mint, dec);
      tokens.set(tb.mint, (tokens.get(tb.mint) || 0) + amt);
    }
  }
  // wSOL 視同 SOL
  if (tokens.has(WSOL)) { sol += tokens.get(WSOL); tokens.delete(WSOL); }
  return { sol: sol, tokens: tokens };
}

/** 回傳 { pos: Map<mint, position>, skippedMulti, trades } */
function buildPositions(txs, walletSet, solPrice, minCost) {
  const pos = new Map();
  const decimals = new Map();
  const touched = new Set();   // 曾經在這個錢包出現過的所有非報價幣，含空投
  let skippedMulti = 0;
  let trades = 0;
  // 判定「這是一筆買賣」的最小金額。太小會把手續費雜訊當成交易，
  // 但也不能高過使用者設的最小成本，否則他調低了卻沒作用，還會被誤標成空投。
  const tradeFloor = Math.max(0.02, Math.min(0.2, minCost));

  const sorted = txs.slice().sort((a, b) => a.timestamp - b.timestamp);
  for (const tx of sorted) {
    if (tx.transactionError) continue;
    const d = walletDeltas(tx, walletSet, decimals);
    const tokens = d.tokens;

    let quoteUSD = d.sol * solPrice(tx.timestamp);
    for (const st of [USDC, USDT]) {
      if (tokens.has(st)) { quoteUSD += tokens.get(st); tokens.delete(st); }
    }

    const subject = [];
    for (const [m, delta] of tokens) {
      if (!EXCLUDE.has(m) && Math.abs(delta) > 0) { subject.push([m, delta]); touched.add(m); }
    }
    if (subject.length === 0) continue;
    if (subject.length > 1) {
      // 同筆牽涉多隻幣（聚合器或空投混雜）— 只取變動量最大的那隻
      subject.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
      skippedMulti++;
    }
    const mint = subject[0][0];
    const delta = subject[0][1];

    let p = pos.get(mint);
    if (!p) {
      p = {
        mint: mint, boughtAmt: 0, costUSD: 0, soldAmt: 0, proceedsUSD: 0,
        netAmt: 0, firstBuyTs: 0, lastTs: 0, buys: 0, sells: 0, movedOut: 0,
      };
      pos.set(mint, p);
    }
    p.netAmt += delta;
    p.lastTs = tx.timestamp;

    if (delta > 0 && quoteUSD < -tradeFloor) {   // 買
      p.boughtAmt += delta;
      p.costUSD += -quoteUSD;
      p.buys++;
      if (!p.firstBuyTs) p.firstBuyTs = tx.timestamp;
      trades++;
    } else if (delta < 0 && quoteUSD > tradeFloor) {  // 賣
      p.soldAmt += -delta;
      p.proceedsUSD += quoteUSD;
      p.sells++;
      trades++;
    } else if (delta < 0) {                      // 轉出，不是賣
      p.movedOut += -delta;
    }
  }

  // 記錄每一關各刷掉多少，報告要能回答「為什麼只找到這幾隻」
  const enteredPos = pos.size;
  let neverBought = 0;
  let belowMinCost = 0;
  for (const [m, p] of Array.from(pos)) {
    p.decimals = decimals.get(m) || 0;
    if (p.boughtAmt <= 0) { neverBought++; pos.delete(m); }
    else if (p.costUSD < minCost) { belowMinCost++; pos.delete(m); }
    else p.avgBuy = p.costUSD / p.boughtAmt;
  }
  return {
    pos: pos, skippedMulti: skippedMulti, trades: trades,
    touched: touched.size,                      // 碰過的幣總數
    lostToMulti: touched.size - enteredPos,     // 同筆多幣時被讓位掉的
    neverBought: neverBought,                   // 只收到沒買過（空投、轉入）
    belowMinCost: belowMinCost,                 // 買過但成本低於門檻
  };
}

// ---------- 3. SOL 歷史價 ----------
// 這段踩過兩個坑，都寫在這裡免得再犯：
//   1. GeckoTerminal 日線一次只回 ~181 根，limit 給多少都一樣。
//   2. 它的 before_timestamp（往前翻頁）需要付費金鑰，免費打會回 401。
// 所以改用交易所的公開 K 線當主來源，兩家都免金鑰且允許跨網域讀取。
const BINANCE = 'https://api.binance.com/api/v3/klines';
const COINBASE = 'https://api.exchange.coinbase.com/products/SOL-USD/candles';

/** Binance：一次 1000 根日線，用 startTime 往後接。涵蓋最廣，但少數地區會被擋。 */
async function fetchSolBinance(sinceTs) {
  const out = [];
  // Binance 只回 openTime >= startTime 的完整 K 棒，直接用 sinceTs 會少掉起點那天。
  // 往前多要兩天當緩衝，確保涵蓋得到第一次買入。
  let startMs = Math.max(0, sinceTs - 2 * 86400) * 1000;
  for (let page = 0; page < 6; page++) {
    const j = await getJSON(BINANCE + '?symbol=SOLUSDT&interval=1d&limit=1000&startTime=' + startMs);
    if (!Array.isArray(j) || !j.length) break;
    for (const k of j) out.push([Math.floor(k[0] / 1000), Number(k[4])]);
    const lastMs = j[j.length - 1][0];
    if (j.length < 1000 || lastMs <= startMs) break;
    startMs = lastMs + 1;
  }
  return out;
}

/** Coinbase：一次 300 根，Binance 被擋時的備援 */
async function fetchSolCoinbase(sinceTs) {
  const out = [];
  let end = Math.floor(Date.now() / 1000);
  for (let page = 0; page < 12; page++) {
    // 多往回要一天：end 每頁減 1 秒會累積偏移，剛好卡在差一天到不了目標
    const start = Math.max(sinceTs - 86400, end - 300 * 86400);
    const j = await getJSON(COINBASE + '?granularity=86400'
      + '&start=' + new Date(start * 1000).toISOString()
      + '&end=' + new Date(end * 1000).toISOString());
    if (!Array.isArray(j) || !j.length) break;
    for (const c of j) out.push([c[0], Number(c[4])]);   // [time,low,high,open,close,volume]
    let oldest = j[0][0];
    for (const c of j) if (c[0] < oldest) oldest = c[0];
    if (oldest <= sinceTs || oldest >= end) break;
    end = oldest - 1;
  }
  return out;
}

/** GeckoTerminal：最後手段，只拿得到約 181 天 */
async function fetchSolGecko(sinceTs) {
  const pairs = await getJSON(DS + '/token-pairs/v1/solana/' + WSOL, { limiter: dsLimit });
  const usable = (pairs || []).filter((p) => p.quoteToken
    && (p.quoteToken.address === USDC || p.quoteToken.address === USDT)
    && (p.liquidity && p.liquidity.usd > 200000));
  const oldEnough = usable.filter((p) => p.pairCreatedAt && p.pairCreatedAt / 1000 <= sinceTs);
  const pool = (oldEnough.length ? oldEnough : usable)
    .sort((a, b) => (b.liquidity.usd || 0) - (a.liquidity.usd || 0))[0];
  if (!pool) return [];
  const j = await getJSON(GT + '/networks/solana/pools/' + pool.pairAddress
    + '/ohlcv/day?aggregate=1&limit=1000&currency=usd', { limiter: gtLimit });
  const raw = (j && j.data && j.data.attributes && j.data.attributes.ohlcv_list) || [];
  return raw.map((c) => [c[0], c[4]]);
}

const SOL_SOURCES = [
  { name: 'Binance', get: fetchSolBinance },
  { name: 'Coinbase', get: fetchSolCoinbase },
  { name: 'GeckoTerminal', get: fetchSolGecko },
];

async function buildSolPrice(sinceTs, onStatus) {
  const need = sinceTs || (Math.floor(Date.now() / 1000) - 400 * 86400);
  const cacheKey = 'solprice2:' + Math.floor(need / 86400);
  let hit = cacheGet(cacheKey);
  let list = hit && hit.list;
  let source = hit && hit.source;

  if (!list) {
    for (const src of SOL_SOURCES) {
      try {
        if (onStatus) onStatus('抓 SOL 歷史價（' + src.name + '）…');
        const raw = await src.get(need);
        if (!raw.length) continue;
        const byTs = new Map();
        for (const c of raw) if (isFinite(c[1]) && c[1] > 0) byTs.set(c[0], c[1]);
        const sorted = Array.from(byTs.entries()).sort((a, b) => a[0] - b[0]);
        if (!sorted.length) continue;
        list = sorted;
        source = src.name;
        break;
      } catch (e) {
        if (e.message === '__ABORT__') throw e;
        // 這家不行就換下一家
      }
    }
    if (list) cacheSet(cacheKey, { list: list, source: source });
  }
  if (!list || !list.length) {
    throw new Error('三個來源都抓不到 SOL 歷史價（Binance / Coinbase / GeckoTerminal），稍後再試。');
  }

  const ts = list.map((c) => c[0]);
  const startTs = ts[0];
  const solPrice = function (t) {
    if (t <= startTs) return list[0][1];
    if (t >= ts[ts.length - 1]) return list[list.length - 1][1];
    let lo = 0, hi = ts.length - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (ts[mid] <= t) lo = mid; else hi = mid;
    }
    return list[lo][1];
  };
  // 比 startTs 更早的成本是用起點價估的，呼叫端要能知道並提醒使用者
  solPrice.startTs = startTs;
  solPrice.days = list.length;
  solPrice.source = source;
  return solPrice;
}

// ---------- 4. 池子與現價 ----------
async function fetchPools(mints, onTick) {
  const info = new Map();
  for (let i = 0; i < mints.length; i += 30) {
    if (abortFlag) throw new Error('__ABORT__');
    const chunk = mints.slice(i, i + 30);
    const pairs = await getJSON(DS + '/tokens/v1/solana/' + chunk.join(','), { limiter: dsLimit });
    for (const p of pairs || []) {
      const mint = p.baseToken && p.baseToken.address;
      if (!mint || chunk.indexOf(mint) === -1) continue;
      const liq = (p.liquidity && p.liquidity.usd) || 0;
      const prev = info.get(mint);
      if (!prev || liq > prev.liq) {
        info.set(mint, {
          pool: p.pairAddress,
          liq: liq,
          symbol: p.baseToken.symbol || '???',
          name: p.baseToken.name || '',
          price: Number(p.priceUsd) || 0,
          mcap: Number(p.marketCap || p.fdv) || 0,
          createdAt: p.pairCreatedAt ? Math.floor(p.pairCreatedAt / 1000) : 0,
        });
      }
    }
    onTick(Math.min(i + 30, mints.length), mints.length);
  }
  return info;
}

// ---------- 5. MFE：買入後最高價 ----------
function pickGranularity(ageDays) {
  if (ageDays <= 40) return { tf: 'hour', agg: 1 };   // 1000 根 ≈ 41 天
  if (ageDays <= 160) return { tf: 'hour', agg: 4 };  // ≈ 166 天
  return { tf: 'day', agg: 1 };                       // ≈ 2.7 年
}

/**
 * Solana Tracker：直接問「這段時間內的最高價」，不用自己撈 K 線再取 max。
 * 回傳還附上最高點當下的市值，比用 fdv ÷ 現價 反推流通量準得多。
 */
async function fetchPeakSolanaTracker(mint, sinceTs) {
  const now = Math.floor(Date.now() / 1000);
  const key = 'st:' + mint + ':' + Math.floor(sinceTs / 3600);
  let hit = cacheGet(key);
  if (!hit) {
    const j = stKey
      ? await getJSON(ST + '/price/history/range?token=' + mint
          + '&time_from=' + Math.floor(sinceTs) + '&time_to=' + now,
          { limiter: stLimit, headers: { 'x-api-key': stKey } })
      : await getJSON(PROXY_URL + '/st/range?token=' + mint
          + '&time_from=' + Math.floor(sinceTs) + '&time_to=' + now,
          { limiter: stLimit });
    const h = j && j.price && j.price.highest;
    if (!h || !(h.price > 0)) return null;
    hit = [h.price, h.time || 0, h.marketcap || 0];
    cacheSet(key, hit);
  }
  return {
    peak: hit[0], peakTs: hit[1], peakMcap: hit[2] || NaN,
    partial: false, src: 'solanatracker',
  };
}

/** Birdeye 是「按代幣地址」查，涵蓋所有池子，含 pump.fun bonding curve 那段 */
const BE_TF = { 'hour:1': '1H', 'hour:4': '4H', 'day:1': '1D' };

async function fetchPeakBirdeye(mint, sinceTs) {
  const ageDays = (Date.now() / 1000 - sinceTs) / 86400;
  const gran = pickGranularity(ageDays);
  const tf = BE_TF[gran.tf + ':' + gran.agg] || '1D';
  const key = 'be:' + mint + ':' + tf + ':' + Math.floor(sinceTs / 86400);
  let list = cacheGet(key);
  if (!list) {
    const now = Math.floor(Date.now() / 1000);
    const j = await getJSON(BE + '/defi/ohlcv?address=' + mint + '&type=' + tf
      + '&time_from=' + Math.floor(sinceTs) + '&time_to=' + now,
      { limiter: beLimit, headers: { 'X-API-KEY': birdeyeKey, 'x-chain': 'solana' } });
    const items = (j && j.data && j.data.items) || [];
    list = items.map((c) => [c.unixTime, c.h]);
    if (list.length) cacheSet(key, list);
  }
  if (!list.length) return null;
  let best = 0, bestTs = 0;
  for (const c of list) if (c[1] > best) { best = c[1]; bestTs = c[0]; }
  if (best <= 0) return null;
  // 是按 time_from 切的，所以涵蓋範圍必然從第一次買入開始
  return { peak: best, peakTs: bestTs, partial: false, src: 'birdeye' };
}

async function fetchPeak(pool, sinceTs) {
  const ageDays = (Date.now() / 1000 - sinceTs) / 86400;
  const gran = pickGranularity(ageDays);
  const key = pool + ':' + gran.tf + ':' + gran.agg + ':' + Math.floor(sinceTs / 86400);
  let list = cacheGet(key);
  if (!list) {
    // 日線一次只回 ~181 根，而往前翻頁的 before_timestamp 需要付費金鑰。
    // 所以買很久的幣在這條路上一定涵蓋不足，只能靠 partial 標記誠實說明，
    // 並建議使用者填 Solana Tracker key（那條路沒有這個限制）。
    const j = await getJSON(GT + '/networks/solana/pools/' + pool + '/ohlcv/' + gran.tf
      + '?aggregate=' + gran.agg + '&limit=1000&currency=usd', { limiter: gtLimit });
    const raw = (j && j.data && j.data.attributes && j.data.attributes.ohlcv_list) || [];
    list = raw.map((c) => [c[0], c[2]]); // [ts, high]
    if (list.length) cacheSet(key, list);
  }
  if (!list.length) return null;

  const bucket = (gran.tf === 'hour' ? 3600 : 86400) * gran.agg;
  let best = 0, bestTs = 0, covered = false;
  for (const c of list) {
    if (c[0] + bucket < sinceTs) continue;
    covered = true;
    if (c[1] > best) { best = c[1]; bestTs = c[0]; }
  }
  if (best <= 0) return null;
  let oldest = Infinity;
  for (const c of list) if (c[0] < oldest) oldest = c[0];
  return { peak: best, peakTs: bestTs, partial: !covered || oldest > sinceTs + bucket, src: 'gecko' };
}

/** 有 Birdeye key 就優先用它，失敗再退回 GeckoTerminal */
async function fetchPeakBest(mint, pool, sinceTs) {
  if (stKey || PROXY_URL) {
    try {
      const r = await fetchPeakSolanaTracker(mint, sinceTs);
      if (r) return r;
    } catch (e) {
      if (e.message === '__ABORT__') throw e;
      if (e.status === 401) throw new Error('Solana Tracker API key 無效。清空該欄位就會改用其他來源。');
      // 額度用完或查不到就往下一個來源退
    }
  }
  if (birdeyeKey) {
    try {
      const r = await fetchPeakBirdeye(mint, sinceTs);
      if (r) return r;
    } catch (e) {
      if (e.message === '__ABORT__') throw e;
      if (e.status === 401) throw new Error('Birdeye API key 無效。清空該欄位就會改用免金鑰的 GeckoTerminal。');
      // 其他錯誤（額度用完、單一代幣查不到）就靜靜退回 GeckoTerminal
    }
  }
  return fetchPeak(pool, sinceTs);
}

// ---------- 6. 統計 ----------
const TIERS = [2, 5, 10, 50, 100];

// 金狗品味：只有「漲幅夠大」且「市值真的做起來」才算數。
// 光是 100x 但市值只到 20 萬，那是插針，不是金狗。
const BIG_DOG   = { x: 100, mcap: 10e6 };
const SMALL_DOG = { x: 10,  mcap: 1e6 };

/** 買入後曾經到過的最高市值。供給量由 fdv ÷ 現價 反推，假設供給量不變。 */
function peakMcapOf(r) {
  if (!(r.mcap > 0) || !(r.price > 0) || !(r.peak > 0)) return NaN;
  return (r.mcap / r.price) * r.peak;
}
/**
 * 用「最高點市值」回推「最高點價格」，跟資料源回報的最高價對照。
 * 兩個數字來自同一時刻，差到 10 倍以上就代表其中一個是錯誤報價 ——
 * 穩定幣特別容易出現這種假插針（USD1 就報過 $999，實際只值 $1）。
 * 市值序列比單筆成交價穩定，所以以市值推回來的為準。
 */
const PEAK_SANITY_RATIO = 10;
function sanePeak(reportedPeak, peakMcap, currentPrice, currentMcap) {
  if (!(reportedPeak > 0) || !(peakMcap > 0) || !(currentPrice > 0) || !(currentMcap > 0)) return null;
  const implied = (peakMcap * currentPrice) / currentMcap;
  if (!(implied > 0)) return null;
  if (reportedPeak > implied * PEAK_SANITY_RATIO) return implied;
  return null;
}

function isBigDog(r) { return r.mfeX >= BIG_DOG.x && r.peakMcap >= BIG_DOG.mcap; }
function isSmallDog(r) { return r.mfeX >= SMALL_DOG.x && r.peakMcap >= SMALL_DOG.mcap; }

/** 全損：現價不到你買入均價的 5%，這筆你等於全賠光（跟幣本身死沒死無關） */
function isWipeout(r) { return r.price > 0 && r.avgBuy > 0 && r.price <= r.avgBuy * 0.05; }
/** 已死：池子流動性見底，或現價不到自己歷史最高價的 1%。這是幣的狀態，跟你買在哪無關 */
function isRugged(r) {
  if (r.liq > 0 && r.liq < DEAD_LIQ) return true;
  return r.peak > 0 && r.price > 0 && r.price <= r.peak * 0.01;
}

function summarize(rows) {
  const s = {
    n: rows.length, cost: 0, ideal: 0, actual: 0, realized: 0, holding: 0,
    missed: 0, paperhand: 0, roundtrip: 0, soldNow: 0, tiers: {}, dead: 0, rugged: 0,
    daysToPeakSum: 0, daysToPeakN: 0, worst: null,
    bigDogs: 0, smallDogs: 0, mcapUnknown: 0, topDog: null,
  };
  TIERS.forEach((t) => { s.tiers[t] = 0; });
  for (const r of rows) {
    s.cost += r.costUSD;
    s.ideal += r.idealUSD;
    s.realized += r.proceedsUSD;
    s.holding += r.holdingUSD;
    if (isFinite(r.paperhandUSD)) s.paperhand += r.paperhandUSD;
    if (isFinite(r.roundtripUSD)) s.roundtrip += r.roundtripUSD;
    if (isFinite(r.soldNowUSD)) s.soldNow += r.soldNowUSD;
    for (const t of TIERS) if (r.mfeX >= t) s.tiers[t]++;
    if (isWipeout(r)) s.dead++;
    if (isRugged(r)) s.rugged++;
    if (isFinite(r.daysToPeak)) { s.daysToPeakSum += r.daysToPeak; s.daysToPeakN++; }
    if (!s.worst || r.missedUSD > s.worst.missedUSD) s.worst = r;
    if (!isFinite(r.peakMcap)) s.mcapUnknown++;
    else {
      if (isBigDog(r)) s.bigDogs++;
      if (isSmallDog(r)) s.smallDogs++;
      if (!s.topDog || r.peakMcap > s.topDog.peakMcap) s.topDog = r;
    }
  }
  s.bigRate = s.n ? s.bigDogs / s.n : 0;
  s.smallRate = s.n ? s.smallDogs / s.n : 0;
  s.actual = s.realized + s.holding;
  s.missed = Math.max(0, s.ideal - s.actual);
  s.pnl = s.actual - s.cost;
  s.efficiency = s.ideal > 0 ? s.actual / s.ideal : 0;
  s.avgDaysToPeak = s.daysToPeakN ? s.daysToPeakSum / s.daysToPeakN : NaN;
  return s;
}

// ---------- 7. 主流程 ----------
let LAST = null;

async function run() {
  abortFlag = false;
  const addrs = Array.from(new Set(
    $('#addresses').value.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean)));
  const key = normalizeKey($('#helius-key').value);
  birdeyeKey = $('#birdeye-key').value.trim();
  stKey = $('#st-key').value.trim();
  localStorage.setItem('fomo:bekey', birdeyeKey);
  localStorage.setItem('fomo:stkey', stKey);
  const maxTokens = clamp(parseInt($('#max-tokens').value, 10) || 30000, 5, 50000);
  const minCost = Math.max(0, parseFloat($('#min-cost').value) || 0);
  const maxTx = clamp(parseInt($('#max-tx').value, 10) || 300000, 100, 1000000);

  if (!addrs.length) throw new Error('請至少輸入一個 Solana 地址。');
  const bad = addrs.filter((a) => !isSolAddress(a));
  if (bad.length) throw new Error('這些看起來不是 Solana 地址：\n' + bad.join('\n'));
  if (!stKey && !key && !PROXY_URL) {
    throw new Error('請至少填一把 API key（建議 Helius + Solana Tracker 都填）。');
  }

  localStorage.setItem('fomo:key', key);
  localStorage.setItem('fomo:addrs', addrs.join('\n'));

  const setProg = (pct, txt) => {
    $('#bar-fill').style.width = pct + '%';
    $('#bar-glow').style.width = pct + '%';
    $('#prog-text').textContent = txt;
  };

  // 7.1 交易紀錄。
  // Helius 是從錢包的原始餘額變化推出來的，任何程式搬動代幣都抓得到；
  // Solana Tracker 的成交索引只涵蓋它整合過的 DEX，
  // 走冷門路由或 launchpad（bags.fm、部分 Token-2022 代幣）的交易會整批漏掉。
  // 所以有 Helius key 就用 Helius，覆蓋率優先於價格精度。
  const useST = !key && !!stKey;
  const txsByAddr = new Map();
  const partialAddrs = [];   // 抓到一半被伺服器打斷的地址
  for (let i = 0; i < addrs.length; i++) {
    const a = addrs[i];
    const base = 2 + (i / addrs.length) * 18;
    const tick = (n) => setProg(base, '[' + (i + 1) + '/' + addrs.length + '] '
      + shortAddr(a) + ' — 已抓 ' + n + (useST ? ' 筆成交' : ' 筆交易'));
    setProg(base, '[' + (i + 1) + '/' + addrs.length + '] 抓 ' + shortAddr(a)
      + (useST ? ' 的成交紀錄…' : ' 的交易紀錄…'));
    const txs = useST
      ? await fetchWalletTradesST(a, maxTx, tick)
      : await fetchWalletTxs(a, key, maxTx, tick);
    if (txs.partial) partialAddrs.push(a);
    txsByAddr.set(a, txs);
  }
  const dedup = new Map();
  for (const txs of txsByAddr.values()) {
    for (const t of txs) dedup.set(useST ? (t.tx + ':' + t.wallet) : t.signature, t);
  }
  const allTxs = Array.from(dedup.values());
  if (!allTxs.length) throw new Error('這些地址沒有任何交易紀錄。');

  // 7.2 SOL 歷史價。Solana Tracker 的成交本身就有美元價，不需要這步
  let solPrice = null;
  if (!useST) {
    setProg(22, '抓 SOL 歷史價…');
    let earliest = Math.floor(Date.now() / 1000);
    for (const t of allTxs) if (t.timestamp && t.timestamp < earliest) earliest = t.timestamp;
    solPrice = await buildSolPrice(earliest - 86400, (m) => setProg(22, m));
  }

  // 7.3 重建部位（多地址合併計算，錢包之間互轉會自動抵銷）
  setProg(26, '重建買賣紀錄…');
  const built = useST
    ? buildPositionsFromTrades(allTxs, minCost)
    : buildPositions(allTxs, new Set(addrs), solPrice, minCost);

  // 每隻幣是哪個（些）地址買的。合併報告看不出來，但這是最常被問的一件事。
  const ownersOf = new Map();
  for (const a of addrs) {
    const one = useST
      ? buildPositionsFromTrades(txsByAddr.get(a) || [], minCost)
      : buildPositions(txsByAddr.get(a) || [], new Set([a]), solPrice, minCost);
    for (const mint of one.pos.keys()) {
      if (!ownersOf.has(mint)) ownersOf.set(mint, []);
      ownersOf.get(mint).push(a);
    }
  }
  let positions = Array.from(built.pos.values()).sort((a, b) => b.costUSD - a.costUSD);
  const totalFound = positions.length;
  const truncated = Math.max(0, totalFound - maxTokens);
  positions = positions.slice(0, maxTokens);
  if (!positions.length) {
    throw new Error('找不到符合條件的買入紀錄（最小成本 $' + minCost + '）。試著把「最小買入成本」調低。');
  }

  // 7.4 池子與現價
  setProg(30, '查池子與現價…');
  const info = await fetchPools(positions.map((p) => p.mint),
    (d, t) => setProg(30 + (d / t) * 10, '查池子與現價… ' + d + '/' + t));

  // 7.5 逐幣算 MFE
  // 只有 GeckoTerminal 需要池子位址；Solana Tracker 與 Birdeye 都是按代幣地址查。
  // 所以有 key 的時候，DexScreener 找不到池子的幣（多半已經死透）還是要算進來 ——
  // 那些正是你賠最慘的，把它們丟掉會讓分母變小、金狗率虛高。
  const canSkipPool = !!(stKey || birdeyeKey);
  const rows = [];
  const noPool = [];
  const withPool = [];
  for (const p of positions) {
    const meta = info.get(p.mint);
    if ((meta && meta.pool) || canSkipPool) withPool.push(p); else noPool.push(p.mint);
  }

  let aborted = false;
  for (let i = 0; i < withPool.length; i++) {
    if (abortFlag) { aborted = true; break; }
    const p = withPool[i];
    const meta = info.get(p.mint) || {
      pool: '', liq: 0, symbol: p.symbol || shortAddr(p.mint), name: '',
      price: 0, mcap: 0, createdAt: 0,
    };
    setProg(40 + (i / withPool.length) * 58,
      '算最高價 ' + (i + 1) + '/' + withPool.length + '（' + meta.symbol + '）… 剩 '
      + etaText(withPool.length - i, (stKey || PROXY_URL) ? 150 : birdeyeKey ? 50 : 25));

    let peak = null;
    try {
      peak = await fetchPeakBest(p.mint, meta.pool, p.firstBuyTs);
    } catch (e) {
      // 中途停止時保留已經算完的部分，不要整份丟掉
      if (e.message === '__ABORT__') { aborted = true; break; }
      if (/Birdeye API key/.test(e.message)) throw e;
    }

    let peakP = (peak && peak.peak) || Math.max(meta.price, p.avgBuy);
    // 你賣掉的價格是市場真的成交過的，最高價不可能比它低
    if (p.soldAmt > 0 && p.proceedsUSD > 0) {
      peakP = Math.max(peakP, p.proceedsUSD / p.soldAmt);
    }
    // 明顯的錯誤報價（例如穩定幣被報成 $999）在這裡擋掉
    const fixed = sanePeak(peakP, peak && peak.peakMcap, meta.price, meta.mcap);
    const peakFixed = fixed !== null;
    if (peakFixed) peakP = Math.max(fixed, p.avgBuy);
    const holdAmt = Math.max(0, p.netAmt);
    const row = Object.assign({}, p, meta, {
      peak: peakP,
      peakTs: (peak && peak.peakTs) || 0,
      partial: !!(peak && peak.partial),
      hasPeak: !!peak,
      peakSrc: (peak && peak.src) || '',
      peakFixed: peakFixed,
      addrs: ownersOf.get(p.mint) || [],
      addrLabel: (ownersOf.get(p.mint) || []).map(shortAddr).join(' '),
      mfeX: p.avgBuy > 0 ? peakP / p.avgBuy : NaN,
      idealUSD: p.boughtAmt * peakP,   // 下面會再與實際結果取大值
      holdAmt: holdAmt,
      holdingUSD: holdAmt * (meta.price || 0),
    });
    row.actualUSD = row.proceedsUSD + row.holdingUSD;
    // 「每一隻都賣在最高點」不可能比你實際拿到的還少
    row.idealUSD = Math.max(row.idealUSD, row.actualUSD);
    row.missedUSD = Math.max(0, row.idealUSD - row.actualUSD);

    // 買入與峰值的「市值」比價格好懂太多 —— 沒人在講 $0.0000169，都是講幾 K 幾 M 市值
    const supply = (meta.mcap > 0 && meta.price > 0) ? meta.mcap / meta.price : NaN;
    row.buyMcap = isFinite(supply) ? supply * p.avgBuy : NaN;

    // 錯過的錢拆成兩種痛，兩者相加剛好等於 missedUSD：
    //   賣飛   = 已賣掉的部位，賣價與最高價的落差
    //   雲霄飛車 = 還抱著的部位，最高價與現價的落差
    const sellPx = p.soldAmt > 0 ? p.proceedsUSD / p.soldAmt : 0;
    row.paperhandUSD = Math.max(0, p.soldAmt * (peakP - sellPx));
    row.roundtripUSD = Math.max(0, holdAmt * (peakP - (meta.price || 0)));
    // 你賣掉的那些，如果抱到現在值多少（有時比你賣的還低，那是安慰）
    row.soldNowUSD = p.soldAmt * (meta.price || 0);
    row.holdDays = (p.lastTs && p.firstBuyTs) ? (p.lastTs - p.firstBuyTs) / 86400 : NaN;
    row.daysToPeak = (peak && peak.peakTs) ? (peak.peakTs - p.firstBuyTs) / 86400 : NaN;
    // Solana Tracker 直接給最高點當下的市值，比反推流通量準
    row.peakMcap = (peak && peak.peakMcap > 0) ? peak.peakMcap : peakMcapOf(row);
    row.mcapExact = !!(peak && peak.peakMcap > 0);
    rows.push(row);
    if (dogRoom()) {
      dogRoom().addDog({ sym: row.symbol, mfeX: row.mfeX,
        tier: isBigDog(row) ? 'big' : isSmallDog(row) ? 'gold' : 'norm' });
    }
  }

  if (!rows.length) throw new Error('還沒算完任何一隻就停止了，沒有結果可以顯示。');

  // 7.6 各地址拆分
  const perAddr = [];
  if (addrs.length > 1) {
    const byMint = new Map(rows.map((r) => [r.mint, r]));
    for (const a of addrs) {
      const b = useST
        ? buildPositionsFromTrades(txsByAddr.get(a), minCost)
        : buildPositions(txsByAddr.get(a), new Set([a]), solPrice, minCost);
      const ar = [];
      for (const p of b.pos.values()) {
        const g = byMint.get(p.mint);
        if (!g) continue;
        const holdAmt = Math.max(0, p.netAmt);
        const r = Object.assign({}, p, {
          symbol: g.symbol, price: g.price, peak: g.peak, daysToPeak: g.daysToPeak,
          mcap: g.mcap, peakMcap: g.peakMcap,
          mfeX: p.avgBuy > 0 ? g.peak / p.avgBuy : NaN,
          idealUSD: p.boughtAmt * g.peak,
          holdingUSD: holdAmt * (g.price || 0),
        });
        r.missedUSD = Math.max(0, r.idealUSD - (r.proceedsUSD + r.holdingUSD));
        ar.push(r);
      }
      perAddr.push({ address: a, sum: summarize(ar) });
    }
  }

  setProg(100, '完成');
  // 交易記錄與 DexScreener 都查不到名字的幣，問 GeckoTerminal 補符號
  const noSym = rows.filter((r) => r.symbol === shortAddr(r.mint));
  for (let i = 0; i < Math.min(noSym.length, 90); i += 30) {
    const chunk = noSym.slice(i, i + 30);
    try {
      const j = await getJSON(GT + '/networks/solana/tokens/multi/'
        + chunk.map((r) => r.mint).join('%2C'), { limiter: gtLimit });
      for (const t of (j && j.data) || []) {
        const at = t.attributes || {};
        const row = chunk.find((r) => r.mint === at.address);
        if (row && at.symbol) { row.symbol = at.symbol; row.addrLabelSym = true; }
      }
    } catch (e) { break; }
  }

  rows.sort((a, b) => b.missedUSD - a.missedUSD);
  return {
    addrs: addrs,
    rows: rows,
    sum: summarize(rows),
    perAddr: perAddr,
    meta: {
      txCount: allTxs.length, totalFound: totalFound, truncated: truncated,
      txSrc: useST ? 'solanatracker' : 'helius',
      solSrc: solPrice ? solPrice.source : '',
      solStartTs: solPrice ? solPrice.startTs : 0,
      solStale: solPrice ? rows.filter((r) => r.firstBuyTs && r.firstBuyTs < solPrice.startTs).length : 0,
      partialAddrs: partialAddrs.slice(),
      noPool: noPool, minCost: minCost, skippedMulti: built.skippedMulti,
      noPeak: rows.filter((r) => !r.hasPeak).length,
      aborted: aborted, planned: withPool.length,
      touched: built.touched, lostToMulti: built.lostToMulti,
      neverBought: built.neverBought, belowMinCost: built.belowMinCost,
      peakFixed: rows.filter((r) => r.peakFixed).length,
      underwater: rows.filter((r) => isFinite(r.mfeX) && r.mfeX < 1).length,
      stRows: rows.filter((r) => r.peakSrc === 'solanatracker').length,
      exactMcap: rows.filter((r) => r.mcapExact).length,
      beRows: rows.filter((r) => r.peakSrc === 'birdeye').length,
      gtRows: rows.filter((r) => r.peakSrc === 'gecko').length,
      beQuotaLeft: beQuota && isFinite(beQuota.remaining) ? beQuota.remaining : 0,
    },
  };
}

// ---------- 8. 排行榜：排序 + 分頁 ----------
const PAGE_SIZE = 10;
// 排行榜只留五欄，完整數據在 CSV
const ALL_COLS = [
  { key: 'symbol',    label: '幣',          num: false },
  { key: 'addrLabel', label: '買入地址',    num: false, multi: true },
  { key: 'costUSD',   label: '成本',        num: true, fmt: fmtUSD },
  { key: 'mfeX',      label: '最高倍數',    num: true, fmt: fmtX },
  { key: 'actualUSD', label: '實際拿到',    num: true, fmt: fmtUSD },
  { key: 'missedUSD', label: '錯過總額',    num: true, fmt: fmtUSD },
];

/** 只有一個地址時「買入地址」整欄沒意義，不顯示 */
function cols() {
  const multi = LAST && LAST.addrs && LAST.addrs.length > 1;
  return ALL_COLS.filter((c) => !c.multi || multi);
}
let sortKey = 'missedUSD';
let sortDir = -1;   // -1 由大到小
let page = 0;

function sortedRows() {
  const C = cols();
  const col = C.find((c) => c.key === sortKey) || C[C.length - 2];
  const rows = LAST.rows.slice();
  rows.sort((a, b) => {
    let x = a[col.key], y = b[col.key];
    if (!col.num) {
      return String(x || '').localeCompare(String(y || '')) * sortDir;
    }
    // 沒有值的一律沉到最底，不管升冪降冪
    const nx = isFinite(x), ny = isFinite(y);
    if (!nx && !ny) return 0;
    if (!nx) return 1;
    if (!ny) return -1;
    return (x - y) * sortDir;
  });
  return rows;
}

function renderTable() {
  if (!LAST) return;
  const rows = sortedRows();
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  page = clamp(page, 0, pages - 1);
  const slice = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const C = cols();
  $('#tokens-table thead').innerHTML = '<tr>' + C.map((c) => {
    const active = c.key === sortKey;
    const arrow = active ? (sortDir === -1 ? '▼' : '▲') : '<span class="sort-idle">↕</span>';
    return '<th class="' + (c.num ? 'num ' : '') + 'sortable' + (active ? ' active' : '') + '"'
      + ' data-key="' + c.key + '" tabindex="0" role="button"'
      + ' aria-sort="' + (active ? (sortDir === -1 ? 'descending' : 'ascending') : 'none') + '">'
      + escapeHTML(c.label) + ' <span class="arrow">' + arrow + '</span></th>';
  }).join('') + '</tr>';

  $('#tokens-table tbody').innerHTML = slice.map((r) => {
    const dog = isBigDog(r) ? '<span class="badge big">大金狗</span>'
      : isSmallDog(r) ? '<span class="badge gold">小金狗</span>' : '';

    const cells = C.slice(1).map((c) => {
      const v = r[c.key];
      if (!c.num) {
        // 買入地址：多個就全部列出，一行一個
        const list = (r.addrs || []);
        return '<td class="addr-cell">' + (list.length
          ? list.map((a) => '<a class="mint" href="https://solscan.io/account/' + a
              + '" target="_blank" rel="noopener">' + shortAddr(a) + '</a>').join('<br>')
          : '—') + '</td>';
      }
      let cls = 'num';
      if (c.key === 'mfeX') cls += r.mfeX >= 2 ? ' pos' : ' neg';
      if (c.key === 'missedUSD') cls += ' neg';
      let txt = isFinite(v) ? c.fmt(v) : '—';
      if (c.key === 'mfeX' && r.partial) txt += ' *';
      return '<td class="' + cls + '">' + txt + '</td>';
    }).join('');
    return '<tr>'
      + '<td><span class="sym">' + escapeHTML(r.symbol) + '</span>' + dog + '<br>'
      + '<a class="mint" href="https://dexscreener.com/solana/' + r.mint
      + '" target="_blank" rel="noopener">' + shortAddr(r.mint) + '</a></td>'
      + cells + '</tr>';
  }).join('');

  const from = rows.length ? page * PAGE_SIZE + 1 : 0;
  $('#pager').innerHTML =
    '<button class="pg" data-go="0"' + (page === 0 ? ' disabled' : '') + '>«</button>'
    + '<button class="pg" data-go="' + (page - 1) + '"' + (page === 0 ? ' disabled' : '') + '>‹</button>'
    + '<span class="pg-info">' + from + '–' + Math.min(rows.length, (page + 1) * PAGE_SIZE)
    + ' / ' + rows.length + '　第 ' + (page + 1) + ' / ' + pages + ' 頁</span>'
    + '<button class="pg" data-go="' + (page + 1) + '"' + (page >= pages - 1 ? ' disabled' : '') + '>›</button>'
    + '<button class="pg" data-go="' + (pages - 1) + '"' + (page >= pages - 1 ? ' disabled' : '') + '>»</button>';
}

function onSortClick(th) {
  const key = th.getAttribute('data-key');
  if (!key) return;
  if (key === sortKey) sortDir = -sortDir;
  else { sortKey = key; sortDir = key === 'symbol' ? 1 : -1; }
  page = 0;
  renderTable();
}

$('#tokens-table thead').addEventListener('click', (e) => {
  const th = e.target.closest('th.sortable');
  if (th) onSortClick(th);
});
$('#tokens-table thead').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const th = e.target.closest('th.sortable');
  if (th) { e.preventDefault(); onSortClick(th); }
});
$('#pager').addEventListener('click', (e) => {
  const b = e.target.closest('button.pg');
  if (!b || b.disabled) return;
  page = parseInt(b.getAttribute('data-go'), 10);
  renderTable();
  const tb = $('#tokens-table');
  const sb = tb && typeof tb.closest === 'function' ? tb.closest('.scr-body') : null;
  if (sb) sb.scrollTop = 0;
});

// ---------- 8b. 畫面 ----------
function render(d) {
  LAST = d;
  const s = d.sum;
  wallDone(true);
  $('#intro').hidden = true;

  const eff = s.efficiency;
  const grade = eff >= 0.5 ? ['你是神。', 'good']
    : eff >= 0.2 ? ['你算會賣的。', 'good']
    : eff >= 0.08 ? ['正常人水準。', 'warn']
    : ['你就是那個一賣就漲的人。', 'bad'];

  $('#verdict').innerHTML =
    '<p class="big">你買過 ' + s.n + ' 隻幣，如果每一隻都賣在最高點<br>'
    + '你會有 <em>' + fmtUSD(s.ideal) + '</em>。</p>'
    + '<p>你實際拿到 ' + fmtUSD(s.actual) + '，也就是說你錯過了 <b>'
    + fmtUSD(s.missed) + '</b>。' + grade[0] + '</p>';

  const hero = '<div class="stat hero"><div class="k">錯過的錢</div>'
    + '<div class="v bad">' + fmtUSD(s.missed) + '</div></div>';
  const stats = [
    ['總投入成本', fmtUSD(s.cost), d.meta.txCount.toLocaleString() + ' 筆交易掃描', ''],
    ['實際損益', (s.pnl >= 0 ? '+' : '') + fmtUSD(s.pnl), '已實現 + 現有持倉', s.pnl >= 0 ? 'good' : 'bad'],
    ['神之手總值', fmtUSD(s.ideal), '每隻都賣在最高點', ''],
    ['神化率', fmtPct(eff), '實際 ÷ 神之手', grade[1]],
  ];
  const rateEl = $('#dog-rates');
  if (rateEl) rateEl.innerHTML =
    '<div class="rate-duo">'
    + '<div class="rate rate-big"><div class="k">大金狗捕獲率</div>'
      + '<div class="v">' + fmtPct(s.bigRate) + '</div>'
      + '<div class="n">' + s.bigDogs + ' / ' + s.n + ' 隻 · 100x 且市值破 $10M</div></div>'
    + '<div class="rate"><div class="k">小金狗捕獲率</div>'
      + '<div class="v">' + fmtPct(s.smallRate) + '</div>'
      + '<div class="n">' + s.smallDogs + ' / ' + s.n + ' 隻 · 10x 且市值破 $1M</div></div>'
    + '</div>';
  $('#stat-grid').innerHTML = hero + stats.map((r) =>
    '<div class="stat"><div class="k">' + r[0] + '</div><div class="v ' + r[3] + '">'
    + r[1] + '</div><div class="n">' + r[2] + '</div></div>').join('');

  // 金狗品味：漲幅 × 市值雙門檻
  const taste = s.bigRate >= 0.05 ? ['你抓得到大狗。', 'good']
    : s.smallRate >= 0.15 ? ['小狗抓得不錯，大狗還差一步。', 'warn']
    : s.smallRate > 0 ? ['偶爾中，但還沒抓到真正做大的。', 'warn']
    : ['目前一隻真金狗都沒抓到。', 'bad'];
  const dogTasteEl = $('#dog-taste');
  if (dogTasteEl) dogTasteEl.innerHTML =
    '<div class="dog-grid">'
    + '<div class="dog big"><div class="k">大金狗捕獲率</div>'
      + '<div class="v ' + (s.bigDogs ? 'good' : '') + '">' + fmtPct(s.bigRate) + '</div>'
      + '<div class="n">' + s.bigDogs + ' / ' + s.n + ' 隻　MFE ≥ 100x 且最高市值 ≥ $10M</div></div>'
    + '<div class="dog"><div class="k">小金狗捕獲率</div>'
      + '<div class="v ' + (s.smallDogs ? 'good' : '') + '">' + fmtPct(s.smallRate) + '</div>'
      + '<div class="n">' + s.smallDogs + ' / ' + s.n + ' 隻　MFE ≥ 10x 且最高市值 ≥ $1M</div></div>'
    + '</div>'
    + '<p class="taste-verdict ' + taste[1] + '">' + taste[0] + '</p>'
    + (s.topDog ? '<p class="hint">你抓過市值做最大的一隻是 <b>' + escapeHTML(s.topDog.symbol)
        + '</b>，最高衝到 ' + fmtUSD(s.topDog.peakMcap) + '，你的成本位對應 ' + fmtX(s.topDog.mfeX) + '。</p>' : '')
    + (s.mcapUnknown ? '<p class="hint">' + s.mcapUnknown + ' 隻查不到市值。</p>' : '');

  const maxT = Math.max(1, ...TIERS.map((t) => s.tiers[t]));
  $('#golden').innerHTML = TIERS.map((t) => {
    const c = s.tiers[t];
    return '<div class="gold-row"><span class="tag">' + t + 'x+</span>'
      + '<span class="track"><span class="fill" style="width:' + ((c / maxT) * 100).toFixed(2) + '%"></span></span>'
      + '<span class="val">' + c + ' 隻 · ' + fmtPct(c / s.n) + '</span></div>';
  }).join('');

  sortKey = 'missedUSD'; sortDir = -1; page = 0;
  renderTable();

  const pa = $('#per-address-panel');
  if (d.perAddr.length > 1) {
    pa.hidden = false;
    $('#addr-table tbody').innerHTML = d.perAddr.map((x) =>
      '<tr><td><a class="mint" href="https://solscan.io/account/' + x.address
      + '" target="_blank" rel="noopener">' + shortAddr(x.address) + '</a></td>'
      + '<td class="num">' + x.sum.n + '</td>'
      + '<td class="num">' + fmtUSD(x.sum.cost) + '</td>'
      + '<td class="num">' + fmtUSD(x.sum.ideal) + '</td>'
      + '<td class="num">' + fmtUSD(x.sum.actual) + '</td>'
      + '<td class="num">' + fmtPct(x.sum.efficiency) + '</td>'
      + '<td class="num">' + (x.sum.n ? fmtPct(x.sum.tiers[10] / x.sum.n) : '—') + '</td></tr>').join('');
  } else {
    pa.hidden = true;
  }

  const m = d.meta;
  const cav = [];
  if (m.aborted) {
    cav.push('<b>中途停止</b>：預計 ' + m.planned + ' 隻，只算完 ' + d.rows.length + ' 隻，比率分母以此為準。');
  }
  if (m.partialAddrs && m.partialAddrs.length) {
    cav.push(m.partialAddrs.map(shortAddr).join('、') + ' 的紀錄沒抓完（資料源暫時故障），稍後重跑即可。');
  }
  // 幣數漏斗：回答「為什麼只有這幾隻」
  const funnel = ['掃描 <b>' + m.txCount.toLocaleString() + '</b> 筆交易'];
  if (isFinite(m.touched)) funnel.push('碰過 <b>' + m.touched + '</b> 隻幣');
  if (m.neverBought) funnel.push('<b>' + m.neverBought + '</b> 隻只收到沒買過');
  if (m.belowMinCost) funnel.push('<b>' + m.belowMinCost + '</b> 隻成本低於 $' + m.minCost);
  if (m.lostToMulti) funnel.push('<b>' + m.lostToMulti + '</b> 隻被多幣交易讓位');
  funnel.push('計入 <b>' + m.totalFound + '</b> 隻');
  if (m.truncated) funnel.push('另有 ' + m.truncated + ' 隻沒算（可調高上限）');
  if (m.noPool.length) funnel.push('<b>' + m.noPool.length + '</b> 隻查不到池子');
  cav.push(funnel.join(' → ') + '。');

  if (m.solStale) {
    cav.push('<b>' + m.solStale + ' 隻</b>的買入早於匯率資料起點（'
      + new Date(m.solStartTs * 1000).toISOString().slice(0, 10) + '），成本為估算值。');
  }
  if (m.txSrc === 'solanatracker') {
    cav.push('成交紀錄來自 Solana Tracker，冷門路由的交易可能有漏；補一把 Helius key 可完整覆蓋。');
  }
  if (m.underwater) cav.push(m.underwater + ' 隻最高倍數低於 1x，來自滑價與手續費。');
  if (m.peakFixed) cav.push(m.peakFixed + ' 隻的最高價為錯誤報價，已用市值回推修正。');
  if (m.exactMcap !== d.rows.length) {
    cav.push((m.exactMcap ? (d.rows.length - m.exactMcap) + ' 隻的' : '') + '最高市值為推算值（以現市值反推流通量）。');
  }
  cav.push('標 <b>*</b> 的幣，K 線未完整涵蓋買入時間，最高價可能被低估。');
  if (m.noPeak) cav.push(m.noPeak + ' 隻抓不到歷史 K 線，以現價與均價較高者代替。');
  cav.push('轉出到未列入的地址不算賣出 —— 有其他錢包記得一起貼上。');
  const cavEl = $('#caveats-list');
  if (cavEl) cavEl.innerHTML = cav.map((c) => '<li>' + c + '</li>').join('');

  if (dogRoom()) {
    dogRoom().setAll(d.rows.map((r) => ({ sym: r.symbol, mfeX: r.mfeX,
      tier: isBigDog(r) ? 'big' : isSmallDog(r) ? 'gold' : 'norm' })), d.rows.length);
  }
  drawCard(d);
}

// ---------- 9. 分享圖 ----------
const CARD = { W: 1080, H: 1500, PAD: 72 };
let bgImage = null;    // 使用者上傳的背景圖
let logoImage = null;  // 使用者上傳的 logo
let cardBgDefault = null;   // assets/card-bg.png：沒上傳背景時的預設卡底（可選）
let cardLogoDefault = null; // assets/logo.png：分享卡右下角的預設 logo（可選）
// file:// 直接開檔時，本機圖片會讓 canvas 無法匯出（瀏覽器安全限制），乾脆不載
if (typeof Image !== 'undefined' && typeof location !== 'undefined' && /^https?:$/.test(location.protocol)) {
  try {
    const cb = new Image();
    cb.onload = () => { cardBgDefault = cb; if (LAST) drawCard(LAST); };
    cb.src = 'assets/card-bg.png';
    const cl = new Image();
    cl.onload = () => { cardLogoDefault = cl; if (LAST) drawCard(LAST); };
    cl.src = 'assets/logo.png';
  } catch (e) {}
}

const SANS = '"Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif';
const MONO = 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace';
const cardFont = (w, sz, mono) => w + ' ' + sz + 'px ' + (mono ? MONO : SANS);

/** 超出寬度就截掉並補上省略號，避免長幣名撞到右邊的數字 */
function clipText(x, text, maxW) {
  let t = String(text || '');
  if (x.measureText(t).width <= maxW) return t;
  while (t.length > 1 && x.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t + '…';
}

/** 等比例填滿整個畫布（等同 CSS background-size: cover） */
function drawCover(x, img, W, H) {
  const s = Math.max(W / img.width, H / img.height);
  const w = img.width * s, h = img.height * s;
  x.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
}

function drawCard(d) {
  const c = $('#share-canvas');
  const x = c.getContext('2d');
  const { W, H } = CARD;
  const PAD = 64;
  const s = d.sum;
  const dim = (parseInt($('#dim').value, 10) || 0) / 100;

  const LINE = 'rgba(232,236,244,.16)';
  const GOLD = '#f0b429', GREEN = '#14f195', RED = '#ff4d6d';
  const PAPER = '#e8ecf4', DIM = '#565f70', MUT = '#7d8697';
  const hr = (yy) => { x.strokeStyle = LINE; x.lineWidth = 1; x.setLineDash([]); x.beginPath(); x.moveTo(24, yy + 0.5); x.lineTo(W - 24, yy + 0.5); x.stroke(); };
  const spacing = (v) => { try { x.letterSpacing = v; } catch (e) {} };

  x.clearRect(0, 0, W, H);
  x.fillStyle = '#0a0b0e';
  x.fillRect(0, 0, W, H);

  const cardBg = bgImage || cardBgDefault;
  if (cardBg) {
    x.save();
    drawCover(x, cardBg, W, H);
    x.fillStyle = 'rgba(10,11,14,' + dim + ')';
    x.fillRect(0, 0, W, H);
    const g = x.createLinearGradient(0, H * 0.4, 0, H);
    g.addColorStop(0, 'rgba(10,11,14,0)');
    g.addColorStop(1, 'rgba(10,11,14,.92)');
    x.fillStyle = g;
    x.fillRect(0, H * 0.4, W, H * 0.6);
    x.restore();
  }

  // ---- 巨型浮水印（斜壓在卡面後方）----
  const paper = s.efficiency < 0.2;
  x.save();
  x.translate(W / 2, H * 0.46);
  x.rotate(-0.25);
  x.textAlign = 'center';
  x.font = cardFont(900, 168, false);
  x.fillStyle = paper ? 'rgba(255,77,109,.06)' : 'rgba(20,241,149,.055)';
  x.fillText(paper ? 'PAPER HANDS' : 'DIAMOND', 0, 0);
  x.restore();

  // ---- 票券外框（雙線）----
  x.strokeStyle = LINE; x.lineWidth = 1;
  x.strokeRect(14.5, 14.5, W - 29, H - 29);
  x.strokeRect(24.5, 24.5, W - 49, H - 49);

  // ================= HEAD =================
  let y = 96;
  x.textAlign = 'left';
  spacing('8px');
  x.font = cardFont(700, 20, true);
  x.fillStyle = GREEN;
  x.fillText('I SHOULD HOLD THE COIN', PAD, y);
  spacing('0px');

  y += 74;
  const handle = ($('#handle').value || '').trim();
  x.font = cardFont(900, 60, false);
  x.fillStyle = PAPER;
  x.fillText(clipText(x, handle || 'ISHTC', W - PAD - 360), PAD, y);

  y += 44;
  x.font = cardFont(600, 20, true);
  x.fillStyle = DIM;
  const dateStr = new Date().toISOString().slice(0, 10);
  let hx = PAD;
  x.fillText(dateStr, hx, y); hx += x.measureText(dateStr).width + 22;
  x.fillText('·', hx, y); hx += 22;
  x.fillText(s.n + ' TOKENS', hx, y); hx += x.measureText(s.n + ' TOKENS').width + 22;
  x.fillText('·', hx, y); hx += 22;
  x.fillText(d.addrs.length + ' WALLET' + (d.addrs.length > 1 ? 'S' : ''), hx, y);

  // 右側：神化率方塊（票頭右欄）
  const boxL = W - 320;
  x.strokeStyle = LINE; x.setLineDash([]);
  x.beginPath(); x.moveTo(boxL, 44); x.lineTo(boxL, 238); x.stroke();
  spacing('4px');
  x.font = cardFont(700, 18, true);
  x.fillStyle = GOLD;
  x.fillText('神化率', boxL + 34, 108);
  spacing('0px');
  x.font = cardFont(700, 58, true);
  x.fillStyle = paper ? RED : GREEN;
  x.fillText(fmtPct(s.efficiency), boxL + 34, 176);
  hr(238);

  // ================= HERO：錯過的錢 =================
  y = 320;
  spacing('6px');
  x.font = cardFont(700, 26, true);
  x.fillStyle = RED;
  x.fillText('我錯過了', PAD, y);
  spacing('0px');

  y += 138;
  let heroSize = 148;
  x.font = cardFont(900, heroSize, true);
  const heroTxt = fmtUSD(s.missed);
  while (x.measureText(heroTxt).width > W - PAD * 2 - 40 && heroSize > 70) {
    heroSize -= 8;
    x.font = cardFont(900, heroSize, true);
  }
  x.fillStyle = RED;
  x.fillText(heroTxt, PAD, y);

  y += 66;
  x.font = cardFont(600, 27, true);
  let sx2 = PAD;
  x.fillStyle = MUT; x.fillText('神之手', sx2, y); sx2 += x.measureText('神之手').width + 16;
  x.fillStyle = PAPER; x.fillText(fmtUSD(s.ideal), sx2, y); sx2 += x.measureText(fmtUSD(s.ideal)).width + 40;
  x.fillStyle = MUT; x.fillText('實際拿到', sx2, y); sx2 += x.measureText('實際拿到').width + 16;
  x.fillStyle = PAPER; x.fillText(fmtUSD(s.actual), sx2, y);

  // 神化率比例條（綠＝拿到的、紅＝飛走的）
  y += 40;
  const barW = W - PAD * 2, barH = 12;
  const gw2 = Math.max(3, Math.min(barW, barW * s.efficiency));
  x.fillStyle = 'rgba(255,77,109,.55)';
  x.fillRect(PAD, y, barW, barH);
  x.fillStyle = GREEN;
  x.fillRect(PAD, y, gw2, barH);
  x.strokeStyle = LINE;
  x.strokeRect(PAD + 0.5, y + 0.5, barW - 1, barH - 1);

  // ---- 橡皮章（旋轉蓋在 HERO 右上）----
  const st = paper
    ? { en: 'PAPER HANDS', zh: '紙 手 認 證', col: RED }
    : (s.bigDogs > 0
      ? { en: 'GOLDEN HUNTER', zh: '金 狗 獵 人', col: GOLD }
      : { en: 'DIAMOND HANDS', zh: '鑽 石 手', col: GREEN });
  x.save();
  x.translate(W - 250, 330);
  x.rotate(-0.13);
  x.textAlign = 'center';
  x.font = cardFont(900, 34, false);
  const stW = Math.max(x.measureText(st.en).width + 56, 260);
  x.fillStyle = 'rgba(10,11,14,.55)';
  x.fillRect(-stW / 2, -44, stW, 92);
  x.strokeStyle = st.col;
  x.lineWidth = 4;
  x.strokeRect(-stW / 2, -44, stW, 92);
  x.lineWidth = 1;
  x.strokeRect(-stW / 2 + 7.5, -36.5, stW - 15, 77);
  x.fillStyle = st.col;
  x.fillText(st.en, 0, 4);
  x.font = cardFont(700, 17, true);
  x.fillText(st.zh, 0, 34);
  x.restore();
  x.textAlign = 'left';

  // 吉祥物坐在分隔線上
  if (dogRoom() && dogRoom().stamp) {
    dogRoom().stamp(x, W - 96, 646, 3, s.bigDogs ? 'big' : 'gold', -1, 0.25, false);
  }
  hr(648);

  // ================= 數據列（點線引導）＋ 戰績 =================
  const lvTop = 700;
  const midX = W / 2 + 10;
  x.strokeStyle = LINE; x.setLineDash([]);
  x.beginPath(); x.moveTo(midX - 40, lvTop - 34); x.lineTo(midX - 40, lvTop + 214); x.stroke();

  const lvRow = (lx, rx, yy, label, value, valColor, valMono) => {
    spacing('3px');
    x.font = cardFont(700, 19, true);
    x.fillStyle = GOLD;
    x.textAlign = 'left';
    x.fillText(label, lx, yy);
    const lw2 = x.measureText(label).width;
    spacing('0px');
    x.font = cardFont(700, 28, valMono !== false);
    x.fillStyle = valColor || PAPER;
    x.textAlign = 'right';
    x.fillText(value, rx, yy);
    const vw2 = x.measureText(value).width;
    x.strokeStyle = 'rgba(232,236,244,.25)';
    x.setLineDash([2, 6]);
    x.beginPath();
    x.moveTo(lx + lw2 + 18, yy - 6);
    x.lineTo(rx - vw2 - 18, yy - 6);
    x.stroke();
    x.setLineDash([]);
    x.textAlign = 'left';
  };
  const Lx = PAD, LR = midX - 74;
  lvRow(Lx, LR, lvTop,       '總投入成本', fmtUSD(s.cost));
  lvRow(Lx, LR, lvTop + 62,  '實際損益', (s.pnl >= 0 ? '+' : '') + fmtUSD(Math.abs(s.pnl)).replace('$', '$'), s.pnl >= 0 ? GREEN : RED);
  lvRow(Lx, LR, lvTop + 124, '賣飛金額', fmtUSD(s.paperhand), RED);
  lvRow(Lx, LR, lvTop + 186, '平均到頂', isFinite(s.avgDaysToPeak) ? s.avgDaysToPeak.toFixed(1) + ' 天' : '—');

  const Rx = midX + 6, RR = W - PAD;
  lvRow(Rx, RR, lvTop,       '大金狗', s.bigDogs + ' 隻', GOLD);
  lvRow(Rx, RR, lvTop + 62,  '小金狗', s.smallDogs + ' 隻', GOLD);
  lvRow(Rx, RR, lvTop + 124, '10X 以上', (s.tiers[10] || 0) + ' 隻', GREEN);
  lvRow(Rx, RR, lvTop + 186, '100X 以上', (s.tiers[100] || 0) + ' 隻', GREEN);

  hr(lvTop + 232);

  // ================= TOP5 =================
  const t5Top = lvTop + 288;
  const COLX = { cost: 520, actual: 690, missed: 878, mfe: W - PAD };
  const top5 = d.rows.slice()
    .filter((r) => isFinite(r.mfeX))
    .sort((a, b) => b.mfeX - a.mfeX)
    .slice(0, 5);

  if (top5.length) {
    spacing('4px');
    x.font = cardFont(700, 19, true);
    x.fillStyle = GOLD;
    x.fillText('TOP5', PAD, t5Top);
    x.fillStyle = DIM;
    x.fillText('· 最痛的五隻', PAD + x.measureText('TOP5').width + 14, t5Top);
    spacing('0px');
    x.textAlign = 'right';
    x.font = cardFont(700, 18, true);
    x.fillStyle = DIM;
    x.fillText('成本', COLX.cost, t5Top);
    x.fillText('實拿', COLX.actual, t5Top);
    x.fillText('賣飛', COLX.missed, t5Top);
    x.fillText('倍數', COLX.mfe, t5Top);

    const ROW_H = 50;
    top5.forEach((r, i) => {
      const ry = t5Top + 52 + i * ROW_H;
      if (i > 0) {
        x.strokeStyle = 'rgba(232,236,244,.10)';
        x.setLineDash([1, 5]);
        x.beginPath(); x.moveTo(PAD, ry - 32); x.lineTo(W - PAD, ry - 32); x.stroke();
        x.setLineDash([]);
      }
      x.textAlign = 'left';
      x.font = cardFont(800, 27, false);
      x.fillStyle = isBigDog(r) ? GOLD : PAPER;
      x.fillText(clipText(x, r.symbol, 260), PAD, ry);
      x.textAlign = 'right';
      x.font = cardFont(500, 24, true);
      x.fillStyle = MUT;
      x.fillText(fmtUSD(r.costUSD), COLX.cost, ry);
      x.fillStyle = PAPER;
      x.fillText(fmtUSD(r.actualUSD), COLX.actual, ry);
      x.fillStyle = RED;
      x.fillText(fmtUSD(r.missedUSD), COLX.missed, ry);
      x.font = cardFont(700, 26, true);
      x.fillStyle = isBigDog(r) ? GOLD : GREEN;
      x.fillText(fmtX(r.mfeX), COLX.mfe, ry);
    });
    x.textAlign = 'left';
  }

  // ================= 頁尾品牌列 ＋ 免責條 =================
  const footLine = H - 128;
  hr(footLine);
  const fy = H - 78;
  let fx = PAD;
  const cardLogo = logoImage || cardLogoDefault;
  if (cardLogo) {
    const maxSide = 64;
    const sc = Math.min(maxSide / cardLogo.width, maxSide / cardLogo.height);
    const lw = cardLogo.width * sc, lh = cardLogo.height * sc;
    x.drawImage(cardLogo, fx, fy - lh + 12, lw, lh);
    fx += lw + 20;
  }
  x.font = cardFont(900, 30, false);
  x.fillStyle = PAPER;
  x.fillText(handle || 'ISHTC', fx, fy);
  spacing('5px');
  x.font = cardFont(600, 14, true);
  x.fillStyle = DIM;
  x.fillText('你 2026 賣飛了多少錢？', fx, fy + 30);
  spacing('0px');

  x.textAlign = 'right';
  spacing('3px');
  x.font = cardFont(600, 15, true);
  x.fillStyle = DIM;
  x.fillText('鏈上交易 × 歷史K線 自動生成 · 僅供娛樂', W - PAD, fy);
  x.fillText('I SHOULD HOLD THE COIN', W - PAD, fy + 30);
  spacing('0px');
  x.textAlign = 'left';
}

// ---------- 10. CSV ----------
function toCSV(d) {
  const head = ['symbol', 'mint', 'cost_usd', 'avg_buy_price', 'peak_price', 'mfe_x',
    'buy_mcap_usd', 'peak_mcap_usd', 'current_mcap_usd', 'dog_tier', 'bought_by',
    'ideal_usd', 'realized_usd', 'holding_usd', 'missed_usd',
    'paperhand_usd', 'roundtrip_usd', 'sold_now_worth_usd', 'hold_days', 'days_to_peak',
    'buys', 'sells', 'current_price', 'first_buy_utc'];
  const lines = [head.join(',')];
  for (const r of d.rows) {
    lines.push([
      JSON.stringify(r.symbol), r.mint, r.costUSD.toFixed(2), r.avgBuy, r.peak,
      isFinite(r.mfeX) ? r.mfeX.toFixed(3) : '',
      isFinite(r.buyMcap) ? r.buyMcap.toFixed(0) : '',
      isFinite(r.peakMcap) ? r.peakMcap.toFixed(0) : '', r.mcap || '',
      isBigDog(r) ? 'big' : isSmallDog(r) ? 'small' : '',
      JSON.stringify((r.addrs || []).join(' ')),
      r.idealUSD.toFixed(2),
      r.proceedsUSD.toFixed(2), r.holdingUSD.toFixed(2), r.missedUSD.toFixed(2),
      (r.paperhandUSD || 0).toFixed(2), (r.roundtripUSD || 0).toFixed(2),
      (r.soldNowUSD || 0).toFixed(2), isFinite(r.holdDays) ? r.holdDays.toFixed(2) : '',
      isFinite(r.daysToPeak) ? r.daysToPeak.toFixed(2) : '',
      r.buys, r.sells, r.price, new Date(r.firstBuyTs * 1000).toISOString(),
    ].join(','));
  }
  return '\uFEFF' + lines.join('\n'); // BOM，讓 Excel 開 CSV 中文不亂碼
}

function download(name, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ---------- 11. 綁定 ----------
if (PROXY_URL) {
  // 代理模式：訪客不用 key，整區收起來；額度冷卻時才重新展開
  $('#key-zone').hidden = true;
  $('#proxy-note').hidden = false;
}

$('#helius-key').value = localStorage.getItem('fomo:key') || '';
$('#birdeye-key').value = localStorage.getItem('fomo:bekey') || '';
$('#st-key').value = localStorage.getItem('fomo:stkey') || '';
$('#addresses').value = localStorage.getItem('fomo:addrs') || '';

function bestRate() {
  if ($('#st-key').value.trim() || PROXY_URL) return { perMin: 150 };
  if ($('#birdeye-key').value.trim()) return { perMin: 50 };
  return { perMin: 25 };
}
function updateEta() {
  const n = clamp(parseInt($('#max-tokens').value, 10) || 0, 0, 50000);
  $('#eta-hint').textContent = '上限；實際只算你買過的幣。跑滿 '
    + n.toLocaleString() + ' 隻約 ' + etaText(n, bestRate().perMin) + '。';
}
// ---------- 可分享的查詢網址 ----------
// ?addr=A,B 直接帶入地址；有代理或已存 key 時自動開跑
function shareUrlFor(addrs) {
  try {
    return location.origin + location.pathname + '?addr=' + addrs.join(',');
  } catch (e) { return ''; }
}
function initFromUrl() {
  try {
    const q = new URLSearchParams(location.search);
    const raw = (q.get('addr') || '').split(/[\s,]+/).filter(Boolean);
    const good = raw.filter(isSolAddress).slice(0, 10);
    if (!good.length) return false;
    $('#addresses').value = good.join('\n');
    $('#hero-addr').value = good.join(' ');
    return !!(PROXY_URL || (localStorage.getItem('fomo:key') || localStorage.getItem('fomo:stkey')));
  } catch (e) { return false; }
}

// ---------- 場景切換 ----------
function wallDone(done) {
  const w = $('#screen-wall');
  if (w && w.classList) w.classList.toggle('done', !!done);
}
let landingHideTimer = 0;
function enterRoom() {
  const landing = $('#landing');
  const scene = $('#dog-room-panel');
  if (landing && landing.classList) {
    landing.classList.add('leaving');
    clearTimeout(landingHideTimer);
    landingHideTimer = setTimeout(() => { landing.hidden = true; }, 430);
  } else if (landing) {
    landing.hidden = true;
  }
  if (scene) {
    scene.hidden = false;
    if (scene.classList) {
      scene.classList.remove('reveal');
      void (scene.offsetWidth || 0);
      scene.classList.add('reveal');
    }
  }
}
function exitRoom() {
  clearTimeout(landingHideTimer);
  const landing = $('#landing');
  const scene = $('#dog-room-panel');
  if (scene) scene.hidden = true;
  if (landing) {
    landing.hidden = false;
    if (landing.classList) landing.classList.remove('leaving');
  }
}
(function wireBack() {
  const b = $('#back-home');
  if (b && b.addEventListener) b.addEventListener('click', exitRoom);
})();

// ---------- 全屏 hero ----------
(function wireHero() {
  const form = $('#hero-form');
  if (!form || !form.addEventListener) return;
  form.addEventListener('submit', (ev) => {
    if (ev && ev.preventDefault) ev.preventDefault();
    const v = ($('#hero-addr').value || '').trim();
    if (v) $('#addresses').value = v;   // 空的話沿用進階區已填的
    $('#run').click();
  });
})();

$('#max-tokens').addEventListener('input', updateEta);
$('#birdeye-key').addEventListener('input', updateEta);
$('#st-key').addEventListener('input', updateEta);
updateEta();

// ---------- 分享圖的圖片上傳 ----------
function loadImageFile(file, onDone) {
  if (!file) return;
  if (!/^image\//.test(file.type)) return;
  const fr = new FileReader();
  fr.onload = () => {
    const img = new Image();
    img.onload = () => onDone(img);
    img.onerror = () => onDone(null);
    img.src = fr.result;
  };
  fr.readAsDataURL(file);
}
function redrawCard() { if (LAST) drawCard(LAST); }

$('#bg-file').addEventListener('change', (e) => {
  loadImageFile(e.target.files[0], (img) => {
    bgImage = img;
    $('#bg-clear').hidden = !img;
    redrawCard();
  });
});
if ($('#logo-file')) $('#logo-file').addEventListener('change', (e) => {
  loadImageFile(e.target.files[0], (img) => {
    logoImage = img;
    $('#logo-clear').hidden = !img;
    redrawCard();
  });
});
$('#bg-clear').addEventListener('click', () => {
  bgImage = null; $('#bg-file').value = ''; $('#bg-clear').hidden = true; redrawCard();
});
if ($('#logo-clear')) $('#logo-clear').addEventListener('click', () => {
  logoImage = null; $('#logo-file').value = ''; $('#logo-clear').hidden = true; redrawCard();
});
$('#dim').addEventListener('input', redrawCard);
$('#handle').addEventListener('input', redrawCard);

$('#run').addEventListener('click', async () => {
  $('#error').hidden = true;
  wallDone(false);
  $('#progress').hidden = false;
  enterRoom();                        // 換頁過場：首頁離場 → 全螢幕操盤室
  if (dogRoom()) dogRoom().reset();   // 清場，等狗從螢幕噴出來
  $('#screen-terminal').hidden = false;   // 大螢幕先跑終端動畫
  $('#run').disabled = true;
  $('#cancel').hidden = false;
  try {
    const d = await run();
    render(d);
    $('#screen-terminal').hidden = true;   // 終端讓位給報告
    try { history.replaceState(null, '', shareUrlFor(d.addrs)); } catch (e2) {}
    if (PROXY_URL) {
      // 回報一筆查詢記錄給排行榜（fire-and-forget，失敗不影響使用者）
      try {
        fetch(PROXY_URL + '/log', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            addresses: d.addrs,
            handle: ($('#handle').value || '').trim() || undefined,
            stats: {
              n: d.sum.n, cost: d.sum.cost, ideal: d.sum.ideal, actual: d.sum.actual,
              missed: d.sum.missed, bigRate: d.sum.bigRate, smallRate: d.sum.smallRate,
              efficiency: d.sum.efficiency,
            },
          }),
        }).catch(function () {});
      } catch (e2) { /* 記錄失敗不影響使用者 */ }
    }
  } catch (e) {
    if (e.cooldown) {
      exitRoom();
      // 共用額度用完：亮出冷卻橫幅 + 展開進階區 + 開放自填 key 的欄位
      const mp = $('#manual-panel'); if (mp) mp.open = true;
      $('#cooldown').hidden = false;
      $('#key-zone').hidden = false;
      $('#proxy-note').hidden = true;
      $('#error').textContent = '⚠ 查詢用量過大，暫時冷卻中。';
      $('#error').hidden = false;
    } else if (e.message !== '__ABORT__') {
      exitRoom();
      const mp = $('#manual-panel'); if (mp) mp.open = true;
      $('#error').textContent = '⚠ ' + e.message;
      $('#error').hidden = false;
      $('#intro').hidden = false;
    }
  } finally {
    $('#run').disabled = false;
    $('#cancel').hidden = true;
    $('#progress').hidden = true;
  }
});

$('#cancel').addEventListener('click', () => { abortFlag = true; });

$('#clear-cache').addEventListener('click', () => {
  Object.keys(localStorage).filter((k) => k.startsWith(CACHE_PREFIX))
    .forEach((k) => localStorage.removeItem(k));
  $('#clear-cache').textContent = '已清除';
  setTimeout(() => { $('#clear-cache').textContent = '清除快取'; }, 1500);
});


// ---------- 全站排行榜 ----------
function boardRow(i, name, right, sub, href) {
  return '<li><a href="' + href + '">'
    + '<span class="rank">' + (i + 1) + '</span>'
    + '<span class="who">' + escapeHTML(name) + '<small>' + escapeHTML(sub) + '</small></span>'
    + '<span class="score">' + right + '</span></a></li>';
}
async function openBoard() {
  const ov = $('#board-overlay');
  if (!ov) return;
  ov.hidden = false;
  if (!PROXY_URL) {
    $('#board-missed').innerHTML = '<li class="board-empty">排行榜需要連上代理伺服器</li>';
    $('#board-dogs').innerHTML = '';
    return;
  }
  try {
    const j = await getJSON(PROXY_URL + '/leaderboard');
    const nameOf = (r) => (r.handle && r.handle.trim())
      || shortAddr((r.addresses || '').split(' ')[0] || '');
    $('#board-missed').innerHTML = (j.missed || []).map((r, i) =>
      boardRow(i, nameOf(r), '<b class="bad">' + fmtUSD(r.missed_usd) + '</b>',
        (r.tokens || 0) + ' 隻幣', '?addr=' + (r.addresses || '').split(' ').join(','))
    ).join('') || '<li class="board-empty">還沒有人上榜，快查一筆</li>';
    $('#board-dogs').innerHTML = (j.dogs || []).map((r, i) =>
      boardRow(i, nameOf(r), '<b class="good">' + (r.big_dogs || 0) + ' 隻大金狗</b>',
        fmtPct(r.big_rate) + ' · ' + (r.tokens || 0) + ' 隻幣',
        '?addr=' + (r.addresses || '').split(' ').join(','))
    ).join('') || '<li class="board-empty">還沒有人抓到大金狗</li>';
  } catch (e) {
    $('#board-missed').innerHTML = '<li class="board-empty">'
      + (e.cooldown ? '用量冷卻中，晚點再看' : '排行榜暫時拿不到') + '</li>';
    $('#board-dogs').innerHTML = '';
  }
}
if ($('#board-btn')) $('#board-btn').addEventListener('click', openBoard);
if ($('#board-close')) $('#board-close').addEventListener('click', () => { $('#board-overlay').hidden = true; });
if ($('#board-overlay')) $('#board-overlay').addEventListener('click', (e) => {
  if (e.target === $('#board-overlay')) $('#board-overlay').hidden = true;
});

$('#download-card').addEventListener('click', () => {
  try {
    $('#share-canvas').toBlob((b) => {
      if (b) download('ishtc.png', b);
      else alert('分享圖匯出失敗：請改用 http:// 網址開啟（直接雙擊 index.html 會被瀏覽器擋）。');
    }, 'image/png');
  } catch (e) {
    alert('分享圖匯出失敗：請改用 http:// 網址開啟（直接雙擊 index.html 會被瀏覽器擋）。');
  }
});

$('#copy-link').addEventListener('click', () => {
  const addrs = $('#addresses').value.split(/[\s,]+/).filter(isSolAddress);
  if (!addrs.length) return;
  const url = shareUrlFor(addrs);
  const done = () => {
    $('#copy-link').textContent = '已複製';
    setTimeout(() => { $('#copy-link').textContent = '複製查詢連結'; }, 1500);
  };
  try { navigator.clipboard.writeText(url).then(done); }
  catch (e) { try { prompt('複製這個連結：', url); } catch (e2) {} }
});

$('#download-csv').addEventListener('click', () => {
  if (LAST) download('sol-fomo.csv', new Blob([toCSV(LAST)], { type: 'text/csv;charset=utf-8' }));
});

// 網址帶 ?addr= 就自動填入；免 key 環境（代理/已存 key）直接開跑
if (initFromUrl()) {
  setTimeout(() => { $('#run').click(); }, 60);
}

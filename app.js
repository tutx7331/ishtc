/* 賣飛計算機 — Solana wallet MFE / FOMO report
 * 純前端。Helius(BYOK) 抓交易、DexScreener 抓池子與現價、GeckoTerminal 抓歷史 K 線。
 */
'use strict';

// ---------- 常數 ----------
const WSOL  = 'So11111111111111111111111111111111111111112';
const USDC  = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDT  = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
// 這些不算 memecoin，從報告排除
const EXCLUDE = new Set([
  WSOL, USDC, USDT,
  'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So',  // mSOL
  'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn', // jitoSOL
  'bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1',  // bSOL
  '7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj', // stSOL
  'jupSoLaHXQiZZTSfEWMTRRgpnyFm8f6sZdosWBjx93v',  // jupSOL
]);
const GT = 'https://api.geckoterminal.com/api/v2';
const DS = 'https://api.dexscreener.com';
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

let abortFlag = false;

async function getJSON(url, opts) {
  const { limiter, tries = 3 } = opts || {};
  for (let i = 0; i < tries; i++) {
    if (abortFlag) throw new Error('__ABORT__');
    if (limiter) await limiter.take();
    let res;
    try {
      res = await fetch(url, { headers: { Accept: 'application/json' } });
    } catch (e) {
      if (i === tries - 1) throw new Error('網路錯誤，連不到 ' + new URL(url).host);
      await sleep(800 * (i + 1));
      continue;
    }
    if (res.status === 429) { await sleep(3000 * (i + 1)); continue; }
    if (res.status === 404) return null;
    if (!res.ok) {
      if (i === tries - 1) {
        const err = new Error('HTTP ' + res.status);
        err.status = res.status;
        throw err;
      }
      await sleep(700 * (i + 1));
      continue;
    }
    return res.json();
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
    const url = 'https://api.helius.xyz/v0/addresses/' + address + '/transactions'
      + '?api-key=' + encodeURIComponent(key) + '&limit=100'
      + (before ? '&before=' + before : '');
    let batch;
    try {
      batch = await getJSON(url, { tries: 3 });
    } catch (e) {
      if (e.status === 401) throw new Error('Helius API key 無效或已停用。');
      if (e.status === 429) throw new Error('Helius 額度用完或被限流，稍後再試。');
      throw e;
    }
    if (!Array.isArray(batch) || batch.length === 0) break;
    out.push.apply(out, batch);
    before = batch[batch.length - 1].signature;
    onTick(out.length);
    if (batch.length < 100) break;
  }
  return out;
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
  let skippedMulti = 0;
  let trades = 0;

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
      if (!EXCLUDE.has(m) && Math.abs(delta) > 0) subject.push([m, delta]);
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

    if (delta > 0 && quoteUSD < -0.2) {          // 買
      p.boughtAmt += delta;
      p.costUSD += -quoteUSD;
      p.buys++;
      if (!p.firstBuyTs) p.firstBuyTs = tx.timestamp;
      trades++;
    } else if (delta < 0 && quoteUSD > 0.2) {    // 賣
      p.soldAmt += -delta;
      p.proceedsUSD += quoteUSD;
      p.sells++;
      trades++;
    } else if (delta < 0) {                      // 轉出，不是賣
      p.movedOut += -delta;
    }
  }

  for (const [m, p] of Array.from(pos)) {
    p.decimals = decimals.get(m) || 0;
    if (p.boughtAmt <= 0 || p.costUSD < minCost) pos.delete(m);
    else p.avgBuy = p.costUSD / p.boughtAmt;
  }
  return { pos: pos, skippedMulti: skippedMulti, trades: trades };
}

// ---------- 3. SOL 歷史價 ----------
async function buildSolPrice() {
  let list = cacheGet('solprice');
  if (!list) {
    const pairs = await getJSON(DS + '/tokens/v1/solana/' + WSOL, { limiter: dsLimit });
    const all = (pairs || []).slice().sort((a, b) =>
      ((b.liquidity && b.liquidity.usd) || 0) - ((a.liquidity && a.liquidity.usd) || 0));
    const stable = all.filter((p) => p.quoteToken &&
      (p.quoteToken.address === USDC || p.quoteToken.address === USDT));
    const pair = stable[0] || all[0];
    if (!pair) throw new Error('抓不到 SOL 的池子，DexScreener 可能暫時無回應。');
    const j = await getJSON(GT + '/networks/solana/pools/' + pair.pairAddress
      + '/ohlcv/day?aggregate=1&limit=1000&currency=usd', { limiter: gtLimit });
    const raw = (j && j.data && j.data.attributes && j.data.attributes.ohlcv_list) || [];
    list = raw.map((c) => [c[0], c[4]]).sort((a, b) => a[0] - b[0]);
    if (list.length) cacheSet('solprice', list);
  }
  if (!list.length) throw new Error('抓不到 SOL 歷史價。');

  const ts = list.map((c) => c[0]);
  return function solPrice(t) {
    if (t <= ts[0]) return list[0][1];
    if (t >= ts[ts.length - 1]) return list[list.length - 1][1];
    let lo = 0, hi = ts.length - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (ts[mid] <= t) lo = mid; else hi = mid;
    }
    return list[lo][1];
  };
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

async function fetchPeak(pool, sinceTs) {
  const ageDays = (Date.now() / 1000 - sinceTs) / 86400;
  const gran = pickGranularity(ageDays);
  const key = pool + ':' + gran.tf + ':' + gran.agg;
  let list = cacheGet(key);
  if (!list) {
    const j = await getJSON(GT + '/networks/solana/pools/' + pool + '/ohlcv/' + gran.tf
      + '?aggregate=' + gran.agg + '&limit=1000&currency=usd', { limiter: gtLimit });
    const raw = (j && j.data && j.data.attributes && j.data.attributes.ohlcv_list) || [];
    list = raw.map((c) => [c[0], c[2]]); // [ts, high]，GeckoTerminal 由新到舊
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
  const oldest = list[list.length - 1] ? list[list.length - 1][0] : 0;
  return { peak: best, peakTs: bestTs, partial: !covered || oldest > sinceTs + bucket };
}

// ---------- 6. 統計 ----------
const TIERS = [2, 5, 10, 50, 100];

function summarize(rows) {
  const s = {
    n: rows.length, cost: 0, ideal: 0, actual: 0, realized: 0, holding: 0,
    missed: 0, tiers: {}, dead: 0, daysToPeakSum: 0, daysToPeakN: 0, worst: null,
  };
  TIERS.forEach((t) => { s.tiers[t] = 0; });
  for (const r of rows) {
    s.cost += r.costUSD;
    s.ideal += r.idealUSD;
    s.realized += r.proceedsUSD;
    s.holding += r.holdingUSD;
    for (const t of TIERS) if (r.mfeX >= t) s.tiers[t]++;
    if (r.price > 0 && r.avgBuy > 0 && r.price <= r.avgBuy * 0.05) s.dead++;
    if (isFinite(r.daysToPeak)) { s.daysToPeakSum += r.daysToPeak; s.daysToPeakN++; }
    if (!s.worst || r.missedUSD > s.worst.missedUSD) s.worst = r;
  }
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
  const maxTokens = clamp(parseInt($('#max-tokens').value, 10) || 80, 5, 500);
  const minCost = Math.max(0, parseFloat($('#min-cost').value) || 0);
  const maxTx = clamp(parseInt($('#max-tx').value, 10) || 3000, 100, 20000);

  if (!addrs.length) throw new Error('請至少輸入一個 Solana 地址。');
  const bad = addrs.filter((a) => !isSolAddress(a));
  if (bad.length) throw new Error('這些看起來不是 Solana 地址：\n' + bad.join('\n'));
  if (!key) throw new Error('請填入 Helius API key（免費申請：dashboard.helius.dev）。');

  localStorage.setItem('fomo:key', key);
  localStorage.setItem('fomo:addrs', addrs.join('\n'));

  const setProg = (pct, txt) => {
    $('#bar-fill').style.width = pct + '%';
    $('#prog-text').textContent = txt;
  };

  // 7.1 交易紀錄
  const txsByAddr = new Map();
  for (let i = 0; i < addrs.length; i++) {
    const a = addrs[i];
    const base = 2 + (i / addrs.length) * 18;
    setProg(base, '[' + (i + 1) + '/' + addrs.length + '] 抓 ' + shortAddr(a) + ' 的交易紀錄…');
    const txs = await fetchWalletTxs(a, key, maxTx, (n) =>
      setProg(base, '[' + (i + 1) + '/' + addrs.length + '] ' + shortAddr(a) + ' — 已抓 ' + n + ' 筆'));
    txsByAddr.set(a, txs);
  }
  const dedup = new Map();
  for (const txs of txsByAddr.values()) for (const t of txs) dedup.set(t.signature, t);
  const allTxs = Array.from(dedup.values());
  if (!allTxs.length) throw new Error('這些地址沒有任何交易紀錄。');

  // 7.2 SOL 歷史價
  setProg(22, '抓 SOL 歷史價…');
  const solPrice = await buildSolPrice();

  // 7.3 重建部位（多地址合併計算，錢包之間互轉會自動抵銷）
  setProg(26, '重建買賣紀錄…');
  const built = buildPositions(allTxs, new Set(addrs), solPrice, minCost);
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
  const rows = [];
  const noPool = [];
  const withPool = [];
  for (const p of positions) {
    const meta = info.get(p.mint);
    if (meta && meta.pool) withPool.push(p); else noPool.push(p.mint);
  }

  for (let i = 0; i < withPool.length; i++) {
    const p = withPool[i];
    const meta = info.get(p.mint);
    const left = withPool.length - i;
    const secs = Math.round((left * 60) / 25);
    const eta = secs > 60 ? '約 ' + Math.ceil(secs / 60) + ' 分' : '約 ' + secs + ' 秒';
    setProg(40 + (i / withPool.length) * 58,
      '算最高價 ' + (i + 1) + '/' + withPool.length + '（' + meta.symbol + '）… 剩 ' + eta);

    let peak = null;
    try {
      peak = await fetchPeak(meta.pool, p.firstBuyTs);
    } catch (e) {
      if (e.message === '__ABORT__') throw e;
    }

    const peakP = (peak && peak.peak) || Math.max(meta.price, p.avgBuy);
    const holdAmt = Math.max(0, p.netAmt);
    const row = Object.assign({}, p, meta, {
      peak: peakP,
      peakTs: (peak && peak.peakTs) || 0,
      partial: !!(peak && peak.partial),
      hasPeak: !!peak,
      mfeX: p.avgBuy > 0 ? peakP / p.avgBuy : NaN,
      idealUSD: p.boughtAmt * peakP,
      holdAmt: holdAmt,
      holdingUSD: holdAmt * (meta.price || 0),
    });
    row.missedUSD = Math.max(0, row.idealUSD - (row.proceedsUSD + row.holdingUSD));
    row.daysToPeak = (peak && peak.peakTs) ? (peak.peakTs - p.firstBuyTs) / 86400 : NaN;
    rows.push(row);
  }

  // 7.6 各地址拆分
  const perAddr = [];
  if (addrs.length > 1) {
    const byMint = new Map(rows.map((r) => [r.mint, r]));
    for (const a of addrs) {
      const b = buildPositions(txsByAddr.get(a), new Set([a]), solPrice, minCost);
      const ar = [];
      for (const p of b.pos.values()) {
        const g = byMint.get(p.mint);
        if (!g) continue;
        const holdAmt = Math.max(0, p.netAmt);
        const r = Object.assign({}, p, {
          symbol: g.symbol, price: g.price, peak: g.peak, daysToPeak: g.daysToPeak,
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
  rows.sort((a, b) => b.missedUSD - a.missedUSD);
  return {
    addrs: addrs,
    rows: rows,
    sum: summarize(rows),
    perAddr: perAddr,
    meta: {
      txCount: allTxs.length, totalFound: totalFound, truncated: truncated,
      noPool: noPool, minCost: minCost, skippedMulti: built.skippedMulti,
      noPeak: rows.filter((r) => !r.hasPeak).length,
    },
  };
}

// ---------- 8. 畫面 ----------
function render(d) {
  LAST = d;
  const s = d.sum;
  $('#results').hidden = false;
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

  const stats = [
    ['總投入成本', fmtUSD(s.cost), d.meta.txCount.toLocaleString() + ' 筆交易掃描', ''],
    ['實際損益', (s.pnl >= 0 ? '+' : '') + fmtUSD(s.pnl), '已實現 + 現有持倉', s.pnl >= 0 ? 'good' : 'bad'],
    ['神之手總值', fmtUSD(s.ideal), '每隻都賣在最高點', ''],
    ['錯過的錢', fmtUSD(s.missed), '賣飛總額', 'bad'],
    ['出場效率', fmtPct(eff), '實際 ÷ 神之手', grade[1]],
    ['10x 命中率', fmtPct(s.tiers[10] / s.n), s.tiers[10] + ' / ' + s.n + ' 隻曾漲 10 倍以上', s.tiers[10] ? 'good' : ''],
    ['歸零率', fmtPct(s.dead / s.n), s.dead + ' 隻現價低於成本 5%', 'bad'],
    ['平均到頂天數', isFinite(s.avgDaysToPeak) ? s.avgDaysToPeak.toFixed(1) + ' 天' : '—', '從你第一次買到最高點', ''],
  ];
  $('#stat-grid').innerHTML = stats.map((r) =>
    '<div class="stat"><div class="k">' + r[0] + '</div><div class="v ' + r[3] + '">'
    + r[1] + '</div><div class="n">' + r[2] + '</div></div>').join('');

  const maxT = Math.max(1, ...TIERS.map((t) => s.tiers[t]));
  $('#golden').innerHTML = TIERS.map((t) => {
    const c = s.tiers[t];
    return '<div class="gold-row"><span class="tag">' + t + 'x+</span>'
      + '<span class="track"><span class="fill" style="width:' + (c / maxT) * 100 + '%"></span></span>'
      + '<span class="val">' + c + ' 隻 · ' + fmtPct(c / s.n) + '</span></div>';
  }).join('');

  $('#tokens-table tbody').innerHTML = d.rows.map((r) => {
    const gold = r.mfeX >= 10 ? '<span class="badge gold">金狗</span>' : '';
    const dead = (r.price > 0 && r.avgBuy > 0 && r.price <= r.avgBuy * 0.05)
      ? '<span class="badge dead">歸零</span>' : '';
    return '<tr>'
      + '<td><span class="sym">' + escapeHTML(r.symbol) + '</span>' + gold + dead + '<br>'
      + '<a class="mint" href="https://dexscreener.com/solana/' + r.mint
      + '" target="_blank" rel="noopener">' + shortAddr(r.mint) + '</a></td>'
      + '<td class="num">' + fmtUSD(r.costUSD) + '</td>'
      + '<td class="num">' + fmtPrice(r.avgBuy) + '</td>'
      + '<td class="num">' + fmtPrice(r.peak) + (r.partial ? ' *' : '') + '</td>'
      + '<td class="num ' + (r.mfeX >= 2 ? 'pos' : 'neg') + '">' + fmtX(r.mfeX) + '</td>'
      + '<td class="num">' + fmtUSD(r.idealUSD) + '</td>'
      + '<td class="num">' + fmtUSD(r.proceedsUSD + r.holdingUSD) + '</td>'
      + '<td class="num neg">' + fmtUSD(r.missedUSD) + '</td>'
      + '<td class="num">' + (isFinite(r.daysToPeak) ? r.daysToPeak.toFixed(1) : '—') + '</td>'
      + '</tr>';
  }).join('');

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
  const cav = [
    '掃描了 ' + m.txCount.toLocaleString() + ' 筆交易，辨識出 ' + m.totalFound
      + ' 隻成本 ≥ $' + m.minCost + ' 的幣'
      + (m.truncated ? '，本次只分析成本前 ' + d.rows.length + ' 隻（另有 ' + m.truncated
        + ' 隻未分析，可在進階設定調高上限）。' : '。'),
    '<b>最高價取自目前流動性最深的那個池子</b>。pump.fun 這類先在 bonding curve 交易、之後才遷移的幣，遷移前的價格不在這個池子裡，MFE 可能被低估。',
    '標了 <b>*</b> 的幣代表 K 線沒有完整覆蓋到你第一次買入的時間，最高價只算了有資料的區間。',
    '買入成本以「該筆交易錢包淨減少的 SOL / USDC / USDT」估算，SOL 以當日收盤價換算美元，跟實際成交價會有小幅誤差。',
    '「實際拿到」＝ 已賣出所得 ＋ 目前持倉市值。<b>轉出到沒填進來的地址不算賣出</b>，所以如果你還有其他錢包，記得一起貼上。',
  ];
  if (m.noPool.length) cav.push(m.noPool.length + ' 隻幣在 DexScreener 查不到池子（多半已完全歸零或下架），未列入報告。');
  if (m.noPeak) cav.push(m.noPeak + ' 隻幣抓不到歷史 K 線，最高價以現價與買入均價中較高者代替。');
  if (m.skippedMulti) cav.push(m.skippedMulti + ' 筆交易同時牽涉多隻代幣，只採計變動量最大的那隻。');
  $('#caveats-list').innerHTML = cav.map((c) => '<li>' + c + '</li>').join('');

  drawCard(d);
  $('#results').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------- 9. 分享圖 ----------
function drawCard(d) {
  const c = $('#share-canvas');
  const x = c.getContext('2d');
  const W = c.width, H = c.height, s = d.sum;

  const g = x.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, '#12061f');
  g.addColorStop(0.5, '#0b0d12');
  g.addColorStop(1, '#04140f');
  x.fillStyle = g;
  x.fillRect(0, 0, W, H);
  x.strokeStyle = 'rgba(153,69,255,.4)';
  x.lineWidth = 4;
  x.strokeRect(24, 24, W - 48, H - 48);

  const F = (w, sz) => w + ' ' + sz + 'px "Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif';
  x.textAlign = 'center';

  x.fillStyle = '#8b95a8'; x.font = F(600, 34);
  x.fillText('賣飛計算機 · SOLANA', W / 2, 120);

  x.fillStyle = '#e8ecf4'; x.font = F(700, 46);
  x.fillText('我買過 ' + s.n + ' 隻 memecoin', W / 2, 230);
  x.fillStyle = '#8b95a8'; x.font = F(500, 38);
  x.fillText('如果每一隻都賣在最高點', W / 2, 300);

  const gg = x.createLinearGradient(0, 340, W, 460);
  gg.addColorStop(0, '#14f195');
  gg.addColorStop(1, '#9945ff');
  x.fillStyle = gg; x.font = F(800, 118);
  x.fillText(fmtUSD(s.ideal), W / 2, 450);

  x.fillStyle = '#8b95a8'; x.font = F(500, 36);
  x.fillText('我實際拿到', W / 2, 540);
  x.fillStyle = '#e8ecf4'; x.font = F(800, 76);
  x.fillText(fmtUSD(s.actual), W / 2, 625);

  x.fillStyle = 'rgba(255,77,109,.12)';
  x.fillRect(80, 680, W - 160, 190);
  x.strokeStyle = 'rgba(255,77,109,.45)';
  x.lineWidth = 2;
  x.strokeRect(80, 680, W - 160, 190);
  x.fillStyle = '#ff4d6d'; x.font = F(600, 36);
  x.fillText('我錯過了', W / 2, 745);
  x.font = F(800, 92);
  x.fillText(fmtUSD(s.missed), W / 2, 840);

  const cells = [
    ['出場效率', fmtPct(s.efficiency)],
    ['10x 命中率', fmtPct(s.tiers[10] / s.n)],
    ['100x 命中', s.tiers[100] + ' 隻'],
    ['歸零率', fmtPct(s.dead / s.n)],
  ];
  cells.forEach((cell, i) => {
    const cx = W / 4 + (i % 2) * (W / 2);
    const cy = 960 + Math.floor(i / 2) * 150;
    x.fillStyle = '#8b95a8'; x.font = F(500, 30);
    x.fillText(cell[0], cx, cy);
    x.fillStyle = '#e8ecf4'; x.font = F(800, 58);
    x.fillText(cell[1], cx, cy + 66);
  });

  if (s.worst) {
    x.fillStyle = '#8b95a8'; x.font = F(500, 30);
    x.fillText('最痛的一隻：' + s.worst.symbol + '　最高漲了 ' + fmtX(s.worst.mfeX), W / 2, 1270);
  }
}

// ---------- 10. CSV ----------
function toCSV(d) {
  const head = ['symbol', 'mint', 'cost_usd', 'avg_buy_price', 'peak_price', 'mfe_x',
    'ideal_usd', 'realized_usd', 'holding_usd', 'missed_usd', 'days_to_peak',
    'buys', 'sells', 'current_price', 'first_buy_utc'];
  const lines = [head.join(',')];
  for (const r of d.rows) {
    lines.push([
      JSON.stringify(r.symbol), r.mint, r.costUSD.toFixed(2), r.avgBuy, r.peak,
      isFinite(r.mfeX) ? r.mfeX.toFixed(3) : '', r.idealUSD.toFixed(2),
      r.proceedsUSD.toFixed(2), r.holdingUSD.toFixed(2), r.missedUSD.toFixed(2),
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
$('#helius-key').value = localStorage.getItem('fomo:key') || '';
$('#addresses').value = localStorage.getItem('fomo:addrs') || '';

$('#run').addEventListener('click', async () => {
  $('#error').hidden = true;
  $('#results').hidden = true;
  $('#progress').hidden = false;
  $('#run').disabled = true;
  $('#cancel').hidden = false;
  try {
    render(await run());
  } catch (e) {
    if (e.message !== '__ABORT__') {
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

$('#download-card').addEventListener('click', () => {
  $('#share-canvas').toBlob((b) => download('sol-fomo.png', b), 'image/png');
});

$('#download-csv').addEventListener('click', () => {
  if (LAST) download('sol-fomo.csv', new Blob([toCSV(LAST)], { type: 'text/csv;charset=utf-8' }));
});

/* ISHTC 代理 Worker
 *
 * 讓訪客不用自備 API key：key 放在這裡的環境變數，網頁改打這支 Worker。
 * 同時做三件事：
 *   1. 代理 Helius（交易紀錄）與 Solana Tracker（區間最高價）
 *   2. 快取最高價查詢 —— 熱門幣大家都在查，一次查詢供多人共用，省下大半額度
 *   3. 記錄查詢（地址 + 統計 + handle），給之後的排行榜用
 *
 * 額度守門：每月用量記在 KV，超過上限回 429 + x-cooldown 標頭，
 * 前端看到就顯示「查詢用量過大暫時冷卻中」並開放訪客自填 key。
 */

const SOL_ADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** secret 貼進來時常帶著引號、空白甚至整條 endpoint URL，這裡自動拆乾淨 */
function cleanKey(raw, uuidStyle) {
  const s = String(raw || '').trim().replace(/^["']|["']$/g, '');
  if (uuidStyle) {
    const m = s.match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/);
    if (m) return m[0];
  }
  return s;
}

/**
 * 多把 key 輪替。
 * secret 可以是一把，也可以是逗號／換行分隔的很多把：
 *   npx wrangler secret put ST_KEYS      ← 貼一整串
 * 每把各自計月額度，用完或被拒就跳過，換下一把。
 */
function parseKeys(raw, uuidStyle) {
  return String(raw || '')
    .split(/[,\s]+/)
    .map((k) => cleanKey(k, uuidStyle))
    .filter(Boolean);
}

/** 某把 key 暫時不能用（401 無效、429 撞速率）就冰起來，避免一直撞同一把 */
const coolKey = (kind, i) => 'coolkey:' + kind + ':' + i;

/**
 * 依序挑一把還能用的 key：跳過冰在冷卻中的、跳過這個月額度已滿的。
 * 回傳 { key, index } 或 null（全部用完）。
 * 起點用計數器輪流轉，讓負載平均分散到每一把，而不是永遠先打第一把。
 */
async function pickKey(env, kind, keys, perKeyLimit) {
  if (!keys.length) return null;
  const month = new Date().toISOString().slice(0, 7);
  const turn = await bump(env, 'turn:' + kind, 1);
  const start = keys.length > 1 ? (turn % keys.length) : 0;
  for (let step = 0; step < keys.length; step++) {
    const i = (start + step) % keys.length;
    let cooling = null;
    try { cooling = await env.CACHE.get(coolKey(kind, i)); } catch (e) {}
    if (cooling) continue;
    // 每把自己的月額度
    const used = await bump(env, 'usage:' + month + ':' + kind + ':' + i, 1);
    if (used && perKeyLimit && used > perKeyLimit) continue;
    return { key: keys[i], index: i };
  }
  return null;
}

/**
 * 打上游；某把 key 被拒（401 無效／429 撞速率）就冰起來換下一把，最多試 3 把。
 * 訪客不該因為「我們其中一把 key 壞了」而看到錯誤。
 * 回傳 { r, picked }；完全沒 key 可用時回 null（呼叫端回冷卻）。
 */
async function fetchWithKeys(env, kind, keys, perKeyLimit, build) {
  let last = null;
  const tries = Math.min(3, keys.length);
  for (let attempt = 0; attempt < tries; attempt++) {
    const picked = await pickKey(env, kind, keys, perKeyLimit);
    if (!picked) return last;
    const r = await build(picked.key);
    if (r.status !== 401 && r.status !== 429) return { r: r, picked: picked };
    await coolDownKey(env, kind, picked.index, r.status);
    last = { r: r, picked: picked };
  }
  return last;
}

/** 這把 key 掛了：冰 10 分鐘（401 這種無效的冰久一點） */
async function coolDownKey(env, kind, i, status) {
  await kvPut(env, coolKey(kind, i), String(status), {
    expirationTtl: status === 401 ? 6 * 3600 : 600,
  });
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Expose-Headers': 'x-cooldown, x-cache',
};

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS, ...headers },
  });

/**
 * 一筆幣價記錄可以撐多久才需要重查 —— 看「高點是多久以前的事」。
 * 三個月前衝上去、早就跌回來的死幣，高點幾乎不可能再變，卻每 6 小時重查一次，
 * 純粹是把額度燒在不會變的東西上。還在動的幣才需要頻繁更新。
 */
function peakTtl(peakTs, nowS) {
  const age = nowS - (peakTs || 0);
  if (age > 60 * 86400) return 14 * 86400;   // 兩個月前的高點：兩週不用重查
  if (age > 7 * 86400) return 3 * 86400;     // 一週以上：三天
  return 6 * 3600;                           // 還很新鮮：維持六小時
}

const cooldown = () =>
  json({ code: 'cooldown', message: '查詢用量過大，暫時冷卻中 —— 等 DEV 充值' }, 429, { 'x-cooldown': '1' });

/** KV 寫入失敗（超出每日額度、暫時故障）不能讓查詢掛掉 */
async function kvPut(env, key, val, opts) {
  try { await env.CACHE.put(key, val, opts); } catch (e) { /* 失敗就當沒快取 */ }
}

/**
 * 計數器：累加後回傳新值。放 D1 不放 KV ——
 * KV 免費額度只有 1,000 次寫入/天，每個請求都要記數的話一次大查詢就爆，
 * 而且 put 拋錯會讓整個 Worker 回 500。D1 是 10 萬次寫入/天。
 * 壞掉時回 0，呼叫端一律放行（可用性優先，上游本身也有自己的限流）。
 */
async function bump(env, name, cost) {
  if (!env.DB) return 0;
  const now = Math.floor(Date.now() / 1000);
  try {
    const row = await env.DB.prepare(
      'INSERT INTO counters (name, n, ts) VALUES (?1, ?2, ?3) '
      + 'ON CONFLICT(name) DO UPDATE SET n = n + ?2, ts = ?3 RETURNING n')
      .bind(name, cost, now).first();
    return (row && row.n) || 0;
  } catch (e) {
    return 0;
  }
}

/** 本月的用量計數。cost 以「次」計。 */
async function takeQuota(env, kind, cost, limit) {
  const name = 'usage:' + new Date().toISOString().slice(0, 7) + ':' + kind;
  const n = await bump(env, name, cost);
  if (!n) return true;              // 計數器壞掉 → 放行
  return n <= limit;
}

/** 每 IP 每分鐘的簡單限流，防止被外人惡意刷爆 */
async function rateLimit(env, ip, max) {
  const name = 'rl:' + ip + ':' + Math.floor(Date.now() / 60000);
  const n = await bump(env, name, 1);
  if (!n) return true;              // 計數器壞掉 → 放行
  // 順手清掉十分鐘前的限流列（機率觸發，不必每次都做）
  if (Math.random() < 0.02 && env.DB) {
    try {
      await env.DB.prepare("DELETE FROM counters WHERE ts < ? AND name LIKE 'rl:%'")
        .bind(Math.floor(Date.now() / 1000) - 600).run();
    } catch (e) { /* 清不掉沒關係 */ }
  }
  return n <= max;
}

// ---------- 熱門幣預載（GeckoTerminal，免金鑰、不消耗 Solana Tracker 額度）----------
// 定時把當下熱門的幣先算好存進資料庫，訪客查到這些幣時就不必再打付費 API。
const SCAN_YEAR = 2026;
const SCAN_FROM = Math.floor(Date.UTC(SCAN_YEAR, 0, 1) / 1000);
const GT = 'https://api.geckoterminal.com/api/v2';

/** Cloudflare 免費方案每次執行最多 50 個外部請求，留餘裕 */
const PRELOAD_BATCH = 10;

async function gtJSON(url) {
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!r.ok) return null;
  try { return await r.json(); } catch (e) { return null; }
}

/** 熱門池 → [{ pool, mint }]，pool id 長得像 "solana_xxx"，要把前綴拆掉 */
async function trendingPools() {
  const outList = [];
  const seen = new Set();
  for (const path of ['/networks/solana/trending_pools?page=1', '/networks/solana/pools?page=1']) {
    const j = await gtJSON(GT + path);
    for (const row of (j && j.data) || []) {
      const pool = String(row.id || '').replace(/^solana_/, '');
      const rel = row.relationships || {};
      const baseId = rel.base_token && rel.base_token.data && rel.base_token.data.id;
      const mint = String(baseId || '').replace(/^solana_/, '');
      if (!pool || !SOL_ADDR.test(mint) || seen.has(mint)) continue;
      seen.add(mint);
      outList.push({ pool: pool, mint: mint });
    }
  }
  return outList;
}

/**
 * 算出這隻幣在掃描年度內的最高價。
 * GeckoTerminal 日線一次只回約 181 根、往前翻頁要付費，
 * 所以我們誠實記錄「實際看得到的最早那天」當 from_day ——
 * 買得比這更早的訪客不會誤用這筆記錄，會照常去查 Solana Tracker。
 */
async function peakFromGecko(pool) {
  const r = await fetch(GT + '/networks/solana/pools/' + pool
    + '/ohlcv/day?aggregate=1&limit=1000&currency=usd', { headers: { Accept: 'application/json' } });
  if (r.status === 429) return 'throttled';       // 被擋了，這一輪收手
  if (!r.ok) return null;
  let j = null;
  try { j = await r.json(); } catch (e) { return null; }
  const raw = (j && j.data && j.data.attributes && j.data.attributes.ohlcv_list) || [];
  if (!raw.length) return null;
  let best = 0, bestTs = 0, oldest = Infinity;
  for (const c of raw) {
    const ts = Number(c[0]) || 0;
    const high = Number(c[2]) || 0;
    if (ts < oldest) oldest = ts;
    if (ts < SCAN_FROM) continue;             // 只看掃描年度內
    if (high > best) { best = high; bestTs = ts; }
  }
  if (!(best > 0)) return null;
  return {
    peak: best,
    peakTs: bestTs,
    // 記錄的適用起點：不能早於我們實際看得到的資料
    fromTs: Math.max(SCAN_FROM, oldest === Infinity ? SCAN_FROM : oldest),
  };
}

/** GeckoTerminal 免金鑰限制很緊（連打第 4 次就 429），每次呼叫之間要留空檔 */
const GT_GAP_MS = 2600;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 記住這隻幣的池子，下次刷新就不必再找 */
async function rememberPool(env, mint, pool) {
  try {
    await env.DB.prepare(
      'INSERT OR REPLACE INTO token_pools (mint, pool, ts) VALUES (?, ?, ?)')
      .bind(mint, pool, Math.floor(Date.now() / 1000)).run();
  } catch (e) { /* 記不起來就下次再查 */ }
}

/**
 * 跑一批預載。順序很重要：
 *   1. 先刷新「已經有人查過、但記錄快過期」的幣 —— 這些是真的會被查到的
 *   2. 再補當下的熱門新幣 —— 為將來的查詢鋪路
 * 全程只打 GeckoTerminal（免金鑰），不消耗 Solana Tracker 額度。
 */
async function preloadBatch(env, limit) {
  if (!env.DB) return { ok: false, reason: 'no DB' };
  const nowS = Math.floor(Date.now() / 1000);
  const targets = [];
  const seen = new Set();

  // 1) 該刷新的舊幣（有記著池子才刷得動）
  let refreshCandidates = 0;
  try {
    const rows = (await env.DB.prepare(
      'SELECT p.mint AS mint, l.pool AS pool, p.peak_ts AS peak_ts, p.updated AS updated '
      + 'FROM token_peaks p JOIN token_pools l ON l.mint = p.mint '
      + 'GROUP BY p.mint ORDER BY p.updated ASC LIMIT 80').all()).results || [];
    for (const r of rows) {
      if (targets.length >= limit) break;
      if ((nowS - (r.updated || 0)) <= peakTtl(r.peak_ts, nowS)) continue;   // 還新鮮
      if (seen.has(r.mint)) continue;
      seen.add(r.mint);
      refreshCandidates++;
      targets.push({ mint: r.mint, pool: r.pool, kind: 'refresh' });
    }
  } catch (e) { /* 表還沒建好就跳過這一段 */ }

  // 2) 熱門新幣
  let trending = [];
  if (targets.length < limit) {
    try { trending = await trendingPools(); } catch (e) { trending = []; }
    for (const item of trending) {
      if (targets.length >= limit) break;
      if (seen.has(item.mint)) continue;
      seen.add(item.mint);
      targets.push({ mint: item.mint, pool: item.pool, kind: 'new' });
    }
  }

  let stored = 0, skipped = 0, failed = 0, throttled = false;
  for (let i = 0; i < targets.length; i++) {
    const item = targets[i];
    // 熱門那批可能已經夠新，先問一下再決定要不要花這次請求
    if (item.kind === 'new') {
      try {
        const row = await env.DB.prepare(
          'SELECT peak_ts, updated FROM token_peaks WHERE mint = ? ORDER BY updated DESC LIMIT 1')
          .bind(item.mint).first();
        if (row && (nowS - (row.updated || 0)) <= peakTtl(row.peak_ts, nowS)) { skipped++; continue; }
      } catch (e) { /* 查不到就當沒有 */ }
    }

    if (i > 0) await sleep(GT_GAP_MS);            // 節流，避免被 GeckoTerminal 擋
    let pk = null;
    try { pk = await peakFromGecko(item.pool); } catch (e) {}
    if (pk === 'throttled') { throttled = true; break; }   // 被擋了就收手，留給下一輪
    if (!pk) { failed++; continue; }

    try {
      await env.DB.prepare(
        'INSERT OR REPLACE INTO token_peaks (mint, from_day, peak, peak_ts, mcap, updated) '
        + 'VALUES (?, ?, ?, ?, ?, ?)')
        .bind(item.mint, Math.floor(pk.fromTs / 86400), pk.peak, pk.peakTs, null, nowS)
        .run();
      await rememberPool(env, item.mint, item.pool);
      stored++;
    } catch (e) { failed++; }
  }

  await bump(env, 'preload:' + new Date().toISOString().slice(0, 7), stored);
  return {
    ok: true, stored: stored, skipped: skipped, failed: failed,
    refreshed: refreshCandidates, trending: trending.length, throttled: throttled,
  };
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const url = new URL(request.url);
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const heliusLimit = Math.floor((Number(env.HELIUS_MONTHLY_CREDITS) || 1000000) / 100);
    const stLimit = Number(env.ST_MONTHLY_LIMIT) || 10000;

    if (url.pathname === '/health') {
      const month = new Date().toISOString().slice(0, 7);
      const readCount = async (name) => {
        if (!env.DB) return 0;
        try {
          const row = await env.DB.prepare('SELECT n FROM counters WHERE name = ?').bind(name).first();
          return (row && row.n) || 0;
        } catch (e) { return 0; }
      };
      const h = await readCount('usage:' + month + ':helius');
      const s = await readCount('usage:' + month + ':st');
      const heliusN = parseKeys(env.HELIUS_KEYS || env.HELIUS_KEY, true).length;
      const stN = parseKeys(env.ST_KEYS || env.ST_KEY, false).length;
      const perKey = async (kind, n, limit) => {
        const list = [];
        for (let i = 0; i < n; i++) {
          let cooling = null;
          try { cooling = await env.CACHE.get(coolKey(kind, i)); } catch (e) {}
          list.push({
            i: i,
            used: await readCount('usage:' + month + ':' + kind + ':' + i),
            limit: limit,
            cooling: cooling || null,
          });
        }
        return list;
      };
      let tokens = null, saved = null;
      if (env.DB) {
        try {
          const q = await env.DB.prepare(
            'SELECT COUNT(*) AS rows, COUNT(DISTINCT mint) AS mints FROM token_peaks').first();
          tokens = q ? q.mints : null;
          saved = q ? q.rows : null;
        } catch (e) { /* 表還沒建 */ }
      }
      return json({
        ok: true, month,
        helius: h + '/' + (heliusLimit * Math.max(1, heliusN)),
        st: s + '/' + (stLimit * Math.max(1, stN)),
        keys: { helius: heliusN, st: stN },
        perKey: {
          helius: await perKey('helius', heliusN, heliusLimit),
          st: await perKey('st', stN, stLimit),
        },
        preloaded: await readCount('preload:' + month),
        db: { tokens: tokens, records: saved },
      });
    }

    if (!(await rateLimit(env, ip, Number(env.IP_RATE_PER_MIN) || 120))) {
      return json({ code: 'rate_limited' }, 429);
    }

    // ---- 代理：Helius 交易紀錄 ----
    if (url.pathname === '/helius/txs') {
      const address = url.searchParams.get('address') || '';
      const before = url.searchParams.get('before') || '';
      if (!SOL_ADDR.test(address)) return json({ error: 'bad address' }, 400);
      if (before && !/^[1-9A-HJ-NP-Za-km-z]{40,120}$/.test(before)) return json({ error: 'bad cursor' }, 400);
      const heliusKeys = parseKeys(env.HELIUS_KEYS || env.HELIUS_KEY, true);
      if (!heliusKeys.length) return json({ error: 'HELIUS_KEY not configured' }, 500);
      // 總量守門（所有 key 加起來）+ 每把各自的額度
      if (!(await takeQuota(env, 'helius', 1, heliusLimit * heliusKeys.length))) return cooldown();
      const got = await fetchWithKeys(env, 'helius', heliusKeys, heliusLimit, (k) =>
        fetch('https://api.helius.xyz/v0/addresses/' + address + '/transactions'
          + '?api-key=' + k + '&limit=100' + (before ? '&before=' + before : '')));
      if (!got) return cooldown();
      return new Response(got.r.body, {
        status: got.r.status,
        headers: { 'Content-Type': 'application/json', 'x-key': String(got.picked.index), ...CORS },
      });
    }

    // ---- 代理：Solana Tracker 區間最高價（KV 短快取 + D1 幣價資料庫）----
    if (url.pathname === '/st/range') {
      const token = url.searchParams.get('token') || '';
      const from = Math.floor(Number(url.searchParams.get('time_from')) || 0);
      const to = Math.floor(Number(url.searchParams.get('time_to')) || 0);
      if (!SOL_ADDR.test(token) || !(from > 0) || !(to > from)) return json({ error: 'bad params' }, 400);
      const fromDay = Math.floor(from / 86400);
      const nowS = Math.floor(Date.now() / 1000);

      // 1) KV：同一天同一隻幣的短快取（最快）
      const cacheKey = 'st:' + token + ':' + fromDay;
      const hit = await env.CACHE.get(cacheKey);
      if (hit) return new Response(hit, { headers: { 'Content-Type': 'application/json', 'x-cache': 'hit', ...CORS } });

      // 2) D1 幣價資料庫：別人查過這隻幣，而且最高點落在你的持有期間內 → 直接給答案
      //    （最高點在你買入之後才發生，代表那個價格你也「有機會賣到」，數值精確）
      if (env.DB) {
        try {
          // 同一隻幣可能有好幾筆（不同起點、不同時間刷新的）。
          // 只挑「還新鮮」的那些，再從中取最高價 —— 不能讓一筆過期的舊記錄
          // 因為數字比較大就擋住後面那筆剛刷新的。
          const cands = (await env.DB.prepare(
            'SELECT peak, peak_ts, mcap, updated FROM token_peaks '
            + 'WHERE mint = ? AND from_day <= ? AND peak_ts >= ? '
            + 'ORDER BY updated DESC LIMIT 5')
            .bind(token, fromDay, from).all()).results || [];
          let row = null;
          for (const c of cands) {
            if ((nowS - (c.updated || 0)) > peakTtl(c.peak_ts, nowS)) continue;
            if (!row || c.peak > row.peak) row = c;
          }
          if (row && row.peak > 0) {
            const body = JSON.stringify({
              price: { highest: { price: row.peak, time: row.peak_ts, marketcap: row.mcap || 0 } },
            });
            await kvPut(env, cacheKey, body, {
              expirationTtl: Math.min(6 * 3600, peakTtl(row.peak_ts, nowS)),
            });
            return new Response(body, {
              headers: { 'Content-Type': 'application/json', 'x-cache': 'db', ...CORS },
            });
          }
        } catch (e) { /* 資料表還沒建好就當沒有 */ }
      }

      // 3) 都沒有才真的去打 API
      const stKeys = parseKeys(env.ST_KEYS || env.ST_KEY, false);
      if (!stKeys.length) return json({ error: 'ST_KEY not configured' }, 500);
      if (!(await takeQuota(env, 'st', 1, stLimit * stKeys.length))) return cooldown();
      const gotSt = await fetchWithKeys(env, 'st', stKeys, stLimit, (k) =>
        fetch('https://data.solanatracker.io/price/history/range?token=' + token
          + '&time_from=' + from + '&time_to=' + to, { headers: { 'x-api-key': k } }));
      if (!gotSt) return cooldown();
      const r = gotSt.r;
      const body = await r.text();
      if (r.ok) {
        await kvPut(env, cacheKey, body, { expirationTtl: 6 * 3600 });
        // 存進資料庫，之後所有人都能共用這一次查詢
        if (env.DB) {
          try {
            const h = JSON.parse(body).price.highest;
            if (h && h.price > 0) {
              await env.DB.prepare(
                'INSERT OR REPLACE INTO token_peaks (mint, from_day, peak, peak_ts, mcap, updated) '
                + 'VALUES (?, ?, ?, ?, ?, ?)')
                .bind(token, fromDay, h.price, Math.floor(h.time || from), h.marketcap || null, nowS)
                .run();
            }
          } catch (e) { /* 存不進去不影響回應 */ }
        }
      }
      return new Response(body, { status: r.status, headers: { 'Content-Type': 'application/json', ...CORS } });
    }

    // ---- 查詢記錄（排行榜資料）----
    if (url.pathname === '/log' && request.method === 'POST') {
      let b;
      try { b = await request.json(); } catch (e) { return json({ error: 'bad json' }, 400); }
      const addrs = (Array.isArray(b.addresses) ? b.addresses : [])
        .filter((a) => SOL_ADDR.test(String(a))).slice(0, 10);
      if (!addrs.length) return json({ error: 'no address' }, 400);
      const s = b.stats || {};
      const num = (v) => (isFinite(Number(v)) ? Number(v) : null);
      try {
        if (env.DB) {
          await env.DB.prepare(
            'INSERT INTO queries (ts, addresses, handle, tokens, cost_usd, ideal_usd, actual_usd, missed_usd, big_rate, small_rate, efficiency) '
            + 'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
            .bind(Date.now(), addrs.join(' '), String(b.handle || '').slice(0, 32) || null,
              num(s.n), num(s.cost), num(s.ideal), num(s.actual), num(s.missed),
              num(s.bigRate), num(s.smallRate), num(s.efficiency))
            .run();
        }
      } catch (e) { /* 記錄失敗不影響使用者 */ }
      return json({ ok: true });
    }

    // ---- 全站排行榜：同一組地址取最新一筆；金狗榜要求至少買過 10 隻 ----
    if (url.pathname === '/leaderboard') {
      const hit = await env.CACHE.get('leaderboard');
      if (hit) return new Response(hit, { headers: { 'Content-Type': 'application/json', 'x-cache': 'hit', ...CORS } });
      let missed = [], pain = [], dogs = [];
      const pick = 'addresses, handle, tokens, cost_usd, missed_usd, big_rate, small_rate, MAX(ts) AS ts';
      try {
        if (env.DB) {
          // 賣飛榜不能純看金額：砸 5000U 快進快出的人一定贏過砸 100U 抱到十萬倍的人。
          // 用「成本開根號」正規化 → 金額仍是主角，但大戶的優勢被壓縮，
          // 小額大賣飛才排得上來。門檻：成本 >= $50、至少 3 隻幣（擋灰塵與單押）。
          const pool = (await env.DB.prepare(
            'SELECT ' + pick + ' FROM queries '
            + 'WHERE missed_usd > 0 AND cost_usd >= 50 AND tokens >= 3 '
            + 'GROUP BY addresses ORDER BY missed_usd DESC LIMIT 300').all()).results || [];
          // 金額榜：純看錯過多少錢（本金大的人本來就容易上榜，這榜就是給他們的）
          missed = pool.slice().sort((a, b) => b.missed_usd - a.missed_usd).slice(0, 20);
          // 痛苦指數榜：錯過金額 / sqrt(總成本) —— 小額大賣飛才痛
          pain = pool
            .map((r) => Object.assign({}, r, {
              score: r.missed_usd / Math.sqrt(Math.max(50, r.cost_usd || 50)),
            }))
            .sort((a, b) => b.score - a.score)
            .slice(0, 20);
          dogs = (await env.DB.prepare(
            'SELECT ' + pick + ', CAST(ROUND(big_rate * tokens) AS INTEGER) AS big_dogs '
            + 'FROM queries WHERE tokens >= 10 AND big_rate > 0 GROUP BY addresses '
            + 'ORDER BY big_dogs DESC, big_rate DESC LIMIT 20').all()).results || [];
        }
      } catch (e) { /* 表未建好等情況：回空榜 */ }
      const body = JSON.stringify({ missed, pain, dogs });
      await kvPut(env, 'leaderboard', body, { expirationTtl: 600 });
      return new Response(body, { headers: { 'Content-Type': 'application/json', ...CORS } });
    }

    // ---- 手動觸發一次預載（方便部署後立刻驗證，平常交給 Cron）----
    if (url.pathname === '/preload') {
      const n = Math.min(PRELOAD_BATCH, Math.max(1, Number(url.searchParams.get('n')) || PRELOAD_BATCH));
      const r = await preloadBatch(env, n);
      return json(r);
    }

    return json({ error: 'not found' }, 404);
  },

  /** Cron 定時觸發：自動把熱門幣預載進資料庫，全程不消耗 Solana Tracker 額度 */
  async scheduled(event, env, ctx) {
    ctx.waitUntil(preloadBatch(env, PRELOAD_BATCH));
  },
};

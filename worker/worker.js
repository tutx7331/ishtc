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

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Expose-Headers': 'x-cooldown',
};

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS, ...headers },
  });

const cooldown = () =>
  json({ code: 'cooldown', message: '查詢用量過大，暫時冷卻中' }, 429, { 'x-cooldown': '1' });

/** 本月的用量計數（KV 非原子性，粗略即可）。cost 以「次」計。 */
async function takeQuota(env, kind, cost, limit) {
  const key = 'usage:' + new Date().toISOString().slice(0, 7) + ':' + kind;
  const used = Number(await env.CACHE.get(key)) || 0;
  if (used + cost > limit) return false;
  // 保留到月底後 5 天即可
  await env.CACHE.put(key, String(used + cost), { expirationTtl: 40 * 86400 });
  return true;
}

/** 每 IP 每分鐘的簡單限流，防止被外人惡意刷爆 */
async function rateLimit(env, ip, max) {
  const key = 'rl:' + ip + ':' + Math.floor(Date.now() / 60000);
  const n = Number(await env.CACHE.get(key)) || 0;
  if (n >= max) return false;
  await env.CACHE.put(key, String(n + 1), { expirationTtl: 120 });
  return true;
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
      const h = Number(await env.CACHE.get('usage:' + month + ':helius')) || 0;
      const s = Number(await env.CACHE.get('usage:' + month + ':st')) || 0;
      return json({ ok: true, month, helius: h + '/' + heliusLimit, st: s + '/' + stLimit });
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
      if (!env.HELIUS_KEY) return json({ error: 'HELIUS_KEY not configured' }, 500);
      if (!(await takeQuota(env, 'helius', 1, heliusLimit))) return cooldown();

      const upstream = 'https://api.helius.xyz/v0/addresses/' + address + '/transactions'
        + '?api-key=' + env.HELIUS_KEY + '&limit=100' + (before ? '&before=' + before : '');
      const r = await fetch(upstream);
      return new Response(r.body, {
        status: r.status,
        headers: { 'Content-Type': 'application/json', ...CORS },
      });
    }

    // ---- 代理：Solana Tracker 區間最高價（含快取）----
    if (url.pathname === '/st/range') {
      const token = url.searchParams.get('token') || '';
      const from = Math.floor(Number(url.searchParams.get('time_from')) || 0);
      const to = Math.floor(Number(url.searchParams.get('time_to')) || 0);
      if (!SOL_ADDR.test(token) || !(from > 0) || !(to > from)) return json({ error: 'bad params' }, 400);
      if (!env.ST_KEY) return json({ error: 'ST_KEY not configured' }, 500);

      // 快取鍵用「哪一天開始買」就夠準；同一隻熱門幣一次查詢供所有人共用
      const cacheKey = 'st:' + token + ':' + Math.floor(from / 86400);
      const hit = await env.CACHE.get(cacheKey);
      if (hit) return new Response(hit, { headers: { 'Content-Type': 'application/json', 'x-cache': 'hit', ...CORS } });

      if (!(await takeQuota(env, 'st', 1, stLimit))) return cooldown();

      const r = await fetch('https://data.solanatracker.io/price/history/range?token=' + token
        + '&time_from=' + from + '&time_to=' + to, { headers: { 'x-api-key': env.ST_KEY } });
      const body = await r.text();
      if (r.ok) await env.CACHE.put(cacheKey, body, { expirationTtl: 6 * 3600 });
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

    return json({ error: 'not found' }, 404);
  },
};

/* ISHTC 狗房 —— 像素風 2.5D 操盤室
 *
 * 每一隻幣是一條狗：大金狗（亮金+皇冠）、小金狗（金色）、普通（柴犬色）。
 * 查詢進行中每算完一隻就有一條狗跑進房間；點狗顯示幣名與 MFE。
 * 房間是 trader 風格：行情牆（多螢幕 K 線）、跑馬燈、簡約家具。
 *
 * 對外 API（app.js 呼叫，全部可選）：
 *   DogRoom.reset()                 開始新查詢，清場
 *   DogRoom.addDog(info)            {sym, mfeX, tier:'big'|'gold'|'norm'}
 *   DogRoom.setAll(list, total)     查詢完成，以最終名單取代（金狗優先入選）
 *   DogRoom.stamp(ctx,x,y,s,tier,d) 把一隻狗蓋章到任意 canvas（分享卡用）
 */
(function () {
  'use strict';

  // ---------- 像素狗 ----------
  // 4 個運動幀的腿部偏移（單位：藝術像素）
  const GAIT = [
    { f1: 0, f2: 0, b1: 0, b2: 0 },       // 站立
    { f1: -2, f2: 1, b1: 1, b2: -2 },     // 跑 A
    { f1: 0, f2: 0, b1: 0, b2: 0 },       // 過渡
    { f1: 1, f2: -2, b1: -2, b2: 1 },     // 跑 B
  ];
  const TIERS = {
    big:  { body: '#ffd34d', shade: '#d99a1d', chest: '#fff3c4', crown: true,  glow: 'rgba(255,211,77,.30)' },
    gold: { body: '#f0b429', shade: '#b8791a', chest: '#ffe9a8', crown: false, glow: 'rgba(240,180,41,.22)' },
    norm: { body: '#b98a4f', shade: '#7d5a2e', chest: '#e8d5b5', crown: false, glow: null },
  };

  /**
   * 畫一條狗。(x,y) 是腳底中心；s 是每個藝術像素的實際 px；dir 1=向右 -1=向左。
   * phase 控制跑步循環與尾巴搖擺；moving=false 時站立只搖尾巴。
   */
  function stamp(c, x, y, s, tier, dir, phase, moving) {
    const T = TIERS[tier] || TIERS.norm;
    const g = GAIT[moving ? (Math.floor(phase * 8) % 4) : 0];
    const bob = moving ? Math.round(Math.sin(phase * Math.PI * 8)) : 0;
    const wag = Math.floor(phase * 10) % 2;

    c.save();
    c.translate(Math.round(x), Math.round(y));
    if (dir < 0) c.scale(-1, 1);
    const px = (cx, cy, w, h, color) => { c.fillStyle = color; c.fillRect(cx * s, cy * s, w * s, h * s); };
    // 以腳底中心為原點：藝術座標 x -7..8, y -11..0
    c.translate(-7 * s, (-11 + bob) * s);

    if (T.glow) {                               // 金狗身上有微光
      c.fillStyle = T.glow;
      c.fillRect(0 * s, 1 * s, 16 * s, 10 * s);
    }
    // 尾巴（上翹，兩節，搖擺）
    px(0, 3 + wag, 1, 2, T.shade);
    px(1, 4, 1, 2, T.body);
    // 身體 8x4 + 底部陰影色
    px(2, 5, 8, 3, T.body);
    px(2, 8, 8, 1, T.shade);
    // 胸口淺色
    px(8, 6, 2, 3, T.chest);
    // 頭 5x4 + 吻部
    px(9, 2, 5, 4, T.body);
    px(13, 4, 2, 2, T.chest);
    // 耳朵兩隻
    px(9, 1, 1, 1, T.shade);
    px(12, 1, 1, 1, T.shade);
    // 眼睛、鼻子
    px(12, 3, 1, 1, '#1a1208');
    px(14, 4, 1, 1, '#1a1208');
    // 四條腿（跑步時前後交錯，用水平偏移呈現步伐）
    px(3 + g.b1, 9, 1, 2, T.shade);
    px(5 + g.b2, 9, 1, 2, T.body);
    px(8 + g.f1, 9, 1, 2, T.shade);
    px(10 + g.f2, 9, 1, 2, T.body);
    // 皇冠（大金狗）
    if (T.crown) {
      px(10, 0, 1, 1, '#ffe9a8');
      px(12, 0, 1, 1, '#ffe9a8');
      px(10, 1, 3, 1, '#ffd34d');
    }
    c.restore();
  }

  // ---------- 房間 ----------
  const cv = typeof document !== 'undefined' && document.getElementById('dog-room');
  if (!cv) { if (typeof window !== 'undefined') window.DogRoom = { stamp: stamp, reset: noop, addDog: noop, setAll: noop }; return; }
  function noop() {}

  const panel = document.getElementById('dog-room-panel');
  const hintEl = document.getElementById('dog-room-hint');
  const ctx = cv.getContext('2d');
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  let W = 0, H = 0, dpr = 1, floorTop = 0;
  let dogs = [];           // 場上的狗
  let total = 0;           // 全部幣數（可能超過上限）
  let ticker = [];         // 跑馬燈內容
  let tickerX = 0;
  let monitors = [];       // 每個螢幕的行情序列
  let raf = 0, last = 0, monLast = 0;
  let inView = true;

  const maxDogs = () => (W < 520 ? 70 : 120);

  function resize() {
    const w = cv.clientWidth || (cv.parentElement ? cv.parentElement.clientWidth - 44 : 600);
    if (!w) return;
    dpr = Math.min(2, (window.devicePixelRatio || 1));
    W = w;
    H = Math.round(Math.max(240, Math.min(400, w * 0.42)));
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    cv.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    floorTop = Math.round(H * 0.52);
  }

  function mkMonitors() {
    monitors = [];
    for (let i = 0; i < 6; i++) {
      const arr = [];
      let v = 0.5;
      for (let j = 0; j < 22; j++) { v = Math.min(0.95, Math.max(0.05, v + (Math.random() - 0.48) * 0.18)); arr.push(v); }
      monitors.push(arr);
    }
  }

  function tickMonitors() {
    for (const m of monitors) {
      const v = Math.min(0.95, Math.max(0.05, m[m.length - 1] + (Math.random() - 0.48) * 0.18));
      m.push(v); m.shift();
    }
  }

  function mkDog(info) {
    const depth = 0.15 + Math.random() * 0.85;
    return {
      sym: info.sym || '?', mfeX: info.mfeX, tier: info.tier || 'norm',
      x: Math.random() < 0.5 ? -20 : W + 20,   // 從左右門口跑進來
      tx: 30 + Math.random() * (W - 60),
      depth: depth, tdepth: depth,
      dir: 1, phase: Math.random() * 10,
      speed: 26 + Math.random() * 30,
      idleT: 0, sayT: 0,
    };
  }

  function updateDog(d, dt) {
    d.phase += dt * (d.idleT > 0 ? 0.35 : 1.1);
    if (d.sayT > 0) d.sayT -= dt;
    if (d.idleT > 0) {                                     // 發呆中
      d.idleT -= dt;
      if (d.idleT <= 0) {
        d.tx = 24 + Math.random() * (W - 48);
        d.tdepth = 0.12 + Math.random() * 0.88;
      }
      return;
    }
    const dx = d.tx - d.x, dd = d.tdepth - d.depth;
    const dist = Math.abs(dx);
    if (dist < 4 && Math.abs(dd) < 0.03) {                 // 到目的地 → 發呆一下
      d.idleT = 0.8 + Math.random() * 2.6;
      return;
    }
    const v = d.speed * (0.6 + d.depth * 0.5) * dt;
    d.x += Math.sign(dx) * Math.min(Math.abs(dx), v);
    d.depth += Math.sign(dd) * Math.min(Math.abs(dd), dt * 0.12);
    if (Math.abs(dx) > 2) d.dir = Math.sign(dx);
  }

  function dogScreen(d) {
    const s = (W < 520 ? 1.6 : 2) * (0.62 + d.depth * 0.55) * (d.tier === 'big' ? 1.3 : 1);
    const y = floorTop + 12 + d.depth * (H - floorTop - 26);
    return { s: s, y: y };
  }

  // ---------- 繪製 ----------
  function drawRoom(t) {
    // 牆與地板
    ctx.fillStyle = '#101318';
    ctx.fillRect(0, 0, W, floorTop);
    ctx.fillStyle = '#161b24';
    ctx.fillRect(0, floorTop, W, H - floorTop);
    // 地板透視線（2.5D 感）
    ctx.strokeStyle = 'rgba(232,236,244,.05)';
    ctx.lineWidth = 1;
    for (let i = 1; i <= 4; i++) {
      const y = floorTop + (H - floorTop) * (i / 4.6);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
    ctx.beginPath(); ctx.moveTo(W * 0.18, H); ctx.lineTo(W * 0.30, floorTop); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(W * 0.82, H); ctx.lineTo(W * 0.70, floorTop); ctx.stroke();
    // 踢腳線
    ctx.fillStyle = '#0b0d12';
    ctx.fillRect(0, floorTop - 3, W, 3);

    // ---- 行情牆：桌 + 6 螢幕 ----
    const deskX = Math.round(W * 0.06), deskW = Math.round(W * 0.46);
    const deskY = floorTop - 8, deskH = 34;
    // 螢幕 2 排 x 3
    const mw = Math.floor(deskW / 3) - 8, mh = 26;
    for (let i = 0; i < 6; i++) {
      const col = i % 3, row = Math.floor(i / 3);
      const mx = deskX + col * (mw + 10), my = deskY - 34 - row * (mh + 8);
      ctx.fillStyle = '#05070b';
      ctx.fillRect(mx - 2, my - 2, mw + 4, mh + 4);
      ctx.fillStyle = '#0a0f16';
      ctx.fillRect(mx, my, mw, mh);
      const m = monitors[i] || [];
      const up = m.length > 1 && m[m.length - 1] >= m[0];
      ctx.strokeStyle = up ? 'rgba(20,241,149,.85)' : 'rgba(255,77,109,.85)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let j = 0; j < m.length; j++) {
        const px2 = mx + 2 + (j / (m.length - 1)) * (mw - 4);
        const py = my + mh - 3 - m[j] * (mh - 6);
        j ? ctx.lineTo(px2, py) : ctx.moveTo(px2, py);
      }
      ctx.stroke();
      // 螢幕微光
      ctx.fillStyle = up ? 'rgba(20,241,149,.05)' : 'rgba(255,77,109,.05)';
      ctx.fillRect(mx, my, mw, mh);
    }
    // 桌面與桌腳
    ctx.fillStyle = '#232833';
    ctx.fillRect(deskX - 6, deskY, deskW + 12, 6);
    ctx.fillStyle = '#171b22';
    ctx.fillRect(deskX, deskY + 6, 5, deskH - 6);
    ctx.fillRect(deskX + deskW - 5, deskY + 6, 5, deskH - 6);
    // 咖啡杯
    ctx.fillStyle = '#e8ecf4';
    ctx.fillRect(deskX + deskW - 26, deskY - 6, 7, 6);
    // 椅子（剪影）
    ctx.fillStyle = '#0d1016';
    ctx.fillRect(deskX + deskW * 0.42, deskY + 10, 26, 5);
    ctx.fillRect(deskX + deskW * 0.42 + 10, deskY + 15, 5, 14);
    ctx.fillRect(deskX + deskW * 0.42 + 2, deskY - 16, 5, 27);

    // ---- 右側：層架 + 植物 + 霓虹 ----
    const shX = Math.round(W * 0.84);
    ctx.fillStyle = '#232833';
    ctx.fillRect(shX, floorTop - 66, Math.round(W * 0.1), 4);
    ctx.fillRect(shX, floorTop - 40, Math.round(W * 0.1), 4);
    // 植物
    ctx.fillStyle = '#7d5a2e';
    ctx.fillRect(shX + 8, floorTop - 78, 8, 12);
    ctx.fillStyle = '#14f195';
    ctx.fillRect(shX + 6, floorTop - 88, 4, 10);
    ctx.fillRect(shX + 12, floorTop - 90, 4, 12);
    ctx.fillRect(shX + 9, floorTop - 94, 3, 8);
    // 霓虹字
    ctx.font = '700 13px ui-monospace,Menlo,Consolas,monospace';
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(153,69,255,.9)';
    ctx.shadowColor = 'rgba(153,69,255,.8)'; ctx.shadowBlur = 8;
    ctx.fillText('ISHTC', W - 14, 40);
    ctx.shadowBlur = 0;

    // ---- 跑馬燈 ----
    ctx.fillStyle = '#05070b';
    ctx.fillRect(0, 6, W, 16);
    if (ticker.length) {
      ctx.font = '700 10px ui-monospace,Menlo,Consolas,monospace';
      ctx.textAlign = 'left';
      const text = ticker.join('   ');
      const tw = ctx.measureText(text).width + 60;
      tickerX = (tickerX + (reduced ? 0 : 0.6)) % tw;
      for (let off = -tw; off < W + tw; off += tw) {
        let x = 8 - tickerX + off;
        for (const seg of ticker) {
          ctx.fillStyle = /x$/.test(seg) ? '#14f195' : '#7d8697';
          ctx.fillText(seg, x, 17);
          x += ctx.measureText(seg).width + ctx.measureText('   ').width;
        }
      }
    }
  }

  function drawDogs() {
    const sorted = dogs.slice().sort((a, b) => a.depth - b.depth);
    for (const d of sorted) {
      const { s, y } = dogScreen(d);
      // 影子
      ctx.fillStyle = 'rgba(0,0,0,.35)';
      ctx.beginPath();
      ctx.ellipse(d.x, y + 1, 8 * s, 2 * s, 0, 0, Math.PI * 2);
      ctx.fill();
      stamp(ctx, d.x, y, s, d.tier, d.dir, d.phase, d.idleT <= 0);
      // 對話泡泡
      if (d.sayT > 0) {
        const label = d.sym + (isFinite(d.mfeX) ? '  ' + (d.mfeX >= 100 ? Math.round(d.mfeX) : d.mfeX.toFixed(1)) + 'x' : '');
        ctx.font = '700 11px ui-monospace,Menlo,Consolas,monospace';
        const tw = ctx.measureText(label).width;
        const bx = Math.max(4, Math.min(W - tw - 16, d.x - tw / 2 - 6));
        const by = y - 13 * s - 22;
        ctx.fillStyle = '#e8ecf4';
        ctx.fillRect(bx, by, tw + 12, 18);
        ctx.fillStyle = '#0a0b0e';
        ctx.textAlign = 'left';
        ctx.fillText(label, bx + 6, by + 13);
      }
    }
  }

  function frame(t) {
    raf = 0;
    const dt = Math.min(0.05, (t - last) / 1000 || 0.016);
    last = t;
    if (t - monLast > 700) { tickMonitors(); monLast = t; }
    for (const d of dogs) updateDog(d, dt);
    drawRoom(t);
    drawDogs();
    if (!reduced && inView && !document.hidden && !panel.hidden) raf = requestAnimationFrame(frame);
  }

  function kick() { if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } }

  // 靜態模式（prefers-reduced-motion）：只畫一次
  function drawOnce() { drawRoom(performance.now()); drawDogs(); }

  // ---------- 事件 ----------
  cv.addEventListener('click', function (ev) {
    const r = cv.getBoundingClientRect();
    const mx = (ev.clientX - r.left), my = (ev.clientY - r.top);
    let best = null, bd = 1e9;
    for (const d of dogs) {
      const p = dogScreen(d);
      const dx = mx - d.x, dy = my - (p.y - 6 * p.s);
      const dist = dx * dx + dy * dy;
      if (dist < bd) { bd = dist; best = d; }
    }
    if (best && bd < 40 * 40) { best.sayT = 2.6; if (reduced) drawOnce(); }
  });
  window.addEventListener('resize', function () { resize(); if (reduced) drawOnce(); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) kick(); });
  if (typeof IntersectionObserver === 'function') {
    new IntersectionObserver(function (es) {
      inView = !!(es[0] && es[0].isIntersecting);
      if (inView) kick();
    }).observe(cv);
  }

  function updateHint() {
    if (!hintEl) return;
    const golds = dogs.filter((d) => d.tier !== 'norm').length;
    let t = '每一隻幣是一條狗 —— 亮金戴皇冠的是大金狗、金色是小金狗。點狗可以看是哪一隻幣。';
    if (total > dogs.length) t += '　房間塞不下，只顯示 ' + dogs.length + ' / ' + total + ' 隻（金狗優先）。';
    else if (dogs.length) t += '　共 ' + dogs.length + ' 隻' + (golds ? '，其中 ' + golds + ' 隻金狗' : '') + '。';
    hintEl.textContent = t;
  }

  // ---------- API ----------
  window.DogRoom = {
    stamp: stamp,
    /** 同步畫一幀（截圖與測試用）。steps 可先推進幾步物理讓姿勢自然 */
    renderNow: function (steps) {
      resize(); if (!monitors.length) mkMonitors();
      for (let i = 0; i < (steps || 0); i++) for (const d of dogs) updateDog(d, 0.033);
      drawRoom(performance.now());
      drawDogs();
    },
    reset: function () {
      resize(); mkMonitors();
      dogs = []; total = 0; ticker = []; tickerX = 0;
      if (panel) panel.hidden = false;
      updateHint();
      reduced ? drawOnce() : kick();
    },
    addDog: function (info) {
      total++;
      if (dogs.length >= maxDogs()) { updateHint(); return; }
      dogs.push(mkDog(info));
      updateHint();
      reduced ? drawOnce() : kick();
    },
    setAll: function (list, totalCount) {
      resize(); if (!monitors.length) mkMonitors();
      total = (totalCount != null ? totalCount : list.length);
      // 金狗優先，再依 MFE 高低
      const rank = { big: 0, gold: 1, norm: 2 };
      const pick = list.slice().sort(function (a, b) {
        return (rank[a.tier] - rank[b.tier]) || ((b.mfeX || 0) - (a.mfeX || 0));
      }).slice(0, maxDogs());
      dogs = pick.map(mkDog);
      // 已經在場的直接落地，不用全部從門口跑進來
      for (const d of dogs) { d.x = 24 + Math.random() * (W - 48); }
      ticker = list.slice().sort(function (a, b) { return (b.mfeX || 0) - (a.mfeX || 0); })
        .slice(0, 8).map(function (r) { return r.sym + ' +' + Math.round(r.mfeX || 0) + 'x'; });
      if (panel) panel.hidden = false;
      updateHint();
      reduced ? drawOnce() : kick();
    },
  };

  resize();
  mkMonitors();
})();

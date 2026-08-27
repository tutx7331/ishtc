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

    if (T.glow) {                               // 金狗身上有微光（放射漸層，不是方塊）
      const gx = 7.5 * s, gy = 5.5 * s, gr = 9.5 * s;
      const grad = c.createRadialGradient(gx, gy, s, gx, gy, gr);
      grad.addColorStop(0, T.glow);
      grad.addColorStop(1, 'rgba(255,211,77,0)');
      c.fillStyle = grad;
      c.beginPath();
      c.ellipse(gx, gy, gr, gr * 0.7, 0, 0, Math.PI * 2);
      c.fill();
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
  if (!cv) { if (typeof window !== 'undefined') window.DogRoom = { stamp: stamp, reset: noop, addDog: noop, setAll: noop, renderNow: noop }; return; }
  function noop() {}

  const panel = document.getElementById('dog-room-panel');
  const hintEl = document.getElementById('dog-room-hint');
  const ctx = cv.getContext('2d');
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  // 物理常數
  const G = 980;            // 重力 px/s²
  const WALL_R = 0.72;      // 撞牆反彈保留的速度
  const FLOOR_R = 0.48;     // 落地反彈
  const THUMP = 330;        // 落地速度超過這個值會跌倒
  const LAUNCH_GAP = 0.14;  // 兩隻狗噴出的間隔秒數

  let W = 0, H = 0, dpr = 1, floorTop = 0;
  let dogs = [];            // 場上的狗
  let pending = [];         // 排隊等著從螢幕噴出來的
  let total = 0;
  let ticker = [], tickerX = 0;
  let monitors = [];        // {x,y,w,h,data[],bias,flash}
  let raf = 0, last = 0, monLast = 0, launchT = 0;
  let inView = true;
  let held = null;          // 被抓著的狗
  let trail = [];           // 指標軌跡，用來算丟出去的速度
  let downAt = null;        // 判斷點擊 vs 拖曳

  const maxDogs = () => (W < 520 ? 70 : 120);
  const bandTop = () => floorTop + 16;
  const bandBot = () => H - 14;

  function resize() {
    const w = cv.clientWidth || (cv.parentElement ? cv.parentElement.clientWidth - 44 : 600);
    if (!w) return;
    dpr = Math.min(2, (window.devicePixelRatio || 1));
    W = w;
    H = Math.round(Math.max(340, Math.min(560, w * 0.5)));
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    cv.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    floorTop = Math.round(H * 0.46);
    layoutMonitors();
  }

  // ---- 行情牆（房間的視覺主角，也是狗的出生點）----
  function layoutMonitors() {
    const n = Math.max(3, Math.min(7, Math.round(W / 210)));
    const span = W * 0.92, left = W * 0.04, gap = 14;
    const mw = (span - gap * (n - 1)) / n;
    const mid = (n - 1) / 2;
    const next = [];
    for (let i = 0; i < n; i++) {
      const big = Math.abs(i - mid) < 0.6;         // 中央那台大一點
      const mh = big ? 52 : 40;
      next.push({
        x: left + i * (mw + gap), w: mw, h: mh,
        y: floorTop - 14 - mh,
        data: (monitors[i] && monitors[i].data) || mkSeries(),
        bias: (monitors[i] && monitors[i].bias) != null ? monitors[i].bias : (Math.random() - 0.5) * 0.05,
        flash: 0,
      });
    }
    monitors = next;
  }
  function mkSeries() {
    const arr = []; let v = 0.5;
    for (let j = 0; j < 26; j++) { v = clamp01(v + (Math.random() - 0.5) * 0.16); arr.push(v); }
    return arr;
  }
  function clamp01(v) { return Math.min(0.92, Math.max(0.08, v)); }
  function tickMonitors() {
    for (const m of monitors) {
      m.data.push(clamp01(m.data[m.data.length - 1] + (Math.random() - 0.5) * 0.16 + m.bias));
      m.data.shift();
    }
  }

  // ---- 狗 ----
  function mkDog(info) {
    return {
      sym: info.sym || '?', mfeX: info.mfeX, tier: info.tier || 'norm',
      x: W / 2, groundY: bandTop() + Math.random() * (bandBot() - bandTop()),
      h: 0, vx: 0, vh: 0, rot: 0, vrot: 0,
      dir: 1, phase: Math.random() * 10,
      state: 'run', tx: 0, idleT: 0, sayT: 0, tumbleT: 0,
      speed: 26 + Math.random() * 30,
    };
  }

  /** 從隨機一台螢幕把狗噴出來 */
  function launch(info) {
    const d = mkDog(info);
    const m = monitors[Math.floor(Math.random() * monitors.length)] || { x: W / 2, y: floorTop - 60, w: 40, h: 40 };
    m.flash = 0.3;
    const sx = m.x + m.w / 2, sy = m.y + m.h * 0.5;
    d.x = sx;
    d.groundY = bandTop() + Math.random() * (bandBot() - bandTop());
    d.h = Math.max(20, d.groundY - sy);
    d.vx = (Math.random() < 0.5 ? -1 : 1) * (90 + Math.random() * 190);
    d.vh = 90 + Math.random() * 180;
    d.vrot = (Math.random() - 0.5) * 9;
    d.dir = d.vx >= 0 ? 1 : -1;
    d.state = 'air';
    dogs.push(d);
  }

  function pickWanderTarget(d) {
    d.tx = 24 + Math.random() * (W - 48);
    d.tGround = bandTop() + Math.random() * (bandBot() - bandTop());
  }

  function updateDog(d, dt) {
    d.phase += dt * (d.state === 'run' ? 1.1 : 0.35);
    if (d.sayT > 0) d.sayT -= dt;

    if (d.state === 'held') return;              // 位置由指標決定

    if (d.state === 'air') {
      d.x += d.vx * dt;
      d.h += d.vh * dt;
      d.vh -= G * dt;
      d.rot += d.vrot * dt;
      // 牆壁反彈
      if (d.x < 16) { d.x = 16; d.vx = Math.abs(d.vx) * WALL_R; d.vrot = -d.vrot; }
      if (d.x > W - 16) { d.x = W - 16; d.vx = -Math.abs(d.vx) * WALL_R; d.vrot = -d.vrot; }
      // 天花板（跑馬燈下緣）
      const maxH = d.groundY - 34;
      if (d.h > maxH) { d.h = maxH; d.vh = -Math.abs(d.vh) * 0.5; }
      d.dir = d.vx >= 0 ? 1 : -1;
      // 落地
      if (d.h <= 0) {
        d.h = 0;
        if (Math.abs(d.vh) > THUMP) {            // 摔太重 → 跌倒
          d.state = 'tumble';
          d.tumbleT = 0.5 + Math.random() * 0.3;
          d.rot = d.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
          d.vx = 0; d.vh = 0; d.vrot = 0;
        } else if (Math.abs(d.vh) > 90) {        // 還有力 → 再彈一下
          d.vh = -d.vh * FLOOR_R;
          d.vx *= 0.85;
        } else {                                  // 站穩 → 開始跑
          d.vh = 0; d.vx = 0; d.rot = 0; d.vrot = 0;
          d.state = 'run';
          pickWanderTarget(d);
        }
      }
      return;
    }

    if (d.state === 'tumble') {                  // 躺著 → 彈回站姿
      d.tumbleT -= dt;
      if (d.tumbleT <= 0) {
        d.rot *= 0.7;
        if (Math.abs(d.rot) < 0.06) { d.rot = 0; d.state = 'run'; pickWanderTarget(d); }
      }
      return;
    }

    if (d.state === 'idle') {
      d.idleT -= dt;
      if (d.idleT <= 0) { d.state = 'run'; pickWanderTarget(d); }
      return;
    }

    // run：地板上遊走
    const dx = d.tx - d.x, dg = (d.tGround || d.groundY) - d.groundY;
    if (Math.abs(dx) < 4 && Math.abs(dg) < 3) {
      d.state = 'idle';
      d.idleT = 0.8 + Math.random() * 2.6;
      return;
    }
    const depth = (d.groundY - bandTop()) / Math.max(1, bandBot() - bandTop());
    const v = d.speed * (0.6 + depth * 0.5) * dt;
    d.x += Math.sign(dx) * Math.min(Math.abs(dx), v);
    d.groundY += Math.sign(dg) * Math.min(Math.abs(dg), dt * 22);
    if (Math.abs(dx) > 2) d.dir = Math.sign(dx);
  }

  function dogScale(d) {
    const depth = (d.groundY - bandTop()) / Math.max(1, bandBot() - bandTop());
    return (W < 520 ? 1.6 : 2) * (0.66 + depth * 0.5) * (d.tier === 'big' ? 1.3 : 1);
  }

  // ---------- 繪製 ----------
  function drawRoom() {
    // 牆
    ctx.fillStyle = '#0e1116';
    ctx.fillRect(0, 0, W, floorTop);
    // 地板：往下漸暗
    const fg = ctx.createLinearGradient(0, floorTop, 0, H);
    fg.addColorStop(0, '#171c26');
    fg.addColorStop(1, '#10141b');
    ctx.fillStyle = fg;
    ctx.fillRect(0, floorTop, W, H - floorTop);
    ctx.strokeStyle = 'rgba(232,236,244,.045)';
    ctx.lineWidth = 1;
    for (let i = 1; i <= 4; i++) {
      const y = floorTop + (H - floorTop) * (i / 4.8);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
    ctx.beginPath(); ctx.moveTo(W * 0.16, H); ctx.lineTo(W * 0.28, floorTop); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(W * 0.84, H); ctx.lineTo(W * 0.72, floorTop); ctx.stroke();
    ctx.fillStyle = '#0a0c10';
    ctx.fillRect(0, floorTop - 3, W, 3);

    // ---- 行情牆 ----
    // 長桌
    const deskL = W * 0.04 - 8, deskW2 = W * 0.92 + 16;
    ctx.fillStyle = '#20252f';
    ctx.fillRect(deskL, floorTop - 14, deskW2, 7);
    ctx.fillStyle = '#151920';
    ctx.fillRect(deskL + 10, floorTop - 7, 6, 7);
    ctx.fillRect(deskL + deskW2 - 16, floorTop - 7, 6, 7);
    for (const m of monitors) {
      if (m.flash > 0) m.flash -= 0.016;
      const up = m.data[m.data.length - 1] >= m.data[0];
      const col = up ? '20,241,149' : '255,77,109';
      // 螢幕外框與面板
      ctx.fillStyle = '#05070b';
      ctx.fillRect(m.x - 3, m.y - 3, m.w + 6, m.h + 6);
      ctx.fillStyle = m.flash > 0 ? 'rgba(232,236,244,.9)' : '#0b0f16';
      ctx.fillRect(m.x, m.y, m.w, m.h);
      if (m.flash <= 0) {
        // 走勢線
        ctx.strokeStyle = 'rgba(' + col + ',.9)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let j = 0; j < m.data.length; j++) {
          const px2 = m.x + 3 + (j / (m.data.length - 1)) * (m.w - 6);
          const py = m.y + m.h - 4 - m.data[j] * (m.h - 8);
          j ? ctx.lineTo(px2, py) : ctx.moveTo(px2, py);
        }
        ctx.stroke();
        // 面板泛光
        ctx.fillStyle = 'rgba(' + col + ',.06)';
        ctx.fillRect(m.x, m.y, m.w, m.h);
      }
      // 螢幕腳架
      ctx.fillStyle = '#1b2029';
      ctx.fillRect(m.x + m.w / 2 - 3, m.y + m.h + 3, 6, 6);
      // 光暈映在牆上與地板倒影
      const glow = ctx.createLinearGradient(0, floorTop, 0, floorTop + 46);
      glow.addColorStop(0, 'rgba(' + col + ',.10)');
      glow.addColorStop(1, 'rgba(' + col + ',0)');
      ctx.fillStyle = glow;
      ctx.fillRect(m.x, floorTop, m.w, 46);
    }

    // 左角：盆栽
    const px0 = W * 0.035, py0 = floorTop + 26;
    ctx.fillStyle = '#3a2c1a';
    ctx.fillRect(px0, py0 - 12, 16, 12);
    ctx.fillStyle = '#2b2013';
    ctx.fillRect(px0, py0 - 3, 16, 3);
    ctx.fillStyle = '#0f9d6a';
    ctx.fillRect(px0 + 2, py0 - 30, 4, 18);
    ctx.fillRect(px0 + 10, py0 - 34, 4, 22);
    ctx.fillStyle = '#14f195';
    ctx.fillRect(px0 + 6, py0 - 38, 4, 26);

    // 右上：霓虹
    ctx.font = '700 13px ui-monospace,Menlo,Consolas,monospace';
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(153,69,255,.9)';
    ctx.shadowColor = 'rgba(153,69,255,.8)'; ctx.shadowBlur = 8;
    ctx.fillText('ISHTC', W - 14, 44);
    ctx.shadowBlur = 0;

    // 跑馬燈
    ctx.fillStyle = '#05070b';
    ctx.fillRect(0, 6, W, 16);
    if (ticker.length) {
      ctx.font = '700 10px ui-monospace,Menlo,Consolas,monospace';
      ctx.textAlign = 'left';
      const sp = ctx.measureText('   ').width;
      let tw = 60;
      for (const seg of ticker) tw += ctx.measureText(seg).width + sp;
      tickerX = (tickerX + (reduced ? 0 : 0.6)) % tw;
      for (let off = -tw; off < W + tw; off += tw) {
        let x = 8 - tickerX + off;
        for (const seg of ticker) {
          ctx.fillStyle = /x$/.test(seg) ? '#14f195' : '#7d8697';
          ctx.fillText(seg, x, 17);
          x += ctx.measureText(seg).width + sp;
        }
      }
    }
  }

  function drawDogs() {
    const sorted = dogs.slice().sort((a, b) => a.groundY - b.groundY);
    for (const d of sorted) {
      const s = dogScale(d);
      const y = d.groundY - d.h;
      // 影子（跳起來時縮小變淡）
      const air = Math.min(1, d.h / 120);
      ctx.fillStyle = 'rgba(0,0,0,' + (0.35 - air * 0.22) + ')';
      ctx.beginPath();
      ctx.ellipse(d.x, d.groundY + 1, (8 - air * 3) * s, 2 * s, 0, 0, Math.PI * 2);
      ctx.fill();
      if (d.rot) {
        ctx.save();
        ctx.translate(d.x, y - 5 * s);
        ctx.rotate(d.rot);
        stamp(ctx, 0, 5 * s, s, d.tier, d.dir, d.phase, false);
        ctx.restore();
      } else {
        stamp(ctx, d.x, y, s, d.tier, d.dir, d.phase, d.state === 'run');
      }
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

  function step(dt, t) {
    if (t - monLast > 700) { tickMonitors(); monLast = t; }
    launchT -= dt;
    if (pending.length && launchT <= 0) { launch(pending.shift()); launchT = LAUNCH_GAP; }
    for (const d of dogs) updateDog(d, dt);
  }

  function frame(t) {
    raf = 0;
    const dt = Math.min(0.05, (t - last) / 1000 || 0.016);
    last = t;
    step(dt, t);
    drawRoom();
    drawDogs();
    if (!reduced && inView && !document.hidden && !panel.hidden) raf = requestAnimationFrame(frame);
  }
  function kick() { if (!raf && !reduced) { last = performance.now(); raf = requestAnimationFrame(frame); } }
  function drawOnce() { drawRoom(); drawDogs(); }

  // ---------- 抓狗 / 丟狗 / 點狗 ----------
  function canvasPos(ev) {
    const r = cv.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  }
  function hitDog(p) {
    let best = null, bd = 1e9;
    for (const d of dogs) {
      const s = dogScale(d);
      const dx = p.x - d.x, dy = p.y - (d.groundY - d.h - 6 * s);
      const dist = dx * dx + dy * dy;
      if (dist < bd) { bd = dist; best = d; }
    }
    return (best && bd < (34 * 34)) ? best : null;
  }
  cv.addEventListener('pointerdown', function (ev) {
    const p = canvasPos(ev);
    const d = hitDog(p);
    downAt = { x: p.x, y: p.y, dog: d, moved: false };
    if (d) {
      held = d;
      d.state = 'held';
      d.rot = 0; d.vrot = 0; d.sayT = 0;
      trail = [{ x: p.x, y: p.y, t: performance.now() }];
      try { cv.setPointerCapture(ev.pointerId); } catch (e) {}
      cv.style.cursor = 'grabbing';
      kick();
    }
  });
  cv.addEventListener('pointermove', function (ev) {
    const p = canvasPos(ev);
    if (downAt && (Math.abs(p.x - downAt.x) > 7 || Math.abs(p.y - downAt.y) > 7)) downAt.moved = true;
    if (!held) {
      cv.style.cursor = hitDog(p) ? 'grab' : 'default';
      return;
    }
    // 抓著走：x 直接跟、深度夾在地板帶內、高度 = 地面 − 指標
    held.x = Math.max(16, Math.min(W - 16, p.x));
    held.groundY = Math.max(bandTop(), Math.min(bandBot(), Math.max(p.y, bandTop())));
    held.h = Math.max(0, held.groundY - p.y);
    trail.push({ x: p.x, y: p.y, t: performance.now() });
    if (trail.length > 6) trail.shift();
    if (reduced) drawOnce();
  });
  function release(ev) {
    if (held) {
      // 用最近 ~90ms 的軌跡算丟出去的速度
      const now = performance.now();
      const old = trail.find((q) => now - q.t < 110) || trail[0];
      const dt = Math.max(0.024, (now - old.t) / 1000);
      const p = ev ? canvasPos(ev) : trail[trail.length - 1];
      held.vx = (p.x - old.x) / dt * 0.9;
      held.vh = -((p.y - old.y) / dt) * 0.9;
      held.vrot = held.vx / 60;
      held.state = 'air';
      if (Math.abs(held.vx) < 40 && Math.abs(held.vh) < 40) held.vh = 20;   // 輕放也小跳一下
      held = null;
      cv.style.cursor = 'default';
      kick();
    } else if (downAt && !downAt.moved && downAt.dog) {
      downAt.dog.sayT = 2.6;                     // 純點擊 → 顯示幣名
      if (reduced) drawOnce();
    }
    downAt = null;
  }
  cv.addEventListener('pointerup', release);
  cv.addEventListener('pointercancel', function () { release(null); });

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
    const shown = dogs.length + pending.length;
    const golds = dogs.filter((d) => d.tier !== 'norm').length
      + pending.filter((d) => d.tier && d.tier !== 'norm').length;
    let t = '金色是金狗，戴皇冠的是大金狗。點狗看幣名，抓起來丟也可以。';
    if (total > shown) t += '　房間塞不下，只顯示 ' + shown + ' / ' + total + ' 隻（金狗優先）。';
    else if (shown) t += '　共 ' + shown + ' 隻' + (golds ? '，其中 ' + golds + ' 隻金狗' : '') + '。';
    hintEl.textContent = t;
  }

  // ---------- API ----------
  window.DogRoom = {
    stamp: stamp,
    /** 同步畫一幀（截圖與測試用）。steps 推進物理讓姿勢自然 */
    renderNow: function (steps) {
      resize();
      while (pending.length && dogs.length < maxDogs()) launch(pending.shift());
      for (let i = 0; i < (steps || 0); i++) step(0.033, performance.now() + i * 33);
      drawRoom();
      drawDogs();
    },
    reset: function () {
      resize();
      dogs = []; pending = []; total = 0; ticker = []; tickerX = 0; held = null;
      if (panel) panel.hidden = false;
      updateHint();
      reduced ? drawOnce() : kick();
    },
    addDog: function (info) {
      total++;
      if (dogs.length + pending.length >= maxDogs()) { updateHint(); return; }
      pending.push(info);
      updateHint();
      reduced ? this.renderNow(1) : kick();
    },
    setAll: function (list, totalCount) {
      resize();
      total = (totalCount != null ? totalCount : list.length);
      const rank = { big: 0, gold: 1, norm: 2 };
      const pick = list.slice().sort(function (a, b) {
        return (rank[a.tier] - rank[b.tier]) || ((b.mfeX || 0) - (a.mfeX || 0));
      }).slice(0, maxDogs());
      // 已經在場上的留著繼續玩，缺的排隊噴出來
      const have = new Set(dogs.map((d) => d.sym).concat(pending.map((p) => p.sym)));
      const want = new Set(pick.map((p) => p.sym));
      dogs = dogs.filter((d) => want.has(d.sym));
      pending = pending.filter((p) => want.has(p.sym));
      for (const p of pick) if (!have.has(p.sym)) pending.push(p);
      ticker = list.slice().sort(function (a, b) { return (b.mfeX || 0) - (a.mfeX || 0); })
        .slice(0, 8).map(function (r) { return r.sym + ' +' + Math.round(r.mfeX || 0) + 'x'; });
      if (panel) panel.hidden = false;
      updateHint();
      reduced ? this.renderNow(4) : kick();
    },
  };

  resize();

})();

/* ---------- FOMO Hero 背景 ----------
 * 上升的 K 線柱（低透明度）+ 飄浮的倍數（偶爾出現金色巨倍）
 * + 底部不時跑過的像素狗。輸入框由 CSS 的暗角罩保護可讀性。
 */
(function () {
  'use strict';
  const cv = typeof document !== 'undefined' && document.getElementById('hero-bg');
  if (!cv) return;
  const hero = document.getElementById('hero');
  const ctx = cv.getContext('2d');
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  let W = 0, H = 0, raf = 0, last = 0, inView = true;
  const candles = [];   // {x, y, h, w, up, alpha, vy}
  const floats = [];    // {x, y, text, gold, alpha, vy, size}
  const runners = [];   // {x, dir, tier, phase, speed, scale}
  let spawnT = 0, dogT = 2;

  function resize() {
    const r = hero.getBoundingClientRect();
    W = Math.max(320, Math.round(r.width));
    H = Math.max(240, Math.round(r.height));
    cv.width = W; cv.height = H;
    ctx.imageSmoothingEnabled = false;
  }

  function spawnCandle() {
    const colW = 60;
    const col = Math.floor(Math.random() * Math.floor(W / colW));
    candles.push({
      x: col * colW + 10 + Math.random() * 18,
      y: H + 30, h: 14 + Math.random() * 46, w: 7,
      up: Math.random() < 0.62,
      alpha: 0.05 + Math.random() * 0.12,
      vy: 12 + Math.random() * 22,
    });
  }
  function spawnFloat() {
    // 多半是小倍數；偶爾一顆金色巨倍飄過，這才是 FOMO 的味道
    const jackpot = Math.random() < 0.12;
    const v = jackpot ? Math.round(100 + Math.random() * 9900)
      : Math.round(2 + Math.random() * 48);
    // 避開中央標題區，只在左右兩側出現
    const side = Math.random() < 0.5;
    floats.push({
      x: side ? 30 + Math.random() * (W * 0.26) : W * 0.72 + Math.random() * (W * 0.24 - 60),
      y: H * (0.25 + Math.random() * 0.6),
      text: '+' + v + 'x', gold: jackpot,
      alpha: 0, life: 0, vy: 14 + Math.random() * 12,
      size: jackpot ? 22 + Math.random() * 14 : 12 + Math.random() * 6,
    });
  }
  function spawnDog() {
    const r = Math.random();
    const tier = r < 0.06 ? 'big' : r < 0.22 ? 'gold' : 'norm';
    const dir = Math.random() < 0.5 ? 1 : -1;
    runners.push({
      x: dir > 0 ? -40 : W + 40, dir: dir, tier: tier,
      phase: Math.random() * 10, speed: 70 + Math.random() * 60,
      scale: 2 + Math.random() * 1.4,
      y: H - 24 - Math.random() * 36,
    });
  }

  function frame(t) {
    raf = 0;
    const dt = Math.min(0.05, (t - last) / 1000 || 0.016);
    last = t;

    spawnT -= dt;
    if (spawnT <= 0) { spawnCandle(); if (Math.random() < 0.5) spawnFloat(); spawnT = 0.22; }
    dogT -= dt;
    if (dogT <= 0) { spawnDog(); dogT = 2.5 + Math.random() * 4; }

    ctx.clearRect(0, 0, W, H);

    // K 線柱
    for (let i = candles.length - 1; i >= 0; i--) {
      const c = candles[i];
      c.y -= c.vy * dt;
      if (c.y + c.h < -20) { candles.splice(i, 1); continue; }
      ctx.fillStyle = c.up ? 'rgba(20,241,149,' + c.alpha + ')' : 'rgba(255,77,109,' + c.alpha + ')';
      ctx.fillRect(c.x, c.y, c.w, c.h);
      ctx.fillRect(c.x + c.w / 2 - 1, c.y - 8, 2, c.h + 16);   // 影線
    }
    // 倍數
    ctx.textAlign = 'left';
    for (let i = floats.length - 1; i >= 0; i--) {
      const f = floats[i];
      f.life += dt;
      f.y -= f.vy * dt;
      f.alpha = Math.min(1, f.life * 1.2) * Math.max(0, 1 - f.life / 5);
      if (f.life > 5) { floats.splice(i, 1); continue; }
      ctx.font = '700 ' + Math.round(f.size) + 'px ui-monospace,Menlo,Consolas,monospace';
      ctx.fillStyle = f.gold
        ? 'rgba(255,211,77,' + (f.alpha * 0.85) + ')'
        : 'rgba(20,241,149,' + (f.alpha * 0.4) + ')';
      if (f.gold) { ctx.shadowColor = 'rgba(255,211,77,.8)'; ctx.shadowBlur = 12; }
      ctx.fillText(f.text, f.x, f.y);
      ctx.shadowBlur = 0;
    }
    // 底部跑過的狗
    const stampFn = window.DogRoom && window.DogRoom.stamp;
    for (let i = runners.length - 1; i >= 0; i--) {
      const d = runners[i];
      d.x += d.dir * d.speed * dt;
      d.phase += dt;
      if ((d.dir > 0 && d.x > W + 50) || (d.dir < 0 && d.x < -50)) { runners.splice(i, 1); continue; }
      if (stampFn) {
        ctx.globalAlpha = 0.9;
        stampFn(ctx, d.x, d.y, d.scale, d.tier, d.dir, d.phase, true);
        ctx.globalAlpha = 1;
      }
    }

    if (!reduced && inView && !document.hidden) raf = requestAnimationFrame(frame);
  }
  function kick() { if (!raf && !reduced) { last = performance.now(); raf = requestAnimationFrame(frame); } }

  // 靜態模式：畫一張定格（幾根 K 線柱 + 一隻金狗）
  function staticFrame() {
    resize();
    for (let i = 0; i < 26; i++) { spawnCandle(); candles[candles.length - 1].y = Math.random() * H; }
    for (let i = 0; i < 5; i++) { spawnFloat(); floats[floats.length - 1].life = 1; floats[floats.length - 1].alpha = 0.6; }
    spawnDog(); runners[0].x = W * 0.7;
    last = performance.now();
    const t = last;
    raf = 1; frame(t); raf = 0;   // 畫一幀後由 frame 內部條件停住
  }

  window.addEventListener('resize', function () { resize(); if (reduced) staticFrame(); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) kick(); });
  if (typeof IntersectionObserver === 'function') {
    new IntersectionObserver(function (es) {
      inView = !!(es[0] && es[0].isIntersecting);
      if (inView) kick();
    }).observe(cv);
  }

  // 同步畫一幀（截圖與測試用；面板隱藏時 rAF 不會跑）
  window.HeroBG = { tick: function (steps) {
    resize();
    for (let i = 0; i < (steps || 1); i++) {
      spawnT = 0; dogT = Math.min(dogT, 0);
      raf = 1; frame(performance.now() + i * 100); raf = 0;
    }
  } };

  resize();
  reduced ? staticFrame() : kick();
})();

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
  let raf = 0, last = 0, monLast = 0, launchT = 0, roomT = 0;
  let inView = true;
  let held = null;          // 被抓著的狗
  let trail = [];           // 指標軌跡，用來算丟出去的速度
  let downAt = null;        // 判斷點擊 vs 拖曳

  const maxDogs = () => (W < 520 ? 70 : 120);
  const bandTop = () => floorTop + 16;
  const bandBot = () => H - 14;

  function resize() {
    // 全螢幕場景：跟著視窗走。面板隱藏時 clientWidth 是 0，退回視窗尺寸，
    // 絕不能算出負值（曾經因此整個佈局糊掉）。
    let w = cv.clientWidth, h = cv.clientHeight;
    if (!w || w < 100) w = (typeof window !== 'undefined' && window.innerWidth) || 800;
    if (!h || h < 100) h = (typeof window !== 'undefined' && window.innerHeight) || 600;
    dpr = Math.min(2, (window.devicePixelRatio || 1));
    W = Math.round(w);
    H = Math.round(h);
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    floorTop = Math.round(H * 0.63);   // DOM 大螢幕佔上方 55%，牆面到這裡
    layoutMonitors();
  }

  // ---- 出生點＝牆上的四台 DOM 螢幕；wallRect 供光條/光暈定位 ----
  let wallRect = null;
  function layoutMonitors() {
    const rects = [];
    try {
      if (typeof document.querySelectorAll === 'function') {
        document.querySelectorAll('#screen-wall .scr').forEach((el) => {
          const r = el.getBoundingClientRect();
          if (r.width > 40 && r.height > 40) rects.push({ x: r.left, y: r.top, w: r.width, h: r.height, el: el });
        });
      }
    } catch (e) {}
    if (rects.length) {
      // 狗畫在 DOM 螢幕後面，所以只從「下緣貼近牆底」的螢幕噴，噴出來才看得到
      let maxBot = -1e9, x0 = 1e9, x1 = -1e9;
      for (const r of rects) {
        maxBot = Math.max(maxBot, r.y + r.h);
        x0 = Math.min(x0, r.x); x1 = Math.max(x1, r.x + r.w);
      }
      const spawnable = rects.filter((r) => r.y + r.h > maxBot - 60);
      monitors = (spawnable.length ? spawnable : rects).map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h, el: r.el, flash: 0 }));
      wallRect = { x0: x0, x1: x1 };
    } else {
      // 測試環境沒有 DOM 螢幕：中央虛擬出生點
      const span = Math.min(W * 0.6, 760), left = (W - span) / 2;
      monitors = [0, 1, 2].map((i) => ({ x: left + i * span / 3, y: floorTop * 0.3, w: span / 3 - 10, h: 40, el: null, flash: 0 }));
      wallRect = { x0: left, x1: left + span };
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

  /** 從隨機一台牆上螢幕把狗噴出來 */
  function launch(info) {
    const d = mkDog(info);
    const m = monitors[Math.floor(Math.random() * monitors.length)] || { x: W / 2, y: floorTop - 60, w: 40, h: 40 };
    m.flash = 0.3;
    if (m.el && m.el.classList && typeof setTimeout === 'function') {
      m.el.classList.add('spawn');
      setTimeout(() => { m.el.classList.remove('spawn'); }, 320);
    }
    const sx = m.x + m.w * (0.2 + Math.random() * 0.6), sy = m.y + m.h - 6;
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
      // 落地：照物理來 —— 每次反彈衰減，最後在地上滑行減速，不會瞬間黏住
      if (d.h <= 0 && d.vh < 0) {
        d.h = 0;
        const impact = -d.vh;
        if (impact > THUMP) d.hardHit = true;    // 記下來，停穩後要跌倒
        d.vh = impact > 40 ? impact * FLOOR_R : 0;
        d.vx *= 0.92;
        d.vrot *= 0.6;
      }
      if (d.h <= 0 && Math.abs(d.vh) < 40) {     // 貼地滑行：摩擦力慢慢煞
        d.h = 0; d.vh = 0;
        d.vx *= Math.pow(0.08, dt);
        d.rot *= Math.pow(0.04, dt);
        if (Math.abs(d.vx) < 16) {               // 真的停下來了
          d.vx = 0; d.vrot = 0;
          if (d.hardHit) {                       // 摔重的這才跌倒
            d.hardHit = false;
            d.state = 'tumble';
            d.tumbleT = 0.5 + Math.random() * 0.3;
            d.rot = d.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
          } else {
            d.rot = 0;
            d.state = 'run';
            pickWanderTarget(d);
          }
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
  // 想換成自己生成的房間圖：放 assets/room-bg.png（1920x1080，下方 37% 留空當地板）
  let roomImg = null;
  if (typeof Image !== 'undefined') {
    try {
      const im = new Image();
      im.onload = () => { roomImg = im; };
      im.src = 'assets/room-bg.png';
    } catch (e) {}
  }

  const MONO = 'ui-monospace,Menlo,Consolas,monospace';

  function drawRoom() {
    if (roomImg) {                                   // 自訂背景：鋪滿裁切
      const sc = Math.max(W / roomImg.width, H / roomImg.height);
      const dw = roomImg.width * sc, dh = roomImg.height * sc;
      ctx.drawImage(roomImg, (W - dw) / 2, (H - dh) / 2, dw, dh);
      drawTicker();
      return;
    }

    // ---- 牆與地板 ----
    ctx.fillStyle = '#0e1116';
    ctx.fillRect(0, 0, W, floorTop);
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

    drawLightStrip();

    const leftEdge = wallRect ? wallRect.x0 : W * 0.1;
    const rightEdge = wallRect ? wallRect.x1 : W * 0.9;

    // ---- 左牆：勵志海報 + BUY THE DIP 霓虹（牆屏左邊的空牆）----
    if (leftEdge >= 108) {
      const margin = leftEdge;
      const pw = Math.min(104, margin - 26);
      const p1x = (margin - pw) / 2, p1y = 44;
      ctx.textAlign = 'center';
      // 海報一：三行標語
      ctx.fillStyle = '#12151c'; ctx.fillRect(p1x, p1y, pw, 64);
      ctx.strokeStyle = '#262c38'; ctx.strokeRect(p1x + 0.5, p1y + 0.5, pw - 1, 63);
      ctx.font = '700 9px ' + MONO;
      ctx.fillStyle = '#8a93a4';
      ctx.fillText('DISCIPLINE', p1x + pw / 2, p1y + 20);
      ctx.fillText('PATIENCE', p1x + pw / 2, p1y + 36);
      ctx.fillText('HODL', p1x + pw / 2, p1y + 52);
      // 海報二：MINDSET
      const p2y = p1y + 76;
      ctx.fillStyle = '#12151c'; ctx.fillRect(p1x, p2y, pw, 44);
      ctx.strokeStyle = '#262c38'; ctx.strokeRect(p1x + 0.5, p2y + 0.5, pw - 1, 43);
      ctx.font = '700 11px ' + MONO;
      ctx.fillStyle = '#c9d1de';
      ctx.fillText('MINDSET', p1x + pw / 2, p2y + 20);
      ctx.font = '8px ' + MONO;
      ctx.fillStyle = '#5b6472';
      ctx.fillText('noun.', p1x + pw / 2, p2y + 34);
      // BUY THE DIP 霓虹（綠光，微閃爍）
      const ny = p2y + 76;
      const flick = 0.8 + 0.2 * Math.sin(roomT * 2.3);
      ctx.font = '700 13px ' + MONO;
      ctx.shadowColor = 'rgba(20,241,149,.85)';
      ctx.shadowBlur = 10 * flick;
      ctx.fillStyle = 'rgba(94,242,169,' + (0.85 * flick + 0.15) + ')';
      ctx.fillText('BUY', p1x + pw / 2, ny);
      ctx.fillText('THE', p1x + pw / 2, ny + 18);
      ctx.fillText('DIP', p1x + pw / 2, ny + 36);
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(20,241,149,.35)';
      ctx.strokeRect(p1x + pw / 2 - 28.5, ny - 14.5, 57, 56);
    }

    // ---- 右牆：夜景窗（城市天際線）----
    if (W - rightEdge >= 108) {
      const margin = W - rightEdge;
      const ww = Math.min(150, margin - 24), wh = Math.min(130, floorTop * 0.42);
      const wx = rightEdge + (margin - ww) / 2, wy = 46;
      // 窗框
      ctx.fillStyle = '#1a1f29';
      ctx.fillRect(wx - 5, wy - 5, ww + 10, wh + 10);
      // 夜空
      const sky = ctx.createLinearGradient(0, wy, 0, wy + wh);
      sky.addColorStop(0, '#0a1226');
      sky.addColorStop(1, '#131b30');
      ctx.fillStyle = sky;
      ctx.fillRect(wx, wy, ww, wh);
      // 月亮
      ctx.fillStyle = '#e8ecf4';
      ctx.beginPath(); ctx.ellipse(wx + ww * 0.76, wy + wh * 0.2, 7, 7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#0a1226';
      ctx.beginPath(); ctx.ellipse(wx + ww * 0.76 + 4, wy + wh * 0.2 - 2, 6, 6, 0, 0, Math.PI * 2); ctx.fill();
      // 天際線：一排高樓剪影 + 亮窗
      let seed2 = 13;
      let bxx = wx + 2;
      while (bxx < wx + ww - 10) {
        seed2 = (seed2 * 16807) % 2147483647;
        const bw2 = 12 + (seed2 % 12), bh2 = wh * (0.3 + (seed2 % 40) / 100);
        ctx.fillStyle = '#0d1420';
        ctx.fillRect(bxx, wy + wh - bh2, bw2, bh2);
        ctx.fillStyle = 'rgba(255,214,120,.55)';
        for (let fy2 = wy + wh - bh2 + 4; fy2 < wy + wh - 6; fy2 += 7) {
          for (let fx2 = bxx + 2; fx2 < bxx + bw2 - 3; fx2 += 6) {
            seed2 = (seed2 * 16807) % 2147483647;
            if (seed2 % 10 < 3) ctx.fillRect(fx2, fy2, 2, 3);
          }
        }
        bxx += bw2 + 3;
      }
      // 窗欞
      ctx.strokeStyle = '#1a1f29';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(wx + ww / 2, wy); ctx.lineTo(wx + ww / 2, wy + wh); ctx.stroke();
      ctx.lineWidth = 1;
      // 窗下：發光狗狗幣座燈
      const cy2 = wy + wh + 34;
      ctx.shadowColor = 'rgba(255,176,32,.8)'; ctx.shadowBlur = 12;
      ctx.fillStyle = '#ffb020';
      ctx.beginPath(); ctx.ellipse(wx + ww / 2, cy2, 11, 11, 0, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#7a4d00';
      ctx.font = '700 12px ' + MONO;
      ctx.textAlign = 'center';
      ctx.fillText('D', wx + ww / 2, cy2 + 4);
    }

    // ---- 地毯（毛絨感：底色 + 邊緣雜點）----
    const rugW = Math.min(W * 0.44, 520), rugX = (W - rugW) / 2;
    const rugY = floorTop + (H - floorTop) * 0.3, rugH = (H - floorTop) * 0.44;
    ctx.fillStyle = 'rgba(153,69,255,.10)';
    ctx.fillRect(rugX, rugY, rugW, rugH);
    ctx.fillStyle = 'rgba(153,69,255,.16)';
    let rs = 29;
    for (let i = 0; i < 90; i++) {
      rs = (rs * 16807) % 2147483647;
      const side = rs % 4;
      const along = (rs % 1000) / 1000;
      let ex, ey;
      if (side === 0) { ex = rugX + along * rugW; ey = rugY - 2; }
      else if (side === 1) { ex = rugX + along * rugW; ey = rugY + rugH; }
      else if (side === 2) { ex = rugX - 2; ey = rugY + along * rugH; }
      else { ex = rugX + rugW; ey = rugY + along * rugH; }
      ctx.fillRect(ex, ey, 2, 2);
    }
    ctx.strokeStyle = 'rgba(153,69,255,.20)';
    ctx.strokeRect(rugX + 5.5, rugY + 5.5, rugW - 11, rugH - 11);

    // ---- 左牆下：書櫃（三層書 + 公仔）----
    const bx = W * 0.025, bw = Math.min(W * 0.12, 160), bh = 150;
    const by = floorTop - bh;
    ctx.fillStyle = '#1b1510';
    ctx.fillRect(bx - 4, by - 6, bw + 8, bh + 6);
    ctx.fillStyle = '#0d0a07';
    for (let sh = 0; sh < 3; sh++) {
      const sy = by + 8 + sh * 46;
      ctx.fillRect(bx, sy, bw, 38);
    }
    const spineCols = ['#14f195', '#9945ff', '#ffb020', '#ff4d6d', '#4d9fff', '#e8ecf4'];
    let seed = 7;
    for (let sh = 0; sh < 2; sh++) {
      let sx = bx + 5;
      const sy = by + 8 + sh * 46;
      while (sx < bx + bw - 12) {
        seed = (seed * 16807) % 2147483647;
        const bwid = 5 + (seed % 5), bhei = 26 + (seed % 9);
        ctx.fillStyle = spineCols[seed % spineCols.length];
        ctx.globalAlpha = 0.75;
        ctx.fillRect(sx, sy + 38 - bhei, bwid, bhei);
        ctx.globalAlpha = 1;
        sx += bwid + 3;
      }
    }
    // 最下層：金狗公仔 + 火箭公仔 + 紅字時鐘
    const fy = by + 8 + 2 * 46 + 38;
    stamp(ctx, bx + 24, fy - 2, 1.3, 'big', 1, 0.25, false);
    ctx.fillStyle = '#e8ecf4';
    ctx.fillRect(bx + bw - 30, fy - 26, 8, 16);
    ctx.fillStyle = '#ff4d6d';
    ctx.fillRect(bx + bw - 30, fy - 32, 8, 6);
    ctx.fillRect(bx + bw - 34, fy - 12, 4, 6);
    ctx.fillRect(bx + bw - 22, fy - 12, 4, 6);
    ctx.fillStyle = 'rgba(255,77,109,.9)';
    ctx.font = '700 9px ' + MONO;
    ctx.textAlign = 'left';
    ctx.fillText('4:20', bx + bw / 2 - 8, fy - 12);

    // ---- 書櫃旁：盆栽 ----
    const px0 = bx + bw + 26, py0 = floorTop - 2;
    ctx.fillStyle = '#3a2c1a';
    ctx.fillRect(px0, py0 - 14, 18, 14);
    ctx.fillStyle = '#0f9d6a';
    ctx.fillRect(px0 + 3, py0 - 34, 4, 20);
    ctx.fillRect(px0 + 11, py0 - 38, 4, 24);
    ctx.fillStyle = '#14f195';
    ctx.fillRect(px0 + 7, py0 - 42, 4, 28);

    // ---- 右側地板：床 + 啞鈴 ----
    const bedW = Math.min(W * 0.16, 210), bedH = 34;
    const bedX = W - bedW - W * 0.03, bedY = floorTop + 18;
    ctx.fillStyle = '#1b212c';
    ctx.fillRect(bedX - 6, bedY - 4, bedW + 12, bedH + 10);
    ctx.fillStyle = '#232b38';
    ctx.fillRect(bedX, bedY, bedW, bedH - 8);
    ctx.fillStyle = '#e8ecf4';
    ctx.fillRect(bedX + 6, bedY + 4, 30, 14);
    ctx.fillStyle = 'rgba(20,241,149,.35)';
    ctx.fillRect(bedX + 44, bedY, bedW - 44, bedH - 8);
    ctx.fillStyle = '#12161d';
    ctx.fillRect(bedX - 6, bedY + bedH + 6, 6, 8);
    ctx.fillRect(bedX + bedW, bedY + bedH + 6, 6, 8);
    const du = bedX - 56;
    for (let k = 0; k < 2; k++) {
      const dy2 = bedY + bedH + 10 + k * 12;
      ctx.fillStyle = '#7d8697';
      ctx.fillRect(du + 8, dy2 + 3, 26, 3);
      ctx.fillStyle = '#3a4150';
      ctx.fillRect(du, dy2, 8, 9);
      ctx.fillRect(du + 34, dy2, 8, 9);
    }

    // 右下：霓虹站名
    ctx.font = '700 13px ' + MONO;
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(153,69,255,.9)';
    ctx.shadowColor = 'rgba(153,69,255,.8)'; ctx.shadowBlur = 8;
    ctx.fillText('ISHTC', W - 14, H - 16);
    ctx.shadowBlur = 0;

    drawTicker();
  }

  /** 牆屏下緣的 LED 光條：本體 + 打上牆的光 + 地板柱狀反光（裝飾） */
  function drawLightStrip() {
    if (!wallRect) return;
    const lx = Math.max(10, wallRect.x0), rx = Math.min(W - 10, wallRect.x1);
    if (rx - lx < 60) return;
    const ly = floorTop - 8;
    const pulse = 0.75 + 0.25 * Math.sin(roomT * 1.6);
    ctx.fillStyle = 'rgba(20,241,149,' + (0.5 * pulse).toFixed(3) + ')';
    ctx.fillRect(lx, ly, rx - lx, 3);
    const up = ctx.createLinearGradient(0, ly - 42, 0, ly);
    up.addColorStop(0, 'rgba(20,241,149,0)');
    up.addColorStop(1, 'rgba(20,241,149,' + (0.10 * pulse).toFixed(3) + ')');
    ctx.fillStyle = up;
    ctx.fillRect(lx, ly - 42, rx - lx, 42);
    const n = Math.max(3, Math.round((rx - lx) / 240));
    const segW = (rx - lx) / n;
    for (let i = 0; i < n; i++) {
      const gx = lx + i * segW + 8;
      const gg = ctx.createLinearGradient(0, floorTop, 0, floorTop + 74);
      gg.addColorStop(0, 'rgba(20,241,149,' + (0.10 * pulse).toFixed(3) + ')');
      gg.addColorStop(1, 'rgba(20,241,149,0)');
      ctx.fillStyle = gg;
      ctx.fillRect(gx, floorTop, segW - 16, 74);
    }
  }

  function drawTicker() {
    ctx.fillStyle = '#05070b';
    ctx.fillRect(0, 6, W, 16);
    if (ticker.length) {
      ctx.font = '700 10px ' + MONO;
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
    roomT += dt;
    if (t - monLast > 1000) { layoutMonitors(); monLast = t; }   // DOM 螢幕位置可能變
    launchT -= dt;
    if (pending.length && launchT <= 0) { launch(pending.shift()); launchT = LAUNCH_GAP; }
    for (const d of dogs) updateDog(d, dt);
  }

  function frame(t) {
    raf = 0;
    if (cv.clientWidth && Math.abs(cv.clientWidth - W) > 2) resize();   // 佈局自癒
    const dt = Math.min(0.05, (t - last) / 1000 || 0.016);
    last = t;
    step(dt, t);
    tickTerminal(t);
    drawRoom();
    drawDogs();
    if (!reduced && inView && !document.hidden && !panel.hidden) raf = requestAnimationFrame(frame);
  }
  function kick() { if (!raf && !reduced) { last = performance.now(); raf = requestAnimationFrame(frame); } }

  // 大螢幕在等結果時的 010101 終端流
  const binEl = document.getElementById('binstream');
  let binLast = 0;
  function tickTerminal(t) {
    if (!binEl) return;
    const term = document.getElementById('screen-terminal');
    if (!term || term.hidden) return;
    if (t - binLast < 90) return;
    binLast = t;
    let line = '';
    const len = 46 + Math.floor(Math.random() * 30);
    for (let i = 0; i < len; i++) line += Math.random() < 0.5 ? '0' : '1';
    if (Math.random() < 0.12) line += '  ▒ SCANNING CHAIN…';
    const lines = (binEl.textContent || '').split('\n');
    lines.push(line);
    while (lines.length > 9) lines.shift();
    binEl.textContent = lines.join('\n');
  }
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
      if (panel) panel.hidden = false;   // 先顯示才能量到正確尺寸
      resize();
      dogs = []; pending = []; total = 0; ticker = []; tickerX = 0; held = null;
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

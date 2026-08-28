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
  // 前景層：狗與標籤（在 DOM 螢幕上方）；房景留在背景層（螢幕下方）
  const cvF = document.getElementById('dog-room-fg') || cv;
  const ctxF = cvF === cv ? ctx : cvF.getContext('2d');
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
    if (cvF !== cv) {
      cvF.width = cv.width;
      cvF.height = cv.height;
      ctxF.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctxF.imageSmoothingEnabled = false;
    }
    floorTop = Math.round(H * 0.74);   // 桌面視角：螢幕佔上方，這裡以下是桌面（狗在桌上跑）
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
    if (d.dazeT > 0) d.dazeT -= dt;

    if (d.state === 'held') return;              // 位置由指標決定

    if (d.state === 'air') {
      d.x += d.vx * dt;
      d.h += d.vh * dt;
      d.vh -= G * dt;
      d.rot += d.vrot * dt;
      // 牆壁反彈
      if (d.x < 16 || d.x > W - 16) {
        if (Math.abs(d.vx) > THUMP * 0.6) d.dazeT = Math.max(d.dazeT || 0, 1.1);
        if (d.x < 16) { d.x = 16; d.vx = Math.abs(d.vx) * WALL_R; }
        else { d.x = W - 16; d.vx = -Math.abs(d.vx) * WALL_R; }
        d.vrot = -d.vrot;
      }
      // 天花板（跑馬燈下緣）
      const maxH = d.groundY - 34;
      if (d.h > maxH) {
        if (Math.abs(d.vh) > THUMP * 0.6) d.dazeT = Math.max(d.dazeT || 0, 1.1);
        d.h = maxH; d.vh = -Math.abs(d.vh) * 0.5;
      }
      d.dir = d.vx >= 0 ? 1 : -1;
      // 落地：照物理來 —— 每次反彈衰減，最後在地上滑行減速，不會瞬間黏住
      if (d.h <= 0 && d.vh < 0) {
        d.h = 0;
        const impact = -d.vh;
        if (impact > THUMP) {
          d.hardHit = true;                      // 停穩後要躺平
          d.dazeT = Math.max(d.dazeT || 0, 1.1); // 撞到的當下就先變暈倒圖案
        }
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
            d.dazeT = 0;
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
        if (Math.abs(d.rot) < 0.06) { d.rot = 0; d.dazeT = 0; d.state = 'run'; pickWanderTarget(d); }
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
    const tierK = (d.tier === 'big' || d.tier === 'cat') ? 1.3 : 1;
    return (W < 520 ? 1.6 : 2) * (0.66 + depth * 0.5) * tierK;
  }

  // ---------- 繪製 ----------
  // ---- AI 生成的狗 sprite sheet（可選）----
  // assets/dogs.png：透明背景、嚴格 64px 網格、無文字無外框。
  // 3 列：列0 大金狗（皇冠）、列1 小金狗、列2 普通狗。
  // 12 欄固定順序：欄0-3 坐姿 idle、欄4-9 跑步、欄10 跳躍、欄11 跌倒。
  // 全部面向右、腳貼格子底邊。整張圖 768x192。沒有這個檔就用程式畫的狗。
  let dogSheet = null;
  if (typeof Image !== 'undefined') {
    try {
      const ds = new Image();
      ds.onload = () => {
        if (ds.width >= 300 && ds.height >= 90) {
          dogSheet = ds;
          analyzeSheet(ds);
          if (!sheetFrames) {           // file:// 等讀不到像素：套預算好的幀框
            sheetFrames = SHEET_BAKED.map((row) => row.map((e) => ({
              sx: e[0] * ds.width, sy: e[1] * ds.height,
              sw: e[2] * ds.width, sh: e[3] * ds.height,
            })));
          }
          if (typeof window !== 'undefined' && window.DogRoom) {
            window.DogRoom._sheet = ds;
            window.DogRoom._frames = sheetFrames;
          }
        }
      };
      ds.src = 'assets/dogs.png';
    } catch (e) {}
  }
  const SHEET_ROW = { big: 0, gold: 1, norm: 2 };

  // ---- 失意貓：全場只有一隻，查詢結束最後噴出 ----
  // assets/cat.png 與狗 sheet 同規格（3 列 x 11 幀），但跑步幀彼此相黏、
  // 投影法切不開 → 用等距接縫預先算好的幀框（normalized，取第 0 列）
const CAT_BAKED = [
    [[0.0055,0.0787,0.0810,0.2914],[0.0866,0.0856,0.0801,0.2845],[0.1671,0.0856,0.0847,0.2831],[0.2574,0.0373,0.0866,0.3329],[0.3559,0.1091,0.1017,0.2541],[0.4613,0.1146,0.0990,0.2431],[0.5617,0.1188,0.0893,0.2514],[0.6510,0.1354,0.0866,0.2431],[0.7376,0.1202,0.0925,0.2652],[0.8301,0.0166,0.0764,0.3370],[0.9065,0.0994,0.0879,0.2831]],
    [[0.0064,0.4157,0.0746,0.2680],[0.0856,0.4171,0.0820,0.2666],[0.1676,0.4144,0.0893,0.2693],[0.2569,0.4006,0.0861,0.3177],[0.3582,0.4282,0.1027,0.2541],[0.4636,0.4461,0.0930,0.2376],[0.5599,0.4475,0.0806,0.2348],[0.6404,0.4530,0.0879,0.2459],[0.7284,0.4613,0.0916,0.2390],[0.8200,0.3895,0.0829,0.3287],[0.9029,0.4572,0.0907,0.2610]],
    [[0.0032,0.7224,0.0741,0.2624],[0.0773,0.7238,0.0875,0.2610],[0.1648,0.7279,0.0921,0.2555],[0.2583,0.7182,0.0870,0.2652],[0.3628,0.7555,0.0990,0.2224],[0.4669,0.7514,0.0907,0.2334],[0.5576,0.7569,0.0907,0.2279],[0.6483,0.7514,0.0792,0.2348],[0.7274,0.7555,0.0912,0.2307],[0.8186,0.7182,0.0838,0.2334],[0.9024,0.7597,0.0948,0.2265]]
  ];
  let catSheet = null, catFrames = null;
  if (typeof Image !== 'undefined') {
    try {
      const cs = new Image();
      cs.onload = () => {
        if (cs.width < 300 || cs.height < 90) return;
        catSheet = cs;
        catFrames = CAT_BAKED.map((row) => row.map((e) => ({
          sx: e[0] * cs.width, sy: e[1] * cs.height,
          sw: e[2] * cs.width, sh: e[3] * cs.height,
        })));
      };
      cs.src = 'assets/cat.png';
    } catch (e) {}
  }
  const CAT_NAME = () => (typeof t === 'function' ? t('cat.sym') : '失意貓');
  const CAT_INFO = { sym: '失意貓', mfeX: 99999, tier: 'cat' };

  /** 該列最高的一幀當縮放基準；用跑步幀當基準會讓趴長的貓被放大成巨貓 */
  function rowRefH(frames, row) {
    const arr = frames[row];
    if (arr._ref == null) {
      let m = 0;
      for (const f of arr) if (f.sh > m) m = f.sh;
      arr._ref = m || 1;
    }
    return arr._ref;
  }

  /** 這隻要用哪張圖、哪一列 */
  function sheetFor(d) {
    if (d.tier === 'cat') {
      if (catSheet) return { img: catSheet, frames: catFrames, row: 0 };
      return dogSheet ? { img: dogSheet, frames: sheetFrames, row: 2 } : null;
    }
    if (!dogSheet) return null;
    return { img: dogSheet, frames: sheetFrames, row: SHEET_ROW[d.tier] != null ? SHEET_ROW[d.tier] : 2 };
  }

  // 幀角色依實際幀數推導：前 4 張坐姿、最後 1 張翻肚、中間是跑步循環
  function frameRoles(n) {
    const tumble = Math.max(0, n - 1);
    const runEnd = Math.max(4, n - 2);
    return { idleN: Math.min(4, n), runStart: Math.min(4, n - 1), runEnd: runEnd, air: runEnd, tumble: tumble };
  }
  function spriteFrame(d, moving, n) {
    const R = frameRoles(n || 12);
    if (d.state === 'tumble' || d.dazeT > 0) return R.tumble;   // 撞到就暈，不用等停穩
    if (d.state === 'air' || d.state === 'held') return R.air;   // 跑步最後一張（騰空姿）當跳躍
    if (moving) return R.runStart + (Math.floor(d.phase * 8) % Math.max(1, R.runEnd - R.runStart + 1));
    return Math.floor(d.phase * 2) % Math.max(1, R.idleN);
  }

  // AI 生的 sheet 幀不會乖乖置中，逐幀掃出實際內容框、以腳底中心錨定，
  // 各幀高度統一到該列跑步幀的基準 → 不再像「方塊裡播幻燈片」
  // file:// 開頁時瀏覽器禁止讀圖片像素、掃不了幀 —— 這是用 assets/dogs.png
  // 預先算好的 36 幀內容框（normalized 0..1），離線時直接套用
const SHEET_BAKED = [
    [[0.0074,0.0552,0.0654,0.2666],[0.0879,0.0608,0.0649,0.2610],[0.1690,0.0608,0.0635,0.2624],[0.2505,0.0608,0.0645,0.2610],[0.3375,0.0732,0.0732,0.2597],[0.4217,0.0718,0.0792,0.2610],[0.5092,0.0801,0.0792,0.2528],[0.6022,0.0773,0.0769,0.2459],[0.6952,0.0691,0.0750,0.2638],[0.8002,0.0359,0.0806,0.2818],[0.8996,0.1202,0.0870,0.2127]],
    [[0.0074,0.3936,0.0663,0.2390],[0.0884,0.3978,0.0654,0.2334],[0.1685,0.3992,0.0640,0.2320],[0.2505,0.4006,0.0645,0.2307],[0.3370,0.4088,0.0727,0.2334],[0.4231,0.4102,0.0797,0.2224],[0.5129,0.4102,0.0755,0.2390],[0.6064,0.4102,0.0732,0.2334],[0.6961,0.4102,0.0746,0.2390],[0.8048,0.3674,0.0723,0.2431],[0.8973,0.3867,0.0939,0.2555]],
    [[0.0074,0.7127,0.0649,0.2348],[0.0884,0.7155,0.0654,0.2320],[0.1685,0.7210,0.0645,0.2265],[0.2505,0.7155,0.0645,0.2320],[0.3370,0.7293,0.0727,0.2279],[0.4231,0.7265,0.0778,0.2265],[0.5120,0.7293,0.0764,0.2348],[0.6073,0.7348,0.0727,0.2224],[0.6966,0.7293,0.0741,0.2376],[0.8025,0.6865,0.0746,0.2376],[0.8983,0.7431,0.0852,0.2224]]
  ];

  let sheetFrames = null;
  function analyzeSheet(img) {
    try {
      if (typeof document === 'undefined' || !document.createElement) return;
      const oc = document.createElement('canvas');
      if (!oc.getContext) return;
      oc.width = img.width; oc.height = img.height;
      const c2 = oc.getContext('2d');
      c2.drawImage(img, 0, 0);
      const W2 = img.width, H2 = img.height, ch = Math.floor(H2 / 3);
      const res = [];
      for (let r = 0; r < 3; r++) {
        const y0 = r * ch, y1 = r < 2 ? (r + 1) * ch : H2;
        const band = c2.getImageData(0, y0, W2, y1 - y0).data;
        // x 投影：這條橫帶每個 x 有幾個不透明像素
        const proj = new Array(W2).fill(0);
        for (let i = 3; i < band.length; i += 4) {
          if (band[i] > 60) proj[((i - 3) / 4) % W2]++;
        }
        // 連續內容段；小空隙（<=6px）併起來
        let segs = [];
        let inseg = false, s0 = 0;
        for (let x = 0; x < W2; x++) {
          if (proj[x] > 0 && !inseg) { inseg = true; s0 = x; }
          else if (proj[x] === 0 && inseg) { inseg = false; segs.push([s0, x - 1]); }
        }
        if (inseg) segs.push([s0, W2 - 1]);
        const merged = [];
        for (const g of segs) {
          if (merged.length && g[0] - merged[merged.length - 1][1] <= 6) merged[merged.length - 1][1] = g[1];
          else merged.push(g);
        }
        segs = merged;
        if (segs.length < 6) return;        // 切不出合理幀數就放棄，外面套預烘焙表
        res[r] = segs.map(([sx0, sx1]) => {
          let yy0 = y1 - y0, yy1 = 0;
          for (let y = 0; y < y1 - y0; y++) {
            const base = y * W2 * 4;
            for (let x = sx0; x <= sx1; x++) {
              if (band[base + x * 4 + 3] > 60) {
                if (y < yy0) yy0 = y;
                if (y > yy1) yy1 = y;
                break;
              }
            }
          }
          if (yy1 < yy0) { yy0 = 0; yy1 = (y1 - y0) - 1; }
          return { sx: sx0, sy: y0 + yy0, sw: sx1 - sx0 + 1, sh: yy1 - yy0 + 1 };
        });
      }
      sheetFrames = res;
      if (typeof window !== 'undefined' && window.DogRoom) window.DogRoom._frames = res;
    } catch (e) { /* file:// 等畫布受限：外面會套 SHEET_BAKED */ }
  }


  /** 用 sprite sheet 畫一隻狗；(x,y) = 腳底中心，s 同 stamp 的縮放 */
  function blitDog(d, x, y, s, moving) {
    const sp = sheetFor(d);
    if (!sp) return false;
    const row = sp.row;
    const nFrames = (sp.frames && sp.frames[row] && sp.frames[row].length) || 12;
    const f = spriteFrame(d, moving, nFrames);
    const size = 24 * s;
    ctxF.save();
    ctxF.translate(Math.round(x), Math.round(y));
    if (d.dir < 0) ctxF.scale(-1, 1);
    if (d.tier !== 'norm') {                   // 金狗微光；貓是紫光
      const grad = ctxF.createRadialGradient(0, -size * 0.45, s, 0, -size * 0.45, size * 0.62);
      grad.addColorStop(0, d.tier === 'cat' ? 'rgba(153,69,255,.34)'
        : d.tier === 'big' ? 'rgba(255,211,77,.30)' : 'rgba(240,180,41,.22)');
      grad.addColorStop(1, d.tier === 'cat' ? 'rgba(153,69,255,0)' : 'rgba(255,211,77,0)');
      ctxF.fillStyle = grad;
      ctxF.beginPath();
      ctxF.ellipse(0, -size * 0.45, size * 0.62, size * 0.45, 0, 0, Math.PI * 2);
      ctxF.fill();
    }
    if (sp.frames) {
      const fr = sp.frames[row][f];
      const ref = rowRefH(sp.frames, row);
      const k = size / ref;
      ctxF.drawImage(sp.img, fr.sx, fr.sy, fr.sw, fr.sh,
        -fr.sw * k / 2, -fr.sh * k, fr.sw * k, fr.sh * k);
    } else {
      const cw = sp.img.width / nFrames, ch = sp.img.height / 3;
      const dw2 = size * (cw / ch), dh2 = size;
      ctxF.drawImage(sp.img, f * cw + cw * 0.04, row * ch + ch * 0.02, cw * 0.92, ch * 0.96,
        -dw2 / 2, -dh2, dw2, dh2);
    }
    ctxF.restore();
    return true;
  }


  // 想換成自己生成的桌面圖：放 assets/room-bg.png（1920x1080，下方 ~26% 是桌面，狗在上面跑）
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
    if (roomImg) {                                   // 自訂背景（桌面照）：鋪滿裁切
      const sc = Math.max(W / roomImg.width, H / roomImg.height);
      const dw = roomImg.width * sc, dh = roomImg.height * sc;
      ctx.drawImage(roomImg, (W - dw) / 2, (H - dh) / 2, dw, dh);
      drawTicker();
      return;
    }

    // ---- 牆（幾乎被螢幕擋住，只露出邊緣）----
    ctx.fillStyle = '#0b0e13';
    ctx.fillRect(0, 0, W, floorTop);

    // ---- 桌面：暗色檯面，往前漸暗＋極淡橫向紋理 ----
    const fg = ctx.createLinearGradient(0, floorTop, 0, H);
    fg.addColorStop(0, '#191510');
    fg.addColorStop(0.2, '#15110c');
    fg.addColorStop(1, '#0c0a07');
    ctx.fillStyle = fg;
    ctx.fillRect(0, floorTop, W, H - floorTop);
    ctx.strokeStyle = 'rgba(232,236,244,.03)';
    ctx.lineWidth = 1;
    for (let i = 1; i <= 5; i++) {
      const gy2 = floorTop + (H - floorTop) * (i / 6);
      ctx.beginPath(); ctx.moveTo(0, gy2 + 0.5); ctx.lineTo(W, gy2 + 0.5); ctx.stroke();
    }
    // 桌沿（螢幕後方那條邊）
    ctx.fillStyle = '#0a0c10';
    ctx.fillRect(0, floorTop - 3, W, 3);

    drawLightStrip();

    const leftEdge = wallRect ? wallRect.x0 : W * 0.1;
    const rightEdge = wallRect ? wallRect.x1 : W * 0.9;
    const deskMid = floorTop + (H - floorTop) * 0.34;   // 桌上物件的基準線（狗跑帶前緣）

    // ---- 大滑鼠墊：狗的主跑道（取代地毯）----
    const padW = Math.min(W * 0.5, 720), padX = (W - padW) / 2;
    const padY = floorTop + (H - floorTop) * 0.22, padH = (H - floorTop) * 0.6;
    ctx.fillStyle = 'rgba(8,8,14,.4)';
    ctx.fillRect(padX, padY, padW, padH);
    ctx.strokeStyle = 'rgba(153,69,255,.16)';
    ctx.strokeRect(padX + 1.5, padY + 1.5, padW - 3, padH - 3);

    // ---- 鍵盤（畫面正前方下緣，紫色背光）----
    const kbW = Math.min(W * 0.26, 360), kbH = 34;
    const kbX = (W - kbW) / 2, kbY = H - kbH - 14;
    ctx.fillStyle = '#12151c';
    ctx.fillRect(kbX - 4, kbY - 4, kbW + 8, kbH + 8);
    const glowP = 0.7 + 0.3 * Math.sin(roomT * 1.1);
    for (let r = 0; r < 3; r++) {
      for (let c2 = 0; c2 < Math.floor(kbW / 18); c2++) {
        ctx.fillStyle = 'rgba(153,69,255,' + (0.16 * glowP).toFixed(3) + ')';
        ctx.fillRect(kbX + c2 * 18 + 2, kbY + r * 11 + 2, 14, 8);
        ctx.fillStyle = '#1c212c';
        ctx.fillRect(kbX + c2 * 18 + 3, kbY + r * 11 + 3, 12, 6);
      }
    }
    // 滑鼠（鍵盤右邊）
    ctx.fillStyle = '#171b24';
    ctx.beginPath(); ctx.ellipse(kbX + kbW + 46, kbY + 16, 11, 15, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(20,241,149,' + (0.5 * glowP).toFixed(3) + ')';
    ctx.beginPath(); ctx.moveTo(kbX + kbW + 46, kbY + 4); ctx.lineTo(kbX + kbW + 46, kbY + 12); ctx.stroke();

    // ---- 左桌面：咖啡杯（冒煙）+ 書 + 麥克風 ----
    {
      const mx = Math.max(56, leftEdge + 52);
      // 麥克風臂（從左邊伸進來）
      ctx.strokeStyle = '#1c212c'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(0, deskMid + 26); ctx.lineTo(mx - 6, deskMid - 2); ctx.stroke();
      ctx.lineWidth = 1;
      ctx.fillStyle = '#242b38';
      ctx.fillRect(mx - 12, deskMid - 22, 14, 22);
      ctx.fillStyle = '#3a4150';
      ctx.fillRect(mx - 10, deskMid - 20, 10, 12);
      // 咖啡杯
      const cx2 = mx + 34, cy3 = deskMid + 18;
      ctx.fillStyle = '#12151c';
      ctx.fillRect(cx2 - 9, cy3 - 16, 18, 16);
      ctx.strokeStyle = '#2e3542';
      ctx.strokeRect(cx2 + 9.5, cy3 - 12.5, 5, 8);
      // 煙（隨時間飄）
      ctx.fillStyle = 'rgba(232,236,244,.18)';
      for (let k = 0; k < 3; k++) {
        const sy2 = cy3 - 22 - k * 8;
        const sx2 = cx2 + Math.sin(roomT * 1.4 + k * 1.7) * 4;
        ctx.fillRect(sx2, sy2, 3, 4);
      }
      // TRADING PLAN 筆記本
      ctx.fillStyle = '#101820';
      ctx.fillRect(mx - 4, cy3 + 14, 44, 12);
      ctx.fillStyle = 'rgba(20,241,149,.7)';
      ctx.fillRect(mx, cy3 + 17, 24, 2);
    }

    // ---- 右桌面：LED 時鐘 + 小盆栽 + 金牛擺件 ----
    {
      const rx0 = Math.min(W - 60, rightEdge - 46);
      // LED 時鐘
      ctx.fillStyle = '#0a0d12';
      ctx.fillRect(rx0 - 30, deskMid - 10, 60, 22);
      ctx.fillStyle = 'rgba(20,241,149,.9)';
      ctx.font = '700 12px ' + MONO;
      ctx.textAlign = 'center';
      ctx.fillText('10:24', rx0, deskMid + 5);
      // 盆栽
      ctx.fillStyle = '#3a2c1a';
      ctx.fillRect(rx0 - 44, deskMid + 22, 14, 11);
      ctx.fillStyle = '#0f9d6a';
      ctx.fillRect(rx0 - 41, deskMid + 8, 3, 14);
      ctx.fillStyle = '#14f195';
      ctx.fillRect(rx0 - 36, deskMid + 4, 3, 18);
      // 金牛擺件（衝勢的吉祥物）
      const bx2 = rx0 + 26, by2 = deskMid + 30;
      ctx.fillStyle = '#2a2f3a';
      ctx.fillRect(bx2 - 12, by2 - 10, 24, 10);      // 身
      ctx.fillRect(bx2 + 8, by2 - 16, 10, 9);        // 頭
      ctx.fillStyle = '#ffd34d';
      ctx.fillRect(bx2 + 8, by2 - 19, 3, 4);         // 角
      ctx.fillRect(bx2 + 15, by2 - 19, 3, 4);
      ctx.fillStyle = '#1c212c';
      ctx.fillRect(bx2 - 10, by2, 3, 5); ctx.fillRect(bx2 + 6, by2, 3, 5);
    }

    // ---- 左遠角：發光狗幣座燈 ----
    {
      const lx2 = 26, ly2 = floorTop + 16;
      ctx.shadowColor = 'rgba(255,176,32,.8)'; ctx.shadowBlur = 12;
      ctx.fillStyle = '#ffb020';
      ctx.beginPath(); ctx.ellipse(lx2, ly2, 9, 9, 0, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#7a4d00';
      ctx.font = '700 10px ' + MONO;
      ctx.textAlign = 'center';
      ctx.fillText('D', lx2, ly2 + 3);
      ctx.fillStyle = '#12151c';
      ctx.fillRect(lx2 - 5, ly2 + 9, 10, 4);
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

  /** 螢幕底座後的 LED 光條：本體 + 桌面反光（裝飾） */
  function drawLightStrip() {
    if (!wallRect) return;
    const lx = Math.max(10, wallRect.x0), rx = Math.min(W - 10, wallRect.x1);
    if (rx - lx < 60) return;
    const ly = floorTop - 7;
    const pulse = 0.75 + 0.25 * Math.sin(roomT * 1.6);
    ctx.fillStyle = 'rgba(20,241,149,' + (0.5 * pulse).toFixed(3) + ')';
    ctx.fillRect(lx, ly, rx - lx, 3);
    const up = ctx.createLinearGradient(0, ly - 30, 0, ly);
    up.addColorStop(0, 'rgba(20,241,149,0)');
    up.addColorStop(1, 'rgba(20,241,149,' + (0.10 * pulse).toFixed(3) + ')');
    ctx.fillStyle = up;
    ctx.fillRect(lx, ly - 30, rx - lx, 30);
    // 桌面反光：整條平滑往前淡出（不再是舊多螢幕的柱狀殘影）
    const gg = ctx.createLinearGradient(0, floorTop, 0, floorTop + 90);
    gg.addColorStop(0, 'rgba(20,241,149,' + (0.11 * pulse).toFixed(3) + ')');
    gg.addColorStop(1, 'rgba(20,241,149,0)');
    ctx.fillStyle = gg;
    ctx.fillRect(lx, floorTop, rx - lx, 90);
  }

  function drawTicker() {
    ctx.fillStyle = '#05070b';
    ctx.fillRect(0, 0, W, 30);
    ctx.fillStyle = 'rgba(20,241,149,.25)';
    ctx.fillRect(0, 30, W, 1);
    if (ticker.length) {
      ctx.font = '700 13px ' + MONO;
      ctx.textAlign = 'left';
      const sp = ctx.measureText('   ').width;
      let tw = 60;
      for (const seg of ticker) tw += ctx.measureText(seg).width + sp;
      tickerX = (tickerX + (reduced ? 0 : 0.8)) % tw;
      for (let off = -tw; off < W + tw; off += tw) {
        let x = 8 - tickerX + off;
        for (const seg of ticker) {
          ctx.fillStyle = /x$/.test(seg) ? '#14f195' : '#7d8697';
          ctx.fillText(seg, x, 20);
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
      ctxF.fillStyle = 'rgba(0,0,0,' + (0.35 - air * 0.22) + ')';
      ctxF.beginPath();
      ctxF.ellipse(d.x, d.groundY + 1, (8 - air * 3) * s, 2 * s, 0, 0, Math.PI * 2);
      ctxF.fill();
      if (d.rot) {
        ctxF.save();
        ctxF.translate(d.x, y - 5 * s);
        ctxF.rotate(d.rot);
        if (!blitDog(d, 0, 5 * s, s, false)) stamp(ctxF, 0, 5 * s, s, d.tier, d.dir, d.phase, false);
        ctxF.restore();
      } else {
        if (!blitDog(d, d.x, y, s, d.state === 'run')) stamp(ctxF, d.x, y, s, d.tier, d.dir, d.phase, d.state === 'run');
      }
      if (d.sayT > 0) {
        const label = d.sym + (isFinite(d.mfeX) ? '  ' + (d.mfeX >= 100 ? Math.round(d.mfeX) : d.mfeX.toFixed(1)) + 'x' : '');
        ctxF.font = '700 11px ui-monospace,Menlo,Consolas,monospace';
        const tw = ctxF.measureText(label).width;
        const bx = Math.max(4, Math.min(W - tw - 16, d.x - tw / 2 - 6));
        const by = y - 13 * s - 22;
        ctxF.fillStyle = '#e8ecf4';
        ctxF.fillRect(bx, by, tw + 12, 18);
        ctxF.fillStyle = '#0a0b0e';
        ctxF.textAlign = 'left';
        ctxF.fillText(label, bx + 6, by + 13);
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
    if (cvF !== cv) ctxF.clearRect(0, 0, W, H);
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
  function drawOnce() {
    drawRoom();
    if (cvF !== cv) ctxF.clearRect(0, 0, W, H);
    drawDogs();
  }

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
    return (best && bd < (46 * 46)) ? best : null;
  }
  // 狗畫在螢幕上層（canvas 本身不收事件），改在 panel 捕獲階段攔：
  // 點到狗 → 攔下來抓狗；沒點到 → 事件照常進到底下的螢幕
  const evRoot = (panel && panel.addEventListener) ? panel : cv;
  const moveRoot = (typeof window !== 'undefined' && window.addEventListener) ? window : cv;
  evRoot.addEventListener('pointerdown', function (ev) {
    const p = canvasPos(ev);
    const d = hitDog(p);
    downAt = { x: p.x, y: p.y, dog: d, moved: false };
    if (d) {
      if (ev.preventDefault) ev.preventDefault();
      if (ev.stopPropagation) ev.stopPropagation();
      held = d;
      d.state = 'held';
      d.rot = 0; d.vrot = 0; d.sayT = 0; d.dazeT = 0;
      trail = [{ x: p.x, y: p.y, t: performance.now() }];
      if (evRoot.style) evRoot.style.cursor = 'grabbing';
      kick();
    }
  }, true);
  moveRoot.addEventListener('pointermove', function (ev) {
    const p = canvasPos(ev);
    if (downAt && (Math.abs(p.x - downAt.x) > 7 || Math.abs(p.y - downAt.y) > 7)) downAt.moved = true;
    if (!held) {
      const hv = hitDog(p);
      if (evRoot.style) evRoot.style.cursor = hv ? 'grab' : '';
      if (hv) {                                   // 滑過就顯示幣名，離開後淡出
        hv.sayT = Math.max(hv.sayT, 0.3);
        if (reduced) drawOnce(); else kick();
      }
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
      if (downAt && !downAt.moved) held.sayT = 2.6;    // 只是點一下 → 報幣名
      held = null;
      if (evRoot.style) evRoot.style.cursor = '';
      kick();
    } else if (downAt && !downAt.moved && downAt.dog) {
      downAt.dog.sayT = 2.6;                     // 純點擊 → 顯示幣名
      if (reduced) drawOnce();
    }
    downAt = null;
  }
  moveRoot.addEventListener('pointerup', release);
  moveRoot.addEventListener('pointercancel', function () { release(null); });

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
    // 貓是彩蛋，不算進你的幣數
    const notCat = (d) => d.tier !== 'cat';
    const shown = dogs.filter(notCat).length + pending.filter(notCat).length;
    const golds = dogs.filter((d) => d.tier !== 'norm' && d.tier !== 'cat').length
      + pending.filter((d) => d.tier && d.tier !== 'norm' && d.tier !== 'cat').length;
    const T = (k, v) => (typeof t === 'function' ? t(k, v) : k);
    let txt = T('room.hint');
    if (total > shown) txt += T('room.overflow', { shown: shown, total: total });
    else if (shown) {
      txt += T('room.count', { n: shown, gold: golds ? T('room.golds', { n: golds }) : '' });
    }
    hintEl.textContent = txt;
  }

  /** 語言切換後重貼提示與貓名 */
  function relabel() {
    for (const d of dogs) if (d.tier === 'cat') d.sym = CAT_NAME();
    for (const p2 of pending) if (p2.tier === 'cat') p2.sym = CAT_NAME();
    updateHint();
    if (reduced) drawOnce(); else kick();
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
    relabel: relabel,
    _roles: frameRoles,        // 測試用
    _frameOf: spriteFrame,     // 測試用
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
      want.add(CAT_INFO.sym); want.add(CAT_NAME());
      dogs = dogs.filter((d) => want.has(d.sym));
      pending = pending.filter((p) => want.has(p.sym));
      for (const p of pick) if (!have.has(p.sym)) pending.push(p);
      // 全場一隻失意貓，排在最後噴出來
      if (!have.has(CAT_INFO.sym)) pending.push(Object.assign({}, CAT_INFO, { sym: CAT_NAME() }));
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
    if (candles.length > 40) return;           // 太多會疊成一片糊
    candles.push({
      x: col * colW + 8 + Math.random() * 16,
      y: H + 30, h: 18 + Math.random() * 52, w: 9,
      up: Math.random() < 0.62,
      alpha: 0.08 + Math.random() * 0.14,
      vy: 30 + Math.random() * 34,
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
      size: jackpot ? 26 + Math.random() * 16 : 14 + Math.random() * 8,
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
    if (spawnT <= 0) { spawnCandle(); if (Math.random() < 0.45) spawnFloat(); spawnT = 0.34; }
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
        : 'rgba(20,241,149,' + (f.alpha * 0.55) + ')';
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
      const sheet = window.DogRoom && window.DogRoom._sheet;
      if (sheet) {
        const rrow = d.tier === 'big' ? 0 : d.tier === 'gold' ? 1 : 2;
        const FR = window.DogRoom._frames;
        const nF = (FR && FR[rrow] && FR[rrow].length) || 12;
        const runN = Math.max(1, (nF - 2) - 4 + 1);
        const fi = 4 + (Math.floor(d.phase * 8) % runN);
        const hgt = 14 * d.scale;
        ctx.save();
        ctx.globalAlpha = 0.95;
        ctx.translate(Math.round(d.x), Math.round(d.y));
        if (d.dir < 0) ctx.scale(-1, 1);
        if (FR) {
          const fr = FR[rrow][fi];
          let ref = 0;
          for (const q of FR[rrow]) if (q.sh > ref) ref = q.sh;
          if (!ref) ref = fr.sh;
          const k = hgt / ref;
          ctx.drawImage(sheet, fr.sx, fr.sy, fr.sw, fr.sh, -fr.sw * k / 2, -fr.sh * k, fr.sw * k, fr.sh * k);
        } else {
          const cw2 = sheet.width / nF, ch2 = sheet.height / 3;
          const wdt = hgt * (cw2 / ch2);
          ctx.drawImage(sheet, fi * cw2 + cw2 * 0.04, rrow * ch2 + ch2 * 0.02,
            cw2 * 0.92, ch2 * 0.96, -wdt / 2, -hgt, wdt, hgt);
        }
        ctx.restore();
        ctx.globalAlpha = 1;
      } else if (stampFn) {
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

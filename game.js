(() => {
  'use strict';

  /* ============================================================
   * 遊戲參數（想調整手感或難度，改這裡就好）
   * 座標單位是「邏輯像素」：畫布只有 320×120，
   * 再由 CSS 放大，所以每個點都是清楚的像素方塊。
   * ============================================================ */
  const CFG = {
    width: 320,
    height: 120,
    groundY: 100,

    gravity: 1400,          // 重力（px/s²）
    jumpVelocity: 340,      // 起跳初速（px/s）

    baseSpeed: 140,         // 起始速度（px/s）
    speedStep: 18,          // 每 500 分增加的速度
    maxSpeed: 420,          // 速度上限（設很大就等於不封頂）

    pointsPerSecond: 10,    // 每秒加 10 分
    pointsPerLevel: 500,    // 每 500 分升一級

    playerX: 28,
    playerH: 24,
    spikeW: 11,             // 單根尖刺寬度（奇數，三角形才會左右對稱）
    spikeH: 12,
    tallSpikeH: 17,
  };

  const C = {
    sky1: '#1f1c47', sky2: '#262250', sky3: '#2f2a5c',
    star: '#cfd3ff', starDim: '#6c6ab0',
    moon: '#ffd166',
    cloud: '#34306a',
    ground: '#3b3f8c', groundTop: '#7b86f0', pebble: '#5560c4', shadow: '#2a2e6e',
    spike: '#ff595e', spikeShade: '#b8323c', spikeLight: '#ff9a9e',
    stick: '#f4f2ff',
  };

  const W = CFG.width, H = CFG.height, GY = CFG.groundY;

  /* ---------- DOM ---------- */
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const screenEl = document.getElementById('screen');
  const hiEl = document.getElementById('hi');
  const scoreEl = document.getElementById('score');
  const levelEl = document.getElementById('level');
  const overlay = document.getElementById('overlay');
  const overlayMain = document.getElementById('overlayMain');
  const overlaySub = document.getElementById('overlaySub');
  const banner = document.getElementById('banner');
  const statusEl = document.getElementById('status');

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- 最高分（存在瀏覽器 localStorage） ---------- */
  const HI_KEY = 'stickrun.hi';
  let hi = 0;
  try { hi = parseInt(localStorage.getItem(HI_KEY), 10) || 0; } catch (e) { /* 無痕模式等情況會失敗，忽略 */ }

  /* ---------- 像素繪圖小工具 ---------- */
  const rect = (x, y, w, h, c) => {
    ctx.fillStyle = c;
    ctx.fillRect(Math.round(x), Math.round(y), w, h);
  };
  const px = (x, y, c) => rect(x, y, 1, 1, c);

  // Bresenham 畫線：每一點都落在整數格子上，才有像素風的階梯感
  function line(x0, y0, x1, y1, c) {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      px(x0, y0, c);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }
  const polyline = (pts, ox, oy, c) => {
    for (let i = 0; i < pts.length - 1; i++) {
      line(ox + pts[i][0], oy + pts[i][1], ox + pts[i + 1][0], oy + pts[i + 1][1], c);
    }
  };

  /* ============================================================
   * 火柴人：頭是 7×7 的空心像素圓，身體與四肢是 1px 線段
   * 座標相對於角色左上角（寬 13、高 24），身體中線在 x=6
   * ============================================================ */
  const HEAD = [
    '..XXX..',
    '.X...X.',
    'X.....X',
    'X.....X',
    'X.....X',
    '.X...X.',
    '..XXX..',
  ];
  const POSES = {
    stand: {
      arms: [[[6, 9], [4, 14]], [[6, 9], [8, 14]]],
      legs: [[[6, 15], [4, 23]], [[6, 15], [8, 23]]],
    },
    run0: {
      arms: [[[6, 9], [9, 12], [11, 10]], [[6, 9], [3, 11], [1, 13]]],
      legs: [[[6, 15], [10, 18], [10, 23]], [[6, 15], [3, 20], [1, 23]]],
    },
    run1: {
      arms: [[[6, 9], [3, 12], [1, 10]], [[6, 9], [9, 11], [11, 13]]],
      legs: [[[6, 15], [2, 18], [2, 23]], [[6, 15], [9, 20], [11, 23]]],
    },
    jump: {
      arms: [[[6, 9], [3, 6], [1, 3]], [[6, 9], [9, 6], [11, 3]]],
      legs: [[[6, 15], [10, 18], [11, 22]], [[6, 15], [2, 18], [1, 22]]],
    },
    dead: {
      arms: [[[6, 9], [2, 12], [1, 16]], [[6, 9], [10, 12], [11, 16]]],
      legs: [[[6, 15], [4, 23]], [[6, 15], [8, 23]]],
    },
  };

  function drawStickman(x, top, poseName) {
    const pose = POSES[poseName];
    const c = C.stick;
    HEAD.forEach((row, ry) => {
      for (let rx = 0; rx < row.length; rx++) if (row[rx] === 'X') px(x + 3 + rx, top + ry, c);
    });
    if (poseName === 'dead') {            // X 眼睛
      [[5, 2], [7, 2], [6, 3], [5, 4], [7, 4]].forEach(([ex, ey]) => px(x + ex, top + ey, c));
    } else {
      px(x + 7, top + 3, c);              // 朝右看的眼睛
    }
    line(x + 6, top + 7, x + 6, top + 15, c);   // 身體
    pose.arms.forEach(a => polyline(a, x, top, c));
    pose.legs.forEach(l => polyline(l, x, top, c));
  }

  /* ============================================================
   * 尖刺：逐列畫出等腰三角形（左亮、右暗，做出像素立體感）
   * ============================================================ */
  const spikeRowWidth = (r, w, h) => 2 * Math.floor(((r + 0.5) / h * w) / 2) + 1; // 恆為奇數

  function drawSpike(x, h) {
    const w = CFG.spikeW, cx = x + (w - 1) / 2;
    for (let r = 0; r < h; r++) {
      const rw = spikeRowWidth(r, w, h);
      const left = Math.round(cx - (rw - 1) / 2);
      const y = GY - h + r;
      rect(left, y, rw, 1, C.spike);
      rect(cx + 1, y, (rw - 1) / 2, 1, C.spikeShade);
      if (rw > 1) px(left, y, C.spikeLight);
    }
  }

  /* ============================================================
   * 遊戲狀態
   * ============================================================ */
  const state = {
    mode: 'ready',      // ready | running | dead
    score: 0,
    tick: 0,            // 累積到 1 秒就加 10 分
    level: 0,
    speed: CFG.baseSpeed,
    scroll: 0,
    runTime: 0,
    obstacles: [],
    spawnIn: 0,
    diedAt: 0,
    newRecord: false,
    player: { feetY: GY, vy: 0, onGround: true },
  };

  // 背景裝飾（固定種子，每次載入長得一樣）
  let seed = 7;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const stars = Array.from({ length: 34 }, () => ({ x: Math.floor(rnd() * W), y: 3 + Math.floor(rnd() * 68), bright: rnd() < 0.3 }));
  const clouds = Array.from({ length: 4 }, (_, i) => ({ x: i * 90 + rnd() * 40, y: 14 + Math.floor(rnd() * 40) }));
  const pebbles = Array.from({ length: 28 }, () => ({ x: Math.floor(rnd() * W), y: GY + 3 + Math.floor(rnd() * 15), w: 1 + Math.floor(rnd() * 3) }));

  function reset() {
    Object.assign(state, {
      mode: 'ready', score: 0, tick: 0, level: 0, speed: CFG.baseSpeed,
      scroll: 0, runTime: 0, obstacles: [], spawnIn: 220, newRecord: false,
    });
    Object.assign(state.player, { feetY: GY, vy: 0, onGround: true });
  }

  /* ---------- 障礙生成 ---------- */
  function spawnSpikes() {
    const lv = state.level;
    const r = Math.random();
    let count;
    if (lv < 2) count = r < 0.7 ? 1 : 2;                // 前期只出單根或雙根
    else count = r < 0.5 ? 1 : (r < 0.8 ? 2 : 3);
    const tall = count === 1 && lv >= 1 && Math.random() < 0.3;
    const obs = { x: W + 4, count, h: tall ? CFG.tallSpikeH : CFG.spikeH };
    obs.w = count * CFG.spikeW;
    state.obstacles.push(obs);

    // 間距依「一次跳躍飛行的水平距離」計算：速度越快，間距越大，永遠跳得過去
    const airDist = state.speed * (2 * CFG.jumpVelocity / CFG.gravity);
    const gap = airDist * (1.25 + Math.random());
    state.spawnIn = obs.w + gap;
  }

  /* ---------- 碰撞：火柴人的窄身體框 vs 三角形（逐列比對） ---------- */
  function hitsSpike(x, h, box) {
    const w = CFG.spikeW, cx = x + (w - 1) / 2;
    for (let r = 0; r < h; r++) {
      const rowTop = GY - h + r;
      if (rowTop + 1 <= box.t || rowTop >= box.b) continue;
      const rw = Math.max(1, spikeRowWidth(r, w, h) - 2);   // 左右各讓 1px，判定稍寬容
      const l = cx - (rw - 1) / 2, rr = cx + (rw - 1) / 2 + 1;
      if (rr > box.l && l < box.r) return true;
    }
    return false;
  }

  /* ---------- 流程控制 ---------- */
  function setOverlay(main, sub) {
    overlayMain.textContent = main;
    overlaySub.textContent = sub;
    overlay.hidden = false;
  }

  function announce(text) { statusEl.textContent = text; }

  function start() {
    reset();
    state.mode = 'running';
    overlay.hidden = true;
    announce('');
  }

  function jump() {
    const p = state.player;
    if (!p.onGround) return;
    p.vy = -CFG.jumpVelocity;
    p.onGround = false;
  }

  function die() {
    state.mode = 'dead';
    state.diedAt = performance.now();
    if (state.score > hi) {
      hi = state.score;
      state.newRecord = true;
      try { localStorage.setItem(HI_KEY, String(hi)); } catch (e) { /* 忽略 */ }
    }
    setOverlay(state.newRecord ? 'NEW RECORD!' : 'GAME OVER', 'SPACE to retry');
    announce('遊戲結束，分數 ' + state.score);
  }

  function levelUp() {
    state.level += 1;
    state.speed = Math.min(CFG.baseSpeed + state.level * CFG.speedStep, CFG.maxSpeed);
    banner.classList.remove('show');
    void banner.offsetWidth;                 // 強制重排，讓動畫可以重播
    banner.classList.add('show');
    announce('速度提升，第 ' + (state.level + 1) + ' 級');
  }

  /* ---------- 每幀更新 ---------- */
  function update(dt) {
    // 計分：每過 1 秒固定 +10 分
    state.tick += dt;
    while (state.tick >= 1) {
      state.tick -= 1;
      state.score += CFG.pointsPerSecond;
    }
    // 每 500 分升一級並加速
    if (Math.floor(state.score / CFG.pointsPerLevel) > state.level) levelUp();

    // 玩家物理
    const p = state.player;
    if (!p.onGround) {
      p.vy += CFG.gravity * dt;
      p.feetY += p.vy * dt;
      if (p.feetY >= GY) { p.feetY = GY; p.vy = 0; p.onGround = true; }
    }

    // 世界往左捲動（尖刺「逼近」）
    const move = state.speed * dt;
    state.scroll += move;
    state.runTime += dt;
    clouds.forEach(c => { c.x -= (6 + state.speed * 0.04) * dt; if (c.x < -24) c.x = W + Math.random() * 60; });

    state.obstacles.forEach(o => { o.x -= move; });
    state.obstacles = state.obstacles.filter(o => o.x + o.w > -4);

    state.spawnIn -= move;
    if (state.spawnIn <= 0) spawnSpikes();

    // 碰撞
    const box = { l: CFG.playerX + 4, r: CFG.playerX + 9, t: p.feetY - CFG.playerH, b: p.feetY };
    for (const o of state.obstacles) {
      for (let i = 0; i < o.count; i++) {
        if (hitsSpike(o.x + i * CFG.spikeW, o.h, box)) { die(); return; }
      }
    }
  }

  /* ---------- 繪製 ---------- */
  function render(t) {
    // 天空（三段色帶，像素風的階梯漸層）
    rect(0, 0, W, 40, C.sky1);
    rect(0, 40, W, 35, C.sky2);
    rect(0, 75, W, GY - 75, C.sky3);

    // 星星
    const tw = reduceMotion ? 0 : Math.floor(t * 2);
    stars.forEach((s, i) => {
      if (s.bright && (i + tw) % 7 === 0) return;
      px(s.x, s.y, s.bright ? C.star : C.starDim);
    });

    // 月牙：先畫滿月，再用天空色挖掉一塊
    const mx = 268, my = 24;
    for (let dy = -8; dy <= 8; dy++) for (let dx = -8; dx <= 8; dx++) if (dx * dx + dy * dy <= 64) px(mx + dx, my + dy, C.moon);
    for (let dy = -8; dy <= 8; dy++) for (let dx = -8; dx <= 8; dx++) if (dx * dx + dy * dy <= 56) px(mx - 3 + dx, my - 2 + dy, C.sky1);

    // 雲
    clouds.forEach(c => {
      const x = Math.round(c.x), y = c.y;
      rect(x + 4, y, 10, 2, C.cloud);
      rect(x, y + 2, 22, 3, C.cloud);
      rect(x + 2, y + 5, 18, 1, C.cloud);
    });

    // 地面
    rect(0, GY, W, H - GY, C.ground);
    rect(0, GY, W, 1, C.groundTop);
    pebbles.forEach(p => {
      const x = (((p.x - state.scroll) % W) + W) % W;
      rect(x, p.y, p.w, 1, C.pebble);
    });

    // 尖刺
    state.obstacles.forEach(o => {
      for (let i = 0; i < o.count; i++) drawSpike(Math.round(o.x) + i * CFG.spikeW, o.h);
    });

    // 火柴人與腳下影子（越高影子越窄）
    const p = state.player;
    const lift = GY - p.feetY;
    const sw = Math.max(3, 9 - Math.floor(lift / 6));
    rect(CFG.playerX + 6 - Math.floor(sw / 2), GY + 2, sw, 1, C.shadow);

    let pose = 'stand';
    if (state.mode === 'dead') pose = 'dead';
    else if (!p.onGround) pose = 'jump';
    else if (state.mode === 'running') pose = Math.floor(state.runTime / 0.11) % 2 ? 'run1' : 'run0';
    drawStickman(CFG.playerX, Math.round(p.feetY) - CFG.playerH, pose);
  }

  /* ---------- HUD ---------- */
  const pad = (n, len) => String(n).padStart(len, '0');
  function updateHud() {
    const s = pad(state.score, 5), h = pad(Math.max(hi, state.score), 5), l = pad(state.level + 1, 2);
    if (scoreEl.textContent !== s) scoreEl.textContent = s;
    if (hiEl.textContent !== h) hiEl.textContent = h;
    if (levelEl.textContent !== l) levelEl.textContent = l;
  }

  /* ---------- 輸入 ---------- */
  function press() {
    if (state.mode === 'ready') start();
    else if (state.mode === 'running') jump();
    else if (state.mode === 'dead' && performance.now() - state.diedAt > 500) start(); // 避免連按誤觸重開
  }

  window.addEventListener('keydown', e => {
    if (['Space', 'ArrowUp', 'KeyW', 'Enter'].includes(e.code)) {
      e.preventDefault();
      if (!e.repeat) press();
    }
  });
  screenEl.addEventListener('pointerdown', e => { e.preventDefault(); press(); });

  /* ---------- 主迴圈 ---------- */
  let last = performance.now();
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.05);   // 切分頁回來時不要一次算太多
    last = now;
    if (state.mode === 'running') update(dt);
    render(now / 1000);
    updateHud();
    requestAnimationFrame(frame);
  }

  reset();
  setOverlay('PRESS SPACE', 'or tap the screen');
  requestAnimationFrame(frame);
})();

(() => {
  'use strict';

  /* ============================================================
   * 遊戲參數（想調整手感或難度，改這裡就好）
   * 座標單位是「邏輯像素」：畫布只有約 300×150 個點，
   * 會依視窗大小自動放大填滿螢幕（見檔案下方的 layout()），
   * 所以每個點都是清楚的像素方塊。
   * ============================================================ */
  const CFG = {
    targetWidth: 300,       // 畫面寬度大約幾個邏輯像素（會依螢幕微調，決定放大倍率）
    minHeight: 100,         // 畫面高度至少幾個邏輯像素
    maxAspect: 0.65,        // 高度上限 = 寬度 × 此值（避免直向手機畫面變成細長條）
    groundBand: 20,         // 畫面底部地面的厚度

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

    // 運動飲料
    buffSeconds: 10,        // 效果持續秒數
    buffSpeedMul: 1.5,      // 效果期間尖刺逼近速度倍率
    buffScoreMul: 2,        // 效果期間得分倍率
    itemChance: 0.4,        // 每組尖刺生成時，出現飲料的機率
    itemCooldown: 15,       // 飲料出現／效果結束後，至少要隔幾秒才會再出現
  };

  const C = {
    sky1: '#1f1c47', sky2: '#262250', sky3: '#2f2a5c',
    star: '#cfd3ff', starDim: '#6c6ab0',
    moon: '#ffd166',
    cloud: '#34306a',
    ground: '#3b3f8c', groundTop: '#7b86f0', pebble: '#5560c4', shadow: '#2a2e6e',
    spike: '#ff595e', spikeShade: '#b8323c', spikeLight: '#ff9a9e',
    stick: '#f4f2ff', stickFar: '#9c98d4',
    wing: '#0a0a12', wingEdge: '#8f8bc4',
    gold: '#ffd166', goldLight: '#fff3b0', goldDeep: '#e09f1f',
  };

  // 畫布的邏輯尺寸與地面高度：會在 layout() 依視窗大小重新計算
  let W = 320, H = 150, GY = H - CFG.groundBand;

  /* ---------- DOM ---------- */
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const screenEl = document.getElementById('screen');
  const hiEl = document.getElementById('hi');
  const scoreEl = document.getElementById('score');
  const levelEl = document.getElementById('level');
  const buffStat = document.getElementById('buffStat');
  const buffEl = document.getElementById('buff');
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

  // 依字元對照表畫出一張像素圖（'.' 為透明）
  function drawSprite(rows, palette, x, y) {
    rows.forEach((row, ry) => {
      for (let rx = 0; rx < row.length; rx++) {
        const ch = row[rx];
        if (ch !== '.') px(x + rx, y + ry, palette[ch]);
      }
    });
  }

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

  // 靜態姿勢：站立、跳躍（上升／下降）、死亡
  const POSES = {
    stand: {
      arms: [[[6, 9], [4, 14]], [[6, 9], [8, 14]]],
      legs: [[[6, 15], [4, 23]], [[6, 15], [8, 23]]],
    },
    jumpUp: {
      arms: [[[6, 9], [3, 11], [2, 14]], [[6, 9], [9, 11], [10, 14]]],
      legs: [[[6, 15], [10, 17], [9, 21]], [[6, 15], [3, 19], [1, 22]]],
    },
    jumpDown: {
      arms: [[[6, 9], [2, 10], [0, 12]], [[6, 9], [10, 10], [12, 12]]],
      legs: [[[6, 15], [8, 19], [9, 23]], [[6, 15], [4, 19], [3, 23]]],
    },
    dead: {
      arms: [[[6, 9], [2, 12], [1, 16]], [[6, 9], [10, 12], [11, 16]]],
      legs: [[[6, 15], [4, 23]], [[6, 15], [8, 23]]],
    },
  };

  /* ---------- 跑步循環：8 格動作 ----------
   * 用關節角度算出大腿、小腿、上臂、前臂，一個週期切成 8 格。
   * 兩腿相差半個週期，手臂與同側腿反向擺動；
   * 前擺的腿會把膝蓋收起來，身體則隨落地腳的高度上下起伏。
   * 遠側的手腳用較暗的顏色（pose.far），做出前後層次，
   * 這樣左右腳互換時畫面才看得出差別，一個週期 8 格都不重複。 */
  const RUN_FRAMES = 8;
  function makeRunPose(phase) {
    const TAU = Math.PI * 2;
    const hip = [5, 15], shoulder = [6, 9];          // 髖部比肩膀略後，身體微微前傾
    const leg = p => {
      const a = 0.6 * Math.sin(TAU * p);                            // 大腿前後擺（弧度）
      const bend = 0.25 + 0.95 * Math.max(0, Math.cos(TAU * p));     // 前擺時膝蓋彎起
      const knee = [hip[0] + 4 * Math.sin(a), hip[1] + 4 * Math.cos(a)];
      const b = a - bend;
      return [hip, knee, [knee[0] + 4 * Math.sin(b), knee[1] + 4 * Math.cos(b)]];
    };
    const arm = p => {
      const a = 0.8 * Math.sin(TAU * p);
      const elbow = [shoulder[0] + 3 * Math.sin(a), shoulder[1] + 3 * Math.cos(a)];
      const f = a + 1.2;                                            // 手肘固定彎曲
      return [shoulder, elbow, [elbow[0] + 3 * Math.sin(f), elbow[1] + 3 * Math.cos(f)]];
    };
    const legs = [leg(phase), leg(phase + 0.5)];
    const arms = [arm(phase + 0.5), arm(phase)];
    const lowest = Math.max(legs[0][2][1], legs[1][2][1]);
    return { hipX: hip[0], far: true, dy: Math.max(0, Math.round(23 - lowest)), arms, legs };
  }
  const RUN_POSES = Array.from({ length: RUN_FRAMES }, (_, i) => makeRunPose(i / RUN_FRAMES));

  function drawStickman(x, top, pose, dead) {
    const c = C.stick;
    top += pose.dy || 0;
    HEAD.forEach((row, ry) => {
      for (let rx = 0; rx < row.length; rx++) if (row[rx] === 'X') px(x + 3 + rx, top + ry, c);
    });
    if (dead) {                                        // X 眼睛
      [[5, 2], [7, 2], [6, 3], [5, 4], [7, 4]].forEach(([ex, ey]) => px(x + ex, top + ey, c));
    } else {
      px(x + 7, top + 3, c);                           // 朝右看的眼睛
    }
    if (pose.far) {                                    // 遠側手腳先畫（較暗），近側蓋在上面
      polyline(pose.arms[1], x, top, C.stickFar);
      polyline(pose.legs[1], x, top, C.stickFar);
    }
    line(x + 6, top + 7, x + (pose.hipX || 6), top + 15, c);   // 身體
    if (pose.far) {
      polyline(pose.arms[0], x, top, c);
      polyline(pose.legs[0], x, top, c);
    } else {
      pose.arms.forEach(a => polyline(a, x, top, c));
      pose.legs.forEach(l => polyline(l, x, top, c));
    }
  }

  /* ============================================================
   * 跳躍特效：黑色翅膀
   * 每隻翅膀由「4 根羽毛尖」組成多邊形，填滿成黑色，
   * 再自動描一圈淺色邊，才不會融進夜空。
   * 4 格拍翅：上舉 → 中間 → 下拍 → 中間，起跳時從 0 倍展開。
   * ============================================================ */
  const WING_FRAMES = [      // 每根羽毛：[角度(度), 長度]，0 度＝水平向外
    [[78, 13], [60, 15], [44, 14], [28, 10]],
    [[52, 13], [35, 15], [19, 14], [4, 10]],
    [[18, 12], [2, 14], [-14, 13], [-30, 9]],
    [[52, 13], [35, 15], [19, 14], [4, 10]],
  ];

  function wingPolygon(frame, s) {
    const tips = frame.map(([a, r]) => [Math.cos(a * Math.PI / 180) * r * s, -Math.sin(a * Math.PI / 180) * r * s]);
    const poly = [[0, 0]];
    tips.forEach((t, i) => {
      poly.push(t);
      if (i < tips.length - 1) {                         // 羽毛之間的凹口
        const n = tips[i + 1];
        poly.push([(t[0] + n[0]) / 2 * 0.68, (t[1] + n[1]) / 2 * 0.68]);
      }
    });
    return poly;
  }

  function inPolygon(x, y, poly) {                       // 射線法（奇偶規則）
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  function drawWings(sx, sy, frameIdx, s) {
    const poly = wingPolygon(WING_FRAMES[frameIdx], s);
    const reach = Math.ceil(16 * s) + 1;
    const filled = new Set();
    const key = (x, y) => (y + 100) * 1000 + (x + 100);
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = 0; dx <= reach; dx++) {
        if (!inPolygon(dx, dy, poly)) continue;                  // 以肩膀像素中心為原點
        filled.add(key(sx + dx, sy + dy));
        filled.add(key(sx - dx, sy + dy));                       // 左右對稱
      }
    }
    const outline = new Set();
    filled.forEach(k => {
      [k - 1, k + 1, k - 1000, k + 1000].forEach(n => { if (!filled.has(n)) outline.add(n); });
    });
    const paint = (set, color) => set.forEach(k => {
      const y = Math.floor(k / 1000) - 100, x = (k % 1000) - 100;
      px(x, y, color);
    });
    paint(outline, C.wingEdge);
    paint(filled, C.wing);
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
   * 運動飲料（7×12）與金色防護罩
   * ============================================================ */
  const ITEM_W = 7, ITEM_H = 12;
  const itemTop = it => GY - it.lift - ITEM_H;      // 飲料離地 5px 浮著
  const DRINK = [
    '..CCC..',
    '..bhb..',
    '.bhbbbd',
    'bbwwwbd',
    'bwwYYbd',
    'bwYYwbd',
    'bwwYwbd',
    'bbwwwbd',
    'bhbbbbd',
    'bhbbbbd',
    '.bbbbdd',
    '.ddddd.',
  ];
  const DRINK_PAL = { C: '#ffd166', b: '#2ec4ff', h: '#b8f1ff', w: '#f4f2ff', Y: '#ffb703', d: '#1580b8' };

  function drawDrink(x, y, t) {
    drawSprite(DRINK, DRINK_PAL, Math.round(x), Math.round(y));
    // 四顆繞著飲料閃爍的金色小星星
    const k = reduceMotion ? 0 : Math.floor(t * 5);
    [[-3, 1], [ITEM_W + 2, 3], [-2, ITEM_H - 2], [ITEM_W + 1, ITEM_H - 1]].forEach(([dx, dy], i) => {
      if ((i + k) % 4 < 2) px(Math.round(x) + dx, Math.round(y) + dy, i % 2 ? C.goldLight : C.gold);
    });
  }

  function drawShield(cx, cy, t, remaining) {
    if (remaining < 2 && Math.floor(t * 10) % 2 === 0) return;      // 最後 2 秒閃爍提醒
    const r = 18 + (reduceMotion ? 0 : Math.floor(t * 4) % 2);       // 以像素為單位微微脈動
    const r2 = r * r, ri2 = (r - 1.3) * (r - 1.3);
    const fill = [], edge = [];
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const d2 = dx * dx + dy * dy;
        if (d2 > r2) continue;
        if (d2 > ri2) {
          const shade = dx + dy < -r * 0.5 ? C.goldLight : (dx + dy > r * 0.6 ? C.goldDeep : C.gold);
          edge.push([dx, dy, shade]);
        } else {
          fill.push([dx, dy]);
        }
      }
    }
    ctx.globalAlpha = 0.16;
    fill.forEach(([dx, dy]) => px(cx + dx, cy + dy, C.gold));
    ctx.globalAlpha = 1;
    edge.forEach(([dx, dy, c]) => px(cx + dx, cy + dy, c));

    // 沿著球面轉動的亮點，其中一顆做成十字星
    const spin = reduceMotion ? 0 : t * 3;
    for (let k = 0; k < 3; k++) {
      const a = spin + k * (Math.PI * 2 / 3);
      const sx = Math.round(cx + Math.cos(a) * r), sy = Math.round(cy + Math.sin(a) * r);
      px(sx, sy, '#ffffff');
      if (k === 0) { px(sx - 1, sy, C.goldLight); px(sx + 1, sy, C.goldLight); px(sx, sy - 1, C.goldLight); px(sx, sy + 1, C.goldLight); }
    }
  }

  /* ============================================================
   * 遊戲狀態
   * ============================================================ */
  const state = {
    mode: 'ready',      // ready | running | dead
    score: 0,
    tick: 0,            // 累積到 1 秒就加分
    level: 0,
    speed: CFG.baseSpeed,
    speedMul: 1,        // 飲料效果的加速倍率（會平滑過渡）
    scroll: 0,
    runPhase: 0,
    airTime: 0,
    wing: 0,            // 翅膀展開程度 0~1
    obstacles: [],
    spawnIn: 0,
    item: null,
    sinceItem: 0,
    buff: 0,            // 飲料效果剩餘秒數
    particles: [],
    diedAt: 0,
    newRecord: false,
    player: { feetY: GY, vy: 0, onGround: true },
  };

  // 背景裝飾（固定種子，每次載入長得一樣）
  let seed = 7;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  // 位置以「比例」儲存，畫面尺寸改變時才不用重算
  const stars = Array.from({ length: 44 }, () => ({ fx: rnd(), fy: rnd(), bright: rnd() < 0.3 }));
  const clouds = Array.from({ length: 5 }, (_, i) => ({ x: i * 80 + rnd() * 40, fy: rnd() }));
  const pebbles = Array.from({ length: 34 }, () => ({ fx: rnd(), fy: rnd(), w: 1 + Math.floor(rnd() * 3) }));

  function reset() {
    Object.assign(state, {
      mode: 'ready', score: 0, tick: 0, level: 0, speed: CFG.baseSpeed, speedMul: 1,
      scroll: 0, runPhase: 0, airTime: 0, wing: 0,
      obstacles: [], spawnIn: 220, item: null, sinceItem: CFG.itemCooldown - 8,
      buff: 0, particles: [], newRecord: false,
    });
    Object.assign(state.player, { feetY: GY, vy: 0, onGround: true });
  }

  /* ---------- 粒子（拾取與擊碎尖刺的火花） ---------- */
  function burst(x, y, colors, n, power) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = power * (0.4 + Math.random() * 0.6);
      state.particles.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40,
        life: 0.45 + Math.random() * 0.4, size: Math.random() < 0.3 ? 2 : 1,
        c: colors[i % colors.length],
      });
    }
  }

  /* ---------- 障礙與道具生成 ---------- */
  const effectiveSpeed = () => state.speed * state.speedMul;

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
    const airDist = effectiveSpeed() * (2 * CFG.jumpVelocity / CFG.gravity);
    const gap = airDist * (1.25 + Math.random());
    state.spawnIn = obs.w + gap;

    // 偶爾把運動飲料放在這組尖刺與下一組尖刺的空檔中間（不會壓在尖刺上）
    if (!state.item && state.buff <= 0 && state.sinceItem >= CFG.itemCooldown && Math.random() < CFG.itemChance) {
      const mid = obs.x + obs.w + gap * (0.4 + Math.random() * 0.2);
      state.item = { x: mid - ITEM_W / 2, lift: 5 };
      state.sinceItem = 0;
    }
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

  function showBanner(text) {
    banner.textContent = text;
    banner.classList.remove('show');
    void banner.offsetWidth;                 // 強制重排，讓動畫可以重播
    banner.classList.add('show');
  }

  function start() {
    reset();
    state.mode = 'running';
    overlay.hidden = true;
    banner.classList.remove('show');
    announce('');
  }

  function jump() {
    const p = state.player;
    if (!p.onGround) return;
    p.vy = -CFG.jumpVelocity;
    p.onGround = false;
    state.airTime = 0;
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
    showBanner('SPEED UP!');
    announce('速度提升，第 ' + (state.level + 1) + ' 級');
  }

  function collectDrink(item) {
    state.buff = CFG.buffSeconds;
    state.item = null;
    burst(item.x + ITEM_W / 2, itemTop(item) + ITEM_H / 2, [C.gold, C.goldLight, '#2ec4ff', '#ffffff'], 16, 90);
    showBanner('POWER UP!');
    announce('喝到運動飲料：' + CFG.buffSeconds + ' 秒無敵、得分兩倍，但尖刺加速');
  }

  /* ---------- 每幀更新 ---------- */
  function update(dt) {
    const p = state.player;

    // 飲料效果倒數；沒有效果也沒有道具在場時，才累積下一瓶的冷卻
    if (state.buff > 0) {
      state.buff -= dt;
      if (state.buff <= 0) { state.buff = 0; state.sinceItem = 0; announce('運動飲料效果結束'); }
    } else if (!state.item) {
      state.sinceItem += dt;
    }
    const buffed = state.buff > 0;

    // 計分：每過 1 秒固定 +10 分（喝了飲料就 ×2）
    state.tick += dt;
    while (state.tick >= 1) {
      state.tick -= 1;
      state.score += CFG.pointsPerSecond * (buffed ? CFG.buffScoreMul : 1);
    }
    // 每 500 分升一級並加速
    if (Math.floor(state.score / CFG.pointsPerLevel) > state.level) levelUp();

    // 尖刺逼近速度：飲料效果期間變快（平滑過渡，不會瞬間跳速）
    const targetMul = buffed ? CFG.buffSpeedMul : 1;
    state.speedMul += (targetMul - state.speedMul) * Math.min(1, dt * 4);
    const v = effectiveSpeed();
    const move = v * dt;

    // 玩家物理
    if (!p.onGround) {
      state.airTime += dt;
      p.vy += CFG.gravity * dt;
      p.feetY += p.vy * dt;
      if (p.feetY >= GY) { p.feetY = GY; p.vy = 0; p.onGround = true; }
    }
    state.wing += ((p.onGround ? 0 : 1) - state.wing) * Math.min(1, dt * 16);   // 起跳長翅膀、落地收起
    state.runPhase += dt * Math.min(6.5, 3 + (v - CFG.baseSpeed) * 0.0107);      // 跑得越快，步頻越高

    // 世界往左捲動（尖刺「逼近」）
    state.scroll += move;
    clouds.forEach(c => { c.x -= (6 + v * 0.04) * dt; if (c.x < -24) c.x = W + Math.random() * 60; });
    state.obstacles.forEach(o => { o.x -= move; });
    state.obstacles = state.obstacles.filter(o => o.x + o.w > -4);

    state.spawnIn -= move;
    if (state.spawnIn <= 0) spawnSpikes();

    // 粒子
    state.particles.forEach(q => {
      q.x += q.vx * dt - move; q.y += q.vy * dt; q.vy += 420 * dt; q.life -= dt;
    });
    state.particles = state.particles.filter(q => q.life > 0);

    const box = { l: CFG.playerX + 4, r: CFG.playerX + 9, t: p.feetY - CFG.playerH, b: p.feetY };

    // 飲料：移動、拾取
    if (state.item) {
      const it = state.item;
      it.x -= move;
      if (it.x + ITEM_W < -2) state.item = null;
      else if (it.x + ITEM_W > box.l - 2 && it.x < box.r + 2 && itemTop(it) + ITEM_H > box.t && itemTop(it) < box.b) collectDrink(it);
    }

    // 尖刺碰撞：平常會死；有金色防護罩時，尖刺會被擊碎
    const survivors = [];
    for (const o of state.obstacles) {
      let hit = false;
      for (let i = 0; i < o.count && !hit; i++) hit = hitsSpike(o.x + i * CFG.spikeW, o.h, box);
      if (!hit) { survivors.push(o); continue; }
      if (!buffed) { die(); return; }
      burst(o.x + o.w / 2, GY - o.h / 2, [C.spike, C.spikeLight, C.spikeShade, C.gold], 14, 110);
    }
    state.obstacles = survivors;
  }

  /* ---------- 繪製 ---------- */
  function render(t) {
    // 天空（三段色帶，像素風的階梯漸層）
    const band1 = Math.round(GY * 0.4), band2 = Math.round(GY * 0.75);
    rect(0, 0, W, band1, C.sky1);
    rect(0, band1, W, band2 - band1, C.sky2);
    rect(0, band2, W, GY - band2, C.sky3);

    // 星星
    const tw = reduceMotion ? 0 : Math.floor(t * 2);
    stars.forEach((s, i) => {
      if (s.bright && (i + tw) % 7 === 0) return;
      px(Math.floor(s.fx * W), 3 + Math.floor(s.fy * (GY - 34)), s.bright ? C.star : C.starDim);
    });

    // 月牙：先畫滿月，再用天空色挖掉一塊
    const mx = W - 52, my = 24;
    for (let dy = -8; dy <= 8; dy++) for (let dx = -8; dx <= 8; dx++) if (dx * dx + dy * dy <= 64) px(mx + dx, my + dy, C.moon);
    for (let dy = -8; dy <= 8; dy++) for (let dx = -8; dx <= 8; dx++) if (dx * dx + dy * dy <= 56) px(mx - 3 + dx, my - 2 + dy, C.sky1);

    // 雲
    clouds.forEach(c => {
      const x = Math.round(c.x), y = 10 + Math.floor(c.fy * GY * 0.42);
      rect(x + 4, y, 10, 2, C.cloud);
      rect(x, y + 2, 22, 3, C.cloud);
      rect(x + 2, y + 5, 18, 1, C.cloud);
    });

    // 地面
    rect(0, GY, W, H - GY, C.ground);
    rect(0, GY, W, 1, C.groundTop);
    pebbles.forEach(p => {
      const x = (((p.fx * W - state.scroll) % W) + W) % W;
      rect(x, GY + 3 + Math.floor(p.fy * (H - GY - 5)), p.w, 1, C.pebble);
    });

    // 尖刺
    state.obstacles.forEach(o => {
      for (let i = 0; i < o.count; i++) drawSpike(Math.round(o.x) + i * CFG.spikeW, o.h);
    });

    // 運動飲料（上下輕輕浮動）
    if (state.item) {
      const bob = reduceMotion ? 0 : Math.round(Math.sin(t * 5) * 1.5);
      drawDrink(state.item.x, itemTop(state.item) + bob, t);
    }

    // 火柴人腳下的影子（越高影子越窄）
    const p = state.player;
    const lift = GY - p.feetY;
    const sw = Math.max(3, 9 - Math.floor(lift / 6));
    rect(CFG.playerX + 6 - Math.floor(sw / 2), GY + 2, sw, 1, C.shadow);

    // 選姿勢
    let pose = POSES.stand, dead = false;
    if (state.mode === 'dead') { pose = POSES.dead; dead = true; }
    else if (!p.onGround) pose = p.vy < 0 ? POSES.jumpUp : POSES.jumpDown;
    else if (state.mode === 'running') pose = RUN_POSES[Math.floor((state.runPhase % 1) * RUN_FRAMES)];

    const top = Math.round(p.feetY) - CFG.playerH;
    // 翅膀畫在身體後面
    if (state.wing > 0.12) {
      const flap = Math.floor(state.airTime / 0.07) % WING_FRAMES.length;
      drawWings(CFG.playerX + 6, top + 9, flap, Math.min(1, state.wing));
    }
    drawStickman(CFG.playerX, top, pose, dead);

    // 金色防護罩
    if (state.buff > 0) {
      drawShield(CFG.playerX + 6, top + 13, t, state.buff);
    }

    // 粒子
    state.particles.forEach(q => rect(q.x, q.y, q.size, q.size, q.c));

    // 效果剩餘時間條（左上角）
    if (state.buff > 0) {
      const ratio = state.buff / CFG.buffSeconds;
      rect(5, 5, 46, 7, '#0b0a1a');
      rect(6, 6, 44, 5, '#4a3d12');
      rect(6, 6, Math.max(1, Math.round(44 * ratio)), 5, C.gold);
      rect(6, 6, Math.max(1, Math.round(44 * ratio)), 1, C.goldLight);
    }
  }

  /* ---------- HUD ---------- */
  const pad = (n, len) => String(n).padStart(len, '0');
  function updateHud() {
    const s = pad(state.score, 5), h = pad(Math.max(hi, state.score), 5), l = pad(state.level + 1, 2);
    if (scoreEl.textContent !== s) scoreEl.textContent = s;
    if (hiEl.textContent !== h) hiEl.textContent = h;
    if (levelEl.textContent !== l) levelEl.textContent = l;
    const active = state.buff > 0;
    if (buffStat.hidden === active) buffStat.hidden = !active;
    if (active) {
      const b = state.buff.toFixed(1);
      if (buffEl.textContent !== b) buffEl.textContent = b;
    }
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
  // 手機（觸控／手寫筆）：點整個網頁的任何地方都能跳；滑鼠則只有點遊戲框才算
  document.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && !screenEl.contains(e.target)) return;
    e.preventDefault();
    press();
  });

  /* ---------- 畫面縮放：讓遊戲框盡量放大，但一定完整看得見 ----------
   * 1. 先用「螢幕寬度」決定整數放大倍率（以裝置像素計，所以高解析手機也是銳利的方塊）。
   * 2. 再用該倍率算出畫布剛好填滿的寬度，並量出標題與說明文字佔掉的高度，
   *    把剩下的高度全部給畫布。
   * 3. 畫布的邏輯尺寸因此會隨螢幕改變；地面永遠貼在畫面底部，
   *    尖刺與跳躍的手感不變（單位都是邏輯像素）。 */
  const cabinet = document.querySelector('.cabinet');
  const hudEl = document.querySelector('.hud');
  const hintEl = document.querySelector('.hint');

  const outerHeight = el => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none') return 0;
    return el.offsetHeight + parseFloat(cs.marginTop) + parseFloat(cs.marginBottom);
  };

  function layout() {
    const dpr = window.devicePixelRatio || 1;
    const bs = getComputedStyle(document.body);
    const padX = parseFloat(bs.paddingLeft) + parseFloat(bs.paddingRight);
    const padY = parseFloat(bs.paddingTop) + parseFloat(bs.paddingBottom);
    const border = 8;                                        // 畫布外框（左右各 4px）
    const availWdev = Math.floor((window.innerWidth - padX - border) * dpr);

    let s = Math.max(1, Math.round(availWdev / CFG.targetWidth));
    let newW, newH;
    for (;; s--) {
      newW = Math.floor(availWdev / s);
      cabinet.style.width = (newW * s / dpr + border) + 'px';   // 先定寬度，說明文字才會排出正確的行數
      const extra = padY + outerHeight(hudEl) + outerHeight(hintEl) + border;
      const availHdev = (window.innerHeight - extra) * dpr;
      const h = Math.floor(availHdev / s);
      if (h >= CFG.minHeight || s === 1) {
        newH = Math.max(CFG.minHeight, Math.min(h, Math.floor(newW * CFG.maxAspect)));
        // 矮螢幕（例如手機橫放）放不下時 h 會小於下限，這時寧可略為縮小，也不要超出螢幕
        if (h < CFG.minHeight) newH = Math.max(60, h);
        break;
      }
    }

    if (canvas.width !== newW || canvas.height !== newH) {
      canvas.width = newW;                                   // 改尺寸會清空畫布並重設繪圖設定
      canvas.height = newH;
      ctx.imageSmoothingEnabled = false;
    }
    canvas.style.width = (newW * s / dpr) + 'px';
    canvas.style.height = (newH * s / dpr) + 'px';

    const newGY = newH - CFG.groundBand;
    state.player.feetY += newGY - GY;                        // 地面移動時，玩家跟著移動
    W = newW; H = newH; GY = newGY;
  }
  window.addEventListener('resize', layout);
  layout();

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

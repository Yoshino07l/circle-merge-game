(function () {
  'use strict';
  const config = window.MERGE_CONFIG;
  const engine = new window.CircleEngine(config);
  const byId = id => document.getElementById(id);
  const canvas = byId('game');
  const context = canvas.getContext('2d');
  const stage = byId('stage');
  const nextCanvas = byId('next');
  const nextContext = nextCanvas.getContext('2d');
  const overDialog = byId('overDialog');
  const resetDialog = byId('resetDialog');
  const BEST_KEY = 'circle-merge.best.v1';
  const MUTE_KEY = 'circle-merge.mute.v1';
  const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
  const read = key => { try { return localStorage.getItem(key); } catch { return null; } };
  const write = (key, value) => { try { localStorage.setItem(key, String(value)); } catch { /* 无存储权限时照常游玩 */ } };
  const storedBest = Number(read(BEST_KEY));
  let best = Number.isFinite(storedBest) && storedBest >= 0 ? storedBest : 0;
  let startingBest = best;
  let muted = read(MUTE_KEY) === '1';
  let aimX = config.width / 2;
  let highestTier = 0;
  let touchPointer = null;
  let scale = 1;
  let previousNext = -1;
  let previousReady;
  let previousScore = -1;
  let previousBest = -1;
  let particles = [];
  let floating = [];
  let soundContext;
  const images = config.levels.map(() => null);
  const imageLoads = config.levels.map((level, tier) => ({
    tier, path: level.image, state: level.image ? 'queued' : 'unused',
    attempts: 0, requests: 0, candidate: null, retryTimer: null, error: null
  }));
  const IMAGE_CONCURRENCY = 2;
  const IMAGE_ATTEMPTS = 4;
  const IMAGE_TIMEOUT = 30000;
  const IMAGE_RETRY_DELAYS = [1000, 3000, 6000];
  const imageSession = Date.now().toString(36) + Math.random().toString(36).slice(2);
  let activeImageLoads = 0;
  let hasImageIssue = false;
  const chainCanvases = [];
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const twoDigits = value => String(value + 1).padStart(2, '0');

  document.title = config.title;
  byId('gameTitle').textContent = config.title;
  byId('chain').previousElementSibling.querySelector('.chain-count').textContent = config.levels.length + ' 级';

  function initSound() {
    if (muted || soundContext) return;
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) return;
    try { soundContext = new Audio(); } catch { return; }
  }

  function tone(frequency, duration, volume = 0.06) {
    if (muted) return;
    initSound();
    if (!soundContext) return;
    if (soundContext.state === 'suspended') {
      soundContext.resume().then(() => tone(frequency, duration, volume)).catch(() => {});
      return;
    }
    const oscillator = soundContext.createOscillator();
    const gain = soundContext.createGain();
    const time = soundContext.currentTime;
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, time);
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(volume, time + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    oscillator.connect(gain);
    gain.connect(soundContext.destination);
    oscillator.start(time);
    oscillator.stop(time + duration + 0.02);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  }

  function paintSound() {
    byId('soundLabel').textContent = muted ? '音效关' : '音效开';
    byId('soundBtn').setAttribute('aria-pressed', String(!muted));
    byId('soundBtn').setAttribute('aria-label', muted ? '开启音效' : '关闭音效');
    byId('soundBtn').setAttribute('title', muted ? '开启音效' : '关闭音效');
  }

  function drawDisc(ctx, x, y, radius, tier, opacity = 1) {
    const level = config.levels[tier];
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.translate(x, y);
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fillStyle = level.color;
    ctx.fill();
    const image = images[tier];
    let paintedImage = false;
    if (image) {
      ctx.save();
      ctx.clip();
      const crop = level.crop || {};
      const value = (key, fallback) => Number.isFinite(crop[key]) ? crop[key] : fallback;
      const square = Math.min(image.naturalWidth, image.naturalHeight) * clamp(value('scale', 1), 0.1, 1);
      const sourceX = clamp(value('x', 0.5) * image.naturalWidth - square / 2, 0, image.naturalWidth - square);
      const sourceY = clamp(value('y', 0.5) * image.naturalHeight - square / 2, 0, image.naturalHeight - square);
      try {
        ctx.drawImage(image, sourceX, sourceY,
          square, square, -radius, -radius, radius * 2, radius * 2);
        paintedImage = true;
      } catch {
        // 单张图片绘制失败时退回编号，不能中断整个棋盘的动画。
        images[tier] = null;
        scheduleImageRetry(imageLoads[tier], 'draw');
      } finally { ctx.restore(); }
    }
    if (!paintedImage) {
      ctx.fillStyle = '#3d443c';
      ctx.font = 'bold ' + Math.max(10, Math.min(58, radius * 0.72)) + 'px Georgia, serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(twoDigits(tier), 0, radius * 0.02);
    }
    ctx.beginPath();
    ctx.arc(0, 0, Math.max(0, radius - 0.65), 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(61,68,60,.3)';
    ctx.lineWidth = 1.3;
    ctx.stroke();
    ctx.restore();
  }

  function paintNext() {
    nextContext.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
    drawDisc(nextContext, 80, 80, 56, engine.next);
    byId('nextName').textContent = config.levels[engine.next].name;
    nextCanvas.setAttribute('aria-label', '下一颗：' + config.levels[engine.next].name);
    previousNext = engine.next;
  }

  function paintChain() {
    for (let tier = 0; tier < chainCanvases.length; tier++) {
      const item = chainCanvases[tier];
      const ctx = item.canvas.getContext('2d');
      ctx.clearRect(0, 0, 80, 80);
      drawDisc(ctx, 40, 40, 36, tier, tier <= highestTier ? 1 : 0.48);
      item.wrapper.classList.toggle('reached', tier <= highestTier);
    }
    byId('highestLevel').textContent = '最高等级 ' + twoDigits(highestTier);
  }

  for (let tier = 0; tier < config.levels.length; tier++) {
    const wrapper = document.createElement('div');
    wrapper.className = 'chain-item';
    wrapper.title = config.levels[tier].name;
    const preview = document.createElement('canvas');
    preview.width = 80;
    preview.height = 80;
    preview.setAttribute('aria-label', '第 ' + (tier + 1) + ' 级');
    const label = document.createElement('span');
    label.textContent = twoDigits(tier);
    wrapper.append(preview, label);
    byId('chain').append(wrapper);
    chainCanvases.push({ wrapper, canvas: preview });
  }

  function resize() {
    const rectangle = canvas.getBoundingClientRect();
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(rectangle.width * ratio));
    canvas.height = Math.max(1, Math.round(rectangle.height * ratio));
    scale = canvas.width / config.width;
    render(0);
  }

  function setAim(x) {
    const [low, high] = engine.aimLimits();
    aimX = clamp(x, low, high);
  }

  function aimFromPointer(event) {
    const bounds = canvas.getBoundingClientRect();
    setAim((event.clientX - bounds.left) * config.width / bounds.width);
  }

  function updateLabels() {
    document.querySelector('.board-caption').hidden = engine.balls.length > 0;
    if (engine.score > best) { best = engine.score; write(BEST_KEY, best); }
    if (previousScore !== engine.score) {
      byId('score').textContent = engine.score;
      if (engine.score > previousScore && previousScore >= 0) {
        byId('score').classList.remove('score-pop');
        void byId('score').offsetWidth;
        byId('score').classList.add('score-pop');
      }
      previousScore = engine.score;
    }
    if (previousBest !== best) { byId('best').textContent = best; previousBest = best; }
    if (previousNext !== engine.next) paintNext();
    const ready = !engine.over && engine.cooldown <= 1e-8 && !resetDialog.open;
    if (previousReady !== ready) {
      byId('readyStatus').textContent = engine.over ? '本局结束' : resetDialog.open ? '已暂停' : ready ? '可以投放' : '准备下一颗…';
      previousReady = ready;
    }
    canvas.setAttribute('aria-label', '合成棋盘，当前 ' + engine.score + ' 分。待投放：' + config.levels[engine.pending].name + '。左右方向键瞄准，空格投放。');
  }

  function effects(event) {
    floating.push({ x: event.x, y: event.y, text: '+' + event.points, life: 0.9 });
    if (!reducedMotion) {
      const count = event.max ? 26 : 12;
      for (let index = 0; index < count; index++) {
        const angle = index * Math.PI * 2 / count;
        const speed = 45 + Math.random() * 65;
        particles.push({ x: event.x, y: event.y, vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed, life: 0.5 + Math.random() * 0.3, color: config.levels[event.tier].color });
      }
      if (particles.length > 160) particles = particles.slice(-160);
    }
  }

  function processEvents() {
    for (const event of engine.drainEvents()) {
      if (event.type === 'drop') tone(280, 0.06, 0.035);
      if (event.type === 'merge') {
        if (event.tier > highestTier) { highestTier = event.tier; paintChain(); }
        effects(event);
        tone(350 * Math.pow(1.1, event.tier), event.max ? 0.28 : 0.12);
      }
      if (event.type === 'over') {
        updateLabels();
        tone(170, 0.26, 0.05);
        byId('finalScore').textContent = engine.score;
        byId('finalBest').textContent = best;
        byId('newRecord').hidden = best <= startingBest;
        overDialog.showModal();
        overDialog.setAttribute('tabindex', '-1');
        overDialog.focus();
      }
    }
  }

  function drop() {
    if (resetDialog.open || overDialog.open) return false;
    initSound();
    const dropped = engine.drop(aimX);
    if (dropped) {
      highestTier = Math.max(highestTier, engine.balls.at(-1).tier);
      paintChain();
      setAim(aimX);
      processEvents();
      updateLabels();
      render(0);
    }
    return dropped;
  }

  function reset() {
    if (overDialog.open) overDialog.close();
    if (resetDialog.open) resetDialog.close();
    engine.reset();
    startingBest = best;
    aimX = config.width / 2;
    highestTier = 0;
    touchPointer = null;
    particles = [];
    floating = [];
    previousNext = -1;
    previousReady = undefined;
    previousScore = -1;
    accumulator = 0;
    previousTime = performance.now();
    paintChain();
    updateLabels();
    render(0);
  }

  function requestReset() {
    if (engine.over || (!engine.balls.length && !engine.score)) reset();
    else if (!resetDialog.open) { resetDialog.showModal(); updateLabels(); }
  }

  function render(dt) {
    context.setTransform(scale, 0, 0, scale, 0, 0);
    context.clearRect(0, 0, config.width, config.height);
    context.fillStyle = '#fffcf2';
    context.fillRect(0, 0, config.width, config.height);
    context.fillStyle = '#ebe8d9';
    context.fillRect(0, 0, config.wall, config.height);
    context.fillRect(config.width - config.wall, 0, config.wall, config.height);
    context.fillRect(0, config.height - config.wall, config.width, config.wall);
    context.save();
    context.setLineDash([6, 7]);
    context.lineWidth = 1.5;
    context.strokeStyle = engine.danger ? '#d97765' : '#b8b3a1';
    context.beginPath();
    context.moveTo(config.wall, config.dangerY);
    context.lineTo(config.width - config.wall, config.dangerY);
    context.stroke();
    context.restore();
    // 每次绘制都使用固定物理半径；不做挤压或放大弹出动画。
    for (const ball of engine.balls) drawDisc(context, ball.x, ball.y, ball.r, ball.tier);
    if (!engine.over) {
      setAim(aimX);
      const radius = config.levels[engine.pending].radius;
      let landingY = config.height - config.wall - radius;
      for (const ball of engine.balls) {
        const offset = Math.abs(ball.x - aimX);
        if (offset < radius + ball.r) {
          const contactY = ball.y - Math.sqrt((radius + ball.r) ** 2 - offset ** 2);
          landingY = Math.min(landingY, contactY);
        }
      }
      context.save();
      context.setLineDash([3, 6]);
      context.strokeStyle = 'rgba(61,68,60,.16)';
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(aimX, config.dropY + radius + 6);
      context.lineTo(aimX, Math.max(config.dropY + radius + 6, landingY));
      context.stroke();
      context.restore();
      drawDisc(context, aimX, config.dropY, radius, engine.pending, engine.cooldown > 0 ? 0.3 : 0.86);
      context.save();
      context.fillStyle = '#3d443c';
      context.globalAlpha = 0.45;
      context.beginPath();
      context.moveTo(aimX - 4, 17);
      context.lineTo(aimX + 4, 17);
      context.lineTo(aimX, 22);
      context.closePath();
      context.fill();
      context.restore();
    }
    for (const particle of particles) {
      particle.life -= dt;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      context.save();
      context.globalAlpha = Math.max(0, Math.min(1, particle.life * 2));
      context.fillStyle = particle.color;
      context.beginPath();
      context.arc(particle.x, particle.y, 2.5, 0, Math.PI * 2);
      context.fill();
      context.restore();
    }
    particles = particles.filter(particle => particle.life > 0);
    for (const text of floating) {
      text.life -= dt;
      text.y -= dt * 40;
      context.save();
      context.globalAlpha = Math.max(0, Math.min(1, text.life * 2));
      context.fillStyle = '#59654a';
      context.font = 'bold 21px Georgia, serif';
      context.textAlign = 'center';
      context.strokeStyle = '#fffcf2';
      context.lineWidth = 4;
      context.strokeText(text.text, text.x, text.y);
      context.fillText(text.text, text.x, text.y);
      context.restore();
    }
    floating = floating.filter(text => text.life > 0);
  }

  stage.addEventListener('pointerdown', event => {
    if (event.button && event.pointerType === 'mouse') return;
    if (engine.over || resetDialog.open) return;
    event.preventDefault();
    initSound();
    aimFromPointer(event);
    canvas.focus({ preventScroll: true });
    if (event.pointerType === 'touch' || event.pointerType === 'pen') {
      if (touchPointer !== null) return;
      touchPointer = event.pointerId;
      stage.setPointerCapture(event.pointerId);
    } else drop();
  });
  stage.addEventListener('pointermove', event => {
    if (engine.over || resetDialog.open) return;
    if (event.pointerType !== 'mouse' && touchPointer !== event.pointerId) return;
    aimFromPointer(event);
  });
  stage.addEventListener('pointerup', event => {
    if (event.pointerId !== touchPointer) return;
    touchPointer = null;
    aimFromPointer(event);
    drop();
  });
  stage.addEventListener('pointercancel', event => { if (event.pointerId === touchPointer) touchPointer = null; });
  stage.addEventListener('lostpointercapture', event => { if (event.pointerId === touchPointer) touchPointer = null; });
  stage.addEventListener('contextmenu', event => event.preventDefault());

  window.addEventListener('keydown', event => {
    if (event.target.matches('input, textarea, select, [contenteditable="true"]')) return;
    if (resetDialog.open || overDialog.open) {
      if (overDialog.open && event.code === 'KeyR') { event.preventDefault(); reset(); }
      if (event.target === overDialog && ['Space', 'Enter'].includes(event.code)) event.preventDefault();
      return;
    }
    if (['ArrowLeft', 'KeyA', 'ArrowRight', 'KeyD'].includes(event.code)) {
      event.preventDefault();
      setAim(aimX + (['ArrowLeft', 'KeyA'].includes(event.code) ? -14 : 14));
    }
    if (['Space', 'Enter', 'ArrowDown'].includes(event.code)) {
      if (event.target.matches('button')) return;
      event.preventDefault();
      drop();
    }
    if (event.code === 'KeyR') { event.preventDefault(); requestReset(); }
  });
  byId('soundBtn').addEventListener('click', () => { muted = !muted; write(MUTE_KEY, muted ? 1 : 0); paintSound(); if (!muted) tone(440, 0.09); });
  byId('resetBtn').setAttribute('aria-label', '重新开始');
  byId('resetBtn').setAttribute('title', '重新开始');
  byId('resetBtn').addEventListener('click', requestReset);
  byId('restartBtn').addEventListener('click', reset);
  byId('cancelReset').addEventListener('click', () => resetDialog.close());
  byId('confirmReset').addEventListener('click', reset);
  resetDialog.addEventListener('close', () => { previousReady = undefined; updateLabels(); });
  overDialog.addEventListener('cancel', event => event.preventDefault());

  function imageLoadState() {
    const required = imageLoads.filter(item => item.state !== 'unused');
    return {
      total: required.length,
      loaded: required.filter(item => item.state === 'loaded').length,
      failed: required.filter(item => item.state === 'failed').length,
      pending: required.filter(item => ['queued', 'loading', 'retrying'].includes(item.state)).length,
      levels: imageLoads.map(item => ({ level: item.tier + 1, state: item.state, attempts: item.attempts, error: item.error }))
    };
  }

  function paintImageStatus() {
    const status = imageLoadState();
    const retry = byId('retryImages');
    const visible = hasImageIssue && status.loaded < status.total;
    // 正常加载完成后恢复原来的操作提示，不挤占棋盘空间。
    byId('playHint').hidden = visible;
    retry.hidden = !visible;
    retry.disabled = status.failed === 0;
    retry.textContent = status.failed ? '头像未全加载 · 重试' : '头像加载中 ' + status.loaded + '/' + status.total;
    retry.title = '已加载 ' + status.loaded + '/' + status.total + ' 张头像；仅重试加载失败的图片';
  }

  function scheduleImageRetry(item, reason) {
    item.error = reason;
    hasImageIssue = true;
    if (item.attempts >= IMAGE_ATTEMPTS) {
      item.state = 'failed';
    } else {
      item.state = 'retrying';
      item.retryTimer = window.setTimeout(() => {
        item.retryTimer = null;
        if (item.state !== 'retrying') return;
        item.state = 'queued';
        pumpImages();
      }, IMAGE_RETRY_DELAYS[item.attempts - 1]);
    }
    paintImageStatus();
  }

  function loadImage(item) {
    item.state = 'loading';
    item.attempts++;
    item.requests++;
    activeImageLoads++;
    const image = new Image();
    item.candidate = image;
    let timeout;
    const settle = reason => {
      // 超时的旧请求即使晚到，也不能覆盖后来成功加载的图片。
      if (item.state !== 'loading' || item.candidate !== image) return;
      window.clearTimeout(timeout);
      image.onload = null;
      image.onerror = null;
      item.candidate = null;
      activeImageLoads--;
      if (reason) {
        image.removeAttribute('src');
        scheduleImageRetry(item, reason);
      } else {
        images[item.tier] = image;
        item.state = 'loaded';
        item.error = null;
        paintImageStatus();
        paintNext();
        paintChain();
        render(0);
      }
      pumpImages();
    };
    // onload 和有效尺寸足以交给 Canvas 绘制，不依赖部分内置浏览器不稳定的 decode()。
    image.onload = () => settle(image.naturalWidth > 0 && image.naturalHeight > 0 ? null : 'empty');
    image.onerror = () => settle('network');
    timeout = window.setTimeout(() => settle('timeout'), IMAGE_TIMEOUT);
    const revision = config.assetRevision;
    let source = item.path + (revision ? (item.path.includes('?') ? '&' : '?') + 'v=' + encodeURIComponent(revision) : '');
    // 首次沿用原地址和已成功的缓存；失败重试使用新地址，绕过错误响应的缓存。
    if (item.requests > 1) source += (source.includes('?') ? '&' : '?') + '_retry=' + imageSession + '-' + item.requests;
    try { image.src = source; } catch { settle('source'); }
  }

  function pumpImages() {
    // 分批加载，避免手机同时请求、解析 11 张大图。
    while (activeImageLoads < IMAGE_CONCURRENCY) {
      const item = imageLoads.find(record => record.state === 'queued');
      if (!item) break;
      loadImage(item);
    }
  }

  function retryFailedImages() {
    imageLoads.forEach(item => {
      if (item.state !== 'failed') return;
      item.attempts = 0;
      item.error = null;
      item.state = 'queued';
    });
    paintImageStatus();
    pumpImages();
  }

  byId('retryImages').addEventListener('click', retryFailedImages);
  window.addEventListener('online', retryFailedImages);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) retryFailedImages(); });

  const publicState = () => ({ ...engine.snapshot(), best, aimX, highestLevel: highestTier + 1, muted, imageLoading: imageLoadState() });
  // 普通游戏状态读取；测试参数仅在本地验证链接中显式启用。
  window.CircleGame = Object.freeze({ getState: publicState });
  if (new URLSearchParams(location.search).has('test')) window.CircleGameTest = { engine, processEvents, updateLabels, reset };

  const modelContext = document.modelContext;
  if (modelContext && typeof modelContext.registerTool === 'function') {
    const lifecycle = new AbortController();
    const register = tool => {
      try { Promise.resolve(modelContext.registerTool(tool, { signal: lifecycle.signal })).catch(() => {}); }
      catch { /* 可选浏览器功能不可用时不影响游戏 */ }
    };
    register({ name: 'get_merge_game_state', title: '查看合成游戏状态', description: '读取分数、棋盘圆球、下一颗和可否投放。',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: false }, execute: () => publicState() });
    register({ name: 'drop_merge_ball', title: '投放一颗圆球', description: '在棋盘横坐标 x 处投放当前圆球。游戏结束、暂停或冷却期间不可投放。',
      inputSchema: { type: 'object', properties: { x: { type: 'number', minimum: 0, maximum: config.width } }, required: ['x'], additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute: input => {
        if (!input || typeof input.x !== 'number' || !Number.isFinite(input.x) || input.x < 0 || input.x > config.width || Object.keys(input).some(key => key !== 'x')) throw new Error('x 必须是棋盘范围内的数字');
        if (engine.over || engine.cooldown > 1e-8 || resetDialog.open || overDialog.open) throw new Error('当前不能投放，请等待冷却结束或开始新一局');
        setAim(input.x);
        drop();
        return publicState();
      }
    });
    window.addEventListener('pagehide', () => lifecycle.abort(), { once: true });
  }

  const FIXED_STEP = 1 / 120;
  let accumulator = 0;
  let previousTime = performance.now();
  function frame(time) {
    const delta = Math.min(0.1, Math.max(0, (time - previousTime) / 1000));
    previousTime = time;
    if (!document.hidden && !resetDialog.open) {
      accumulator += delta;
      let steps = 0;
      while (accumulator >= FIXED_STEP && steps < 12) {
        engine.step(FIXED_STEP);
        accumulator -= FIXED_STEP;
        steps++;
      }
    } else accumulator = 0;
    processEvents();
    updateLabels();
    render(delta);
    requestAnimationFrame(frame);
  }
  document.addEventListener('visibilitychange', () => { previousTime = performance.now(); accumulator = 0; });
  paintSound();
  paintChain();
  updateLabels();
  resize();
  if (window.ResizeObserver) new ResizeObserver(resize).observe(stage);
  else window.addEventListener('resize', resize);
  requestAnimationFrame(frame);
  pumpImages();
})();

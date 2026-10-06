/* 独立圆形碰撞引擎。速度约束与位置修正分开，避免穿透修正制造反弹。 */
(function (root) {
  'use strict';
  const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

  class CircleEngine {
    constructor(config, random = Math.random) {
      this.config = config;
      this.random = random;
      this.reset();
    }

    reset() {
      this.balls = [];
      this.events = [];
      this.score = 0;
      this.over = false;
      this.cooldown = 0;
      this.danger = false;
      this.elapsed = 0;
      this.counter = 0;
      this.pending = this.pickLevel();
      this.next = this.pickLevel(this.pending);
    }

    pickLevel(avoid) {
      const weights = this.config.spawnWeights;
      const total = weights.reduce((sum, value) => sum + value, 0);
      for (let attempt = 0; attempt < 8; attempt++) {
        let sample = this.random() * total;
        let selected = weights.length - 1;
        for (let index = 0; index < weights.length; index++) {
          sample -= weights[index];
          if (sample < 0) { selected = index; break; }
        }
        if (selected !== avoid || attempt === 7) return selected;
      }
      return 0;
    }

    addBall(tier, x, y, velocity = {}) {
      const level = this.config.levels[tier];
      if (!level) throw new RangeError('无效的圆球等级');
      const ball = {
        id: ++this.counter, tier, x, y,
        r: level.radius, inverseMass: 1 / (level.radius * level.radius),
        vx: velocity.vx || 0, vy: velocity.vy || 0,
        landed: false, contact: false, age: 0, dangerTime: 0, dead: false
      };
      this.keepInside(ball);
      this.balls.push(ball);
      return ball;
    }

    aimLimits(tier = this.pending) {
      const radius = this.config.levels[tier].radius;
      return [this.config.wall + radius, this.config.width - this.config.wall - radius];
    }

    drop(x) {
      if (this.over || this.cooldown > 1e-8) return false;
      const [low, high] = this.aimLimits();
      const ball = this.addBall(this.pending, clamp(x, low, high), this.config.dropY);
      this.events.push({ type: 'drop', tier: ball.tier });
      this.pending = this.next;
      this.next = this.pickLevel(this.pending);
      this.cooldown = this.config.dropInterval;
      return true;
    }

    keepInside(ball) {
      const c = this.config;
      ball.x = clamp(ball.x, c.wall + ball.r, c.width - c.wall - ball.r);
      ball.y = clamp(ball.y, ball.r, c.height - c.wall - ball.r);
    }

    solveWalls(ball) {
      const c = this.config;
      const left = c.wall + ball.r;
      const right = c.width - c.wall - ball.r;
      const floor = c.height - c.wall - ball.r;
      const threshold = c.bounceThreshold || 0;
      const reflected = speed => speed > threshold ? -speed * c.wallRestitution : 0;
      if (ball.x <= left) {
        ball.x = left;
        if (ball.vx < 0) ball.vx = -reflected(-ball.vx);
      }
      if (ball.x >= right) {
        ball.x = right;
        if (ball.vx > 0) ball.vx = reflected(ball.vx);
      }
      if (ball.y >= floor) {
        ball.y = floor;
        if (ball.vy > 0) ball.vy = reflected(ball.vy);
        ball.landed = true;
        ball.contact = true;
      }
      if (ball.y < ball.r) {
        ball.y = ball.r;
        if (ball.vy < 0) ball.vy = -reflected(-ball.vy);
      }
    }

    merge(a, b) {
      a.dead = true;
      b.dead = true;
      const massA = 1 / a.inverseMass;
      const massB = 1 / b.inverseMass;
      const total = massA + massB;
      const x = (a.x * massA + b.x * massB) / total;
      const y = (a.y * massA + b.y * massB) / total;
      const last = this.config.levels.length - 1;
      let points;
      if (a.tier === last) {
        points = this.config.maxBonus;
      } else {
        const newBall = this.addBall(a.tier + 1, x, y, {
          vx: (a.vx * massA + b.vx * massB) / total,
          vy: (a.vy * massA + b.vy * massB) / total
        });
        newBall.landed = a.landed || b.landed;
        // 合成球没有向上冲量，也没有弹出动画改变它的物理半径。
        points = this.config.mergeScores[a.tier + 1];
      }
      this.score += points;
      this.events.push({ type: 'merge', tier: Math.min(last, a.tier + 1), x, y, points, max: a.tier === last });
    }

    solvePair(a, b, allowMerge) {
      if (a.dead || b.dead) return;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const radius = a.r + b.r;
      const distanceSquared = dx * dx + dy * dy;
      if (distanceSquared > (radius + 0.25) ** 2) return;
      if (allowMerge && a.tier === b.tier) { this.merge(a, b); return; }
      if (distanceSquared > radius * radius) return;
      const distance = Math.sqrt(distanceSquared);
      // 完全重叠时使用固定方向，避免除零、NaN 或随机抖动。
      const nx = distance > 1e-8 ? dx / distance : 1;
      const ny = distance > 1e-8 ? dy / distance : 0;
      const massSum = a.inverseMass + b.inverseMass;
      const penetration = Math.max(0, radius - distance);
      const correction = Math.max(0, penetration - 0.015) * 0.86 / massSum;
      a.x -= nx * correction * a.inverseMass;
      a.y -= ny * correction * a.inverseMass;
      b.x += nx * correction * b.inverseMass;
      b.y += ny * correction * b.inverseMass;
      a.contact = true;
      b.contact = true;
      if (a.landed || b.landed) { a.landed = true; b.landed = true; }

      const relativeX = b.vx - a.vx;
      const relativeY = b.vy - a.vy;
      const normalSpeed = relativeX * nx + relativeY * ny;
      if (normalSpeed < 0) {
        const restitution = -normalSpeed > (this.config.bounceThreshold || 0) ? this.config.restitution : 0;
        const impulse = -(1 + restitution) * normalSpeed / massSum;
        a.vx -= impulse * nx * a.inverseMass;
        a.vy -= impulse * ny * a.inverseMass;
        b.vx += impulse * nx * b.inverseMass;
        b.vy += impulse * ny * b.inverseMass;
        const tangentSpeed = relativeX * -ny + relativeY * nx;
        const tangentImpulse = clamp(-tangentSpeed / massSum,
          -impulse * this.config.friction, impulse * this.config.friction);
        a.vx -= tangentImpulse * -ny * a.inverseMass;
        a.vy -= tangentImpulse * nx * a.inverseMass;
        b.vx += tangentImpulse * -ny * b.inverseMass;
        b.vy += tangentImpulse * nx * b.inverseMass;
      }
    }

    step(dt) {
      if (this.over) return;
      this.elapsed += dt;
      this.cooldown = Math.max(0, this.cooldown - dt);
      for (const ball of this.balls) {
        ball.age += dt;
        ball.contact = false;
        ball.vy += this.config.gravity * dt;
        ball.vx *= Math.exp(-0.15 * dt);
        ball.x += ball.vx * dt;
        ball.y += ball.vy * dt;
      }
      // 多次约束传播让大小球堆叠稳定；每个子步仅首轮允许合成。
      for (let iteration = 0; iteration < 18; iteration++) {
        for (const ball of this.balls) if (!ball.dead) this.solveWalls(ball);
        const count = this.balls.length;
        for (let i = 0; i < count; i++) {
          for (let j = i + 1; j < count; j++) {
            this.solvePair(this.balls[i], this.balls[j], iteration === 0);
          }
        }
      }
      this.balls = this.balls.filter(ball => !ball.dead);
      this.danger = false;
      for (const ball of this.balls) {
        this.solveWalls(ball);
        // 求解器一帧多轮，只在这里按时间施加一次地面阻力。
        if (ball.y >= this.config.height - this.config.wall - ball.r - 0.05) {
          ball.vx *= Math.exp(-(this.config.groundDrag ?? 4) * dt);
          if (Math.abs(ball.vx) < 0.4) ball.vx = 0;
        }
        if (ball.contact && Math.hypot(ball.vx, ball.vy) < 1) { ball.vx = 0; ball.vy = 0; }
        const aboveLine = ball.y - ball.r < this.config.dangerY;
        const resting = Math.hypot(ball.vx, ball.vy) < this.config.restSpeed;
        if (ball.landed && aboveLine) this.danger = true;
        if (ball.landed && aboveLine && resting) ball.dangerTime += dt;
        else ball.dangerTime = Math.max(0, ball.dangerTime - 2 * dt);
        if (ball.dangerTime >= this.config.dangerTime) {
          this.over = true;
          this.events.push({ type: 'over', score: this.score });
          break;
        }
      }
    }

    drainEvents() {
      const events = this.events;
      this.events = [];
      return events;
    }

    snapshot() {
      return {
        score: this.score, over: this.over, danger: this.danger,
        pending: this.pending, next: this.next, ready: this.cooldown <= 1e-8,
        balls: this.balls.map(({ id, tier, x, y, r, vx, vy }) => ({ id, tier, x, y, r, vx, vy }))
      };
    }
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = CircleEngine;
  else root.CircleEngine = CircleEngine;
})(typeof window === 'undefined' ? globalThis : window);

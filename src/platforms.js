import { clamp } from './collision.js';

const BREAK_WARNING = 1.05;
const BREAK_DURATION = 1.48;
const COLLISION_RELEASE = 1.10;

export class ArenaPlatformManager {
  constructor(floor) {
    this.floor = { ...floor };
    const centerWidth = 54; const sideWidth = (floor.w - centerWidth) / 2;
    this.platforms = [
      this.make('boss_floor_left', floor.x, sideWidth, false),
      this.make('boss_floor_center', floor.x + sideWidth, centerWidth, true),
      this.make('boss_floor_right', floor.x + sideWidth + centerWidth, sideWidth, false),
    ];
  }
  make(id, x, w, destroyable) { return { id, x, y: this.floor.y, w, h: this.floor.h, destroyable, state: 'intact', elapsed: 0, collisionActive: true, visualActive: true, debrisActive: false, dropY: 0, alpha: 1 }; }
  reset() { this.platforms.forEach((platform) => Object.assign(platform, { state: 'intact', elapsed: 0, collisionActive: true, visualActive: true, debrisActive: false, dropY: 0, alpha: 1 })); }
  beginCollapse() {
    const center = this.center(); if (center.state !== 'intact') return false;
    center.state = 'breaking'; center.elapsed = 0; center.collisionActive = true; center.visualActive = true; center.debrisActive = false; return true;
  }
  update(dt) {
    const center = this.center(); if (center.state !== 'breaking' && !center.debrisActive) return null;
    center.elapsed += dt;
    const fall = clamp((center.elapsed - BREAK_WARNING) / (BREAK_DURATION - BREAK_WARNING), 0, 1);
    center.dropY = fall * fall * 52; center.alpha = 1 - fall * .92;
    if (center.elapsed >= COLLISION_RELEASE && center.state === 'breaking') { center.state = 'destroyed'; center.visualActive = false; center.collisionActive = false; center.debrisActive = true; }
    if (center.elapsed >= BREAK_DURATION) { center.debrisActive = false; center.alpha = 0; return 'destroyed'; }
    return null;
  }
  center() { return this.platforms.find((platform) => platform.destroyable); }
  colliders() { return this.platforms.filter((platform) => platform.collisionActive).map(({ id, x, y, w, h }) => ({ id, shape: 'rect', x, y, w, h })); }
  syncIssues() { return this.platforms.filter((platform) => platform.visualActive !== platform.collisionActive); }
  debugSummary() { return this.platforms.map((platform) => `${platform.id}:${platform.state} collision=${platform.collisionActive} visual=${platform.visualActive}${platform.debrisActive ? ' debris=true' : ''}`).join(' | '); }
  warningProgress() { const center = this.center(); return center.state === 'breaking' ? clamp(center.elapsed / BREAK_WARNING, 0, 1) : 0; }
}

export const ARENA_BREAK_TIMING = Object.freeze({ warning: BREAK_WARNING, collisionRelease: COLLISION_RELEASE, duration: BREAK_DURATION });

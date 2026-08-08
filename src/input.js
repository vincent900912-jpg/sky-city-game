import { DEFAULT_CONTROLS } from './controls.js';

export class Input {
  constructor(bindings = DEFAULT_CONTROLS, onChange = () => {}, root = document) {
    this.down = new Set(); this.pressed = new Set(); this.released = new Set(); this.pointers = new Map(); this.tapAxis = 0; this.tapAxisUntil = 0;
    this.bindings = { ...DEFAULT_CONTROLS, ...bindings }; this.onChange = onChange; this.capture = null;
    this.fixed = new Map([['ArrowLeft', 'left'], ['ArrowRight', 'right'], ['Backquote', 'debug']]);
    root.addEventListener('keydown', (event) => {
      if (this.capture) { event.preventDefault(); this.finishCapture(event.code); return; }
      const action = this.actionForCode(event.code); if (!action) return;
      event.preventDefault(); if (!this.down.has(action)) this.pressed.add(action); this.down.add(action); if (action === 'left' || action === 'right') { this.tapAxis = action === 'left' ? -1 : 1; this.tapAxisUntil = performance.now() + 150; }
    }, { passive: false });
    root.addEventListener('keyup', (event) => {
      const action = this.actionForCode(event.code); if (!action) return;
      event.preventDefault(); this.down.delete(action); this.released.add(action);
    }, { passive: false });
    document.querySelectorAll('[data-action]').forEach((button) => {
      const begin = (event) => {
        event.preventDefault(); try { button.setPointerCapture?.(event.pointerId); } catch {}
        const action = button.dataset.action; this.pointers.set(event.pointerId, action);
        if (!this.down.has(action)) this.pressed.add(action); this.down.add(action); button.classList.add('pressed');
      };
      const end = (event) => {
        event.preventDefault(); const action = this.pointers.get(event.pointerId); this.pointers.delete(event.pointerId);
        button.classList.remove('pressed'); if (!action || [...this.pointers.values()].includes(action)) return;
        this.down.delete(action); this.released.add(action);
      };
      button.addEventListener('pointerdown', begin, { passive: false }); button.addEventListener('pointerup', end, { passive: false }); button.addEventListener('pointercancel', end, { passive: false });
      button.addEventListener('contextmenu', (event) => event.preventDefault());
    });
    addEventListener('blur', () => this.clear());
    ['touchmove', 'gesturestart', 'dblclick'].forEach((name) => document.addEventListener(name, (event) => event.preventDefault(), { passive: false }));
  }
  actionForCode(code) { return this.fixed.get(code) || Object.keys(this.bindings).find((action) => this.bindings[action] === code); }
  beginCapture(action, callback) { this.capture = { action, callback }; this.clear(); }
  finishCapture(code) {
    const capture = this.capture; if (!capture) return;
    if (['ArrowLeft', 'ArrowRight', 'Backquote'].includes(code)) { capture.callback({ ok: false, error: '方向鍵與 ` 鍵為固定保留鍵。' }); return; }
    const conflict = Object.keys(this.bindings).find((action) => action !== capture.action && this.bindings[action] === code);
    if (conflict) { capture.callback({ ok: false, error: '此按鍵已被其他動作使用。' }); return; }
    this.bindings[capture.action] = code; this.capture = null; this.onChange({ ...this.bindings }); capture.callback({ ok: true });
  }
  cancelCapture() { this.capture = null; }
  resetBindings() { this.bindings = { ...DEFAULT_CONTROLS }; this.capture = null; this.onChange({ ...this.bindings }); }
  isDown(action) { return this.down.has(action); } wasPressed(action) { return this.pressed.has(action); } wasReleased(action) { return this.released.has(action); }
  axis() { const held = (this.isDown('right') ? 1 : 0) - (this.isDown('left') ? 1 : 0); return held || (performance.now() < this.tapAxisUntil ? this.tapAxis : 0); }
  endFrame() { this.pressed.clear(); this.released.clear(); }
  clear() { this.down.clear(); this.pressed.clear(); this.released.clear(); this.pointers.clear(); this.tapAxis = 0; this.tapAxisUntil = 0; document.querySelectorAll('[data-action].pressed').forEach((button) => button.classList.remove('pressed')); }
}

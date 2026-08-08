export const ACTIONS = ['left', 'right', 'jump', 'crouch', 'attack', 'dash', 'skill', 'pause'];
export const ACTION_LABELS = { left: '向左移動', right: '向右移動', jump: '跳躍', crouch: '蹲下', attack: '普通攻擊', dash: '空中衝刺', skill: 'Wind Pulse', pause: '暫停' };
export const DEFAULT_CONTROLS = { left: 'KeyA', right: 'KeyD', jump: 'KeyW', crouch: 'KeyS', attack: 'KeyJ', dash: 'KeyK', skill: 'KeyL', pause: 'Escape' };
export function displayCode(code) {
  const names = { Space: 'Space', Escape: 'Esc', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓' };
  return names[code] || code.replace(/^Key/, '').replace(/^Digit/, '');
}

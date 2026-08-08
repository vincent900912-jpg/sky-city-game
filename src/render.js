export function frameAt(frames, time, fps = 10, loop = true) {
  if (!frames?.length) return null; const raw = Math.floor(time * fps); return frames[loop ? raw % frames.length : Math.min(raw, frames.length - 1)];
}
const boundsCache = new WeakMap();
export function imageAlphaBounds(image) {
  if (!image) return null; if (boundsCache.has(image)) return boundsCache.get(image);
  const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height; const context = canvas.getContext('2d', { willReadFrequently: true }); context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, image.width, image.height).data; let left = image.width, top = image.height, right = -1, bottom = -1;
  for (let y = 0; y < image.height; y += 1) for (let x = 0; x < image.width; x += 1) if (pixels[(y * image.width + x) * 4 + 3]) { left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y); }
  const bounds = right < 0 ? { left: 0, top: 0, right: image.width - 1, bottom: image.height - 1 } : { left, top, right, bottom }; boundsCache.set(image, bounds); return bounds;
}
export function drawAnchored(ctx, image, x, y, cameraX, anchorX, anchorY, facing = 1, alpha = 1, lockVisibleBaseline = false, scale = 1, rotation = 0) {
  if (!image) return; const correction = lockVisibleBaseline ? anchorY - imageAlphaBounds(image).bottom : 0;
  ctx.save(); ctx.globalAlpha = alpha; ctx.translate(Math.round(x - cameraX), Math.round(y + correction * scale)); ctx.rotate(rotation * (facing < 0 ? -1 : 1)); ctx.scale((facing < 0 ? -1 : 1) * scale, scale); ctx.drawImage(image, -anchorX, -anchorY); ctx.restore();
}
export function anchoredVisualBounds(image, x, y, anchorX, anchorY, facing = 1, lockVisibleBaseline = false, scale = 1) {
  const bounds = imageAlphaBounds(image); const correction = lockVisibleBaseline ? anchorY - bounds.bottom : 0; const left = facing > 0 ? x + bounds.left - anchorX : x - (bounds.right - anchorX);
  return { x: x + (left - x) * scale, y: y + (correction + bounds.top - anchorY) * scale, w: (bounds.right - bounds.left + 1) * scale, h: (bounds.bottom - bounds.top + 1) * scale };
}
export function drawImageWorld(ctx, image, x, y, cameraX, alpha = 1, width = image?.width, height = image?.height) {
  if (!image) return; ctx.save(); ctx.globalAlpha = alpha; ctx.drawImage(image, Math.round(x - cameraX), Math.round(y), Math.round(width), Math.round(height)); ctx.restore();
}
export function drawRect(ctx, rect, cameraX, color, outline = false) {
  ctx[outline ? 'strokeStyle' : 'fillStyle'] = color; if (outline) ctx.strokeRect(Math.round(rect.x - cameraX) + .5, Math.round(rect.y) + .5, Math.round(rect.w), Math.round(rect.h)); else ctx.fillRect(Math.round(rect.x - cameraX), Math.round(rect.y), Math.round(rect.w), Math.round(rect.h));
}
export function drawAnchor(ctx, x, y, cameraX, color = '#fff') { ctx.strokeStyle = color; ctx.beginPath(); ctx.moveTo(x - cameraX - 4, y); ctx.lineTo(x - cameraX + 4, y); ctx.moveTo(x - cameraX, y - 4); ctx.lineTo(x - cameraX, y + 4); ctx.stroke(); }

export const WORLD_WIDTH = 384;
export const WORLD_HEIGHT = 216;
export const BASE_RENDER_WIDTH = 960;
export const BASE_RENDER_HEIGHT = 540;
export const BASE_RENDER_SCALE = BASE_RENDER_WIDTH / WORLD_WIDTH;
export const MAP_ASSET_SCALE = 2.5;
export const MAX_DPR = 2;

export function configureCanvas(canvas, ctx) {
  const dpr = Math.min(MAX_DPR, Math.max(1, window.devicePixelRatio || 1));
  const width = Math.round(BASE_RENDER_WIDTH * dpr);
  const height = Math.round(BASE_RENDER_HEIGHT * dpr);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const scaleX = width / WORLD_WIDTH;
  const scaleY = height / WORLD_HEIGHT;
  ctx.setTransform(scaleX, 0, 0, scaleY, 0, 0);
  ctx.imageSmoothingEnabled = false;
  return { width, height, dpr, scaleX, scaleY };
}

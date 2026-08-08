export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
export const center = (rect) => ({ x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 });

export function moveBody(body, dt, solids, oneWays = []) {
  body.grounded = false;
  body.x += body.vx * dt;
  let box = body.hitbox();
  for (const solid of solids) {
    if (!overlap(box, solid)) continue;
    if (body.vx > 0) body.x -= box.x + box.w - solid.x;
    else if (body.vx < 0) body.x += solid.x + solid.w - box.x;
    body.vx = 0;
    box = body.hitbox();
  }
  const previousBottom = body.hitbox().y + body.hitbox().h;
  body.y += body.vy * dt;
  box = body.hitbox();
  for (const solid of solids) {
    if (!overlap(box, solid)) continue;
    if (body.vy > 0) { body.y -= box.y + box.h - solid.y; body.grounded = true; }
    else if (body.vy < 0) body.y += solid.y + solid.h - box.y;
    body.vy = 0;
    box = body.hitbox();
  }
  if (body.vy >= 0) {
    for (const platform of oneWays) {
      box = body.hitbox();
      const bottom = box.y + box.h;
      if (box.x + box.w <= platform.x || box.x >= platform.x + platform.w) continue;
      if (previousBottom <= platform.y + 2 && bottom >= platform.y) {
        body.y -= bottom - platform.y;
        body.vy = 0;
        body.grounded = true;
      }
    }
  }
}

export function visibleRect(rect, cameraX) {
  return { x: rect.x - cameraX, y: rect.y, w: rect.w, h: rect.h };
}

import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const manifest = JSON.parse(await readFile(new URL('../assets/audio/audio-manifest.json', import.meta.url), 'utf8'));
const root = new URL('../', import.meta.url);
const rate = 22050;
const TAU = Math.PI * 2;
const clamp = (value, min = -1, max = 1) => Math.max(min, Math.min(max, value));
const hash = (text) => [...text].reduce((value, char) => ((value * 33) ^ char.charCodeAt(0)) >>> 0, 2166136261);
const rngFor = (seedText) => { let state = hash(seedText) || 1; return () => ((state = (state * 1664525 + 1013904223) >>> 0) / 4294967296); };

function durationFor(id) {
  if (id.startsWith('music_')) return id === 'music_victory' ? 5 : 14;
  if (id.startsWith('ambience_')) return 8;
  if (id.includes('idle_loop')) return 3;
  if (id.includes('death') || id.includes('phase_change') || id.includes('collapse')) return 1.5;
  if (id.includes('charge') || id.includes('warning') || id.includes('door')) return 0.85;
  if (id.includes('fly') || id.includes('scan_beam') || id.includes('ring_spin')) return 0.75;
  return 0.38;
}
function envelope(t, duration, attack = 0.015, release = 0.22) {
  return Math.min(1, t / attack) * Math.min(1, Math.max(0, duration - t) / release);
}
function filteredNoise(rng, count, smoothing = 0.94) {
  const out = new Float32Array(count); let value = 0;
  for (let i = 0; i < count; i += 1) { value = value * smoothing + (rng() * 2 - 1) * (1 - smoothing); out[i] = value; }
  return out;
}
function music(id, duration, rng) {
  const count = Math.floor(duration * rate); const out = new Float32Array(count); const noise = filteredNoise(rng, count, .985);
  const rootNote = id.includes('boss') ? 82.41 : id.includes('intro') ? 110 : id.includes('menu') ? 130.81 : 146.83;
  const scale = id.includes('boss') ? [1, 1.1892, 1.3348, 1.4983, 1.7818] : [1, 1.1225, 1.3348, 1.4983, 1.6818];
  const beat = id.includes('boss') ? .42 : .58;
  for (let i = 0; i < count; i += 1) {
    const t = i / rate; const bar = Math.floor(t / (beat * 4)); const degree = [0, 3, 1, 4][bar % 4];
    const base = rootNote * scale[degree % scale.length]; const pulse = Math.exp(-((t % beat) / .12));
    const pad = Math.sin(TAU * base * t) * .12 + Math.sin(TAU * base * 1.5 * t + .6) * .07 + Math.sin(TAU * base * 2 * t + 1.2) * .035;
    const arpDegree = scale[Math.floor(t / (beat / 2)) % scale.length]; const arp = Math.sin(TAU * rootNote * 2 * arpDegree * t) * pulse * .11;
    const wind = noise[i] * (id.includes('boss') ? .15 : .1) * (0.55 + .45 * Math.sin(TAU * t / 5));
    const percussion = id.includes('boss') ? Math.sin(TAU * (58 - 18 * Math.min(1, t % beat / .18)) * t) * pulse * .13 : 0;
    out[i] = clamp((pad + arp + wind + percussion) * .82);
  }
  const fade = Math.min(rate * .08, count / 2);
  for (let i = 0; i < fade; i += 1) { out[i] *= i / fade; out[count - 1 - i] *= i / fade; }
  return out;
}
function ambience(id, duration, rng) {
  const count = Math.floor(duration * rate); const out = new Float32Array(count); const smooth = filteredNoise(rng, count, id.includes('wind') ? .975 : .993);
  for (let i = 0; i < count; i += 1) {
    const t = i / rate; const cycle = Math.sin(TAU * t / duration);
    const hum = id.includes('machine') ? Math.sin(TAU * 55 * t) * .12 + Math.sin(TAU * 82.5 * t) * .05 : 0;
    out[i] = (smooth[i] * (id.includes('wind') ? .55 : .35) * (.65 + .25 * cycle) + hum) * .55;
  }
  const fade = Math.floor(rate * .25);
  for (let i = 0; i < fade; i += 1) { out[i] *= i / fade; out[count - 1 - i] *= i / fade; }
  return out;
}
function sfx(id, duration, rng, variation) {
  const count = Math.floor(duration * rate); const out = new Float32Array(count); const noise = filteredNoise(rng, count, .78);
  const isHeavy = /heavy|wall_hit|collapse|death|dash_stop|door_close/.test(id);
  const isWind = /wind|swing|dash|fly|ring_spin|step/.test(id);
  const isEnergy = /pulse|core|checkpoint|saved|ui_|alert|warning|scan|phase|pickup|reflect/.test(id);
  const isMechanical = /guard|oro|platform|door|mechanical|ring_detach|crack/.test(id);
  for (let i = 0; i < count; i += 1) {
    const t = i / rate; const p = t / duration; const env = envelope(t, duration, isHeavy ? .006 : .012, isHeavy ? .45 : .18);
    let value = 0;
    if (isWind) {
      const sweep = 980 - p * (isHeavy ? 680 : 420) + variation * 35;
      value += Math.sin(TAU * sweep * t) * .16 + noise[i] * .42 * (1 - p);
    }
    if (isEnergy) {
      const rise = 280 + p * (id.includes('charge') || id.includes('warning') ? 720 : 260);
      value += Math.sin(TAU * rise * t + Math.sin(TAU * 7 * t) * 1.4) * .27;
      value += Math.sin(TAU * rise * 2.01 * t) * .08;
    }
    if (isMechanical) {
      const metal = isHeavy ? 92 : 185 + variation * 13;
      value += Math.sin(TAU * metal * t) * .22 + Math.sin(TAU * metal * 2.73 * t) * .12;
      value += noise[i] * (isHeavy ? .55 : .22) * Math.exp(-t * 8);
    }
    if (!isWind && !isEnergy && !isMechanical) value += Math.sin(TAU * (220 + variation * 25) * t) * .22 + noise[i] * .28;
    if (/hurt|hit/.test(id)) value += Math.sin(TAU * (isHeavy ? 110 : 190) * t) * .34 * Math.exp(-t * 10);
    if (/jump|open|stand/.test(id)) value += Math.sin(TAU * (240 + p * 420) * t) * .18;
    if (/land|crouch|step/.test(id)) value += noise[i] * .3 * Math.exp(-t * 16);
    out[i] = clamp(value * env * (isHeavy ? .9 : .72));
  }
  return out;
}
function encodeWav(samples) {
  const buffer = Buffer.alloc(44 + samples.length * 2);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(36 + samples.length * 2, 4); buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22); buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write('data', 36); buffer.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i += 1) buffer.writeInt16LE(Math.round(clamp(samples[i]) * 32767), 44 + i * 2);
  return buffer;
}

let files = 0;
for (const [id, entry] of Object.entries(manifest.sounds)) {
  for (let variation = 0; variation < entry.paths.length; variation += 1) {
    const rel = entry.paths[variation]; const target = fileURLToPath(new URL('../' + rel, import.meta.url)); await mkdir(path.dirname(target), { recursive: true });
    const duration = durationFor(id); const rng = rngFor(id + ':' + variation);
    const samples = id.startsWith('music_') ? music(id, duration, rng) : id.startsWith('ambience_') ? ambience(id, duration, rng) : sfx(id, duration, rng, variation);
    await writeFile(target, encodeWav(samples)); files += 1;
  }
}
console.log(`Generated ${files} original WAV files`);

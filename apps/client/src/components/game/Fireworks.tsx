import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { EnvironmentQualityConfig } from './visualQuality';

/**
 * Ambient dusk fireworks for the Independence Day event biome.
 *
 * A pool of shells launches on staggered timers high over the arena. Each shell picks a
 * *shape* — chrysanthemum, ring, double ring, palm, willow, star, heart, or a full
 * stars-and-stripes flag — and detonates its sparks into that pattern, which then expands,
 * droops under gravity, twinkles, and fades before the shell relaunches with a new shape.
 *
 * Everything lives in a single additive THREE.Points buffer (one draw call). Planar shapes
 * (flag / heart / star / ring) are billboarded toward the camera at launch so they stay
 * readable, while volumetric shapes (chrysanthemum / palm / willow) burst in 3D. Sky-anchored
 * in world space so the bursts read as fireworks going off over the map.
 */

interface FireworksProps {
  seed: number;
  config: Pick<EnvironmentQualityConfig, 'maxParticles' | 'particleDensity'>;
}

const SHELL_CAP = 360; // max sparks per shell (a 26x13 flag is 338)
const GRAVITY = 8.5;
const MAX_STEP_SECONDS = 1 / 12;
const BRIGHTNESS = 1.55; // additive push so cores clip toward white

type RGB = readonly [number, number, number];

const HUE = {
  red: [1.0, 0.16, 0.22] as RGB,
  white: [1.0, 1.0, 1.0] as RGB,
  blue: [0.26, 0.42, 1.0] as RGB,
  gold: [1.0, 0.74, 0.22] as RGB,
  cyan: [0.25, 1.0, 0.95] as RGB,
  magenta: [1.0, 0.22, 0.78] as RGB,
  green: [0.35, 1.0, 0.4] as RGB,
} as const;

// Patriotic-leaning palettes, with a few vivid ones mixed in for variety.
const PALETTES: RGB[][] = [
  [HUE.red, HUE.white, HUE.blue],
  [HUE.red, HUE.white],
  [HUE.blue, HUE.white],
  [HUE.gold, HUE.red],
  [HUE.gold, HUE.white],
  [HUE.cyan, HUE.white],
  [HUE.magenta, HUE.gold],
  [HUE.green, HUE.white],
];

type ShapeKind = 'chrysanthemum' | 'ring' | 'doubleRing' | 'palm' | 'willow' | 'star' | 'heart';
const SHAPES: ShapeKind[] = ['chrysanthemum', 'ring', 'doubleRing', 'palm', 'willow', 'star', 'heart'];

interface ShellState {
  launched: boolean;
  delayMs: number;
  ageMs: number;
  lifetimeMs: number;
  cx: number;
  cy: number;
  cz: number;
  radius: number;
  expandRate: number;
  gravFactor: number;
  count: number;
  spin: number; // radians/sec of gentle in-plane swirl
  wave: number; // flag ripple amplitude (0 = none)
  // View-facing basis captured at launch (for billboarded shapes + flag wave depth).
  rx: number; ry: number; rz: number;
  ux: number; uy: number; uz: number;
  dx: number; dy: number; dz: number;
}

function rand(seed: number, salt: number): number {
  let h = (seed >>> 0) ^ Math.imul(salt, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
}

export function Fireworks({ seed, config }: FireworksProps) {
  const tuning = useMemo(() => {
    if (config.maxParticles <= 0 || config.particleDensity <= 0) {
      return { shellCount: 0, countScale: 0, allowFlag: false };
    }
    const shellCount = config.maxParticles >= 700 ? 8 : config.maxParticles >= 350 ? 6 : 4;
    const tierScale = config.maxParticles >= 700 ? 1 : config.maxParticles >= 350 ? 0.82 : 0.6;
    const countScale = Math.min(1, Math.max(0.4, config.particleDensity)) * tierScale;
    return { shellCount, countScale, allowFlag: config.maxParticles >= 350 };
  }, [config.maxParticles, config.particleDensity]);

  const resources = useMemo(() => {
    if (tuning.shellCount <= 0) return null;
    const total = tuning.shellCount * SHELL_CAP;

    const positions = new Float32Array(total * 3);
    const colors = new Float32Array(total * 3);
    // Per-spark static launch data.
    const ox = new Float32Array(total);
    const oy = new Float32Array(total);
    const oz = new Float32Array(total);
    const baseR = new Float32Array(total);
    const baseG = new Float32Array(total);
    const baseB = new Float32Array(total);
    const twPhase = new Float32Array(total);
    const waveCoord = new Float32Array(total); // horizontal position within a flag (for ripple)

    const geometry = new THREE.BufferGeometry();
    const positionAttribute = new THREE.BufferAttribute(positions, 3);
    positionAttribute.setUsage(THREE.StreamDrawUsage);
    const colorAttribute = new THREE.BufferAttribute(colors, 3);
    colorAttribute.setUsage(THREE.StreamDrawUsage);
    geometry.setAttribute('position', positionAttribute);
    geometry.setAttribute('color', colorAttribute);
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 60, -45), 260);

    const material = new THREE.PointsMaterial({
      size: 1.25,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });

    const shells: ShellState[] = Array.from({ length: tuning.shellCount }, (_, index) => ({
      launched: false,
      delayMs: 150 + rand(seed, index * 0x51 + 0x9) * 2400,
      ageMs: 0,
      lifetimeMs: 1800,
      cx: 0, cy: 60, cz: -45,
      radius: 10,
      expandRate: 5,
      gravFactor: 1,
      count: 0,
      spin: 0,
      wave: 0,
      rx: 1, ry: 0, rz: 0,
      ux: 0, uy: 1, uz: 0,
      dx: 0, dy: 0, dz: 1,
    }));

    return {
      geometry, positionAttribute, colorAttribute, positions, colors,
      ox, oy, oz, baseR, baseG, baseB, twPhase, waveCoord, material, shells,
    };
  }, [tuning.shellCount, seed]);

  const launchCounterRef = useRef(0);

  useEffect(
    () => () => {
      resources?.geometry.dispose();
      resources?.material.dispose();
    },
    [resources]
  );

  useFrame((state, delta) => {
    if (!resources) return;
    const step = Math.min(Math.max(delta, 0), MAX_STEP_SECONDS);
    if (step <= 0) return;

    const { shells, positions, colors, ox, oy, oz, baseR, baseG, baseB, twPhase, waveCoord } = resources;
    const cam = state.camera.position;

    for (let s = 0; s < shells.length; s++) {
      const shell = shells[s];
      const base = s * SHELL_CAP;

      if (!shell.launched) {
        shell.delayMs -= step * 1000;
        if (shell.delayMs > 0) continue;
        launchShell(resources, tuning, shell, base, cam.x, cam.y, cam.z, (launchCounterRef.current += 1), seed);
        continue;
      }

      shell.ageMs += step * 1000;
      const life = shell.ageMs / shell.lifetimeMs;
      if (life >= 1) {
        shell.launched = false;
        // Snappy, busy cadence so the sky is never empty.
        shell.delayMs = 220 + rand(seed ^ launchCounterRef.current, s * 0x77 + 0x13) * 1500;
        for (let i = 0; i < shell.count; i++) {
          const c = (base + i) * 3;
          colors[c] = 0; colors[c + 1] = 0; colors[c + 2] = 0;
        }
        continue;
      }

      const t = shell.ageMs / 1000;
      // Ease open to the shape's radius, then hold.
      const expansion = shell.radius * (1 - Math.exp(-t * shell.expandRate));
      const drop = 0.5 * GRAVITY * shell.gravFactor * t * t;
      const fadeOut = 1 - smoothstep(0.5, 1, life);
      const flashIn = smoothstep(0, 0.05, life);
      const swirl = shell.spin * t;
      const cosS = Math.cos(swirl);
      const sinS = Math.sin(swirl);
      const brightBase = fadeOut * (0.32 + 0.68 * flashIn) * BRIGHTNESS;

      for (let i = 0; i < shell.count; i++) {
        const idx = base + i;
        // Gentle in-plane swirl around the view axis makes bursts feel alive.
        let vx = ox[idx];
        let vy = oy[idx];
        let vz = oz[idx];
        if (shell.spin !== 0) {
          // Rotate the offset within the billboard (right/up) plane.
          const du = vx * shell.rx + vy * shell.ry + vz * shell.rz;
          const dv = vx * shell.ux + vy * shell.uy + vz * shell.uz;
          const dw = vx * shell.dx + vy * shell.dy + vz * shell.dz;
          const ru = du * cosS - dv * sinS;
          const rv = du * sinS + dv * cosS;
          vx = shell.rx * ru + shell.ux * rv + shell.dx * dw;
          vy = shell.ry * ru + shell.uy * rv + shell.dy * dw;
          vz = shell.rz * ru + shell.uz * rv + shell.dz * dw;
        }

        let px = shell.cx + vx * expansion;
        let py = shell.cy + vy * expansion - drop;
        let pz = shell.cz + vz * expansion;

        if (shell.wave !== 0) {
          // Ripple the flag in depth (along the view axis) for a waving look.
          const ripple = Math.sin(waveCoord[idx] * 7 + t * 6) * shell.wave * expansion;
          px += shell.dx * ripple;
          py += shell.dy * ripple;
          pz += shell.dz * ripple;
        }

        const p = idx * 3;
        positions[p] = px;
        positions[p + 1] = py;
        positions[p + 2] = pz;

        const twinkle = 0.72 + 0.28 * Math.sin(t * 21 + twPhase[idx]);
        const b = brightBase * twinkle;
        const c = idx * 3;
        colors[c] = baseR[idx] * b;
        colors[c + 1] = baseG[idx] * b;
        colors[c + 2] = baseB[idx] * b;
      }
    }

    resources.positionAttribute.needsUpdate = true;
    resources.colorAttribute.needsUpdate = true;
  });

  if (!resources) return null;

  return (
    <points frustumCulled={false} renderOrder={-70}>
      <primitive object={resources.geometry} attach="geometry" />
      <primitive object={resources.material} attach="material" />
    </points>
  );
}

// The subset of the memoized resources that launchShell / buildFlag write into.
interface Resources {
  positions: Float32Array;
  colors: Float32Array;
  ox: Float32Array;
  oy: Float32Array;
  oz: Float32Array;
  baseR: Float32Array;
  baseG: Float32Array;
  baseB: Float32Array;
  twPhase: Float32Array;
  waveCoord: Float32Array;
  shells: ShellState[];
}

interface Tuning {
  shellCount: number;
  countScale: number;
  allowFlag: boolean;
}

function launchShell(
  res: Resources,
  tuning: Tuning,
  shell: ShellState,
  base: number,
  camX: number,
  camY: number,
  camZ: number,
  launchId: number,
  seed: number
): void {
  // Force a flag roughly every 6th launch (when the budget allows enough points).
  const isFlag = tuning.allowFlag && launchId % 6 === 0;
  const shape: ShapeKind = SHAPES[Math.floor(rand(seed ^ launchId, 0x1234) * SHAPES.length) % SHAPES.length];

  // Burst position high over the arena; flags sit centered and a touch higher/larger.
  if (isFlag) {
    shell.cx = (rand(seed ^ launchId, 0x21) - 0.5) * 46;
    shell.cy = 60 + rand(seed ^ launchId, 0x22) * 16;
    shell.cz = -72 + rand(seed ^ launchId, 0x23) * 34;
  } else {
    shell.cx = (rand(seed ^ launchId, 0x21) - 0.5) * 150;
    shell.cy = 46 + rand(seed ^ launchId, 0x22) * 34;
    shell.cz = -100 + rand(seed ^ launchId, 0x23) * 96;
  }

  // Billboard basis: face the pattern toward the camera.
  let dx = shell.cx - camX;
  let dy = shell.cy - camY;
  let dz = shell.cz - camZ;
  const dl = Math.hypot(dx, dy, dz) || 1;
  dx /= dl; dy /= dl; dz /= dl;
  let rx = dz;
  let rz = -dx;
  const rl = Math.hypot(rx, rz) || 1;
  rx /= rl; let ry = 0; rz /= rl;
  const ux = dy * rz - dz * ry;
  const uy = dz * rx - dx * rz;
  const uz = dx * ry - dy * rx;
  shell.rx = rx; shell.ry = ry; shell.rz = rz;
  shell.ux = ux; shell.uy = uy; shell.uz = uz;
  shell.dx = dx; shell.dy = dy; shell.dz = dz;
  shell.wave = 0;

  const writePlanar = (i: number, u: number, v: number, color: RGB, wc = 0) => {
    const idx = base + i;
    res.ox[idx] = rx * u + ux * v;
    res.oy[idx] = ry * u + uy * v;
    res.oz[idx] = rz * u + uz * v;
    res.baseR[idx] = color[0]; res.baseG[idx] = color[1]; res.baseB[idx] = color[2];
    res.twPhase[idx] = rand(launchId, idx * 3 + 1) * Math.PI * 2;
    res.waveCoord[idx] = wc;
  };
  const writeVolumetric = (i: number, x: number, y: number, z: number, color: RGB) => {
    const idx = base + i;
    res.ox[idx] = x; res.oy[idx] = y; res.oz[idx] = z;
    res.baseR[idx] = color[0]; res.baseG[idx] = color[1]; res.baseB[idx] = color[2];
    res.twPhase[idx] = rand(launchId, idx * 3 + 1) * Math.PI * 2;
    res.waveCoord[idx] = 0;
  };

  const scaleCount = (n: number) => Math.max(24, Math.min(SHELL_CAP, Math.round(n * tuning.countScale)));

  let count = 0;

  if (isFlag) {
    count = buildFlag(res, base, tuning, writePlanar);
    shell.radius = 15;
    shell.expandRate = 4.6;
    shell.gravFactor = 0.22;
    shell.lifetimeMs = 3200;
    shell.spin = 0;
    shell.wave = 0.06;
  } else {
    const palette = PALETTES[launchId % PALETTES.length];
    const pick = (i: number): RGB => palette[Math.floor(rand(launchId, i * 7 + 0x55) * palette.length) % palette.length];

    switch (shape) {
      case 'ring': {
        count = scaleCount(150);
        for (let i = 0; i < count; i++) {
          const a = (i / count) * Math.PI * 2;
          writePlanar(i, Math.cos(a), Math.sin(a), palette[0]);
        }
        shell.radius = 12; shell.expandRate = 5.5; shell.gravFactor = 0.5; shell.lifetimeMs = 2100;
        shell.spin = (rand(launchId, 0x9) - 0.5) * 1.2;
        break;
      }
      case 'doubleRing': {
        count = scaleCount(220);
        const inner = Math.floor(count / 2);
        const cB = palette[1] ?? palette[0];
        for (let i = 0; i < count; i++) {
          const onInner = i < inner;
          const denom = onInner ? inner : count - inner;
          const a = ((onInner ? i : i - inner) / denom) * Math.PI * 2;
          const r = onInner ? 0.58 : 1;
          writePlanar(i, Math.cos(a) * r, Math.sin(a) * r, onInner ? cB : palette[0]);
        }
        shell.radius = 12.5; shell.expandRate = 5.2; shell.gravFactor = 0.5; shell.lifetimeMs = 2200;
        shell.spin = (rand(launchId, 0x9) - 0.5) * 1.4;
        break;
      }
      case 'star': {
        count = scaleCount(190);
        for (let i = 0; i < count; i++) {
          const seg = (i / count) * 10;
          const k = Math.floor(seg);
          const frac = seg - k;
          const a0 = (Math.PI / 2) + (k * Math.PI) / 5;
          const a1 = (Math.PI / 2) + ((k + 1) * Math.PI) / 5;
          const r0 = k % 2 === 0 ? 1 : 0.44;
          const r1 = (k + 1) % 2 === 0 ? 1 : 0.44;
          const x0 = Math.cos(a0) * r0, y0 = Math.sin(a0) * r0;
          const x1 = Math.cos(a1) * r1, y1 = Math.sin(a1) * r1;
          writePlanar(i, x0 + (x1 - x0) * frac, y0 + (y1 - y0) * frac, pick(i));
        }
        shell.radius = 12; shell.expandRate = 5; shell.gravFactor = 0.45; shell.lifetimeMs = 2400;
        shell.spin = (rand(launchId, 0x9) - 0.5) * 0.8;
        break;
      }
      case 'heart': {
        count = scaleCount(180);
        const cHue = palette[0][0] > 0.7 ? palette[0] : HUE.red;
        for (let i = 0; i < count; i++) {
          const th = (i / count) * Math.PI * 2;
          const hx = 16 * Math.sin(th) ** 3;
          const hy = 13 * Math.cos(th) - 5 * Math.cos(2 * th) - 2 * Math.cos(3 * th) - Math.cos(4 * th);
          writePlanar(i, hx / 17, hy / 17, cHue);
        }
        shell.radius = 12; shell.expandRate = 4.8; shell.gravFactor = 0.4; shell.lifetimeMs = 2500;
        shell.spin = 0;
        break;
      }
      case 'palm':
      case 'willow': {
        const isWillow = shape === 'willow';
        const fronds = 16;
        const perFrond = Math.max(6, Math.round(scaleCount(isWillow ? 176 : 160) / fronds));
        count = Math.min(SHELL_CAP, fronds * perFrond);
        let i = 0;
        for (let f = 0; f < fronds && i < count; f++) {
          const az = (f / fronds) * Math.PI * 2 + rand(launchId, f * 0x13) * 0.3;
          const el = 0.35 + rand(launchId, f * 0x17) * 0.5; // bias upward
          const ux2 = Math.cos(az) * Math.cos(el);
          const uy2 = Math.sin(el);
          const uz2 = Math.sin(az) * Math.cos(el);
          const cHue = isWillow ? HUE.gold : pick(f);
          for (let m = 0; m < perFrond && i < count; m++) {
            const r = 0.28 + (m / perFrond) * 0.92;
            writeVolumetric(i, ux2 * r, uy2 * r, uz2 * r, cHue);
            i++;
          }
        }
        count = i;
        shell.radius = 13; shell.expandRate = isWillow ? 3.4 : 4.4;
        shell.gravFactor = isWillow ? 1.6 : 0.85; shell.lifetimeMs = isWillow ? 2900 : 2300;
        shell.spin = 0;
        break;
      }
      case 'chrysanthemum':
      default: {
        count = scaleCount(230);
        for (let i = 0; i < count; i++) {
          const u = rand(launchId, i * 5 + 0x3);
          const v = rand(launchId, i * 5 + 0x4);
          const theta = u * Math.PI * 2;
          const phi = Math.acos(2 * v - 1);
          const sinPhi = Math.sin(phi);
          const rr = 0.82 + rand(launchId, i * 5 + 0x6) * 0.24;
          writeVolumetric(
            i,
            Math.cos(theta) * sinPhi * rr,
            Math.cos(phi) * rr,
            Math.sin(theta) * sinPhi * rr,
            pick(i)
          );
        }
        shell.radius = 12.5; shell.expandRate = 4.8; shell.gravFactor = 0.7; shell.lifetimeMs = 2300;
        shell.spin = (rand(launchId, 0x9) - 0.5) * 0.6;
        break;
      }
    }
  }

  // Blank any leftover capacity from the previous, larger burst.
  for (let i = count; i < shell.count; i++) {
    const c = (base + i) * 3;
    res.colors[c] = 0; res.colors[c + 1] = 0; res.colors[c + 2] = 0;
  }

  shell.count = count;
  shell.ageMs = 0;
  shell.launched = true;
}

/** Lay out a stars-and-stripes grid and return the spark count used. */
function buildFlag(
  res: Resources,
  base: number,
  tuning: Tuning,
  writePlanar: (i: number, u: number, v: number, color: RGB, wc?: number) => void
): number {
  const cols = tuning.countScale < 0.75 ? 20 : 26;
  const rows = 13;
  const halfW = 1;
  const halfH = halfW / 1.9; // US flag aspect ~1.9:1
  const cantonCols = Math.round(cols * 0.4);
  let i = 0;

  for (let row = 0; row < rows; row++) {
    // Row 0 is the top stripe (red); stripes alternate red/white.
    const stripeRed = row % 2 === 0;
    for (let col = 0; col < cols; col++) {
      const u = -halfW + (col / (cols - 1)) * 2 * halfW;
      const v = halfH - (row / (rows - 1)) * 2 * halfH;
      const inCanton = col < cantonCols && row < 7;
      let color: RGB;
      if (inCanton) {
        color = (row + col) % 2 === 0 ? HUE.white : HUE.blue; // scattered "stars" on blue
      } else {
        color = stripeRed ? HUE.red : HUE.white;
      }
      writePlanar(i, u, v, color, u);
      i++;
    }
  }
  return i;
}

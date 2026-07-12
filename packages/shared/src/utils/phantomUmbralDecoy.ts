import {
  PHANTOM_UMBRAL_DECOY_CLOAK_DURATION_SECONDS,
  PHANTOM_UMBRAL_DECOY_SPEED,
} from '../constants/heroes.js';
import type { Vec3 } from '../types/vector.js';

export interface PhantomUmbralDecoyAbilityState {
  isActive?: boolean;
  activatedAt?: number;
}

export interface PhantomUmbralDecoyCastSchedule {
  primaryCastTimesMs: readonly [number, number];
  shieldCastTimeMs: number;
  blinkCastTimeMs: number;
}

export interface PhantomUmbralDecoyMotion {
  position: Vec3;
  yaw: number;
}

function mixSeed(seed: number): number {
  let value = seed >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return value >>> 0;
}

function seededUnit(seed: number, salt: number): number {
  return mixSeed(seed ^ Math.imul(salt, 0x9e3779b1)) / 0xffffffff;
}

export function getPhantomUmbralDecoySeed(castId: string): number {
  let hash = 2166136261;
  for (let index = 0; index < castId.length; index++) {
    hash ^= castId.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function getPhantomUmbralDecoyCastSchedule(
  seed: number,
): PhantomUmbralDecoyCastSchedule {
  return {
    primaryCastTimesMs: [
      460 + Math.round(seededUnit(seed, 11) * 180),
      2_380 + Math.round(seededUnit(seed, 12) * 180),
    ],
    shieldCastTimeMs: 1_020 + Math.round(seededUnit(seed, 13) * 220),
    blinkCastTimeMs: 1_720 + Math.round(seededUnit(seed, 14) * 240),
  };
}

export function isPhantomUmbralDecoyCloaked(
  ability: PhantomUmbralDecoyAbilityState | null | undefined,
  now: number,
): boolean {
  return Boolean(
    ability?.isActive &&
    now - (ability.activatedAt ?? 0) < PHANTOM_UMBRAL_DECOY_CLOAK_DURATION_SECONDS * 1000
  );
}

export function getPhantomUmbralDecoyPosition(
  startPosition: Vec3,
  direction: Vec3,
  elapsedMs: number,
  seed = 0,
): Vec3 {
  const elapsedSeconds = Math.max(0, elapsedMs) / 1000;
  const forwardLength = Math.hypot(direction.x, direction.z);
  const forwardX = forwardLength > 0.0001 ? direction.x / forwardLength : 0;
  const forwardZ = forwardLength > 0.0001 ? direction.z / forwardLength : -1;
  const rightX = -forwardZ;
  const rightZ = forwardX;
  const phaseA = seededUnit(seed, 1) * Math.PI * 2;
  const phaseB = seededUnit(seed, 2) * Math.PI * 2;
  const frequencyA = 2.4 + seededUnit(seed, 3) * 1.5;
  const frequencyB = 4.8 + seededUnit(seed, 4) * 1.8;
  const lateralAmplitude = 0.85 + seededUnit(seed, 5) * 0.7;
  const lateralOffset = (
    (Math.sin(elapsedSeconds * frequencyA + phaseA) - Math.sin(phaseA)) * lateralAmplitude +
    (Math.sin(elapsedSeconds * frequencyB + phaseB) - Math.sin(phaseB)) * 0.34
  );
  const forwardDistance = PHANTOM_UMBRAL_DECOY_SPEED * elapsedSeconds * (
    0.9 + Math.sin(elapsedSeconds * 2.1 + phaseB) * 0.08
  );
  const schedule = getPhantomUmbralDecoyCastSchedule(seed);
  const blinkApplied = elapsedMs >= schedule.blinkCastTimeMs;
  const blinkForward = blinkApplied ? 2.4 + seededUnit(seed, 6) * 1.4 : 0;
  const blinkLateral = blinkApplied ? (seededUnit(seed, 7) < 0.5 ? -1 : 1) * (1.1 + seededUnit(seed, 8) * 1.3) : 0;
  return {
    x: startPosition.x + forwardX * (forwardDistance + blinkForward) + rightX * (lateralOffset + blinkLateral),
    y: startPosition.y,
    z: startPosition.z + forwardZ * (forwardDistance + blinkForward) + rightZ * (lateralOffset + blinkLateral),
  };
}

export function getPhantomUmbralDecoyMotion(
  startPosition: Vec3,
  direction: Vec3,
  elapsedMs: number,
  seed: number,
): PhantomUmbralDecoyMotion {
  const position = getPhantomUmbralDecoyPosition(startPosition, direction, elapsedMs, seed);
  const priorPosition = getPhantomUmbralDecoyPosition(
    startPosition,
    direction,
    Math.max(0, elapsedMs - 24),
    seed,
  );
  const velocityX = position.x - priorPosition.x;
  const velocityZ = position.z - priorPosition.z;
  const yaw = Math.hypot(velocityX, velocityZ) > 0.0001
    ? Math.atan2(-velocityX, -velocityZ)
    : Math.atan2(-direction.x, -direction.z);
  return { position, yaw };
}

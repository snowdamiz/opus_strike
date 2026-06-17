import type { PlainVec2, PlainVec3 } from './bot-ai';

const COARSE_EVENT_POSITION_GRID_METERS = 12;

export function normalizeHorizontalPlain(vector: { x: number; z: number }): PlainVec2 | null {
  const length = Math.sqrt(vector.x * vector.x + vector.z * vector.z);
  if (length <= 0.0001) return null;
  return {
    x: vector.x / length,
    z: vector.z / length,
  };
}

export function vec3SchemaToPlain(position: { x: number; y: number; z: number }): PlainVec3 {
  return { x: position.x, y: position.y, z: position.z };
}

export function getForwardVector(yaw: number, pitch: number): PlainVec3 {
  const cosPitch = Math.cos(pitch);
  return {
    x: -Math.sin(yaw) * cosPitch,
    y: Math.sin(pitch),
    z: -Math.cos(yaw) * cosPitch,
  };
}

export function direction2DFromTo(from: { x: number; z: number }, to: { x: number; z: number }): PlainVec2 | null {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const length = Math.sqrt(dx * dx + dz * dz);
  if (length <= 0.001) return null;
  return { x: dx / length, z: dz / length };
}

export function forward2D(yaw: number): PlainVec2 {
  return {
    x: -Math.sin(yaw),
    z: -Math.cos(yaw),
  };
}

export function normalize2D(vector: PlainVec2): PlainVec2 | null {
  const length = Math.sqrt(vector.x * vector.x + vector.z * vector.z);
  if (length <= 0.001) return null;
  return { x: vector.x / length, z: vector.z / length };
}

export function worldDirectionToLocalMove(direction: PlainVec2, lookYaw: number): PlainVec2 {
  const cos = Math.cos(lookYaw);
  const sin = Math.sin(lookYaw);
  return {
    x: direction.x * cos - direction.z * sin,
    z: direction.x * sin + direction.z * cos,
  };
}

export function rotateAngleToward(current: number, target: number, maxStep: number): number {
  const delta = normalizeAngle(target - current);
  if (Math.abs(delta) <= maxStep) return normalizeAngle(target);
  return normalizeAngle(current + Math.sign(delta) * maxStep);
}

export function normalizeAngle(angle: number): number {
  let normalized = angle;
  while (normalized > Math.PI) normalized -= Math.PI * 2;
  while (normalized < -Math.PI) normalized += Math.PI * 2;
  return normalized;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

export function randomSigned(amount: number): number {
  return (Math.random() * 2 - 1) * amount;
}

export function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export function distance2D(a: { x: number; z: number }, b: { x: number; z: number }): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

export function distance3D(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function getCoarseEventPosition(position: PlainVec3): PlainVec3 {
  return {
    x: Math.round(position.x / COARSE_EVENT_POSITION_GRID_METERS) * COARSE_EVENT_POSITION_GRID_METERS,
    y: Math.round(position.y),
    z: Math.round(position.z / COARSE_EVENT_POSITION_GRID_METERS) * COARSE_EVENT_POSITION_GRID_METERS,
  };
}

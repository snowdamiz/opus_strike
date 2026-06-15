import type { Vec3Like } from './playerGeometry.js';

export const BLAZE_BOMB_METEOR_ENTRY_HEIGHT = 52;
export const BLAZE_BOMB_METEOR_ENTRY_BACK_OFFSET = 30;
export const BLAZE_BOMB_METEOR_IMPACT_Y_OFFSET = 0.9;

const EPSILON = 0.0001;

export interface BlazeMeteorPathInput {
  id: string;
  startPosition: Vec3Like;
  targetPosition: Vec3Like;
}

export interface BlazeMeteorPath {
  entryPosition: Vec3Like;
  impactPosition: Vec3Like;
  travelDirection: Vec3Like;
  distance: number;
}

function getFallbackApproachDirection(id: string): Vec3Like {
  let seed = 0;
  for (let index = 0; index < id.length; index++) {
    seed += id.charCodeAt(index);
  }
  const angle = (seed % 360) * (Math.PI / 180);
  return {
    x: Math.cos(angle),
    y: 0,
    z: Math.sin(angle),
  };
}

export function getBlazeMeteorPath(input: BlazeMeteorPathInput): BlazeMeteorPath {
  const impactPosition = {
    x: input.targetPosition.x,
    y: input.targetPosition.y + BLAZE_BOMB_METEOR_IMPACT_Y_OFFSET,
    z: input.targetPosition.z,
  };
  let approachDirection = {
    x: impactPosition.x - input.startPosition.x,
    y: 0,
    z: impactPosition.z - input.startPosition.z,
  };
  const approachLengthSq =
    approachDirection.x * approachDirection.x +
    approachDirection.z * approachDirection.z;

  if (approachLengthSq < EPSILON) {
    approachDirection = getFallbackApproachDirection(input.id);
  } else {
    const approachLength = Math.sqrt(approachLengthSq);
    approachDirection = {
      x: approachDirection.x / approachLength,
      y: 0,
      z: approachDirection.z / approachLength,
    };
  }

  const entryPosition = {
    x: impactPosition.x - approachDirection.x * BLAZE_BOMB_METEOR_ENTRY_BACK_OFFSET,
    y: impactPosition.y + BLAZE_BOMB_METEOR_ENTRY_HEIGHT,
    z: impactPosition.z - approachDirection.z * BLAZE_BOMB_METEOR_ENTRY_BACK_OFFSET,
  };
  const travel = {
    x: impactPosition.x - entryPosition.x,
    y: impactPosition.y - entryPosition.y,
    z: impactPosition.z - entryPosition.z,
  };
  const distance = Math.sqrt(travel.x * travel.x + travel.y * travel.y + travel.z * travel.z);
  const travelDirection = distance > EPSILON
    ? {
      x: travel.x / distance,
      y: travel.y / distance,
      z: travel.z / distance,
    }
    : { x: 0, y: -1, z: 0 };

  return {
    entryPosition,
    impactPosition,
    travelDirection,
    distance,
  };
}

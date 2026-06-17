const DEFAULT_AUDIO_UP = { x: 0, y: 1, z: 0 };
const AUDIO_LISTENER_POSITION_EPSILON_SQ = 0.000001;
const AUDIO_LISTENER_DIRECTION_EPSILON_SQ = 0.00000001;

let lastAudioListenerContext: AudioContext | null = null;
let hasLastAudioListenerPosition = false;
let hasLastAudioListenerOrientation = false;
let lastAudioListenerPositionX = 0;
let lastAudioListenerPositionY = 0;
let lastAudioListenerPositionZ = 0;
let lastAudioListenerForwardX = 0;
let lastAudioListenerForwardY = 0;
let lastAudioListenerForwardZ = -1;
let lastAudioListenerUpX = 0;
let lastAudioListenerUpY = 1;
let lastAudioListenerUpZ = 0;

interface AudioVec3 {
  x: number;
  y: number;
  z: number;
}

function setAudioParam(param: AudioParam | undefined, value: number, currentTime: number): void {
  if (!param) return;
  param.setValueAtTime(value, currentTime);
}

function vectorDistanceSq(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number
): number {
  const dx = ax - bx;
  const dy = ay - by;
  const dz = az - bz;
  return dx * dx + dy * dy + dz * dz;
}

export function setAudioListenerTransformForContext(
  ctx: AudioContext | null,
  position: AudioVec3,
  forward?: AudioVec3,
  up: AudioVec3 = DEFAULT_AUDIO_UP
): void {
  if (!ctx) return;

  if (lastAudioListenerContext !== ctx) {
    lastAudioListenerContext = ctx;
    hasLastAudioListenerPosition = false;
    hasLastAudioListenerOrientation = false;
  }

  const listener = ctx.listener as AudioListener & {
    positionX?: AudioParam;
    positionY?: AudioParam;
    positionZ?: AudioParam;
    forwardX?: AudioParam;
    forwardY?: AudioParam;
    forwardZ?: AudioParam;
    upX?: AudioParam;
    upY?: AudioParam;
    upZ?: AudioParam;
    setPosition?: (x: number, y: number, z: number) => void;
    setOrientation?: (fx: number, fy: number, fz: number, ux: number, uy: number, uz: number) => void;
  };

  const positionChanged = !hasLastAudioListenerPosition || vectorDistanceSq(
    position.x,
    position.y,
    position.z,
    lastAudioListenerPositionX,
    lastAudioListenerPositionY,
    lastAudioListenerPositionZ
  ) > AUDIO_LISTENER_POSITION_EPSILON_SQ;

  if (positionChanged) {
    if (listener.positionX && listener.positionY && listener.positionZ) {
      setAudioParam(listener.positionX, position.x, ctx.currentTime);
      setAudioParam(listener.positionY, position.y, ctx.currentTime);
      setAudioParam(listener.positionZ, position.z, ctx.currentTime);
    } else {
      listener.setPosition?.(position.x, position.y, position.z);
    }

    hasLastAudioListenerPosition = true;
    lastAudioListenerPositionX = position.x;
    lastAudioListenerPositionY = position.y;
    lastAudioListenerPositionZ = position.z;
  }

  if (!forward) return;

  const orientationChanged = !hasLastAudioListenerOrientation || (
    vectorDistanceSq(
      forward.x,
      forward.y,
      forward.z,
      lastAudioListenerForwardX,
      lastAudioListenerForwardY,
      lastAudioListenerForwardZ
    ) > AUDIO_LISTENER_DIRECTION_EPSILON_SQ ||
    vectorDistanceSq(
      up.x,
      up.y,
      up.z,
      lastAudioListenerUpX,
      lastAudioListenerUpY,
      lastAudioListenerUpZ
    ) > AUDIO_LISTENER_DIRECTION_EPSILON_SQ
  );

  if (!orientationChanged) return;

  if (
    listener.forwardX &&
    listener.forwardY &&
    listener.forwardZ &&
    listener.upX &&
    listener.upY &&
    listener.upZ
  ) {
    setAudioParam(listener.forwardX, forward.x, ctx.currentTime);
    setAudioParam(listener.forwardY, forward.y, ctx.currentTime);
    setAudioParam(listener.forwardZ, forward.z, ctx.currentTime);
    setAudioParam(listener.upX, up.x, ctx.currentTime);
    setAudioParam(listener.upY, up.y, ctx.currentTime);
    setAudioParam(listener.upZ, up.z, ctx.currentTime);
  } else {
    listener.setOrientation?.(forward.x, forward.y, forward.z, up.x, up.y, up.z);
  }

  hasLastAudioListenerOrientation = true;
  lastAudioListenerForwardX = forward.x;
  lastAudioListenerForwardY = forward.y;
  lastAudioListenerForwardZ = forward.z;
  lastAudioListenerUpX = up.x;
  lastAudioListenerUpY = up.y;
  lastAudioListenerUpZ = up.z;
}

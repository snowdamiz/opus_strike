import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import {
  BLAZE_FLAMETHROWER_BURN_DAMAGE,
  BLAZE_FLAMETHROWER_BURN_INTERVAL_MS,
  BLAZE_FLAMETHROWER_BURN_TICKS,
  BLAZE_FLAMETHROWER_COLLISION_RADIUS,
  BLAZE_FLAMETHROWER_CONE_HALF_ANGLE,
  BLAZE_FLAMETHROWER_DAMAGE,
  BLAZE_FLAMETHROWER_DAMAGE_INTERVAL,
  BLAZE_FLAMETHROWER_RANGE,
  type Team,
} from '@voxel-strike/shared';
import { useGameStore } from '../../../store/gameStore';
import { SHARED_GEOMETRIES } from '../effectResources';
import { visualStore } from '../../../store/visualStore';
import { raycastDirectionInto, type RaycastDirectionHitResult } from '../../../hooks/usePhysics';
import { triggerTerrainImpact } from '../TerrainImpactEffects';
import { getFirstChronosAegisVisualHit } from '../chronos/aegisCollision';
import { BudgetedPointLight } from '../systems/DynamicLightBudget';
import { getFrameClock } from '../../../utils/frameClock';
import { measureFrameWork } from '../../../movement/networkDiagnostics';
import { applyTutorialOfflineTrainingConeDamage } from '../../../utils/tutorialOfflineCombatRuntime';
import {
  PLIABLE_ROPE_SEGMENT_COUNT,
  ROPE_SEGMENT_INDICES,
  createRopePoints,
  updatePliableRopePoints,
  updateRopeSegment,
} from '../hookshot/rope';

// ============================================================================
// FLAMETHROWER EFFECT - Held Blaze E ability
// ============================================================================

export interface FlamethrowerPose {
  origin: { x: number; y: number; z: number };
  direction: { x: number; y: number; z: number };
}

interface FlamethrowerEffectProps {
  isActive: boolean;
  poseProvider?: () => FlamethrowerPose | null;
  ownerId?: string;
  ownerTeam?: Team;
  enableCollisionEffects?: boolean;
}

interface FlamethrowerImpactHit {
  point: { x: number; y: number; z: number };
  normal: { x: number; y: number; z: number };
  distance: number;
}

const _origin = new THREE.Vector3();
const _direction = new THREE.Vector3(0, 0, -1);
const _defaultAxis = new THREE.Vector3(0, 1, 0);
const _quat = new THREE.Quaternion();
const _inverseQuat = new THREE.Quaternion();
const _lag = new THREE.Vector3();
const _localLag = new THREE.Vector3();
const _smoothedLocalDirection = new THREE.Vector3();
const _streamStart = new THREE.Vector3();
const _streamEnd = new THREE.Vector3();
const _swirlOffset = new THREE.Vector3();
const _pathPoint = new THREE.Vector3();
const OPEN_FLAME_GEOMETRY = new THREE.ConeGeometry(1, 1, 14, 1, true);
// Type-only fallback so flamethrowerDirection is never undefined when idle; it is
// never read unless hasLivePose (which requires a real origin/direction source).
const FLAMETHROWER_FALLBACK_DIRECTION = { x: 0, y: 0, z: -1 };

const FLAME_SEGMENTS = [
  { y: 0.72, radius: 0.1, length: 0.82, color: 0xffffff, opacity: 0.46, lag: 0 },
  { y: 1.18, radius: 0.24, length: 1.38, color: 0xfff2a6, opacity: 0.43, lag: 0.1 },
  { y: 1.9, radius: 0.54, length: 2.36, color: 0xffb21f, opacity: 0.38, lag: 0.28 },
  { y: 2.88, radius: 0.9, length: 3.18, color: 0xff5a00, opacity: 0.3, lag: 0.48 },
  { y: 4.1, radius: 1.2, length: 3.82, color: 0xd43100, opacity: 0.22, lag: 0.68 },
  { y: 5.48, radius: 1.48, length: 4.28, color: 0x7d1700, opacity: 0.15, lag: 0.92 },
];

const FLAME_SPARKS = Array.from({ length: 24 }, (_, i) => ({
  phase: i / 24,
  side: i % 2 === 0 ? -1 : 1,
  drift: 0.12 + Math.random() * 0.28,
  speed: 1.9 + Math.random() * 1.8,
  size: 0.03 + Math.random() * 0.04,
}));

const SMOKE_PUFFS = Array.from({ length: 10 }, (_, i) => ({
  phase: i / 10,
  drift: (Math.random() - 0.5) * 0.52,
  rise: 0.15 + Math.random() * 0.25,
  size: 0.13 + Math.random() * 0.16,
}));

const FLAMETHROWER_SPIN_UP_DURATION = 0.14;
const FLAMETHROWER_SPIN_DOWN_DURATION = 0.18;
const FLAME_NOZZLE_VISUAL_OFFSET = 0.16;
const FLAME_STREAM_MAX_LAG = 1.42;
const FLAMETHROWER_COLLISION_SAMPLE_INTERVAL_MS = 50;
const FLAMETHROWER_TERRAIN_IMPACT_INTERVAL_MS = 180;
const FLAME_STREAM_POINT_INDICES = Array.from(
  { length: PLIABLE_ROPE_SEGMENT_COUNT + 1 },
  (_, index) => index
);

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const easeOutCubic = (value: number): number => 1 - Math.pow(1 - clamp01(value), 3);
const FLAME_STREAM_SEGMENT_SAMPLES = ROPE_SEGMENT_INDICES.map((index) => {
  const t = (index + 0.5) / PLIABLE_ROPE_SEGMENT_COUNT;
  return {
    index,
    t,
    widthBase: 0.045 + Math.pow(t, 0.92) * 0.62,
    endFade: 1 - THREE.MathUtils.smoothstep(t, 0.72, 1),
  };
});
const FLAME_STREAM_POINT_SAMPLES = FLAME_STREAM_POINT_INDICES.map((index) => {
  const t = index / PLIABLE_ROPE_SEGMENT_COUNT;
  return {
    index,
    t,
    sizeBase: 0.045 + Math.pow(t, 0.86) * 0.56,
  };
});

function sampleStreamPoint(
  out: THREE.Vector3,
  points: THREE.Vector3[],
  distance: number,
  streamLength: number
): THREE.Vector3 {
  const segmentCount = points.length - 1;
  const t = clamp01((distance - FLAME_NOZZLE_VISUAL_OFFSET) / Math.max(0.001, streamLength - FLAME_NOZZLE_VISUAL_OFFSET));
  const scaledIndex = t * segmentCount;
  const startIndex = Math.min(segmentCount - 1, Math.floor(scaledIndex));
  const endIndex = startIndex + 1;

  return out.copy(points[startIndex]).lerp(points[endIndex], scaledIndex - startIndex);
}

function copyImpactHit(
  point: { x: number; y: number; z: number },
  normal: { x: number; y: number; z: number },
  distance: number
): FlamethrowerImpactHit {
  return {
    point: { x: point.x, y: point.y, z: point.z },
    normal: { x: normal.x, y: normal.y, z: normal.z },
    distance,
  };
}

interface RemoteFlamethrowerInstancedVisualsProps {
  playerIds: readonly string[];
  capacity: number;
  poseProvider: (playerId: string) => FlamethrowerPose | null;
}

interface RemoteFlamethrowerRuntimeState {
  liveFrame: number;
  ramp: number;
  wasLive: boolean;
  startTimeMs: number;
  poseInitialized: boolean;
  phase: number;
  poseOrigin: THREE.Vector3;
  poseDirection: THREE.Vector3;
  smoothedOrigin: THREE.Vector3;
  smoothedDirection: THREE.Vector3;
  streamPoints: THREE.Vector3[];
  streamControlA: THREE.Vector3;
  streamControlB: THREE.Vector3;
  streamLag: THREE.Vector3;
}

const INSTANCE_ALPHA_ATTRIBUTE = 'instanceAlpha';
const REMOTE_STREAM_SEGMENT_INSTANCE_MULTIPLIER = ROPE_SEGMENT_INDICES.length;
const REMOTE_STREAM_POINT_INSTANCE_MULTIPLIER = FLAME_STREAM_POINT_INDICES.length;
const REMOTE_FLAME_INSTANCE_MULTIPLIER = FLAME_SEGMENTS.length;
const REMOTE_SPARK_INSTANCE_MULTIPLIER = FLAME_SPARKS.length;
const REMOTE_SMOKE_INSTANCE_MULTIPLIER = SMOKE_PUFFS.length;
const REMOTE_IDENTITY_QUAT = new THREE.Quaternion();
const _remoteOrigin = new THREE.Vector3();
const _remoteDirection = new THREE.Vector3(0, 0, -1);
const _remoteRootQuat = new THREE.Quaternion();
const _remoteInverseQuat = new THREE.Quaternion();
const _remoteLag = new THREE.Vector3();
const _remoteLocalLag = new THREE.Vector3();
const _remoteSmoothedLocalDirection = new THREE.Vector3();
const _remoteStreamStart = new THREE.Vector3();
const _remoteStreamEnd = new THREE.Vector3();
const _remoteSwirlOffset = new THREE.Vector3();
const _remotePathPoint = new THREE.Vector3();
const _remoteLocalPosition = new THREE.Vector3();
const _remoteLocalScale = new THREE.Vector3();
const _remoteLocalQuat = new THREE.Quaternion();
const _remoteEuler = new THREE.Euler();
const _remoteWorldPosition = new THREE.Vector3();
const _remoteWorldStart = new THREE.Vector3();
const _remoteWorldEnd = new THREE.Vector3();
const _remoteInstanceDirection = new THREE.Vector3();
const _remoteInstanceQuat = new THREE.Quaternion();
const _remoteInstanceDummy = new THREE.Object3D();
const _remoteInstanceColor = new THREE.Color();

function hashRemoteFlamethrowerPhase(playerId: string): number {
  let hash = 2166136261;
  for (let index = 0; index < playerId.length; index++) {
    hash ^= playerId.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) / 0xffffffff) * Math.PI * 2;
}

function createRemoteFlamethrowerRuntimeState(playerId: string, now: number): RemoteFlamethrowerRuntimeState {
  return {
    liveFrame: -1,
    ramp: 0,
    wasLive: false,
    startTimeMs: now,
    poseInitialized: false,
    phase: hashRemoteFlamethrowerPhase(playerId),
    poseOrigin: new THREE.Vector3(),
    poseDirection: new THREE.Vector3(0, 0, -1),
    smoothedOrigin: new THREE.Vector3(),
    smoothedDirection: new THREE.Vector3(0, 0, -1),
    streamPoints: createRopePoints(),
    streamControlA: new THREE.Vector3(),
    streamControlB: new THREE.Vector3(),
    streamLag: new THREE.Vector3(),
  };
}

function updateRemoteFlamethrowerRuntime(
  runtime: RemoteFlamethrowerRuntimeState,
  hasLivePose: boolean,
  delta: number,
  now: number
): boolean {
  const rampStep = delta / (hasLivePose ? FLAMETHROWER_SPIN_UP_DURATION : FLAMETHROWER_SPIN_DOWN_DURATION);
  runtime.ramp = hasLivePose
    ? Math.min(1, runtime.ramp + rampStep)
    : Math.max(0, runtime.ramp - rampStep);

  if (hasLivePose && !runtime.wasLive) {
    runtime.startTimeMs = now;
  }
  runtime.wasLive = hasLivePose;

  if (!hasLivePose && (!runtime.poseInitialized || runtime.ramp <= 0.001)) {
    if (runtime.ramp <= 0.001) {
      runtime.poseInitialized = false;
    }
    return false;
  }

  return runtime.ramp > 0.001;
}

function createInstancedAlphaMaterial(parameters: THREE.MeshBasicMaterialParameters): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial(parameters);
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', `attribute float ${INSTANCE_ALPHA_ATTRIBUTE};\nvarying float vInstanceAlpha;\nvoid main() {`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n  vInstanceAlpha = ${INSTANCE_ALPHA_ATTRIBUTE};`);
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'varying float vInstanceAlpha;\nvoid main() {')
      .replace('#include <color_fragment>', '#include <color_fragment>\n  diffuseColor.a *= vInstanceAlpha;');
  };
  material.customProgramCacheKey = () => 'voxel-strike-instanced-alpha-basic-v1';
  return material;
}

function ensureInstanceAlphaAttribute(mesh: THREE.InstancedMesh, capacity: number): THREE.InstancedBufferAttribute {
  const existing = mesh.geometry.getAttribute(INSTANCE_ALPHA_ATTRIBUTE);
  if (existing instanceof THREE.InstancedBufferAttribute && existing.count >= capacity) {
    return existing;
  }

  const attribute = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
  mesh.geometry.setAttribute(INSTANCE_ALPHA_ATTRIBUTE, attribute);
  return attribute;
}

function clearInstancedMesh(mesh: THREE.InstancedMesh | null): void {
  if (!mesh) return;
  mesh.count = 0;
}

function finalizeInstancedMesh(
  mesh: THREE.InstancedMesh | null,
  alpha: THREE.InstancedBufferAttribute | null,
  count: number
): void {
  if (!mesh || !alpha) return;
  mesh.count = count;
  mesh.instanceMatrix.needsUpdate = true;
  alpha.needsUpdate = true;
  if (mesh.instanceColor) {
    mesh.instanceColor.needsUpdate = true;
  }
}

function setInstanceAlpha(alpha: THREE.InstancedBufferAttribute, index: number, value: number): void {
  alpha.setX(index, value);
}

function canWriteInstance(mesh: THREE.InstancedMesh, alpha: THREE.InstancedBufferAttribute, index: number): boolean {
  return index < alpha.count && index < mesh.instanceMatrix.count;
}

function writeRemoteCylinderInstance(
  mesh: THREE.InstancedMesh | null,
  alpha: THREE.InstancedBufferAttribute | null,
  index: number,
  rootOrigin: THREE.Vector3,
  rootQuat: THREE.Quaternion,
  localStart: THREE.Vector3,
  localEnd: THREE.Vector3,
  radius: number,
  opacity: number
): boolean {
  if (!mesh || !alpha || opacity <= 0.001 || !canWriteInstance(mesh, alpha, index)) return false;

  _remoteWorldStart.copy(localStart).applyQuaternion(rootQuat).add(rootOrigin);
  _remoteWorldEnd.copy(localEnd).applyQuaternion(rootQuat).add(rootOrigin);
  const dx = _remoteWorldEnd.x - _remoteWorldStart.x;
  const dy = _remoteWorldEnd.y - _remoteWorldStart.y;
  const dz = _remoteWorldEnd.z - _remoteWorldStart.z;
  const lengthSq = dx * dx + dy * dy + dz * dz;
  if (lengthSq < 0.0001) return false;

  const segmentLength = Math.sqrt(lengthSq);
  _remoteInstanceDummy.position.set(
    _remoteWorldStart.x + dx * 0.5,
    _remoteWorldStart.y + dy * 0.5,
    _remoteWorldStart.z + dz * 0.5
  );
  _remoteInstanceDirection.set(dx / segmentLength, dy / segmentLength, dz / segmentLength);
  _remoteInstanceQuat.setFromUnitVectors(_defaultAxis, _remoteInstanceDirection);
  _remoteInstanceDummy.quaternion.copy(_remoteInstanceQuat);
  _remoteInstanceDummy.scale.set(radius, segmentLength, radius);
  _remoteInstanceDummy.updateMatrix();
  mesh.setMatrixAt(index, _remoteInstanceDummy.matrix);
  setInstanceAlpha(alpha, index, opacity);
  return true;
}

function writeRemoteTransformInstance(
  mesh: THREE.InstancedMesh | null,
  alpha: THREE.InstancedBufferAttribute | null,
  index: number,
  rootOrigin: THREE.Vector3,
  rootQuat: THREE.Quaternion,
  localPosition: THREE.Vector3,
  localQuat: THREE.Quaternion,
  localScale: THREE.Vector3,
  opacity: number
): boolean {
  if (!mesh || !alpha || opacity <= 0.001 || !canWriteInstance(mesh, alpha, index)) return false;

  _remoteWorldPosition.copy(localPosition).applyQuaternion(rootQuat).add(rootOrigin);
  _remoteInstanceQuat.copy(rootQuat).multiply(localQuat);
  _remoteInstanceDummy.position.copy(_remoteWorldPosition);
  _remoteInstanceDummy.quaternion.copy(_remoteInstanceQuat);
  _remoteInstanceDummy.scale.copy(localScale);
  _remoteInstanceDummy.updateMatrix();
  mesh.setMatrixAt(index, _remoteInstanceDummy.matrix);
  setInstanceAlpha(alpha, index, opacity);
  return true;
}

export const RemoteFlamethrowerInstancedVisuals = React.memo(({
  playerIds,
  capacity,
  poseProvider,
}: RemoteFlamethrowerInstancedVisualsProps) => {
  const groupRef = useRef<THREE.Group>(null);
  const streamHeatRef = useRef<THREE.InstancedMesh>(null);
  const streamOuterRef = useRef<THREE.InstancedMesh>(null);
  const streamCoreRef = useRef<THREE.InstancedMesh>(null);
  const streamPuffRef = useRef<THREE.InstancedMesh>(null);
  const flameRef = useRef<THREE.InstancedMesh>(null);
  const glowRef = useRef<THREE.InstancedMesh>(null);
  const sparkRef = useRef<THREE.InstancedMesh>(null);
  const smokeRef = useRef<THREE.InstancedMesh>(null);
  const runtimeStatesRef = useRef(new Map<string, RemoteFlamethrowerRuntimeState>());
  const activeIdsRef = useRef(new Set<string>());
  const frameIdRef = useRef(0);

  const safeCapacityForRender = Math.max(0, Math.floor(capacity));
  const streamSegmentCapacity = Math.max(1, safeCapacityForRender * REMOTE_STREAM_SEGMENT_INSTANCE_MULTIPLIER);
  const streamPointCapacity = Math.max(1, safeCapacityForRender * REMOTE_STREAM_POINT_INSTANCE_MULTIPLIER);
  const flameCapacity = Math.max(1, safeCapacityForRender * REMOTE_FLAME_INSTANCE_MULTIPLIER);
  const glowCapacity = Math.max(1, safeCapacityForRender);
  const sparkCapacity = Math.max(1, safeCapacityForRender * REMOTE_SPARK_INSTANCE_MULTIPLIER);
  const smokeCapacity = Math.max(1, safeCapacityForRender * REMOTE_SMOKE_INSTANCE_MULTIPLIER);

  const geometries = useMemo(() => ({
    streamHeat: SHARED_GEOMETRIES.cylinder8.clone(),
    streamOuter: SHARED_GEOMETRIES.cylinder8.clone(),
    streamCore: SHARED_GEOMETRIES.cylinder8.clone(),
    streamPuff: SHARED_GEOMETRIES.sphere12.clone(),
    flame: OPEN_FLAME_GEOMETRY.clone(),
    glow: SHARED_GEOMETRIES.sphere8.clone(),
    spark: SHARED_GEOMETRIES.sphere8.clone(),
    smoke: SHARED_GEOMETRIES.sphere8.clone(),
  }), []);

  const materials = useMemo(() => ({
    streamHeat: createInstancedAlphaMaterial({
      color: 0xff2a00,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
    streamOuter: createInstancedAlphaMaterial({
      color: 0xff6a00,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
    streamCore: createInstancedAlphaMaterial({
      color: 0xfff0a8,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
    streamPuff: createInstancedAlphaMaterial({
      color: 0xff7a00,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
    flame: createInstancedAlphaMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
    }),
    glow: createInstancedAlphaMaterial({
      color: 0xff6a00,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
    spark: createInstancedAlphaMaterial({
      color: 0xffdd55,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
    smoke: createInstancedAlphaMaterial({
      color: 0x3a302a,
      transparent: true,
      opacity: 1,
      depthWrite: false,
    }),
  }), []);

  useEffect(() => () => {
    Object.values(geometries).forEach(geometry => geometry.dispose());
    Object.values(materials).forEach(material => material.dispose());
  }, [geometries, materials]);

  useFrame((frameState, delta) => measureFrameWork('frame.effects.remoteBlazeFlamethrowerBatch', () => {
    const group = groupRef.current;
    if (!group) return;

    const safeCapacity = Math.max(0, Math.floor(capacity));
    const heatMesh = streamHeatRef.current;
    const outerMesh = streamOuterRef.current;
    const coreMesh = streamCoreRef.current;
    const puffMesh = streamPuffRef.current;
    const flameMesh = flameRef.current;
    const glowMesh = glowRef.current;
    const sparkMesh = sparkRef.current;
    const smokeMesh = smokeRef.current;

    if (safeCapacity <= 0) {
      clearInstancedMesh(heatMesh);
      clearInstancedMesh(outerMesh);
      clearInstancedMesh(coreMesh);
      clearInstancedMesh(puffMesh);
      clearInstancedMesh(flameMesh);
      clearInstancedMesh(glowMesh);
      clearInstancedMesh(sparkMesh);
      clearInstancedMesh(smokeMesh);
      group.visible = false;
      return;
    }

    const heatAlpha = heatMesh ? ensureInstanceAlphaAttribute(heatMesh, streamSegmentCapacity) : null;
    const outerAlpha = outerMesh ? ensureInstanceAlphaAttribute(outerMesh, streamSegmentCapacity) : null;
    const coreAlpha = coreMesh ? ensureInstanceAlphaAttribute(coreMesh, streamSegmentCapacity) : null;
    const puffAlpha = puffMesh ? ensureInstanceAlphaAttribute(puffMesh, streamPointCapacity) : null;
    const flameAlpha = flameMesh ? ensureInstanceAlphaAttribute(flameMesh, flameCapacity) : null;
    const glowAlpha = glowMesh ? ensureInstanceAlphaAttribute(glowMesh, glowCapacity) : null;
    const sparkAlpha = sparkMesh ? ensureInstanceAlphaAttribute(sparkMesh, sparkCapacity) : null;
    const smokeAlpha = smokeMesh ? ensureInstanceAlphaAttribute(smokeMesh, smokeCapacity) : null;

    let heatCount = 0;
    let outerCount = 0;
    let coreCount = 0;
    let puffCount = 0;
    let flameCount = 0;
    let glowCount = 0;
    let sparkCount = 0;
    let smokeCount = 0;
    let drawnPlayers = 0;
    const now = getFrameClock().nowMs;
    const frameId = ++frameIdRef.current;
    const activeIds = activeIdsRef.current;
    const runtimes = runtimeStatesRef.current;
    activeIds.clear();

    const activeLimit = Math.min(playerIds.length, safeCapacity);
    for (let index = 0; index < activeLimit; index++) {
      const playerId = playerIds[index];
      const pose = poseProvider(playerId);
      if (!pose) continue;

      let runtime = runtimes.get(playerId);
      if (!runtime) {
        runtime = createRemoteFlamethrowerRuntimeState(playerId, now);
        runtimes.set(playerId, runtime);
      }
      runtime.liveFrame = frameId;
      runtime.poseOrigin.set(pose.origin.x, pose.origin.y, pose.origin.z);
      runtime.poseDirection.set(pose.direction.x, pose.direction.y, pose.direction.z);
      activeIds.add(playerId);
    }

    const writeRuntime = (
      runtime: RemoteFlamethrowerRuntimeState,
      hasLivePose: boolean
    ): void => {
      if (drawnPlayers >= safeCapacity) return;
      if (!updateRemoteFlamethrowerRuntime(runtime, hasLivePose, delta, now)) return;

      if (hasLivePose) {
        _remoteOrigin.copy(runtime.poseOrigin);
        _remoteDirection.copy(runtime.poseDirection);
      } else {
        _remoteOrigin.copy(runtime.smoothedOrigin);
        _remoteDirection.copy(runtime.smoothedDirection);
      }

      if (_remoteDirection.lengthSq() < 0.0001) {
        _remoteDirection.set(0, 0, -1);
      }
      _remoteDirection.normalize();

      if (!runtime.poseInitialized) {
        runtime.smoothedOrigin.copy(_remoteOrigin);
        runtime.smoothedDirection.copy(_remoteDirection);
        runtime.poseInitialized = true;
      }

      const originAlpha = 1 - Math.exp(-delta * 7);
      const directionAlpha = 1 - Math.exp(-delta * 10);
      runtime.smoothedOrigin.lerp(_remoteOrigin, originAlpha);
      runtime.smoothedDirection.lerp(_remoteDirection, directionAlpha).normalize();

      _remoteRootQuat.setFromUnitVectors(_defaultAxis, _remoteDirection);
      _remoteInverseQuat.copy(_remoteRootQuat).invert();
      _remoteLag.copy(runtime.smoothedOrigin).sub(_remoteOrigin);
      _remoteLocalLag.copy(_remoteLag).applyQuaternion(_remoteInverseQuat);
      _remoteSmoothedLocalDirection.copy(runtime.smoothedDirection).applyQuaternion(_remoteInverseQuat);

      const elapsed = (now - runtime.startTimeMs) / 1000;
      const time = frameState.clock.elapsedTime + runtime.phase;
      const flicker = 0.88 + Math.sin(time * 34) * 0.08 + Math.sin(time * 71) * 0.04;
      const plumeIntensity = easeOutCubic(runtime.ramp);
      const spin = time * (10 + plumeIntensity * 18);
      const streamPoints = runtime.streamPoints;
      const streamLength = BLAZE_FLAMETHROWER_RANGE * (0.78 + plumeIntensity * 0.18);

      _remoteStreamStart.set(0, FLAME_NOZZLE_VISUAL_OFFSET, 0);
      _remoteStreamEnd.set(
        _remoteLocalLag.x * 0.72 + _remoteSmoothedLocalDirection.x * streamLength * 0.42 + Math.sin(time * 2.1) * 0.08 * plumeIntensity,
        streamLength + THREE.MathUtils.clamp(_remoteLocalLag.y * 0.2, -0.22, 0.22),
        _remoteLocalLag.z * 0.72 + _remoteSmoothedLocalDirection.z * streamLength * 0.42 + Math.cos(time * 2.4) * 0.08 * plumeIntensity
      );
      runtime.streamLag.copy(_remoteLocalLag).multiplyScalar(0.86);
      const streamLagLength = runtime.streamLag.length();
      if (streamLagLength > FLAME_STREAM_MAX_LAG) {
        runtime.streamLag.multiplyScalar(FLAME_STREAM_MAX_LAG / streamLagLength);
      }

      streamPoints[0].copy(_remoteStreamStart);
      streamPoints[PLIABLE_ROPE_SEGMENT_COUNT].copy(_remoteStreamEnd);
      updatePliableRopePoints(
        streamPoints,
        runtime.streamControlA,
        runtime.streamControlB,
        _remoteStreamStart,
        _remoteStreamEnd,
        runtime.streamLag,
        streamLength,
        0.34
      );

      for (let i = 1; i < PLIABLE_ROPE_SEGMENT_COUNT; i++) {
        const t = i / PLIABLE_ROPE_SEGMENT_COUNT;
        const swirlRadius = t * t * (0.34 + plumeIntensity * 0.44);
        const swirlAngle = spin * (0.2 + t * 0.2) + i * 1.36;
        _remoteSwirlOffset.set(
          Math.cos(swirlAngle) * swirlRadius * plumeIntensity,
          Math.sin(time * (5.5 + i) + i) * 0.035 * plumeIntensity,
          Math.sin(swirlAngle) * swirlRadius * plumeIntensity
        );
        streamPoints[i].add(_remoteSwirlOffset);
      }

      for (let sampleIndex = 0; sampleIndex < FLAME_STREAM_SEGMENT_SAMPLES.length; sampleIndex++) {
        const { index: i, t, widthBase, endFade } = FLAME_STREAM_SEGMENT_SAMPLES[sampleIndex];
        const segmentRamp = easeOutCubic(clamp01((runtime.ramp - t * 0.08) / 0.7));
        const widthPulse = flicker + Math.sin(time * (13 + i * 1.7) + i) * 0.08;
        const radius = Math.max(0.001, widthBase * widthPulse * segmentRamp);
        const opacity = endFade * segmentRamp;

        if (writeRemoteCylinderInstance(heatMesh, heatAlpha, heatCount, _remoteOrigin, _remoteRootQuat, streamPoints[i], streamPoints[i + 1], radius * 2.15, 0.08 * opacity)) {
          heatCount++;
        }
        if (writeRemoteCylinderInstance(outerMesh, outerAlpha, outerCount, _remoteOrigin, _remoteRootQuat, streamPoints[i], streamPoints[i + 1], radius * 1.28, 0.22 * opacity)) {
          outerCount++;
        }
        if (writeRemoteCylinderInstance(coreMesh, coreAlpha, coreCount, _remoteOrigin, _remoteRootQuat, streamPoints[i], streamPoints[i + 1], radius * 0.42, 0.54 * opacity)) {
          coreCount++;
        }
      }

      for (let sampleIndex = 0; sampleIndex < FLAME_STREAM_POINT_SAMPLES.length; sampleIndex++) {
        const { index: i, t, sizeBase } = FLAME_STREAM_POINT_SAMPLES[sampleIndex];
        const source = streamPoints[Math.min(i, PLIABLE_ROPE_SEGMENT_COUNT)];
        const puffRamp = easeOutCubic(clamp01((runtime.ramp - t * 0.06) / 0.7));
        const pulse = 0.85 + Math.sin(time * (16 + i) + i * 0.7) * 0.12;
        _remoteLocalScale.setScalar(sizeBase * pulse * puffRamp);
        const opacity = (0.24 + (1 - t) * 0.28) * (1 - THREE.MathUtils.smoothstep(t, 0.78, 1)) * puffRamp;
        if (writeRemoteTransformInstance(puffMesh, puffAlpha, puffCount, _remoteOrigin, _remoteRootQuat, source, REMOTE_IDENTITY_QUAT, _remoteLocalScale, opacity)) {
          puffCount++;
        }
      }

      for (let i = 0; i < FLAME_SEGMENTS.length; i++) {
        const segment = FLAME_SEGMENTS[i];
        const pulse = flicker + Math.sin(time * (18 + i * 3) + i) * 0.06;
        const segmentRamp = easeOutCubic(clamp01((runtime.ramp - i * 0.06) / 0.7));
        const trailLag = segment.lag * segmentRamp;
        const trailX =
          _remoteLocalLag.x * trailLag +
          _remoteSmoothedLocalDirection.x * segment.y * trailLag * 0.45;
        const trailY = Math.max(-0.25, Math.min(0.2, _remoteLocalLag.y * trailLag));
        const trailZ =
          _remoteLocalLag.z * trailLag +
          _remoteSmoothedLocalDirection.z * segment.y * trailLag * 0.45;
        const spinAngle = spin + i * 0.75;
        const spinWobble = Math.sin(spinAngle) * segment.radius * 0.08 * plumeIntensity;
        const pathPoint = sampleStreamPoint(_remotePathPoint, streamPoints, segment.y, streamLength);
        const pathBlend = 0.35 + segmentRamp * 0.65;

        _remoteLocalPosition.set(
          pathPoint.x * pathBlend + trailX * 0.38 + spinWobble + Math.sin(time * (9 + i) + i) * segment.radius * 0.14,
          pathPoint.y * pathBlend + trailY,
          pathPoint.z * pathBlend + trailZ * 0.38 + Math.cos(spinAngle) * segment.radius * 0.08 * plumeIntensity +
            Math.cos(time * (7 + i) + i) * segment.radius * 0.14
        );
        _remoteLocalScale.set(
          Math.max(0.001, segment.radius * pulse * segmentRamp),
          Math.max(0.001, segment.length * pulse * (0.2 + segmentRamp * 0.8)),
          Math.max(0.001, segment.radius * pulse * segmentRamp)
        );
        _remoteEuler.set(Math.PI, spinAngle, 0);
        _remoteLocalQuat.setFromEuler(_remoteEuler);
        const opacity = segment.opacity * Math.min(1, pulse + 0.05) * segmentRamp;
        if (writeRemoteTransformInstance(flameMesh, flameAlpha, flameCount, _remoteOrigin, _remoteRootQuat, _remoteLocalPosition, _remoteLocalQuat, _remoteLocalScale, opacity)) {
          flameMesh?.setColorAt(flameCount, _remoteInstanceColor.setHex(segment.color));
          flameCount++;
        }
      }

      const glowPulse = 1 + Math.sin(time * 28) * 0.12;
      _remoteLocalPosition.set(
        _remoteLocalLag.x * 0.32 + _remoteSmoothedLocalDirection.x * BLAZE_FLAMETHROWER_RANGE * 0.12,
        BLAZE_FLAMETHROWER_RANGE * 0.32,
        _remoteLocalLag.z * 0.32 + _remoteSmoothedLocalDirection.z * BLAZE_FLAMETHROWER_RANGE * 0.12
      );
      _remoteLocalScale.set(
        Math.max(0.001, 0.7 * glowPulse * plumeIntensity),
        BLAZE_FLAMETHROWER_RANGE * 0.48 * (0.25 + plumeIntensity * 0.75),
        Math.max(0.001, 0.7 * glowPulse * plumeIntensity)
      );
      if (writeRemoteTransformInstance(glowMesh, glowAlpha, glowCount, _remoteOrigin, _remoteRootQuat, _remoteLocalPosition, REMOTE_IDENTITY_QUAT, _remoteLocalScale, (0.055 + flicker * 0.02) * plumeIntensity)) {
        glowCount++;
      }

      for (let i = 0; i < FLAME_SPARKS.length; i++) {
        const data = FLAME_SPARKS[i];
        const cycle = (elapsed * data.speed + data.phase) % 1;
        const distance = 0.5 + cycle * (BLAZE_FLAMETHROWER_RANGE * 0.85);
        const spread = cycle * cycle * 1.65;
        const lag = 0.18 + cycle * 0.8;
        const sparkRamp = easeOutCubic(clamp01((runtime.ramp - 0.1) / 0.65));
        const spinAngle = spin * 1.25 + i * 0.9 + cycle * Math.PI * 2;

        _remoteLocalPosition.set(
          _remoteLocalLag.x * lag +
            _remoteSmoothedLocalDirection.x * distance * lag * 0.35 +
            data.side * spread * data.drift +
            Math.cos(spinAngle) * spread * 0.18 * sparkRamp +
            Math.sin(time * 14 + i) * 0.05,
          distance * (0.3 + sparkRamp * 0.7),
          _remoteLocalLag.z * lag +
            _remoteSmoothedLocalDirection.z * distance * lag * 0.35 +
            Math.sin(spinAngle) * spread * 0.18 * sparkRamp +
            Math.cos(time * 11 + i) * spread * 0.12
        );
        _remoteLocalScale.setScalar(cycle < 0.85 ? data.size * (1 + cycle * 1.2) * sparkRamp : 0);
        if (writeRemoteTransformInstance(sparkMesh, sparkAlpha, sparkCount, _remoteOrigin, _remoteRootQuat, _remoteLocalPosition, REMOTE_IDENTITY_QUAT, _remoteLocalScale, Math.max(0, 0.9 - cycle) * sparkRamp)) {
          sparkCount++;
        }
      }

      for (let i = 0; i < SMOKE_PUFFS.length; i++) {
        const data = SMOKE_PUFFS[i];
        const cycle = (elapsed * 0.9 + data.phase) % 1;
        const distance = 2.4 + cycle * (BLAZE_FLAMETHROWER_RANGE * 0.45);
        const spread = cycle * 2.0;
        const lag = 0.42 + cycle * 0.95;
        const smokeRamp = easeOutCubic(clamp01((runtime.ramp - 0.18) / 0.7));

        _remoteLocalPosition.set(
          _remoteLocalLag.x * lag +
            _remoteSmoothedLocalDirection.x * distance * lag * 0.28 +
            data.drift * spread,
          distance * (0.45 + smokeRamp * 0.55),
          _remoteLocalLag.z * lag +
            _remoteSmoothedLocalDirection.z * distance * lag * 0.28 +
            data.rise * spread
        );
        _remoteLocalScale.setScalar((data.size + cycle * 0.28) * smokeRamp);
        if (writeRemoteTransformInstance(smokeMesh, smokeAlpha, smokeCount, _remoteOrigin, _remoteRootQuat, _remoteLocalPosition, REMOTE_IDENTITY_QUAT, _remoteLocalScale, Math.max(0, 0.28 - cycle * 0.28) * smokeRamp)) {
          smokeCount++;
        }
      }

      drawnPlayers++;
    };

    for (let index = 0; index < activeLimit; index++) {
      const runtime = runtimes.get(playerIds[index]);
      if (!runtime || runtime.liveFrame !== frameId) continue;
      writeRuntime(runtime, true);
    }

    for (const [playerId, runtime] of runtimes) {
      if (activeIds.has(playerId)) continue;
      const beforeDrawn = drawnPlayers;
      writeRuntime(runtime, false);
      if (runtime.ramp <= 0.001 && runtime.liveFrame !== frameId) {
        runtimes.delete(playerId);
      } else if (beforeDrawn === drawnPlayers && drawnPlayers >= safeCapacity) {
        updateRemoteFlamethrowerRuntime(runtime, false, delta, now);
      }
    }

    finalizeInstancedMesh(heatMesh, heatAlpha, heatCount);
    finalizeInstancedMesh(outerMesh, outerAlpha, outerCount);
    finalizeInstancedMesh(coreMesh, coreAlpha, coreCount);
    finalizeInstancedMesh(puffMesh, puffAlpha, puffCount);
    finalizeInstancedMesh(flameMesh, flameAlpha, flameCount);
    finalizeInstancedMesh(glowMesh, glowAlpha, glowCount);
    finalizeInstancedMesh(sparkMesh, sparkAlpha, sparkCount);
    finalizeInstancedMesh(smokeMesh, smokeAlpha, smokeCount);

    group.visible =
      heatCount > 0 ||
      outerCount > 0 ||
      coreCount > 0 ||
      puffCount > 0 ||
      flameCount > 0 ||
      glowCount > 0 ||
      sparkCount > 0 ||
      smokeCount > 0;
  }));

  return (
    <group ref={groupRef} visible={false}>
      <instancedMesh
        key={`remote-flame-stream-heat-${streamSegmentCapacity}`}
        ref={streamHeatRef}
        args={[geometries.streamHeat, materials.streamHeat, streamSegmentCapacity]}
        frustumCulled={false}
        onUpdate={mesh => {
          ensureInstanceAlphaAttribute(mesh, streamSegmentCapacity);
          mesh.count = 0;
        }}
      />
      <instancedMesh
        key={`remote-flame-stream-outer-${streamSegmentCapacity}`}
        ref={streamOuterRef}
        args={[geometries.streamOuter, materials.streamOuter, streamSegmentCapacity]}
        frustumCulled={false}
        onUpdate={mesh => {
          ensureInstanceAlphaAttribute(mesh, streamSegmentCapacity);
          mesh.count = 0;
        }}
      />
      <instancedMesh
        key={`remote-flame-stream-core-${streamSegmentCapacity}`}
        ref={streamCoreRef}
        args={[geometries.streamCore, materials.streamCore, streamSegmentCapacity]}
        frustumCulled={false}
        onUpdate={mesh => {
          ensureInstanceAlphaAttribute(mesh, streamSegmentCapacity);
          mesh.count = 0;
        }}
      />
      <instancedMesh
        key={`remote-flame-stream-puff-${streamPointCapacity}`}
        ref={streamPuffRef}
        args={[geometries.streamPuff, materials.streamPuff, streamPointCapacity]}
        frustumCulled={false}
        onUpdate={mesh => {
          ensureInstanceAlphaAttribute(mesh, streamPointCapacity);
          mesh.count = 0;
        }}
      />
      <instancedMesh
        key={`remote-flame-cones-${flameCapacity}`}
        ref={flameRef}
        args={[geometries.flame, materials.flame, flameCapacity]}
        frustumCulled={false}
        onUpdate={mesh => {
          ensureInstanceAlphaAttribute(mesh, flameCapacity);
          mesh.count = 0;
        }}
      />
      <instancedMesh
        key={`remote-flame-glow-${glowCapacity}`}
        ref={glowRef}
        args={[geometries.glow, materials.glow, glowCapacity]}
        frustumCulled={false}
        onUpdate={mesh => {
          ensureInstanceAlphaAttribute(mesh, glowCapacity);
          mesh.count = 0;
        }}
      />
      <instancedMesh
        key={`remote-flame-sparks-${sparkCapacity}`}
        ref={sparkRef}
        args={[geometries.spark, materials.spark, sparkCapacity]}
        frustumCulled={false}
        onUpdate={mesh => {
          ensureInstanceAlphaAttribute(mesh, sparkCapacity);
          mesh.count = 0;
        }}
      />
      <instancedMesh
        key={`remote-flame-smoke-${smokeCapacity}`}
        ref={smokeRef}
        args={[geometries.smoke, materials.smoke, smokeCapacity]}
        frustumCulled={false}
        onUpdate={mesh => {
          ensureInstanceAlphaAttribute(mesh, smokeCapacity);
          mesh.count = 0;
        }}
      />
    </group>
  );
}, (prev, next) => (
  prev.playerIds === next.playerIds &&
  prev.capacity === next.capacity &&
  prev.poseProvider === next.poseProvider
));

export const FlamethrowerEffect = React.memo(({
  isActive,
  poseProvider,
  ownerId,
  ownerTeam,
  enableCollisionEffects = true,
}: FlamethrowerEffectProps) => {
  const groupRef = useRef<THREE.Group>(null);
  const flameRefs = useRef<(THREE.Mesh | null)[]>([]);
  const streamHeatRefs = useRef<(THREE.Mesh | null)[]>([]);
  const streamOuterRefs = useRef<(THREE.Mesh | null)[]>([]);
  const streamCoreRefs = useRef<(THREE.Mesh | null)[]>([]);
  const streamPuffRefs = useRef<(THREE.Mesh | null)[]>([]);
  const glowRef = useRef<THREE.Mesh>(null);
  const sparkRefs = useRef<(THREE.Mesh | null)[]>([]);
  const smokeRefs = useRef<(THREE.Mesh | null)[]>([]);
  const lightRef = useRef<THREE.PointLight>(null);
  const startTimeRef = useRef(getFrameClock().nowMs);
  const lastTerrainImpactRef = useRef(0);
  const smoothedOriginRef = useRef(new THREE.Vector3());
  const smoothedDirectionRef = useRef(new THREE.Vector3(0, 0, -1));
  const poseInitializedRef = useRef(false);
  const rampRef = useRef(0);
  const wasLiveRef = useRef(false);
  const streamPointsRef = useRef(createRopePoints());
  const streamControlARef = useRef(new THREE.Vector3());
  const streamControlBRef = useRef(new THREE.Vector3());
  const streamLagRef = useRef(new THREE.Vector3());
  const lastCollisionSampleRef = useRef(0);
  const cachedImpactHitRef = useRef<FlamethrowerImpactHit | null>(null);
  const terrainHitRef = useRef<RaycastDirectionHitResult>({
    hit: false,
    point: { x: 0, y: 0, z: 0 },
    normal: { x: 0, y: 1, z: 0 },
    distance: 0,
    isWalkable: false,
  });
  // Persistent cone-damage config reused every channeling frame. Static fields are
  // set once here; only origin/direction/range/source are mutated per frame below.
  // applyTutorialOfflineTrainingConeDamage reads the input synchronously and copies
  // out the values it retains, so reusing this object is safe.
  const coneDamageConfigRef = useRef({
    origin: { x: 0, y: 0, z: 0 },
    direction: { x: 0, y: 0, z: 0 },
    range: 0,
    coneDot: Math.cos(BLAZE_FLAMETHROWER_CONE_HALF_ANGLE),
    extraRadius: BLAZE_FLAMETHROWER_COLLISION_RADIUS,
    damage: BLAZE_FLAMETHROWER_DAMAGE,
    damageType: 'flamethrower',
    sourceId: '' as string,
    sourceTeam: null as Team | null,
    abilityId: 'blaze_flamethrower',
    falloffScale: 0.35,
    damageIntervalMs: BLAZE_FLAMETHROWER_DAMAGE_INTERVAL,
    burn: {
      damage: BLAZE_FLAMETHROWER_BURN_DAMAGE,
      damageType: 'burn',
      ticks: BLAZE_FLAMETHROWER_BURN_TICKS,
      intervalMs: BLAZE_FLAMETHROWER_BURN_INTERVAL_MS,
      abilityId: 'blaze_flamethrower',
    },
  });

  useFrame((state, delta) => measureFrameWork('frame.effects.blazeFlamethrower', () => {
    if (!groupRef.current) return;

    // Pose acquisition only matters when active: hasLivePose requires isActive,
    // and the resolved origin/direction are only read inside the hasLivePose
    // branch below. Skipping it while idle avoids the poseProvider allocation and
    // store read every frame the weapon is holstered/ramping down.
    const providedPose = isActive ? (poseProvider?.() ?? null) : null;
    const storeState = isActive && !providedPose ? visualStore.getState() : null;
    const flamethrowerOrigin = providedPose
      ? providedPose.origin
      : storeState?.flamethrowerOrigin ?? null;
    const flamethrowerDirection = providedPose
      ? providedPose.direction
      : storeState
        ? storeState.flamethrowerDirection
        : FLAMETHROWER_FALLBACK_DIRECTION;
    const hasLivePose = isActive && Boolean(flamethrowerOrigin);
    const rampStep = delta / (hasLivePose ? FLAMETHROWER_SPIN_UP_DURATION : FLAMETHROWER_SPIN_DOWN_DURATION);
    rampRef.current = hasLivePose
      ? Math.min(1, rampRef.current + rampStep)
      : Math.max(0, rampRef.current - rampStep);

    if (!hasLivePose && (!poseInitializedRef.current || rampRef.current <= 0.001)) {
      groupRef.current.visible = false;
      if (rampRef.current <= 0.001) {
        poseInitializedRef.current = false;
      }
      wasLiveRef.current = false;
      return;
    }
    groupRef.current.visible = true;

    if (hasLivePose && flamethrowerOrigin) {
      _origin.set(flamethrowerOrigin.x, flamethrowerOrigin.y, flamethrowerOrigin.z);
      _direction.set(flamethrowerDirection.x, flamethrowerDirection.y, flamethrowerDirection.z);
    } else {
      _origin.copy(smoothedOriginRef.current);
      _direction.copy(smoothedDirectionRef.current);
    }

    if (_direction.lengthSq() < 0.0001) {
      _direction.set(0, 0, -1);
    }
    _direction.normalize();

    const now = getFrameClock().nowMs;
    const game = enableCollisionEffects ? useGameStore.getState() : null;
    const owner = enableCollisionEffects
      ? ownerId
        ? game?.players.get(ownerId)
        : game?.localPlayer
      : null;
    const activeOwnerId = enableCollisionEffects
      ? ownerId ?? game?.localPlayer?.id ?? game?.playerId ?? ''
      : '';
    const activeOwnerTeam = enableCollisionEffects
      ? ownerTeam ?? owner?.team ?? null
      : null;

    if (hasLivePose && !wasLiveRef.current) {
      startTimeRef.current = now;
    }
    wasLiveRef.current = hasLivePose;

    const shouldSampleCollision = enableCollisionEffects &&
      hasLivePose &&
      rampRef.current > 0.35 &&
      (now - lastCollisionSampleRef.current >= FLAMETHROWER_COLLISION_SAMPLE_INTERVAL_MS || !cachedImpactHitRef.current);

    if (!enableCollisionEffects || !hasLivePose || rampRef.current <= 0.05) {
      cachedImpactHitRef.current = null;
    } else if (shouldSampleCollision) {
      lastCollisionSampleRef.current = now;
      const aegisHit = getFirstChronosAegisVisualHit(
        _origin,
        _direction,
        BLAZE_FLAMETHROWER_RANGE,
        activeOwnerTeam,
        activeOwnerId,
        BLAZE_FLAMETHROWER_COLLISION_RADIUS
      );
      const terrainHit = terrainHitRef.current;
      const terrainHitActive = raycastDirectionInto(
        terrainHit,
        _origin.x, _origin.y, _origin.z,
        _direction.x, _direction.y, _direction.z,
        BLAZE_FLAMETHROWER_RANGE,
        {
          priority: 'visual',
          feature: 'effect:blazeFlamethrower',
        }
      );

      cachedImpactHitRef.current = aegisHit && (!terrainHitActive || aegisHit.distance <= terrainHit.distance)
        ? copyImpactHit(aegisHit.point, aegisHit.normal, aegisHit.distance)
        : terrainHitActive
          ? copyImpactHit(terrainHit.point, terrainHit.normal, terrainHit.distance)
          : null;
    }

    const impactHit = cachedImpactHitRef.current;
    const collisionRange = impactHit
      ? Math.max(FLAME_NOZZLE_VISUAL_OFFSET + 0.35, impactHit.distance)
      : BLAZE_FLAMETHROWER_RANGE;

    if (enableCollisionEffects && hasLivePose && rampRef.current > 0.35) {
      const coneConfig = coneDamageConfigRef.current;
      coneConfig.origin.x = _origin.x;
      coneConfig.origin.y = _origin.y;
      coneConfig.origin.z = _origin.z;
      coneConfig.direction.x = _direction.x;
      coneConfig.direction.y = _direction.y;
      coneConfig.direction.z = _direction.z;
      coneConfig.range = collisionRange;
      coneConfig.sourceId = activeOwnerId;
      coneConfig.sourceTeam = activeOwnerTeam;
      applyTutorialOfflineTrainingConeDamage(coneConfig);
    }

    if (enableCollisionEffects && impactHit && now - lastTerrainImpactRef.current > FLAMETHROWER_TERRAIN_IMPACT_INTERVAL_MS) {
      lastTerrainImpactRef.current = now;
      triggerTerrainImpact('blaze_flamethrower', impactHit.point, {
        normal: impactHit.normal,
        direction: { x: _direction.x, y: _direction.y, z: _direction.z },
        scale: 1 + Math.max(0, 1 - impactHit.distance / BLAZE_FLAMETHROWER_RANGE) * 0.35,
      });
    }

    if (!poseInitializedRef.current) {
      smoothedOriginRef.current.copy(_origin);
      smoothedDirectionRef.current.copy(_direction);
      poseInitializedRef.current = true;
    }

    const originAlpha = 1 - Math.exp(-delta * 7);
    const directionAlpha = 1 - Math.exp(-delta * 10);
    smoothedOriginRef.current.lerp(_origin, originAlpha);
    smoothedDirectionRef.current.lerp(_direction, directionAlpha).normalize();

    groupRef.current.position.copy(_origin);
    _quat.setFromUnitVectors(_defaultAxis, _direction);
    groupRef.current.quaternion.copy(_quat);
    _inverseQuat.copy(_quat).invert();
    _lag.copy(smoothedOriginRef.current).sub(_origin);
    _localLag.copy(_lag).applyQuaternion(_inverseQuat);
    _smoothedLocalDirection.copy(smoothedDirectionRef.current).applyQuaternion(_inverseQuat);

    const elapsed = (now - startTimeRef.current) / 1000;
    const time = state.clock.elapsedTime;
    const flicker = 0.88 + Math.sin(time * 34) * 0.08 + Math.sin(time * 71) * 0.04;
    const plumeIntensity = easeOutCubic(rampRef.current);
    const spin = time * (10 + plumeIntensity * 18);
    const streamPoints = streamPointsRef.current;
    const streamLength = collisionRange * (0.78 + plumeIntensity * 0.18);

    _streamStart.set(0, FLAME_NOZZLE_VISUAL_OFFSET, 0);
    _streamEnd.set(
      _localLag.x * 0.72 + _smoothedLocalDirection.x * streamLength * 0.42 + Math.sin(time * 2.1) * 0.08 * plumeIntensity,
      streamLength + THREE.MathUtils.clamp(_localLag.y * 0.2, -0.22, 0.22),
      _localLag.z * 0.72 + _smoothedLocalDirection.z * streamLength * 0.42 + Math.cos(time * 2.4) * 0.08 * plumeIntensity
    );
    streamLagRef.current.copy(_localLag).multiplyScalar(0.86);
    const streamLagLength = streamLagRef.current.length();
    if (streamLagLength > FLAME_STREAM_MAX_LAG) {
      streamLagRef.current.multiplyScalar(FLAME_STREAM_MAX_LAG / streamLagLength);
    }

    streamPoints[0].copy(_streamStart);
    streamPoints[PLIABLE_ROPE_SEGMENT_COUNT].copy(_streamEnd);
    updatePliableRopePoints(
      streamPoints,
      streamControlARef.current,
      streamControlBRef.current,
      _streamStart,
      _streamEnd,
      streamLagRef.current,
      streamLength,
      0.34
    );

    for (let i = 1; i < PLIABLE_ROPE_SEGMENT_COUNT; i++) {
      const t = i / PLIABLE_ROPE_SEGMENT_COUNT;
      const swirlRadius = t * t * (0.34 + plumeIntensity * 0.44);
      const swirlAngle = spin * (0.2 + t * 0.2) + i * 1.36;
      _swirlOffset.set(
        Math.cos(swirlAngle) * swirlRadius * plumeIntensity,
        Math.sin(time * (5.5 + i) + i) * 0.035 * plumeIntensity,
        Math.sin(swirlAngle) * swirlRadius * plumeIntensity
      );
      streamPoints[i].add(_swirlOffset);
    }

    for (let sampleIndex = 0; sampleIndex < FLAME_STREAM_SEGMENT_SAMPLES.length; sampleIndex++) {
      const { index: i, t, widthBase, endFade } = FLAME_STREAM_SEGMENT_SAMPLES[sampleIndex];
      const segmentRamp = easeOutCubic(clamp01((rampRef.current - t * 0.08) / 0.7));
      const widthPulse = flicker + Math.sin(time * (13 + i * 1.7) + i) * 0.08;
      const radius = Math.max(0.001, widthBase * widthPulse * segmentRamp);
      const opacity = endFade * segmentRamp;

      updateRopeSegment(streamHeatRefs.current[i], streamPoints[i], streamPoints[i + 1], radius * 2.15);
      updateRopeSegment(streamOuterRefs.current[i], streamPoints[i], streamPoints[i + 1], radius * 1.28);
      updateRopeSegment(streamCoreRefs.current[i], streamPoints[i], streamPoints[i + 1], radius * 0.42);

      const heat = streamHeatRefs.current[i];
      if (heat) {
        heat.visible = segmentRamp > 0.01;
        (heat.material as THREE.MeshBasicMaterial).opacity = 0.08 * opacity;
      }
      const outer = streamOuterRefs.current[i];
      if (outer) {
        outer.visible = segmentRamp > 0.01;
        (outer.material as THREE.MeshBasicMaterial).opacity = 0.22 * opacity;
      }
      const core = streamCoreRefs.current[i];
      if (core) {
        core.visible = segmentRamp > 0.01;
        (core.material as THREE.MeshBasicMaterial).opacity = 0.54 * opacity;
      }
    }

    for (let sampleIndex = 0; sampleIndex < FLAME_STREAM_POINT_SAMPLES.length; sampleIndex++) {
      const { index: i, t, sizeBase } = FLAME_STREAM_POINT_SAMPLES[sampleIndex];
      const puff = streamPuffRefs.current[i];
      if (!puff) continue;
      const source = streamPoints[Math.min(i, PLIABLE_ROPE_SEGMENT_COUNT)];
      const puffRamp = easeOutCubic(clamp01((rampRef.current - t * 0.06) / 0.7));
      const pulse = 0.85 + Math.sin(time * (16 + i) + i * 0.7) * 0.12;

      puff.visible = puffRamp > 0.01;
      puff.position.copy(source);
      puff.scale.setScalar(sizeBase * pulse * puffRamp);
      (puff.material as THREE.MeshBasicMaterial).opacity =
        (0.24 + (1 - t) * 0.28) * (1 - THREE.MathUtils.smoothstep(t, 0.78, 1)) * puffRamp;
    }

    for (let i = 0; i < FLAME_SEGMENTS.length; i++) {
      const flame = flameRefs.current[i];
      if (!flame) continue;
      const segment = FLAME_SEGMENTS[i];
      const pulse = flicker + Math.sin(time * (18 + i * 3) + i) * 0.06;
      const segmentRamp = easeOutCubic(clamp01((rampRef.current - i * 0.06) / 0.7));
      const trailLag = segment.lag * segmentRamp;
      const trailX =
        _localLag.x * trailLag +
        _smoothedLocalDirection.x * segment.y * trailLag * 0.45;
      const trailY = Math.max(-0.25, Math.min(0.2, _localLag.y * trailLag));
      const trailZ =
        _localLag.z * trailLag +
        _smoothedLocalDirection.z * segment.y * trailLag * 0.45;
      const spinAngle = spin + i * 0.75;
      const spinWobble = Math.sin(spinAngle) * segment.radius * 0.08 * plumeIntensity;
      const pathPoint = sampleStreamPoint(_pathPoint, streamPoints, segment.y, streamLength);
      const pathBlend = 0.35 + segmentRamp * 0.65;

      flame.visible = segmentRamp > 0.01;
      flame.rotation.y = spinAngle;
      flame.position.set(
        pathPoint.x * pathBlend + trailX * 0.38 + spinWobble + Math.sin(time * (9 + i) + i) * segment.radius * 0.14,
        pathPoint.y * pathBlend + trailY,
        pathPoint.z * pathBlend + trailZ * 0.38 + Math.cos(spinAngle) * segment.radius * 0.08 * plumeIntensity +
          Math.cos(time * (7 + i) + i) * segment.radius * 0.14
      );
      flame.scale.set(
        Math.max(0.001, segment.radius * pulse * segmentRamp),
        Math.max(0.001, segment.length * pulse * (0.2 + segmentRamp * 0.8)),
        Math.max(0.001, segment.radius * pulse * segmentRamp)
      );
      (flame.material as THREE.MeshBasicMaterial).opacity =
        segment.opacity * Math.min(1, pulse + 0.05) * segmentRamp;
    }

    if (glowRef.current) {
      const glowPulse = 1 + Math.sin(time * 28) * 0.12;
      glowRef.current.visible = plumeIntensity > 0.01;
      glowRef.current.position.set(
        _localLag.x * 0.32 + _smoothedLocalDirection.x * BLAZE_FLAMETHROWER_RANGE * 0.12,
        BLAZE_FLAMETHROWER_RANGE * 0.32,
        _localLag.z * 0.32 + _smoothedLocalDirection.z * BLAZE_FLAMETHROWER_RANGE * 0.12
      );
      glowRef.current.scale.set(
        Math.max(0.001, 0.7 * glowPulse * plumeIntensity),
        BLAZE_FLAMETHROWER_RANGE * 0.48 * (0.25 + plumeIntensity * 0.75),
        Math.max(0.001, 0.7 * glowPulse * plumeIntensity)
      );
      (glowRef.current.material as THREE.MeshBasicMaterial).opacity =
        (0.055 + flicker * 0.02) * plumeIntensity;
    }

    for (let i = 0; i < FLAME_SPARKS.length; i++) {
      const spark = sparkRefs.current[i];
      if (!spark) continue;
      const data = FLAME_SPARKS[i];
      const cycle = (elapsed * data.speed + data.phase) % 1;
      const distance = 0.5 + cycle * (BLAZE_FLAMETHROWER_RANGE * 0.85);
      const spread = cycle * cycle * 1.65;
      const lag = 0.18 + cycle * 0.8;
      const sparkRamp = easeOutCubic(clamp01((rampRef.current - 0.1) / 0.65));
      const spinAngle = spin * 1.25 + i * 0.9 + cycle * Math.PI * 2;

      spark.visible = sparkRamp > 0.01;
      spark.position.set(
        _localLag.x * lag +
          _smoothedLocalDirection.x * distance * lag * 0.35 +
          data.side * spread * data.drift +
          Math.cos(spinAngle) * spread * 0.18 * sparkRamp +
          Math.sin(time * 14 + i) * 0.05,
        distance * (0.3 + sparkRamp * 0.7),
        _localLag.z * lag +
          _smoothedLocalDirection.z * distance * lag * 0.35 +
          Math.sin(spinAngle) * spread * 0.18 * sparkRamp +
          Math.cos(time * 11 + i) * spread * 0.12
      );
      spark.scale.setScalar(cycle < 0.85 ? data.size * (1 + cycle * 1.2) * sparkRamp : 0);
      (spark.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.9 - cycle) * sparkRamp;
    }

    for (let i = 0; i < SMOKE_PUFFS.length; i++) {
      const smoke = smokeRefs.current[i];
      if (!smoke) continue;
      const data = SMOKE_PUFFS[i];
      const cycle = (elapsed * 0.9 + data.phase) % 1;
      const distance = 2.4 + cycle * (BLAZE_FLAMETHROWER_RANGE * 0.45);
      const spread = cycle * 2.0;
      const lag = 0.42 + cycle * 0.95;
      const smokeRamp = easeOutCubic(clamp01((rampRef.current - 0.18) / 0.7));

      smoke.visible = smokeRamp > 0.01;
      smoke.position.set(
        _localLag.x * lag +
          _smoothedLocalDirection.x * distance * lag * 0.28 +
          data.drift * spread,
        distance * (0.45 + smokeRamp * 0.55),
        _localLag.z * lag +
          _smoothedLocalDirection.z * distance * lag * 0.28 +
          data.rise * spread
      );
      smoke.scale.setScalar((data.size + cycle * 0.28) * smokeRamp);
      (smoke.material as THREE.MeshBasicMaterial).opacity =
        Math.max(0, 0.28 - cycle * 0.28) * smokeRamp;
    }

    if (lightRef.current) {
      lightRef.current.position.y = BLAZE_FLAMETHROWER_RANGE * 0.35;
      lightRef.current.intensity = (2 + flicker * 1.5) * plumeIntensity;
    }
  }));

  if (getFrameClock().nowMs - startTimeRef.current > 5000) {
    startTimeRef.current = getFrameClock().nowMs;
  }

  return (
    <group ref={groupRef} visible={false}>
      {ROPE_SEGMENT_INDICES.map(i => (
        <mesh key={`stream-heat-${i}`} ref={el => streamHeatRefs.current[i] = el} geometry={SHARED_GEOMETRIES.cylinder8}>
          <meshBasicMaterial color={0xff2a00} transparent opacity={0.08} depthWrite={false} blending={THREE.AdditiveBlending} />
        </mesh>
      ))}
      {ROPE_SEGMENT_INDICES.map(i => (
        <mesh key={`stream-outer-${i}`} ref={el => streamOuterRefs.current[i] = el} geometry={SHARED_GEOMETRIES.cylinder8}>
          <meshBasicMaterial color={0xff6a00} transparent opacity={0.22} depthWrite={false} blending={THREE.AdditiveBlending} />
        </mesh>
      ))}
      {ROPE_SEGMENT_INDICES.map(i => (
        <mesh key={`stream-core-${i}`} ref={el => streamCoreRefs.current[i] = el} geometry={SHARED_GEOMETRIES.cylinder8}>
          <meshBasicMaterial color={0xfff0a8} transparent opacity={0.5} depthWrite={false} blending={THREE.AdditiveBlending} />
        </mesh>
      ))}
      {FLAME_STREAM_POINT_INDICES.map(i => (
        <mesh
          key={`stream-puff-${i}`}
          ref={el => streamPuffRefs.current[i] = el}
          geometry={SHARED_GEOMETRIES.sphere12}
        >
          <meshBasicMaterial color={i < 3 ? 0xfff2b0 : 0xff5a00} transparent opacity={0.28} depthWrite={false} blending={THREE.AdditiveBlending} />
        </mesh>
      ))}

      {FLAME_SEGMENTS.map((segment, i) => (
        <mesh
          key={`flame-${i}`}
          ref={el => flameRefs.current[i] = el}
          geometry={OPEN_FLAME_GEOMETRY}
          rotation-x={Math.PI}
        >
          <meshBasicMaterial
            color={segment.color}
            transparent
            opacity={segment.opacity}
            depthWrite={false}
            side={THREE.DoubleSide}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
      ))}

      <mesh ref={glowRef} position={[0, BLAZE_FLAMETHROWER_RANGE * 0.32, 0]} geometry={SHARED_GEOMETRIES.sphere8}>
        <meshBasicMaterial color={0xff6a00} transparent opacity={0.08} depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>

      {FLAME_SPARKS.map((_, i) => (
        <mesh
          key={`spark-${i}`}
          ref={el => sparkRefs.current[i] = el}
          geometry={SHARED_GEOMETRIES.sphere8}
        >
          <meshBasicMaterial color={0xffdd55} transparent opacity={0.8} />
        </mesh>
      ))}

      {SMOKE_PUFFS.map((_, i) => (
        <mesh
          key={`smoke-${i}`}
          ref={el => smokeRefs.current[i] = el}
          geometry={SHARED_GEOMETRIES.sphere8}
        >
          <meshBasicMaterial color={0x3a302a} transparent opacity={0.2} depthWrite={false} />
        </mesh>
      ))}

      <BudgetedPointLight budgetPriority={4} ref={lightRef} color={0xff7a00} intensity={8} distance={10} decay={2} />
    </group>
  );
}, (prev, next) => prev.isActive === next.isActive);

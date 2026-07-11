import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import {
  BLAZE_AFTERBURNER_MAX_TRAIL_POINTS,
  BLAZE_AFTERBURNER_TRAIL_DAMAGE,
  BLAZE_AFTERBURNER_TRAIL_DAMAGE_INTERVAL_MS,
  BLAZE_AFTERBURNER_TRAIL_RADIUS,
  BLAZE_AFTERBURNER_TRAIL_SAMPLE_SPACING,
} from '@voxel-strike/shared';
import { checkGroundWithNormal } from '../../../hooks/usePhysics';
import { useGameStore } from '../../../store/gameStore';
import { visualStore } from '../../../store/visualStore';
import { getFrameClock } from '../../../utils/frameClock';
import { applyTutorialOfflineTrainingTrailDamage } from '../../../utils/tutorialOfflineCombatRuntime';
import { BLAZE_COLORS, SHARED_GEOMETRIES } from '../effectResources';

interface AfterburnerTrailPoint {
  position: { x: number; y: number; z: number };
  spawnedAt: number;
  seed: number;
}

interface AfterburnerTrailData {
  id: string;
  playerId: string;
  startTime: number;
  dashEndsAt: number;
  expiresAt: number;
  lastSourcePosition: { x: number; y: number; z: number };
  points: AfterburnerTrailPoint[];
  lastDamageTick: Map<string, number>;
  samplingComplete: boolean;
}

export interface AfterburnerTrailTrigger {
  id?: string;
  playerId: string;
  startPosition: { x: number; y: number; z: number };
  dashDurationMs: number;
  trailDurationMs: number;
}

const MAX_AFTERBURNER_TRAILS = 10;
const MAX_POINTS_PER_TRAIL = BLAZE_AFTERBURNER_MAX_TRAIL_POINTS;
const POINT_SAMPLE_SPACING = BLAZE_AFTERBURNER_TRAIL_SAMPLE_SPACING;
const SIDE_FLAMES_PER_POINT = 3;
const EMBERS_PER_POINT = 3;
const MAX_POINT_INSTANCES = MAX_AFTERBURNER_TRAILS * MAX_POINTS_PER_TRAIL;
const afterburnerTrails: AfterburnerTrailData[] = [];
let nextTrailId = 0;

function projectPointToTerrain(
  source: { x: number; y: number; z: number }
): { x: number; y: number; z: number } | null {
  const ground = checkGroundWithNormal(source.x, source.y + 0.25, source.z, 128, {
    feature: 'blaze_afterburner_trail',
    priority: 'visual',
  });
  if (!ground) return null;
  return { x: source.x, y: ground.groundY + 0.025, z: source.z };
}

function appendTerrainPoint(trail: AfterburnerTrailData, source: { x: number; y: number; z: number }, now: number): void {
  if (trail.points.length >= MAX_POINTS_PER_TRAIL) return;
  const position = projectPointToTerrain(source);
  if (!position) return;
  const previous = trail.points[trail.points.length - 1]?.position;
  if (previous && Math.hypot(position.x - previous.x, position.z - previous.z) < 0.08) return;
  trail.points.push({
    position,
    spawnedAt: now,
    seed: (trail.points.length * 1.731 + trail.startTime * 0.00037) % (Math.PI * 2),
  });
}

function getLivePlayerPosition(trail: AfterburnerTrailData) {
  const visuals = visualStore.getState();
  const rendered = visuals.renderedPlayerPositions.get(trail.playerId);
  if (rendered) return rendered;
  const predicted = visuals.playerPositions.get(trail.playerId);
  if (predicted) return predicted;
  const game = useGameStore.getState();
  if (game.localPlayer?.id === trail.playerId) return game.localPlayer.position;
  return game.players.get(trail.playerId)?.position ?? null;
}

function sampleTrailToPosition(
  trail: AfterburnerTrailData,
  position: { x: number; y: number; z: number },
  now: number,
  forceFinalPoint: boolean
): void {
  const dx = position.x - trail.lastSourcePosition.x;
  const dy = position.y - trail.lastSourcePosition.y;
  const dz = position.z - trail.lastSourcePosition.z;
  const distance = Math.hypot(dx, dz);
  if (distance < (forceFinalPoint ? 0.08 : POINT_SAMPLE_SPACING)) return;

  const sampleCount = forceFinalPoint
    ? Math.max(1, Math.ceil(distance / POINT_SAMPLE_SPACING))
    : Math.floor(distance / POINT_SAMPLE_SPACING);
  const stepDistance = forceFinalPoint ? distance / sampleCount : POINT_SAMPLE_SPACING;
  for (let index = 1; index <= sampleCount; index++) {
    const alpha = Math.min(1, (index * stepDistance) / distance);
    const source = {
      x: trail.lastSourcePosition.x + dx * alpha,
      y: trail.lastSourcePosition.y + dy * alpha,
      z: trail.lastSourcePosition.z + dz * alpha,
    };
    appendTerrainPoint(trail, source, now);
    if (trail.points.length >= MAX_POINTS_PER_TRAIL) break;
  }

  const consumedAlpha = forceFinalPoint ? 1 : Math.min(1, (sampleCount * POINT_SAMPLE_SPACING) / distance);
  trail.lastSourcePosition = {
    x: trail.lastSourcePosition.x + dx * consumedAlpha,
    y: trail.lastSourcePosition.y + dy * consumedAlpha,
    z: trail.lastSourcePosition.z + dz * consumedAlpha,
  };
}

export function triggerAfterburnerTrail(input: AfterburnerTrailTrigger): void {
  const now = getFrameClock().nowMs || performance.now();
  for (let index = afterburnerTrails.length - 1; index >= 0; index--) {
    if (now >= afterburnerTrails[index].expiresAt) afterburnerTrails.splice(index, 1);
  }

  const existing = input.id
    ? afterburnerTrails.find((trail) => trail.id === input.id)
    : undefined;
  if (existing) {
    existing.playerId = input.playerId;
    existing.expiresAt = Math.max(existing.expiresAt, existing.startTime + Math.max(1, input.trailDurationMs));
    return;
  }

  if (afterburnerTrails.length >= MAX_AFTERBURNER_TRAILS) afterburnerTrails.shift();
  const trail: AfterburnerTrailData = {
    id: input.id ?? `afterburner_${nextTrailId++}`,
    playerId: input.playerId,
    startTime: now,
    dashEndsAt: now + Math.max(1, input.dashDurationMs),
    expiresAt: now + Math.max(1, input.trailDurationMs),
    lastSourcePosition: { ...input.startPosition },
    points: [],
    lastDamageTick: new Map(),
    samplingComplete: false,
  };
  appendTerrainPoint(trail, input.startPosition, now);
  afterburnerTrails.push(trail);
}

function setInstance(mesh: THREE.InstancedMesh, index: number, dummy: THREE.Object3D): void {
  dummy.updateMatrix();
  mesh.setMatrixAt(index, dummy.matrix);
}

function commitInstances(mesh: THREE.InstancedMesh, count: number): void {
  mesh.count = count;
  if (count === 0) return;

  mesh.instanceMatrix.clearUpdateRanges();
  mesh.instanceMatrix.addUpdateRange(0, count * mesh.instanceMatrix.itemSize);
  mesh.instanceMatrix.needsUpdate = true;
}

export function AfterburnerTrails() {
  const outerFlameRef = useRef<THREE.InstancedMesh>(null);
  const sideFlameRef = useRef<THREE.InstancedMesh>(null);
  const innerFlameRef = useRef<THREE.InstancedMesh>(null);
  const emberRef = useRef<THREE.InstancedMesh>(null);
  const smokeRef = useRef<THREE.InstancedMesh>(null);
  const glowRef = useRef<THREE.InstancedMesh>(null);
  const scorchRef = useRef<THREE.InstancedMesh>(null);
  const wasActiveRef = useRef(false);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const outerFlameMaterial = useMemo(() => new THREE.MeshBasicMaterial({
    color: BLAZE_COLORS.fireOrange,
    transparent: true,
    opacity: 0.72,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  }), []);
  const innerFlameMaterial = useMemo(() => new THREE.MeshBasicMaterial({
    color: BLAZE_COLORS.fireYellow,
    transparent: true,
    opacity: 0.88,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  }), []);
  const sideFlameMaterial = useMemo(() => new THREE.MeshBasicMaterial({
    color: BLAZE_COLORS.fireRed,
    transparent: true,
    opacity: 0.62,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  }), []);
  const emberMaterial = useMemo(() => new THREE.MeshBasicMaterial({
    color: BLAZE_COLORS.fireWhite,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  }), []);
  const smokeMaterial = useMemo(() => new THREE.MeshBasicMaterial({
    color: BLAZE_COLORS.smokeDark,
    transparent: true,
    opacity: 0.16,
    depthWrite: false,
  }), []);
  const glowMaterial = useMemo(() => new THREE.MeshBasicMaterial({
    color: BLAZE_COLORS.fireRed,
    transparent: true,
    opacity: 0.2,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  }), []);
  const scorchMaterial = useMemo(() => new THREE.MeshBasicMaterial({
    color: 0x2b0b04,
    transparent: true,
    opacity: 0.42,
    side: THREE.DoubleSide,
    depthWrite: false,
  }), []);

  useLayoutEffect(() => {
    const meshes = [
      outerFlameRef.current,
      sideFlameRef.current,
      innerFlameRef.current,
      emberRef.current,
      smokeRef.current,
      glowRef.current,
      scorchRef.current,
    ];
    for (const mesh of meshes) {
      if (!mesh) continue;
      mesh.count = 0;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    }
    return () => {
      afterburnerTrails.length = 0;
      nextTrailId = 0;
      outerFlameMaterial.dispose();
      sideFlameMaterial.dispose();
      innerFlameMaterial.dispose();
      emberMaterial.dispose();
      smokeMaterial.dispose();
      glowMaterial.dispose();
      scorchMaterial.dispose();
    };
  }, [emberMaterial, glowMaterial, innerFlameMaterial, outerFlameMaterial, scorchMaterial, sideFlameMaterial, smokeMaterial]);

  useFrame((state) => {
    const outerFlameMesh = outerFlameRef.current;
    const sideFlameMesh = sideFlameRef.current;
    const innerFlameMesh = innerFlameRef.current;
    const emberMesh = emberRef.current;
    const smokeMesh = smokeRef.current;
    const glowMesh = glowRef.current;
    const scorchMesh = scorchRef.current;
    if (!outerFlameMesh || !sideFlameMesh || !innerFlameMesh || !emberMesh || !smokeMesh || !glowMesh || !scorchMesh) return;

    const now = getFrameClock().nowMs || performance.now();
    for (let trailIndex = afterburnerTrails.length - 1; trailIndex >= 0; trailIndex--) {
      if (now >= afterburnerTrails[trailIndex].expiresAt) afterburnerTrails.splice(trailIndex, 1);
    }

    if (afterburnerTrails.length === 0) {
      if (wasActiveRef.current) {
        outerFlameMesh.count = 0;
        sideFlameMesh.count = 0;
        innerFlameMesh.count = 0;
        emberMesh.count = 0;
        smokeMesh.count = 0;
        glowMesh.count = 0;
        scorchMesh.count = 0;
        wasActiveRef.current = false;
      }
      return;
    }

    wasActiveRef.current = true;
    let pointInstance = 0;
    let sideFlameInstance = 0;
    let emberInstance = 0;
    const shouldApplyPracticeDamage = useGameStore.getState().isPracticeMode;

    for (let trailIndex = afterburnerTrails.length - 1; trailIndex >= 0; trailIndex--) {
      const trail = afterburnerTrails[trailIndex];
      if (trail.points.length === 0) {
        appendTerrainPoint(trail, trail.lastSourcePosition, now);
      }

      const livePosition = getLivePlayerPosition(trail);
      if (livePosition && !trail.samplingComplete) {
        if (now < trail.dashEndsAt) {
          sampleTrailToPosition(trail, livePosition, now, false);
        } else {
          sampleTrailToPosition(trail, livePosition, now, true);
          trail.samplingComplete = true;
        }
      }

      if (shouldApplyPracticeDamage) {
        applyTutorialOfflineTrainingTrailDamage({
          points: trail.points,
          radius: BLAZE_AFTERBURNER_TRAIL_RADIUS,
          damage: BLAZE_AFTERBURNER_TRAIL_DAMAGE,
          damageType: 'afterburner',
          damageIntervalMs: BLAZE_AFTERBURNER_TRAIL_DAMAGE_INTERVAL_MS,
          lastDamageTick: trail.lastDamageTick,
          sourceId: trail.playerId,
          abilityId: 'blaze_afterburner',
        });
      }

      for (let pointIndex = 0; pointIndex < trail.points.length; pointIndex++) {
        const point = trail.points[pointIndex];
        if (pointInstance >= MAX_POINT_INSTANCES) break;
        const remainingLifeMs = Math.max(1, trail.expiresAt - point.spawnedAt);
        const ageMs = Math.max(0, now - point.spawnedAt);
        const life = Math.min(1, ageMs / remainingLifeMs);
        const enter = THREE.MathUtils.smoothstep(ageMs, 0, 90);
        const exit = 1 - THREE.MathUtils.smoothstep(life, 0.58, 1);
        const flameFade = enter * exit;
        const phase = state.clock.elapsedTime * 13.5 + point.seed;
        const flicker = 0.86 + Math.sin(phase) * 0.11 + Math.sin(phase * 2.37) * 0.05;
        const swayX = Math.sin(phase * 0.61) * 0.11;
        const swayZ = Math.cos(phase * 0.53) * 0.11;
        const previousPoint = trail.points[Math.max(0, pointIndex - 1)].position;
        const nextPoint = trail.points[Math.min(trail.points.length - 1, pointIndex + 1)].position;
        const tangentX = nextPoint.x - previousPoint.x;
        const tangentZ = nextPoint.z - previousPoint.z;
        const tangentLength = Math.hypot(tangentX, tangentZ);
        const forwardX = tangentLength > 0.001 ? tangentX / tangentLength : 1;
        const forwardZ = tangentLength > 0.001 ? tangentZ / tangentLength : 0;
        const sideX = tangentLength > 0.001 ? -tangentZ / tangentLength : 0;
        const sideZ = tangentLength > 0.001 ? tangentX / tangentLength : 1;

        const outerHeight = 0.8 * flicker * flameFade;
        dummy.position.set(
          point.position.x + swayX * 0.12,
          point.position.y + outerHeight * 0.5,
          point.position.z + swayZ * 0.12,
        );
        dummy.rotation.set(swayZ, point.seed, -swayX);
        dummy.scale.set(0.38 * flameFade, outerHeight, 0.38 * flameFade);
        setInstance(outerFlameMesh, pointInstance, dummy);

        for (let sideIndex = 0; sideIndex < SIDE_FLAMES_PER_POINT; sideIndex++) {
          const side = sideIndex === 0
            ? -1
            : sideIndex === 1
              ? 1
              : Math.sin(point.seed * 3.71) < 0 ? -1 : 1;
          const sidePhase = phase + side * 1.17 + sideIndex * 1.93;
          const laneDistance = sideIndex < 2
            ? 0.62 + Math.sin(point.seed * 2.43 + sideIndex * 2.17) * 0.12
            : 0.92 + Math.sin(point.seed * 1.83) * 0.1;
          const alongDistance = Math.sin(point.seed * 4.13 + sideIndex * 1.47) * 0.2;
          const sideHeight = (
            0.46
            + sideIndex * 0.055
            + Math.sin(sidePhase * 1.43) * 0.09
          ) * flameFade;
          const sideWidth = (0.28 + Math.sin(point.seed * 2.79 + sideIndex) * 0.055) * flameFade;
          dummy.position.set(
            point.position.x
              + sideX * side * laneDistance
              + forwardX * alongDistance
              + Math.sin(sidePhase) * 0.045,
            point.position.y + sideHeight * 0.5,
            point.position.z
              + sideZ * side * laneDistance
              + forwardZ * alongDistance
              + Math.cos(sidePhase) * 0.045,
          );
          dummy.rotation.set(sideZ * side * 0.13, point.seed + side * 0.24, -sideX * side * 0.13);
          dummy.scale.set(sideWidth, sideHeight, sideWidth);
          setInstance(sideFlameMesh, sideFlameInstance++, dummy);
        }

        const innerHeight = 0.5 * (0.92 + Math.sin(phase * 1.31) * 0.08) * flameFade;
        dummy.position.set(point.position.x, point.position.y + innerHeight * 0.5 + 0.015, point.position.z);
        dummy.rotation.set(-swayZ * 0.6, -point.seed, swayX * 0.6);
        dummy.scale.set(0.18 * flameFade, innerHeight, 0.18 * flameFade);
        setInstance(innerFlameMesh, pointInstance, dummy);

        const groundFade = 1 - THREE.MathUtils.smoothstep(life, 0.78, 1);
        dummy.position.set(point.position.x, point.position.y + 0.007, point.position.z);
        dummy.rotation.set(-Math.PI / 2, 0, point.seed);
        dummy.scale.set(
          (1.2 + Math.sin(point.seed * 2.11) * 0.18) * groundFade,
          (0.82 + Math.cos(point.seed * 1.73) * 0.14) * groundFade,
          1,
        );
        setInstance(scorchMesh, pointInstance, dummy);

        dummy.position.set(point.position.x, point.position.y + 0.014, point.position.z);
        const glowPulse = 0.94 + Math.sin(phase * 0.73) * 0.06;
        dummy.scale.set(
          (1.38 + Math.sin(point.seed * 2.11) * 0.2) * glowPulse * flameFade,
          (0.96 + Math.cos(point.seed * 1.73) * 0.16) * glowPulse * flameFade,
          1,
        );
        setInstance(glowMesh, pointInstance, dummy);

        const smokeCycle = (life * 3.2 + point.seed * 0.17) % 1;
        const smokeFade = flameFade * (1 - smokeCycle);
        dummy.position.set(
          point.position.x + Math.sin(point.seed + smokeCycle * 3) * 0.2,
          point.position.y + 0.42 + smokeCycle * 0.9,
          point.position.z + Math.cos(point.seed + smokeCycle * 2.7) * 0.2,
        );
        dummy.rotation.set(0, phase * 0.08, 0);
        dummy.scale.setScalar((0.16 + smokeCycle * 0.27) * smokeFade);
        setInstance(smokeMesh, pointInstance, dummy);

        for (let ember = 0; ember < EMBERS_PER_POINT; ember++) {
          const emberCycle = (life * 4.5 + ember * 0.47 + point.seed * 0.11) % 1;
          const emberFade = flameFade * (1 - emberCycle);
          const emberAngle = point.seed + ember * Math.PI + emberCycle * 2.4;
          dummy.position.set(
            point.position.x + Math.cos(emberAngle) * emberCycle * 0.34,
            point.position.y + 0.22 + emberCycle * 0.95,
            point.position.z + Math.sin(emberAngle) * emberCycle * 0.34,
          );
          dummy.rotation.set(0, 0, 0);
          dummy.scale.setScalar(0.042 * emberFade);
          setInstance(emberMesh, emberInstance++, dummy);
        }
        pointInstance++;
      }
    }

    commitInstances(outerFlameMesh, pointInstance);
    commitInstances(sideFlameMesh, sideFlameInstance);
    commitInstances(innerFlameMesh, pointInstance);
    commitInstances(smokeMesh, pointInstance);
    commitInstances(glowMesh, pointInstance);
    commitInstances(scorchMesh, pointInstance);
    commitInstances(emberMesh, emberInstance);
  });

  return (
    <group>
      <instancedMesh ref={scorchRef} args={[SHARED_GEOMETRIES.circle16, scorchMaterial, MAX_POINT_INSTANCES]} frustumCulled={false} />
      <instancedMesh ref={glowRef} args={[SHARED_GEOMETRIES.circle16, glowMaterial, MAX_POINT_INSTANCES]} frustumCulled={false} />
      <instancedMesh ref={outerFlameRef} args={[SHARED_GEOMETRIES.cone6, outerFlameMaterial, MAX_POINT_INSTANCES]} frustumCulled={false} />
      <instancedMesh
        ref={sideFlameRef}
        args={[SHARED_GEOMETRIES.cone6, sideFlameMaterial, MAX_POINT_INSTANCES * SIDE_FLAMES_PER_POINT]}
        frustumCulled={false}
      />
      <instancedMesh ref={innerFlameRef} args={[SHARED_GEOMETRIES.cone6, innerFlameMaterial, MAX_POINT_INSTANCES]} frustumCulled={false} />
      <instancedMesh ref={smokeRef} args={[SHARED_GEOMETRIES.sphere6, smokeMaterial, MAX_POINT_INSTANCES]} frustumCulled={false} />
      <instancedMesh
        ref={emberRef}
        args={[SHARED_GEOMETRIES.sphere4, emberMaterial, MAX_POINT_INSTANCES * EMBERS_PER_POINT]}
        frustumCulled={false}
      />
    </group>
  );
}

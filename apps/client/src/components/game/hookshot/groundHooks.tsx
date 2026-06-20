import React, { useMemo, useRef } from 'react';
import * as THREE from 'three';
import {
  HOOKSHOT_GROUND_HOOKS_HOOKS_PER_TARGET,
  PLAYER_HEIGHT,
} from '@voxel-strike/shared';
import { useGameStore } from '../../../store/gameStore';
import type { HookshotGroundHooksData, HookshotGroundHooksTargetData } from '../../../store/types';
import { getFrameClock } from '../../../utils/frameClock';
import { triggerTerrainImpact } from '../TerrainImpactEffects';
import { BudgetedPointLight } from '../systems/DynamicLightBudget';
import {
  HOOKSHOT_COLORS,
  SHARED_GEOMETRIES,
  TEMP_VECTORS,
  getHookshotMaterials,
} from '../effectResources';
import {
  HOOK_MAIN_ROPE_MATERIAL,
  PLIABLE_ROPE_SEGMENT_COUNT,
  ROPE_SEGMENT_INDICES,
  createRopePoints,
  updatePliableRopePoints,
  updateRopeSegment,
} from './rope';
import { useHookshotFrameUpdater } from './hookshotFrameRegistry';

const HOOK_ANCHOR_RADIUS = 1.35;
const HOOK_RISE_DEPTH = 0.65;
const HOOK_LATCH_SECONDS = 0.28;
const TARGET_LATCH_HEIGHTS = [0.18, 0.45, 0.72] as const;

const GROUND_HOOK_MATERIALS = {
  spike: new THREE.MeshStandardMaterial({
    color: HOOKSHOT_COLORS.metalLight,
    metalness: 0.92,
    roughness: 0.18,
  }),
  collar: new THREE.MeshStandardMaterial({
    color: HOOKSHOT_COLORS.metalDark,
    metalness: 0.86,
    roughness: 0.24,
  }),
  ring: new THREE.MeshBasicMaterial({
    color: HOOKSHOT_COLORS.energy,
    transparent: true,
    opacity: 0.72,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    depthWrite: false,
    toneMapped: false,
  }),
  field: new THREE.MeshBasicMaterial({
    color: HOOKSHOT_COLORS.energyGlow,
    transparent: true,
    opacity: 0.16,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    depthWrite: false,
    toneMapped: false,
  }),
};

function smooth01(value: number): number {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}

function hashPhase(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return (Math.abs(hash) % 360) / 360 * Math.PI * 2;
}

function writeTargetPosition(
  out: THREE.Vector3,
  target: HookshotGroundHooksTargetData
): THREE.Vector3 {
  const liveTarget = useGameStore.getState().players.get(target.targetId);
  const position = liveTarget?.state === 'alive' ? liveTarget.position : target.position;
  out.set(position.x, position.y, position.z);
  return out;
}

function orientAlong(group: THREE.Group | null, from: THREE.Vector3, to: THREE.Vector3): void {
  if (!group) return;

  TEMP_VECTORS.v1.copy(to).sub(from);
  if (TEMP_VECTORS.v1.lengthSq() <= 0.0001) return;

  TEMP_VECTORS.v1.normalize();
  TEMP_VECTORS.quat1.setFromUnitVectors(TEMP_VECTORS.forward, TEMP_VECTORS.v1);
  group.quaternion.copy(TEMP_VECTORS.quat1);
}

function GroundHookHead({ hookRef }: { hookRef: React.MutableRefObject<THREE.Group | null> }) {
  const materials = getHookshotMaterials();
  return (
    <group ref={hookRef}>
      <mesh geometry={SHARED_GEOMETRIES.cone8} material={materials.tip} rotation-x={Math.PI / 2} scale={[0.18, 0.48, 0.18]} />
      <mesh position={[0, 0, 0.28]} geometry={SHARED_GEOMETRIES.cylinder8} material={GROUND_HOOK_MATERIALS.spike} rotation-x={Math.PI / 2} scale={[0.12, 0.32, 0.12]} />
      <mesh position={[0, 0, 0.52]} geometry={SHARED_GEOMETRIES.ring16} material={materials.ring} rotation-x={Math.PI / 2} scale={[0.24, 0.24, 0.04]} />
      <mesh position={[0, 0, 0.64]} geometry={SHARED_GEOMETRIES.cylinder8} material={GROUND_HOOK_MATERIALS.collar} rotation-x={Math.PI / 2} scale={[0.09, 0.18, 0.09]} />
    </group>
  );
}

function GroundHookTether({
  effectId,
  target,
  targetIndex,
  hookIndex,
  phase,
  startTime,
}: {
  effectId: string;
  target: HookshotGroundHooksTargetData;
  targetIndex: number;
  hookIndex: number;
  phase: number;
  startTime: number;
}) {
  const hookRef = useRef<THREE.Group>(null);
  const groundRingRef = useRef<THREE.Mesh>(null);
  const ropeMainRefs = useRef<(THREE.Mesh | null)[]>([]);
  const ropeGlowRefs = useRef<(THREE.Mesh | null)[]>([]);
  const ropeCoreRefs = useRef<(THREE.Mesh | null)[]>([]);
  const targetPosRef = useRef(new THREE.Vector3(target.position.x, target.position.y, target.position.z));
  const anchorRef = useRef(new THREE.Vector3());
  const hookPosRef = useRef(new THREE.Vector3());
  const latchRef = useRef(new THREE.Vector3());
  const ropeControlARef = useRef(new THREE.Vector3());
  const ropeControlBRef = useRef(new THREE.Vector3());
  const ropeLagRef = useRef(new THREE.Vector3());
  const ropePointsRef = useRef(createRopePoints());
  const startFrameTimeRef = useRef(getFrameClock().nowMs - Math.max(0, Date.now() - startTime));
  const impactedRef = useRef(false);
  const angle = phase + hookIndex * (Math.PI * 2 / HOOKSHOT_GROUND_HOOKS_HOOKS_PER_TARGET);

  useHookshotFrameUpdater(`ground-hooks:${effectId}:${target.targetId}:${hookIndex}`, (state) => {
    const elapsed = Math.max(0, (getFrameClock().nowMs - startFrameTimeRef.current) / 1000);
    const latchProgress = smooth01(elapsed / HOOK_LATCH_SECONDS);
    const pulse = 1 + Math.sin(state.clock.elapsedTime * 9 + targetIndex + hookIndex) * 0.08;

    writeTargetPosition(targetPosRef.current, target);
    const targetPos = targetPosRef.current;
    const groundY = targetPos.y - PLAYER_HEIGHT / 2 + 0.04;
    const anchor = anchorRef.current.set(
      targetPos.x + Math.cos(angle) * HOOK_ANCHOR_RADIUS,
      groundY,
      targetPos.z + Math.sin(angle) * HOOK_ANCHOR_RADIUS
    );
    const hookPos = hookPosRef.current.set(
      anchor.x,
      groundY - HOOK_RISE_DEPTH * (1 - latchProgress),
      anchor.z
    );
    const latchHeight = TARGET_LATCH_HEIGHTS[hookIndex % TARGET_LATCH_HEIGHTS.length];
    const latch = latchRef.current.set(
      targetPos.x - Math.cos(angle) * 0.22,
      targetPos.y + latchHeight,
      targetPos.z - Math.sin(angle) * 0.22
    );

    if (!impactedRef.current) {
      impactedRef.current = true;
      triggerTerrainImpact('hookshot_ground_hooks', anchor, { scale: 0.62 });
    }

    hookRef.current?.position.copy(hookPos);
    orientAlong(hookRef.current, hookPos, latch);
    if (groundRingRef.current) {
      groundRingRef.current.position.set(anchor.x, anchor.y + 0.025, anchor.z);
      groundRingRef.current.scale.setScalar((0.42 + latchProgress * 0.32) * pulse);
    }

    const ropePoints = ropePointsRef.current;
    ropePoints[0].copy(hookPos);
    ropePoints[PLIABLE_ROPE_SEGMENT_COUNT].lerpVectors(hookPos, latch, latchProgress);
    ropeLagRef.current.set(0, Math.sin(state.clock.elapsedTime * 5 + hookIndex) * 0.04, 0);
    updatePliableRopePoints(
      ropePoints,
      ropeControlARef.current,
      ropeControlBRef.current,
      ropePoints[0],
      ropePoints[PLIABLE_ROPE_SEGMENT_COUNT],
      ropeLagRef.current,
      ropePoints[0].distanceTo(ropePoints[PLIABLE_ROPE_SEGMENT_COUNT]),
      0.12
    );

    for (let i = 0; i < PLIABLE_ROPE_SEGMENT_COUNT; i++) {
      updateRopeSegment(ropeGlowRefs.current[i], ropePoints[i], ropePoints[i + 1], 0.075);
      updateRopeSegment(ropeMainRefs.current[i], ropePoints[i], ropePoints[i + 1], 0.03);
      updateRopeSegment(ropeCoreRefs.current[i], ropePoints[i], ropePoints[i + 1], 0.014);
    }
  });

  return (
    <group>
      <GroundHookHead hookRef={hookRef} />
      <mesh ref={groundRingRef} rotation-x={-Math.PI / 2} geometry={SHARED_GEOMETRIES.ring16} material={GROUND_HOOK_MATERIALS.ring} />
      {ROPE_SEGMENT_INDICES.map(i => (
        <mesh key={`ground-hook-glow-${i}`} ref={el => ropeGlowRefs.current[i] = el} geometry={SHARED_GEOMETRIES.cylinder8} material={getHookshotMaterials().ropeGlow} />
      ))}
      {ROPE_SEGMENT_INDICES.map(i => (
        <mesh key={`ground-hook-main-${i}`} ref={el => ropeMainRefs.current[i] = el} geometry={SHARED_GEOMETRIES.cylinder8} material={HOOK_MAIN_ROPE_MATERIAL} />
      ))}
      {ROPE_SEGMENT_INDICES.map(i => (
        <mesh key={`ground-hook-core-${i}`} ref={el => ropeCoreRefs.current[i] = el} geometry={SHARED_GEOMETRIES.cylinder8} material={getHookshotMaterials().ropeCore} />
      ))}
    </group>
  );
}

function GroundHookTargetBundle({
  effect,
  target,
  targetIndex,
}: {
  effect: HookshotGroundHooksData;
  target: HookshotGroundHooksTargetData;
  targetIndex: number;
}) {
  const phase = useMemo(
    () => hashPhase(`${effect.id}:${target.targetId}`),
    [effect.id, target.targetId]
  );

  return (
    <group>
      {Array.from({ length: HOOKSHOT_GROUND_HOOKS_HOOKS_PER_TARGET }, (_, hookIndex) => (
        <GroundHookTether
          key={`${target.targetId}:${hookIndex}`}
          effectId={effect.id}
          target={target}
          targetIndex={targetIndex}
          hookIndex={hookIndex}
          phase={phase}
          startTime={effect.startTime}
        />
      ))}
      <BudgetedPointLight
        budgetPriority={2}
        color={HOOKSHOT_COLORS.energy}
        intensity={2.1}
        distance={5}
        decay={2}
        position={[target.position.x, target.position.y + 0.3, target.position.z]}
      />
    </group>
  );
}

export function GroundHooksEffect({ effect }: { effect: HookshotGroundHooksData }) {
  const removeHookshotGroundHooks = useGameStore(state => state.removeHookshotGroundHooks);
  const fieldRef = useRef<THREE.Mesh>(null);
  const startFrameTimeRef = useRef(getFrameClock().nowMs - Math.max(0, Date.now() - effect.startTime));
  const removedRef = useRef(false);

  useHookshotFrameUpdater(`ground-hooks:${effect.id}`, (state) => {
    if (removedRef.current) return;

    const elapsedMs = getFrameClock().nowMs - startFrameTimeRef.current;
    const lifetimeMs = Math.max(effect.duration * 1000, effect.rootUntil - effect.startTime) + 500;
    if (elapsedMs >= lifetimeMs) {
      removedRef.current = true;
      removeHookshotGroundHooks(effect.id);
      return;
    }

    if (fieldRef.current) {
      const expand = smooth01(elapsedMs / 240);
      const fade = Math.max(0, 1 - Math.max(0, elapsedMs - effect.duration * 1000) / 500);
      fieldRef.current.position.set(effect.position.x, effect.position.y - PLAYER_HEIGHT / 2 + 0.035, effect.position.z);
      fieldRef.current.scale.setScalar(effect.radius * (0.25 + expand * 0.75));
      fieldRef.current.rotation.z = state.clock.elapsedTime * 0.35;
      GROUND_HOOK_MATERIALS.field.opacity = 0.16 * fade;
    }
  });

  return (
    <group>
      <mesh ref={fieldRef} rotation-x={-Math.PI / 2} geometry={SHARED_GEOMETRIES.circle32} material={GROUND_HOOK_MATERIALS.field} />
      {effect.targets.map((target, targetIndex) => (
        <GroundHookTargetBundle
          key={target.targetId}
          effect={effect}
          target={target}
          targetIndex={targetIndex}
        />
      ))}
      <BudgetedPointLight
        budgetPriority={1}
        color={HOOKSHOT_COLORS.energyGlow}
        intensity={1.4}
        distance={Math.min(12, effect.radius)}
        decay={2}
        position={[effect.position.x, effect.position.y + 0.2, effect.position.z]}
      />
    </group>
  );
}

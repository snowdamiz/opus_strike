import React, { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useGameStore, type IceMalletSwingData } from '../../../store/gameStore';
import { raycastDirection } from '../../../hooks/usePhysics';
import { SHARED_GEOMETRIES } from '../effectResources';
import { triggerTerrainImpact } from '../TerrainImpactEffects';
import { BudgetedPointLight } from '../systems/DynamicLightBudget';
import { getFrameClock } from '../../../utils/frameClock';
import {
  GLACIER_COLORS,
  tempVec3,
  initMaterials,
  getMalletGeometry,
  malletHeadMaterial,
  malletHandleMaterial,
  malletCapMaterial,
  malletBevelMaterial,
  malletFrostRingMaterial,
  malletVeinMaterial,
  malletCrystalMaterial,
  malletFrostCrystalMaterial,
  malletGripHandMaterial,
  malletGripSleeveMaterial,
  frostParticleMaterial,
  iceShardMaterial,
  FROST_RING_POSITIONS,
  VEIN_POSITIONS,
  FROST_CRYSTAL_CONFIGS,
} from './materials';

// ============================================================================
// ICE MALLET SWING - Glacier basic attack
// ============================================================================

const MALLET_SWING_DURATION = 0.4;
const MALLET_DAMAGE = 50;
const MALLET_RANGE = 3.4;
const FROST_PARTICLE_INDICES = [0, 1, 2, 3, 4, 5] as const;
const ICE_SHARD_INDICES = [0, 1, 2, 3] as const;
const IDLE_FROST_CRYSTAL_CONFIGS = FROST_CRYSTAL_CONFIGS.slice(0, 2);
const MALLET_GRIP_FINGER_Z_OFFSETS = [-0.135, -0.045, 0.045, 0.135] as const;

function MalletLeftGrip() {
  return (
    <group position={[0.018, -0.075, -0.58]} rotation={[0.02, 0.04, -0.2]}>
      <mesh
        geometry={SHARED_GEOMETRIES.box}
        material={malletGripHandMaterial}
        position={[0.102, 0.028, 0]}
        rotation={[0, 0, -0.08]}
        scale={[0.16, 0.135, 0.34]}
      />
      <mesh
        geometry={SHARED_GEOMETRIES.box}
        material={malletGripSleeveMaterial}
        position={[0.12, 0.065, 0.02]}
        rotation={[0, 0, -0.08]}
        scale={[0.11, 0.068, 0.25]}
      />
      <mesh
        geometry={SHARED_GEOMETRIES.box}
        material={malletGripSleeveMaterial}
        position={[0.028, -0.012, -0.17]}
        rotation={[0.03, 0.16, -0.62]}
        scale={[0.06, 0.155, 0.062]}
      />
      {MALLET_GRIP_FINGER_Z_OFFSETS.map((z, index) => {
        const isLongFinger = index === 1 || index === 2;
        return (
          <group key={`mallet-left-grip-finger-${z}`} position={[0.16, 0.092, z]} rotation={[0.02, 0, -0.34]}>
            <mesh
              geometry={SHARED_GEOMETRIES.box}
              material={malletGripHandMaterial}
              position={[-0.038, -0.002, 0]}
              scale={[0.056, 0.052, 0.052]}
            />
            <mesh
              geometry={SHARED_GEOMETRIES.box}
              material={malletGripSleeveMaterial}
              position={[0.03, 0.008, 0]}
              scale={[isLongFinger ? 0.104 : 0.09, 0.048, 0.046]}
            />
            <mesh
              geometry={SHARED_GEOMETRIES.box}
              material={malletGripHandMaterial}
              position={[isLongFinger ? 0.106 : 0.092, 0.016, 0]}
              rotation={[0, 0, -0.12]}
              scale={[0.052, 0.043, 0.044]}
            />
          </group>
        );
      })}
      <mesh
        geometry={SHARED_GEOMETRIES.box}
        material={malletGripHandMaterial}
        position={[0.042, -0.062, 0.125]}
        rotation={[0.06, -0.22, -0.68]}
        scale={[0.064, 0.15, 0.064]}
      />
    </group>
  );
}

interface IceMalletSwingProps {
  swing: IceMalletSwingData;
}

export const IceMalletSwing = React.memo(({ swing }: IceMalletSwingProps) => {
  const { camera } = useThree();
  const groupRef = useRef<THREE.Group>(null);
  const offsetGroupRef = useRef<THREE.Group>(null);
  const swingPivotRef = useRef<THREE.Group>(null);
  const frostTrailRefs = useRef<(THREE.Mesh | null)[]>([]);
  const iceShardRefs = useRef<(THREE.Mesh | null)[]>([]);
  const lightRef = useRef<THREE.PointLight>(null);
  const hasHitRef = useRef(swing.hasHit);
  const hasTerrainImpactRef = useRef(false);
  const hitPlayersRef = useRef<Set<string>>(new Set());
  const shouldRemoveRef = useRef(false);
  
  // Store initial values in refs to avoid re-renders
  const startFrameTimeRef = useRef(getFrameClock().nowMs - Math.max(0, Date.now() - swing.startTime));
  const ownerIdRef = useRef(swing.ownerId);
  const ownerTeamRef = useRef(swing.ownerTeam);
  const swingDirectionRef = useRef(swing.swingDirection);
  
  // Initialize materials and geometry
  initMaterials();
  const { malletHeadMainGeometry, malletHeadCapGeometry, malletHeadBevelGeometry, malletHandleGeometry } = getMalletGeometry();
  
  // Get store actions once
  const removeIceMalletSwing = useGameStore(state => state.removeIceMalletSwing);
  const updateIceMalletSwing = useGameStore(state => state.updateIceMalletSwing);
  const players = useGameStore(state => state.players);
  const localPlayer = useGameStore(state => state.localPlayer);
  
  useFrame(() => {
    if (!groupRef.current || !swingPivotRef.current || shouldRemoveRef.current) return;
    
    const elapsed = (getFrameClock().nowMs - startFrameTimeRef.current) / 1000;
    const progress = Math.min(elapsed / MALLET_SWING_DURATION, 1);
    
    if (progress >= 1) {
      shouldRemoveRef.current = true;
      removeIceMalletSwing(swing.id);
      return;
    }
    
    const isLocalPlayerSwing = localPlayer && ownerIdRef.current === localPlayer.id;
    
    if (isLocalPlayerSwing) {
      groupRef.current.position.copy(camera.position);
      groupRef.current.quaternion.copy(camera.quaternion);
    } else {
      const owner = players.get(ownerIdRef.current);
      if (owner) {
        groupRef.current.position.set(owner.position.x, owner.position.y + 1.0, owner.position.z);
        groupRef.current.rotation.set(0, owner.lookYaw, 0);
      }
    }
    
    const dir = swingDirectionRef.current;
    const easedProgress = 1 - Math.pow(1 - progress, 2.5);
    
    const startY = dir * Math.PI * 0.45;
    const endY = dir * (-Math.PI * 0.35);
    const swingY = startY + (endY - startY) * easedProgress;
    
    const startX = 0.2;
    const endX = -0.2;
    const swingX = startX + (endX - startX) * easedProgress;
    
    swingPivotRef.current.rotation.set(swingX, swingY, 0);
    
    if (offsetGroupRef.current) {
      const shiftAmount = 0.8;
      const pivotShiftX = -dir * (shiftAmount - easedProgress * shiftAmount * 2);
      const forwardShift = Math.sin(easedProgress * Math.PI) * 0.2;
      const verticalShift = -Math.sin(easedProgress * Math.PI) * 0.1;
      offsetGroupRef.current.position.set(0.3 + pivotShiftX, -0.6 + verticalShift, -0.5 - forwardShift);
    }
    
    const scale = Math.min(progress * 5, 1) * 0.5 + 0.5;
    swingPivotRef.current.scale.setScalar(scale);
    
    const swingIntensity = Math.sin(progress * Math.PI);
    
    if (lightRef.current) {
      lightRef.current.intensity = 1.0 + swingIntensity * 2.5;
    }

    if (!hasTerrainImpactRef.current && isLocalPlayerSwing && progress > 0.46) {
      tempVec3.set(0, 0, -1).applyQuaternion(camera.quaternion);
      const hit = raycastDirection(
        camera.position.x,
        camera.position.y,
        camera.position.z,
        tempVec3.x,
        tempVec3.y,
        tempVec3.z,
        MALLET_RANGE
      );

      if (hit?.hit && hit.distance > 0.7) {
        hasTerrainImpactRef.current = true;
        triggerTerrainImpact('glacier_mallet', hit.point, {
          normal: hit.normal,
          direction: { x: tempVec3.x, y: tempVec3.y, z: tempVec3.z },
        });
      }
    }
    
    // Update frost particles (reduced count from 12 to 6 for performance)
    const frostLen = frostTrailRefs.current.length;
    for (let i = 0; i < frostLen; i++) {
      const particle = frostTrailRefs.current[i];
      if (!particle) continue;
      
      const angleOffset = (i / frostLen) * Math.PI * 2;
      const time = progress * 8 + angleOffset;
      const spiralRadius = 0.3 + swingIntensity * 1.2;
      
      particle.position.set(
        Math.cos(time) * spiralRadius * (1 + i * 0.1) + (i % 2 === 0 ? 1 : -1) * swingIntensity * 0.8,
        Math.sin(time * 0.7) * spiralRadius * 0.5,
        -7.5 + Math.sin(time * 0.5) * 0.5
      );
      
      const fadeIn = Math.min(progress * 4, 1);
      const fadeOut = Math.max(0, 1 - (progress - 0.6) * 3);
      particle.scale.setScalar(0.1 + swingIntensity * 0.15);
      (particle.material as THREE.MeshBasicMaterial).opacity = fadeIn * fadeOut * 0.5;
    }
    
    // Update ice shards (reduced count from 8 to 4)
    const shardLen = iceShardRefs.current.length;
    for (let i = 0; i < shardLen; i++) {
      const shard = iceShardRefs.current[i];
      if (!shard) continue;
      
      const shardProgress = Math.max(0, (progress - 0.3) / 0.7);
      const baseAngle = (i / shardLen) * Math.PI * 2;
      const flyAngle = baseAngle + swingY * 0.5;
      const flyDistance = shardProgress * 3;
      const gravity = shardProgress * shardProgress * 2;
      
      shard.position.set(
        Math.sin(flyAngle) * flyDistance,
        Math.cos(flyAngle) * flyDistance * 0.5 - gravity,
        -7.5 - Math.cos(flyAngle) * flyDistance * 0.3
      );
      shard.rotation.set(shardProgress * 8 + i * 1.5, shardProgress * 5 + i, shardProgress * 6 + i * 0.7);
      
      const shardFade = Math.max(0, 1 - shardProgress * 1.2);
      shard.scale.setScalar((0.08 + shardFade * 0.12) * (shardProgress > 0 ? 1 : 0));
    }
    
    // Hit detection - use temp vectors instead of allocating
    if (!hasHitRef.current && localPlayer && ownerIdRef.current === localPlayer.id) {
      tempVec3.set(0, 0, -1).applyQuaternion(camera.quaternion);
      const camYaw = Math.atan2(-tempVec3.x, -tempVec3.z);
      
      for (const [playerId, player] of players) {
        if (playerId === ownerIdRef.current || player.state !== 'alive') continue;
        if (player.team === ownerTeamRef.current) continue;
        if (hitPlayersRef.current.has(playerId)) continue;
        
        const dx = player.position.x - camera.position.x;
        const dz = player.position.z - camera.position.z;
        const distSq = dx * dx + dz * dz;
        
        if (distSq > MALLET_RANGE * MALLET_RANGE || distSq < 1) continue;
        
        const targetAngle = Math.atan2(-dx, -dz);
        let angleDiff = targetAngle - (camYaw - swingY);
        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
        
        if (Math.abs(angleDiff) <= 0.5) {
          hitPlayersRef.current.add(playerId);
        }
      }
      
      if (hitPlayersRef.current.size > 0) {
        hasHitRef.current = true;
        updateIceMalletSwing(swing.id, { hasHit: true });
      }
    }
  });
  
  return (
    <group ref={groupRef}>
      <group ref={offsetGroupRef} position={[0.3, -0.6, -0.5]}>
        <group ref={swingPivotRef}>
          {/* Handle */}
          <mesh geometry={malletHandleGeometry!} material={malletHandleMaterial} position={[0, 0, -3.5]} rotation={[Math.PI / 2, 0, 0]} />
          <MalletLeftGrip />
          
          {/* Frost rings - using cached material */}
          {FROST_RING_POSITIONS.map((z, i) => (
            <mesh key={i} geometry={SHARED_GEOMETRIES.cylinder8} material={malletFrostRingMaterial} position={[0, 0, -z]} rotation={[Math.PI / 2, 0, 0]} scale={[0.11, 0.06, 0.11]} />
          ))}
          
          {/* Mallet head */}
          <mesh geometry={malletHeadMainGeometry!} material={malletHeadMaterial} position={[0, 0, -7.5]} rotation={[0, 0, Math.PI / 2]} />
          <mesh geometry={malletHeadCapGeometry!} material={malletCapMaterial} position={[-1.3, 0, -7.5]} rotation={[0, 0, Math.PI / 2]} />
          <mesh geometry={malletHeadCapGeometry!} material={malletCapMaterial} position={[1.3, 0, -7.5]} rotation={[0, 0, Math.PI / 2]} />
          <mesh geometry={malletHeadBevelGeometry!} material={malletBevelMaterial} position={[0, 0, -7]} rotation={[Math.PI / 2, 0, 0]} />
          
          {/* Veins - cached material */}
          {VEIN_POSITIONS.map((x, i) => (
            <mesh key={i} geometry={SHARED_GEOMETRIES.box} material={malletVeinMaterial} position={[x, 0, -7.5]} scale={[0.02, 0.55, 0.02]} />
          ))}
          
          {/* Frost crystals - cached material */}
          {FROST_CRYSTAL_CONFIGS.map((c, i) => (
            <mesh key={i} geometry={SHARED_GEOMETRIES.cone6} material={c.type === 'frost' ? malletFrostCrystalMaterial : malletCrystalMaterial} position={c.pos as [number, number, number]} rotation={c.rot as [number, number, number]} scale={c.scale as [number, number, number]} />
          ))}
          
          {/* Frost particles - reduced count */}
          {FROST_PARTICLE_INDICES.map((i) => (
            <mesh key={i} ref={el => frostTrailRefs.current[i] = el} geometry={SHARED_GEOMETRIES.sphere4} material={frostParticleMaterial} position={[0, 0, -7.5]} />
          ))}
          
          {/* Ice shards - reduced count */}
          {ICE_SHARD_INDICES.map((i) => (
            <mesh key={i} ref={el => iceShardRefs.current[i] = el} geometry={SHARED_GEOMETRIES.cone4} material={iceShardMaterial} position={[0, 0, -7.5]} scale={[0.08, 0.18, 0.08]} />
          ))}
          
          <BudgetedPointLight budgetPriority={3} ref={lightRef} position={[0, 0, -7.5]} color={GLACIER_COLORS.iceLight} intensity={1.5} distance={6} decay={2} />
        </group>
      </group>
    </group>
  );
}, (prev, next) => {
  // Custom comparison: only re-render if swing.id changes
  return prev.swing.id === next.swing.id;
});

// ============================================================================
// IDLE MALLET - Optimized with cached materials
// ============================================================================

const IDLE_PULLOUT_DURATION = 0.25;

export const IdleMallet = React.memo(function IdleMallet() {
  const { camera } = useThree();
  const groupRef = useRef<THREE.Group>(null);
  const malletGroupRef = useRef<THREE.Group>(null);
  const bobRef = useRef(0);
  const pulloutStartRef = useRef(getFrameClock().nowMs);
  
  initMaterials();
  const { malletHeadMainGeometry, malletHeadCapGeometry, malletHeadBevelGeometry, malletHandleGeometry } = getMalletGeometry();
  
  useFrame((_, delta) => {
    if (!groupRef.current || !malletGroupRef.current) return;
    
    groupRef.current.position.copy(camera.position);
    groupRef.current.quaternion.copy(camera.quaternion);
    
    const elapsed = (getFrameClock().nowMs - pulloutStartRef.current) / 1000;
    const pulloutProgress = Math.min(elapsed / IDLE_PULLOUT_DURATION, 1);
    const easedProgress = 1 - Math.pow(1 - pulloutProgress, 3);
    
    if (pulloutProgress >= 1) bobRef.current += delta * 1.5;
    
    const bobY = Math.sin(bobRef.current) * 0.015 * easedProgress;
    const bobX = Math.cos(bobRef.current * 0.7) * 0.008 * easedProgress;
    
    malletGroupRef.current.position.set(
      0.6 + (0.2 - 0.6) * easedProgress + bobX,
      -1.8 + (-1 - -1.8) * easedProgress + bobY,
      -0.3 + (-0.5 - -0.3) * easedProgress
    );
    malletGroupRef.current.rotation.set(
      1.6 + (1.2 - 1.6) * easedProgress,
      1.2 + (0.8 - 1.2) * easedProgress,
      1.4 + (1.0 - 1.4) * easedProgress
    );
  });
  
  return (
    <group ref={groupRef}>
      <group ref={malletGroupRef}>
        <mesh geometry={malletHandleGeometry!} material={malletHandleMaterial} position={[0, 0, -3.5]} rotation={[Math.PI / 2, 0, 0]} />
        <MalletLeftGrip />
        
        {FROST_RING_POSITIONS.map((z, i) => (
          <mesh key={i} geometry={SHARED_GEOMETRIES.cylinder8} material={malletFrostRingMaterial} position={[0, 0, -z]} rotation={[Math.PI / 2, 0, 0]} scale={[0.11, 0.06, 0.11]} />
        ))}
        
        <mesh geometry={malletHeadMainGeometry!} material={malletHeadMaterial} position={[0, 0, -7.5]} rotation={[0, 0, Math.PI / 2]} />
        <mesh geometry={malletHeadCapGeometry!} material={malletCapMaterial} position={[-1.3, 0, -7.5]} rotation={[0, 0, Math.PI / 2]} />
        <mesh geometry={malletHeadCapGeometry!} material={malletCapMaterial} position={[1.3, 0, -7.5]} rotation={[0, 0, Math.PI / 2]} />
        <mesh geometry={malletHeadBevelGeometry!} material={malletBevelMaterial} position={[0, 0, -7]} rotation={[Math.PI / 2, 0, 0]} />
        
        {VEIN_POSITIONS.map((x, i) => (
          <mesh key={i} geometry={SHARED_GEOMETRIES.box} material={malletVeinMaterial} position={[x, 0, -7.5]} scale={[0.02, 0.5, 0.02]} />
        ))}
        
        {IDLE_FROST_CRYSTAL_CONFIGS.map((c, i) => (
          <mesh key={i} geometry={SHARED_GEOMETRIES.cone6} material={malletCrystalMaterial} position={c.pos as [number, number, number]} rotation={c.rot as [number, number, number]} scale={[c.scale[0] * 0.85, c.scale[1] * 0.85, c.scale[2] * 0.85]} />
        ))}
        
        <BudgetedPointLight budgetPriority={1} position={[0, 0, -7.5]} color={GLACIER_COLORS.iceLight} intensity={0.8} distance={4} decay={2} />
      </group>
    </group>
  );
});

import React, { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useGameStore } from '../../../store/gameStore';
import { checkGroundWithNormal, isPhysicsReady } from '../../../hooks/usePhysics';
import { SHARED_GEOMETRIES } from '../effectResources';
import { BudgetedPointLight } from '../systems/DynamicLightBudget';
import { getFrameClock } from '../../../utils/frameClock';
import {
  GLACIER_COLORS,
  tempVec3,
  tempMatrix,
  tempQuaternion,
  tempScale,
  tempEuler,
  initMaterials,
  getShieldGeometry,
  getShieldCrystalGeometry,
  shieldCrystalMaterial,
  shieldPanelMaterial,
  shieldGroundFrostMaterial,
  shieldFrostParticleMaterial,
  SHIELD_CRYSTALS,
} from './materials';

// ============================================================================
// ICE SHIELD - Optimized with InstancedMesh for crystals
// ============================================================================

export const ICE_SHIELD_RAISE_DURATION = 0.3;
export const ICE_SHIELD_LOWER_DURATION = 0.2;
const ICE_SHIELD_DISTANCE = 2.5;
const MAX_SHIELD_CRYSTALS = 27;
const SHIELD_FROST_PARTICLE_INDICES = [0, 1, 2, 3, 4, 5, 6, 7] as const;

interface IceShieldProps {
  isLowering: boolean;
  lowerStartTime: number;
}

export const IceShield = React.memo(({ isLowering, lowerStartTime }: IceShieldProps) => {
  const instancedMeshRef = useRef<THREE.InstancedMesh>(null);
  const groupRef = useRef<THREE.Group>(null);
  const panelRef = useRef<THREE.Mesh>(null);
  const frostGroundRef = useRef<THREE.Mesh>(null);
  const frostParticleRefs = useRef<(THREE.Mesh | null)[]>([]);
  const lightRef = useRef<THREE.PointLight>(null);
  
  const smoothedGroundYRef = useRef<number | null>(null);
  const smoothedYawRef = useRef<number | null>(null);
  const lastRaycastTimeRef = useRef(0);
  const lastRaycastYRef = useRef<number | null>(null);
  
  const shieldStartTime = useGameStore(state => state.glacierShieldStartTime);
  const localPlayer = useGameStore(state => state.localPlayer);
  const shieldStartFrameTimeRef = useRef(getFrameClock().nowMs - Math.max(0, Date.now() - shieldStartTime));
  const lowerStartFrameTimeRef = useRef(getFrameClock().nowMs - Math.max(0, Date.now() - lowerStartTime));
  
  initMaterials();
  const crystalGeometry = getShieldCrystalGeometry();
  const { shieldPanelGeometry, shieldGroundFrostGeometry } = getShieldGeometry();

  useEffect(() => {
    shieldStartFrameTimeRef.current = getFrameClock().nowMs - Math.max(0, Date.now() - shieldStartTime);
  }, [shieldStartTime]);

  useEffect(() => {
    lowerStartFrameTimeRef.current = getFrameClock().nowMs - Math.max(0, Date.now() - lowerStartTime);
  }, [lowerStartTime]);
  
  useFrame((_, delta) => {
    const mesh = instancedMeshRef.current;
    if (!groupRef.current || !mesh || !localPlayer) return;
    
    const now = getFrameClock().nowMs;

    let raiseProgress: number;
    if (isLowering) {
      const lowerElapsed = (now - lowerStartFrameTimeRef.current) / 1000;
      raiseProgress = 1 - Math.min(lowerElapsed / ICE_SHIELD_LOWER_DURATION, 1);
    } else {
      const raiseElapsed = (now - shieldStartFrameTimeRef.current) / 1000;
      raiseProgress = Math.min(raiseElapsed / ICE_SHIELD_RAISE_DURATION, 1);
    }
    
    const easedProgress = 1 - Math.pow(1 - raiseProgress, 3);
    
    // Smooth yaw
    if (smoothedYawRef.current === null) smoothedYawRef.current = localPlayer.lookYaw;
    let yawDiff = localPlayer.lookYaw - smoothedYawRef.current;
    while (yawDiff > Math.PI) yawDiff -= Math.PI * 2;
    while (yawDiff < -Math.PI) yawDiff += Math.PI * 2;
    smoothedYawRef.current += yawDiff * Math.min(15 * delta, 1);
    
    const yaw = smoothedYawRef.current;
    const shieldX = localPlayer.position.x - Math.sin(yaw) * ICE_SHIELD_DISTANCE;
    const shieldZ = localPlayer.position.z - Math.cos(yaw) * ICE_SHIELD_DISTANCE;
    
    // Throttled ground raycast
    let targetGroundY = localPlayer.position.y - 0.5;
    if (isPhysicsReady() && now - lastRaycastTimeRef.current > 100) {
      lastRaycastTimeRef.current = now;
      const groundCheck = checkGroundWithNormal(shieldX, localPlayer.position.y + 20, shieldZ, 100);
      if (groundCheck?.isWalkable) lastRaycastYRef.current = groundCheck.groundY;
    }
    if (lastRaycastYRef.current !== null) targetGroundY = lastRaycastYRef.current;
    
    if (smoothedGroundYRef.current === null) smoothedGroundYRef.current = targetGroundY;
    const yDiffGround = targetGroundY - smoothedGroundYRef.current;
    const smoothSpeed = Math.abs(yDiffGround) < 0.3 ? 2 : Math.abs(yDiffGround) < 1.0 ? 4 : 8;
    smoothedGroundYRef.current += yDiffGround * Math.min(smoothSpeed * delta, 1);
    
    groupRef.current.position.set(shieldX, smoothedGroundYRef.current, shieldZ);
    groupRef.current.rotation.set(0, yaw, 0);
    
    // Update instanced crystals
    for (let i = 0; i < SHIELD_CRYSTALS.length; i++) {
      const c = SHIELD_CRYSTALS[i];
      const delayedProgress = Math.max(0, (raiseProgress - c.d) / (1 - c.d));
      const crystalProgress = Math.min(delayedProgress, 1);
      const easedCrystal = 1 - Math.pow(1 - crystalProgress, 2.5);
      
      const currentHeight = c.h * easedCrystal;
      
      tempEuler.set(0, c.ry, c.rz);
      tempQuaternion.setFromEuler(tempEuler);
      tempScale.set(c.w, currentHeight, c.w * 0.8);
      tempVec3.set(c.x, currentHeight * 0.5, c.z);
      
      // Add slight shake during rise
      if (crystalProgress > 0 && crystalProgress < 1) {
        const shake = Math.sin(now * 0.05) * 0.02 * (1 - crystalProgress);
        tempVec3.x += shake;
      }
      
      tempMatrix.compose(tempVec3, tempQuaternion, tempScale);
      mesh.setMatrixAt(i, tempMatrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    
    // Update panel and ground frost
    if (panelRef.current) {
      panelRef.current.scale.setScalar(easedProgress);
      (panelRef.current.material as THREE.MeshStandardMaterial).opacity = 0.35 * easedProgress;
    }
    if (frostGroundRef.current) {
      frostGroundRef.current.scale.setScalar(easedProgress);
      (frostGroundRef.current.material as THREE.MeshBasicMaterial).opacity = 0.4 * easedProgress;
    }
    
    // Update frost particles (reduced to 8)
    for (let i = 0; i < frostParticleRefs.current.length; i++) {
      const particle = frostParticleRefs.current[i];
      if (!particle) continue;
      
      const particleTime = (now * 0.001 + i * 0.5) % 2;
      const particleY = particleTime * 1.5 * easedProgress;
      particle.position.set(
        Math.sin(i * 2.3 + now * 0.002) * 0.5 * (i % 3 - 1),
        particleY,
        Math.cos(i * 1.7 + now * 0.0015) * 0.3 + 0.3
      );
      particle.scale.setScalar(0.05 + (1 - particleY / 1.5) * 0.08);
      (particle.material as THREE.MeshBasicMaterial).opacity = (1 - particleY / 1.5) * 0.4 * easedProgress;
    }
    
    if (lightRef.current) {
      lightRef.current.intensity = (2 + Math.sin(now * 0.003) * 0.5) * easedProgress;
    }
  });
  
  return (
    <group ref={groupRef}>
      {/* Instanced crystals - single draw call */}
      <instancedMesh ref={instancedMeshRef} args={[crystalGeometry!, shieldCrystalMaterial, MAX_SHIELD_CRYSTALS]} frustumCulled={false} />
      
      {/* Panel */}
      <mesh ref={panelRef} geometry={shieldPanelGeometry!} material={shieldPanelMaterial} position={[0, 0, -0.15]} />
      
      {/* Ground frost */}
      <mesh ref={frostGroundRef} geometry={shieldGroundFrostGeometry!} material={shieldGroundFrostMaterial} position={[0, 0.02, 0.1]} rotation={[-Math.PI / 2, 0, 0]} />
      
      {/* Frost particles - reduced to 8 */}
      {SHIELD_FROST_PARTICLE_INDICES.map((i) => (
        <mesh key={i} ref={el => frostParticleRefs.current[i] = el} geometry={SHARED_GEOMETRIES.sphere4} material={shieldFrostParticleMaterial} />
      ))}
      
      <BudgetedPointLight budgetPriority={3} ref={lightRef} position={[0, 1.5, 0.5]} color={GLACIER_COLORS.iceLight} intensity={2} distance={6} decay={2} />
    </group>
  );
});

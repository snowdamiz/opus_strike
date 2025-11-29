import { useRef, useEffect, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useGameStore, type IceMalletSwingData, type IceWallRushData } from '../../store/gameStore';
import { damageNpc } from '../ui/GameConsole';
import { SHARED_GEOMETRIES } from './effectResources';
import { checkGroundWithNormal, isPhysicsReady, addIceWallCollider, cleanupExpiredIceWallColliders } from '../../hooks/usePhysics';
import { ICE_WALL_DURATION, ICE_WALL_SEGMENT_DEPTH } from '@voxel-strike/shared';

// ============================================================================
// GLACIER COLOR PALETTE
// ============================================================================

export const GLACIER_COLORS = {
  iceLight: 0x87ceeb,      // Sky blue (lighter ice)
  iceMedium: 0x3b82f6,     // Glacier blue (main color)
  iceDark: 0x1d4ed8,       // Deep ice blue
  iceGlow: 0x60a5fa,       // Soft blue glow
  iceCrystal: 0xbfdbfe,    // Crystalline white-blue
  frost: 0xdbeafe,         // Frost white-blue
  malletMetal: 0x4a5568,   // Mallet handle (dark metal)
} as const;

// ============================================================================
// REUSABLE TEMP OBJECTS - Avoid allocations in render loop
// ============================================================================

const tempVec3 = new THREE.Vector3();
const tempVec3_2 = new THREE.Vector3();
const tempMatrix = new THREE.Matrix4();
const tempQuaternion = new THREE.Quaternion();
const tempScale = new THREE.Vector3();
const tempEuler = new THREE.Euler();

// ============================================================================
// ICE MALLET SWING - Glacier basic attack
// Optimized: Cached materials, reusable vectors
// ============================================================================

const MALLET_SWING_DURATION = 0.4;
const MALLET_DAMAGE = 50;
const MALLET_RANGE = 12;
const MALLET_HIT_WIDTH = 2.5;

// All materials cached on first use
let materialsInitialized = false;
let malletHeadMaterial: THREE.MeshStandardMaterial;
let malletHandleMaterial: THREE.MeshStandardMaterial;
let malletCapMaterial: THREE.MeshStandardMaterial;
let malletBevelMaterial: THREE.MeshStandardMaterial;
let malletFrostRingMaterial: THREE.MeshStandardMaterial;
let malletVeinMaterial: THREE.MeshBasicMaterial;
let malletCrystalMaterial: THREE.MeshStandardMaterial;
let malletFrostCrystalMaterial: THREE.MeshStandardMaterial;
let frostParticleMaterial: THREE.MeshBasicMaterial;
let iceShardMaterial: THREE.MeshStandardMaterial;
let shieldCrystalMaterial: THREE.MeshStandardMaterial;
let shieldGlowCoreMaterial: THREE.MeshBasicMaterial;
let shieldShardMaterial: THREE.MeshStandardMaterial;
let shieldPanelMaterial: THREE.MeshStandardMaterial;
let shieldFrostParticleMaterial: THREE.MeshBasicMaterial;
let shieldGroundFrostMaterial: THREE.MeshBasicMaterial;

function initMaterials() {
  if (materialsInitialized) return;
  
  // Mallet materials
  malletHeadMaterial = new THREE.MeshStandardMaterial({
    color: GLACIER_COLORS.iceMedium,
    metalness: 0.3,
    roughness: 0.4,
    emissive: GLACIER_COLORS.iceGlow,
    emissiveIntensity: 0.3,
  });
  
  malletHandleMaterial = new THREE.MeshStandardMaterial({
    color: GLACIER_COLORS.malletMetal,
    metalness: 0.8,
    roughness: 0.3,
  });
  
  malletCapMaterial = new THREE.MeshStandardMaterial({
    color: GLACIER_COLORS.iceMedium,
    metalness: 0.3,
    roughness: 0.35,
    emissive: GLACIER_COLORS.iceGlow,
    emissiveIntensity: 0.15,
  });
  
  malletBevelMaterial = new THREE.MeshStandardMaterial({
    color: GLACIER_COLORS.iceDark,
    metalness: 0.4,
    roughness: 0.3,
  });
  
  malletFrostRingMaterial = new THREE.MeshStandardMaterial({
    color: GLACIER_COLORS.iceCrystal,
    metalness: 0.2,
    roughness: 0.3,
    transparent: true,
    opacity: 0.85,
  });
  
  malletVeinMaterial = new THREE.MeshBasicMaterial({
    color: GLACIER_COLORS.iceCrystal,
    transparent: true,
    opacity: 0.6,
  });
  
  malletCrystalMaterial = new THREE.MeshStandardMaterial({
    color: GLACIER_COLORS.iceCrystal,
    transparent: true,
    opacity: 0.9,
  });
  
  malletFrostCrystalMaterial = new THREE.MeshStandardMaterial({
    color: GLACIER_COLORS.frost,
    transparent: true,
    opacity: 0.85,
  });
  
  frostParticleMaterial = new THREE.MeshBasicMaterial({
    color: GLACIER_COLORS.frost,
    transparent: true,
    opacity: 0.4,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  
  iceShardMaterial = new THREE.MeshStandardMaterial({
    color: GLACIER_COLORS.iceCrystal,
    transparent: true,
    opacity: 0.8,
    emissive: GLACIER_COLORS.iceLight,
    emissiveIntensity: 0.3,
  });
  
  // Shield materials
  shieldCrystalMaterial = new THREE.MeshStandardMaterial({
    color: GLACIER_COLORS.iceCrystal,
    metalness: 0.1,
    roughness: 0.15,
    transparent: true,
    opacity: 0.85,
    emissive: GLACIER_COLORS.iceGlow,
    emissiveIntensity: 0.15,
  });
  
  shieldGlowCoreMaterial = new THREE.MeshBasicMaterial({
    color: GLACIER_COLORS.iceLight,
    transparent: true,
    opacity: 0.25,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  
  shieldShardMaterial = new THREE.MeshStandardMaterial({
    color: GLACIER_COLORS.frost,
    transparent: true,
    opacity: 0.8,
    emissive: GLACIER_COLORS.iceGlow,
    emissiveIntensity: 0.1,
  });
  
  shieldPanelMaterial = new THREE.MeshStandardMaterial({
    color: GLACIER_COLORS.iceMedium,
    metalness: 0.1,
    roughness: 0.2,
    transparent: true,
    opacity: 0.35,
    side: THREE.DoubleSide,
    emissive: GLACIER_COLORS.iceGlow,
    emissiveIntensity: 0.1,
  });
  
  shieldFrostParticleMaterial = new THREE.MeshBasicMaterial({
    color: GLACIER_COLORS.frost,
    transparent: true,
    opacity: 0.3,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  
  shieldGroundFrostMaterial = new THREE.MeshBasicMaterial({
    color: GLACIER_COLORS.frost,
    transparent: true,
    opacity: 0.4,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  
  materialsInitialized = true;
}

// Pre-allocated geometry for the mallet
let malletHeadMainGeometry: THREE.CylinderGeometry | null = null;
let malletHeadCapGeometry: THREE.CylinderGeometry | null = null;
let malletHeadBevelGeometry: THREE.CylinderGeometry | null = null;
let malletHandleGeometry: THREE.CylinderGeometry | null = null;
let shieldPanelGeometry: THREE.CircleGeometry | null = null;
let shieldGroundFrostGeometry: THREE.CircleGeometry | null = null;

function getMalletGeometry() {
  if (!malletHeadMainGeometry) {
    malletHeadMainGeometry = new THREE.CylinderGeometry(0.7, 0.7, 2.4, 8); // Reduced segments
  }
  if (!malletHeadCapGeometry) {
    malletHeadCapGeometry = new THREE.CylinderGeometry(0.8, 0.7, 0.3, 8);
  }
  if (!malletHeadBevelGeometry) {
    malletHeadBevelGeometry = new THREE.CylinderGeometry(0.4, 0.5, 0.4, 8);
  }
  if (!malletHandleGeometry) {
    malletHandleGeometry = new THREE.CylinderGeometry(0.06, 0.09, 7, 6);
  }
  return { malletHeadMainGeometry, malletHeadCapGeometry, malletHeadBevelGeometry, malletHandleGeometry };
}

function getShieldGeometry() {
  if (!shieldPanelGeometry) {
    shieldPanelGeometry = new THREE.CircleGeometry(3, 16, 0, Math.PI); // Reduced segments
  }
  if (!shieldGroundFrostGeometry) {
    shieldGroundFrostGeometry = new THREE.CircleGeometry(3.2, 12);
  }
  return { shieldPanelGeometry, shieldGroundFrostGeometry };
}

// Pre-computed static data for frost rings and veins
const FROST_RING_POSITIONS = [1.5, 2.8, 4.2, 5.5];
const VEIN_POSITIONS = [-0.8, -0.3, 0.3, 0.8];
const FROST_CRYSTAL_CONFIGS = [
  { pos: [-1.4, 0.5, -7.5], rot: [0, 0, -0.4], scale: [0.12, 0.35, 0.12], type: 'crystal' },
  { pos: [1.4, 0.4, -7.6], rot: [0, 0, 0.5], scale: [0.1, 0.3, 0.1], type: 'crystal' },
  { pos: [0, 0.6, -7.5], rot: [0, 0, 0], scale: [0.08, 0.25, 0.08], type: 'frost' },
  { pos: [-1.3, -0.4, -7.4], rot: [0.3, 0, 0.2], scale: [0.09, 0.28, 0.09], type: 'crystal' },
] as const;

interface IceMalletSwingProps {
  swing: IceMalletSwingData;
}

function IceMalletSwing({ swing }: IceMalletSwingProps) {
  const { camera } = useThree();
  const groupRef = useRef<THREE.Group>(null);
  const offsetGroupRef = useRef<THREE.Group>(null);
  const swingPivotRef = useRef<THREE.Group>(null);
  const frostTrailRefs = useRef<(THREE.Mesh | null)[]>([]);
  const iceShardRefs = useRef<(THREE.Mesh | null)[]>([]);
  const lightRef = useRef<THREE.PointLight>(null);
  const hasHitRef = useRef(swing.hasHit);
  const hitPlayersRef = useRef<Set<string>>(new Set());
  const shouldRemoveRef = useRef(false);
  
  // Store initial values in refs to avoid re-renders
  const startTimeRef = useRef(swing.startTime);
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
    
    const now = Date.now();
    const elapsed = (now - startTimeRef.current) / 1000;
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
      const worldAngle = camYaw - swingY;
      
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
          if (playerId.startsWith('npc_')) damageNpc(playerId, MALLET_DAMAGE);
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
          {Array.from({ length: 6 }).map((_, i) => (
            <mesh key={i} ref={el => frostTrailRefs.current[i] = el} geometry={SHARED_GEOMETRIES.sphere4} material={frostParticleMaterial} position={[0, 0, -7.5]} />
          ))}
          
          {/* Ice shards - reduced count */}
          {Array.from({ length: 4 }).map((_, i) => (
            <mesh key={i} ref={el => iceShardRefs.current[i] = el} geometry={SHARED_GEOMETRIES.cone4} material={iceShardMaterial} position={[0, 0, -7.5]} scale={[0.08, 0.18, 0.08]} />
          ))}
          
          <pointLight ref={lightRef} position={[0, 0, -7.5]} color={GLACIER_COLORS.iceLight} intensity={1.5} distance={6} decay={2} />
        </group>
      </group>
    </group>
  );
}

// ============================================================================
// IDLE MALLET - Optimized with cached materials
// ============================================================================

const IDLE_PULLOUT_DURATION = 0.25;

function IdleMallet() {
  const { camera } = useThree();
  const groupRef = useRef<THREE.Group>(null);
  const malletGroupRef = useRef<THREE.Group>(null);
  const bobRef = useRef(0);
  const pulloutStartRef = useRef(Date.now());
  
  initMaterials();
  const { malletHeadMainGeometry, malletHeadCapGeometry, malletHeadBevelGeometry, malletHandleGeometry } = getMalletGeometry();
  
  useFrame((_, delta) => {
    if (!groupRef.current || !malletGroupRef.current) return;
    
    groupRef.current.position.copy(camera.position);
    groupRef.current.quaternion.copy(camera.quaternion);
    
    const elapsed = (Date.now() - pulloutStartRef.current) / 1000;
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
        
        {FROST_CRYSTAL_CONFIGS.slice(0, 2).map((c, i) => (
          <mesh key={i} geometry={SHARED_GEOMETRIES.cone6} material={malletCrystalMaterial} position={c.pos as [number, number, number]} rotation={c.rot as [number, number, number]} scale={[c.scale[0] * 0.85, c.scale[1] * 0.85, c.scale[2] * 0.85]} />
        ))}
        
        <pointLight position={[0, 0, -7.5]} color={GLACIER_COLORS.iceLight} intensity={0.8} distance={4} decay={2} />
      </group>
    </group>
  );
}

// ============================================================================
// ICE SHIELD - Optimized with InstancedMesh for crystals
// ============================================================================

const ICE_SHIELD_RAISE_DURATION = 0.3;
const ICE_SHIELD_LOWER_DURATION = 0.2;
const ICE_SHIELD_DISTANCE = 2.5;
const MAX_SHIELD_CRYSTALS = 27;

// Pre-computed shield crystal configurations
const SHIELD_CRYSTALS = [
  // Main crystals
  { x: 0, z: 0, h: 2.8, w: 0.4, ry: 0, rz: 0.1, d: 0 },
  { x: 0.3, z: 0.15, h: 2.4, w: 0.35, ry: 0.2, rz: -0.15, d: 0.02 },
  { x: -0.35, z: 0.1, h: 2.5, w: 0.38, ry: -0.15, rz: 0.12, d: 0.01 },
  // Left side
  { x: -0.8, z: 0.05, h: 2.2, w: 0.32, ry: -0.3, rz: 0.2, d: 0.04 },
  { x: -1.2, z: 0.12, h: 1.9, w: 0.28, ry: -0.4, rz: 0.25, d: 0.06 },
  { x: -1.6, z: 0.08, h: 1.6, w: 0.26, ry: -0.5, rz: 0.3, d: 0.08 },
  { x: -2.0, z: 0.15, h: 1.3, w: 0.24, ry: -0.6, rz: 0.35, d: 0.1 },
  { x: -2.4, z: 0.1, h: 1.0, w: 0.22, ry: -0.7, rz: 0.4, d: 0.12 },
  // Right side
  { x: 0.75, z: 0.08, h: 2.1, w: 0.3, ry: 0.25, rz: -0.18, d: 0.03 },
  { x: 1.15, z: 0.1, h: 1.85, w: 0.27, ry: 0.35, rz: -0.22, d: 0.05 },
  { x: 1.55, z: 0.06, h: 1.55, w: 0.25, ry: 0.45, rz: -0.28, d: 0.07 },
  { x: 1.95, z: 0.12, h: 1.25, w: 0.23, ry: 0.55, rz: -0.32, d: 0.09 },
  { x: 2.35, z: 0.08, h: 0.95, w: 0.21, ry: 0.65, rz: -0.38, d: 0.11 },
  // Back layer
  { x: 0.15, z: -0.2, h: 2.0, w: 0.25, ry: 0.1, rz: 0.05, d: 0.02 },
  { x: -0.5, z: -0.18, h: 1.9, w: 0.24, ry: -0.2, rz: 0.08, d: 0.03 },
  { x: 0.6, z: -0.22, h: 1.7, w: 0.22, ry: 0.3, rz: -0.1, d: 0.04 },
  { x: -1.0, z: -0.15, h: 1.5, w: 0.2, ry: -0.35, rz: 0.15, d: 0.06 },
  { x: 1.0, z: -0.17, h: 1.4, w: 0.2, ry: 0.4, rz: -0.12, d: 0.05 },
  // Small accents
  { x: -0.2, z: 0.25, h: 1.2, w: 0.15, ry: -0.1, rz: 0.2, d: 0.03 },
  { x: 0.45, z: 0.28, h: 1.0, w: 0.14, ry: 0.15, rz: -0.25, d: 0.04 },
  { x: -0.65, z: 0.22, h: 0.9, w: 0.12, ry: -0.25, rz: 0.3, d: 0.05 },
  { x: 0.9, z: 0.2, h: 0.8, w: 0.12, ry: 0.3, rz: -0.28, d: 0.06 },
  { x: -1.4, z: 0.2, h: 0.7, w: 0.11, ry: -0.4, rz: 0.35, d: 0.08 },
  { x: 1.35, z: 0.18, h: 0.75, w: 0.11, ry: 0.38, rz: -0.32, d: 0.07 },
  { x: -1.7, z: -0.12, h: 1.2, w: 0.18, ry: -0.5, rz: 0.2, d: 0.08 },
  { x: 1.7, z: -0.14, h: 1.1, w: 0.18, ry: 0.5, rz: -0.18, d: 0.07 },
  { x: -2.75, z: 0.18, h: 0.7, w: 0.18, ry: -0.8, rz: 0.45, d: 0.14 },
];

let shieldCrystalGeometry: THREE.ConeGeometry | null = null;
function getShieldCrystalGeometry() {
  if (!shieldCrystalGeometry) {
    shieldCrystalGeometry = new THREE.ConeGeometry(1, 1, 6);
  }
  return shieldCrystalGeometry;
}

interface IceShieldProps {
  isLowering: boolean;
  lowerStartTime: number;
}

function IceShield({ isLowering, lowerStartTime }: IceShieldProps) {
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
  
  initMaterials();
  const crystalGeometry = getShieldCrystalGeometry();
  const { shieldPanelGeometry, shieldGroundFrostGeometry } = getShieldGeometry();
  
  useFrame((_, delta) => {
    const mesh = instancedMeshRef.current;
    if (!groupRef.current || !mesh || !localPlayer) return;
    
    const now = Date.now();
    
    let raiseProgress: number;
    if (isLowering) {
      const lowerElapsed = (now - lowerStartTime) / 1000;
      raiseProgress = 1 - Math.min(lowerElapsed / ICE_SHIELD_LOWER_DURATION, 1);
    } else {
      const raiseElapsed = (now - shieldStartTime) / 1000;
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
      {Array.from({ length: 8 }).map((_, i) => (
        <mesh key={i} ref={el => frostParticleRefs.current[i] = el} geometry={SHARED_GEOMETRIES.sphere4} material={shieldFrostParticleMaterial} />
      ))}
      
      <pointLight ref={lightRef} position={[0, 1.5, 0.5]} color={GLACIER_COLORS.iceLight} intensity={2} distance={6} decay={2} />
    </group>
  );
}

// ============================================================================
// ICE WALL RUSH - Glacier E ability
// Optimized: InstancedMesh for crystals, single useFrame
// ============================================================================

const ICE_WALL_RISE_DURATION = 0.3;
const ICE_WALL_FADE_DURATION = 1.0;
const CRYSTALS_PER_SEGMENT = 5;
const MAX_WALL_SEGMENTS = 25;
const MAX_WALL_CRYSTALS = MAX_WALL_SEGMENTS * CRYSTALS_PER_SEGMENT;

let wallMaterialsCreated = false;
let wallCrystalMaterial: THREE.MeshStandardMaterial;
let wallFrostMaterial: THREE.MeshBasicMaterial;

function getWallMaterials() {
  if (!wallMaterialsCreated) {
    wallCrystalMaterial = new THREE.MeshStandardMaterial({
      color: GLACIER_COLORS.iceCrystal,
      metalness: 0.15,
      roughness: 0.2,
      transparent: true,
      opacity: 0.9,
      emissive: GLACIER_COLORS.iceGlow,
      emissiveIntensity: 0.2,
    });
    wallFrostMaterial = new THREE.MeshBasicMaterial({
      color: GLACIER_COLORS.frost,
      transparent: true,
      opacity: 0.35,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    wallMaterialsCreated = true;
  }
  return { wallCrystalMaterial, wallFrostMaterial };
}

const CRYSTAL_LAYOUT = (() => {
  const configs: Array<{ tOffset: number; heightMult: number; widthBase: number; rotZ: number; delay: number }> = [];
  for (let i = 0; i < CRYSTALS_PER_SEGMENT; i++) {
    const t = i / (CRYSTALS_PER_SEGMENT - 1);
    const centerDist = Math.abs(t - 0.5) * 2;
    configs.push({
      tOffset: (t - 0.5) * 0.9,
      heightMult: (1 - centerDist * 0.4) * (0.85 + (i % 3) * 0.1),
      widthBase: 0.35 + (i % 2) * 0.1,
      rotZ: ((i % 3) - 1) * 0.15,
      delay: centerDist * 0.08,
    });
  }
  return configs;
})();

let wallCrystalGeometry: THREE.ConeGeometry | null = null;
function getWallCrystalGeometry() {
  if (!wallCrystalGeometry) wallCrystalGeometry = new THREE.ConeGeometry(1, 1, 6);
  return wallCrystalGeometry;
}

interface IceWallRushProps {
  rush: IceWallRushData;
}

function IceWallRush({ rush }: IceWallRushProps) {
  const instancedMeshRef = useRef<THREE.InstancedMesh>(null);
  const frostMeshesRef = useRef<Map<number, THREE.Mesh>>(new Map());
  // Track which segments have colliders registered
  const registeredCollidersRef = useRef<Set<string>>(new Set());
  
  const { wallCrystalMaterial, wallFrostMaterial } = getWallMaterials();
  const crystalGeometry = getWallCrystalGeometry();
  
  useFrame(() => {
    const mesh = instancedMeshRef.current;
    if (!mesh) return;
    
    const now = Date.now();
    const segments = rush.segments.slice(-MAX_WALL_SEGMENTS);
    
    let instanceIdx = 0;
    
    segments.forEach((segment, segIdx) => {
      const age = (now - segment.createdAt) / 1000;
      // Use createdAt for stable ID - segIdx shifts as array is sliced
      const segmentId = `${rush.id}_${segment.createdAt}`;
      
      // Register collider for new segments (if physics ready and not already registered)
      if (!registeredCollidersRef.current.has(segmentId) && age < ICE_WALL_DURATION - ICE_WALL_FADE_DURATION) {
        if (isPhysicsReady()) {
          // Add collision box for this wall segment
          const colliderAdded = addIceWallCollider(
            segmentId,
            segment.position.x,
            segment.position.y,
            segment.position.z,
            segment.rotation,
            segment.width,    // width
            segment.height,   // height  
            ICE_WALL_SEGMENT_DEPTH // depth/thickness
          );
          if (colliderAdded) {
            registeredCollidersRef.current.add(segmentId);
          }
        }
      }
      
      if (age >= ICE_WALL_DURATION) {
        for (let c = 0; c < CRYSTALS_PER_SEGMENT; c++) {
          tempScale.set(0, 0, 0);
          tempMatrix.compose(tempVec3, tempQuaternion, tempScale);
          mesh.setMatrixAt(segIdx * CRYSTALS_PER_SEGMENT + c, tempMatrix);
        }
        return;
      }
      
      const fadeStart = ICE_WALL_DURATION - ICE_WALL_FADE_DURATION;
      const fadeProgress = age > fadeStart ? Math.min((age - fadeStart) / ICE_WALL_FADE_DURATION, 1) : 0;
      // Eased sink progress - starts slow, accelerates as it sinks (ease-in)
      const sinkProgress = fadeProgress > 0 ? Math.pow(fadeProgress, 2) : 0;
      
      CRYSTAL_LAYOUT.forEach((config, crystalIdx) => {
        const idx = segIdx * CRYSTALS_PER_SEGMENT + crystalIdx;
        if (idx >= MAX_WALL_CRYSTALS) return;
        
        const crystalRiseProgress = Math.min(Math.max(0, (age - config.delay) / ICE_WALL_RISE_DURATION), 1);
        const crystalEasedRise = 1 - Math.pow(1 - crystalRiseProgress, 3);
        
        // Full height when risen, then sink back down during fade
        const maxHeight = segment.height * config.heightMult * crystalEasedRise;
        // Stagger the sink - crystals on edges sink first (like they're crumbling inward)
        const staggeredSink = Math.min(1, sinkProgress + Math.abs(config.tOffset) * 0.3);
        const sinkFactor = 1 - staggeredSink;
        const height = maxHeight * sinkFactor;
        
        const cosR = Math.cos(segment.rotation);
        const sinR = Math.sin(segment.rotation);
        const localX = config.tOffset * segment.width;
        // Y position: base at ground, crystal sinks down so we keep bottom at ground level
        const yPos = segment.position.y + height / 2;
        tempVec3.set(segment.position.x + localX * cosR, yPos, segment.position.z + localX * sinR);
        
        tempEuler.set(0, segment.rotation, config.rotZ);
        tempQuaternion.setFromEuler(tempEuler);
        
        // Scale shrinks as crystal sinks - width shrinks slightly, height matches sink
        const widthFade = 1 - sinkProgress * 0.3;
        tempScale.set(config.widthBase * widthFade, Math.max(0.01, height), config.widthBase * 0.7 * widthFade);
        
        tempMatrix.compose(tempVec3, tempQuaternion, tempScale);
        mesh.setMatrixAt(idx, tempMatrix);
        instanceIdx++;
      });
      
      const frostMesh = frostMeshesRef.current.get(segIdx);
      if (frostMesh) {
        const riseProgress = Math.min(age / ICE_WALL_RISE_DURATION, 1);
        // Frost patch shrinks as crystals sink back down
        const frostScale = (1 - Math.pow(1 - riseProgress, 3)) * (1 - sinkProgress * 0.8);
        frostMesh.scale.setScalar(segment.width * 0.5 * frostScale);
        (frostMesh.material as THREE.MeshBasicMaterial).opacity = 0.35 * (1 - fadeProgress);
      }
    });
    
    for (let i = instanceIdx; i < MAX_WALL_CRYSTALS; i++) {
      tempScale.set(0, 0, 0);
      tempMatrix.compose(tempVec3, tempQuaternion, tempScale);
      mesh.setMatrixAt(i, tempMatrix);
    }
    
    mesh.instanceMatrix.needsUpdate = true;
    
    // Update material opacity
    const avgFade = segments.length > 0 ? segments.reduce((sum, s) => {
      const age = (now - s.createdAt) / 1000;
      const fadeStart = ICE_WALL_DURATION - ICE_WALL_FADE_DURATION;
      return sum + (age > fadeStart ? Math.min((age - fadeStart) / ICE_WALL_FADE_DURATION, 1) : 0);
    }, 0) / segments.length : 0;
    wallCrystalMaterial.opacity = 0.9 * (1 - avgFade * 0.3);
    wallCrystalMaterial.emissiveIntensity = 0.2 * (1 - avgFade * 0.5);
  });
  
  const now = Date.now();
  const activeSegments = rush.segments.slice(-MAX_WALL_SEGMENTS).filter(seg => (now - seg.createdAt) / 1000 < ICE_WALL_DURATION);
  
  return (
    <group>
      <instancedMesh ref={instancedMeshRef} args={[crystalGeometry!, wallCrystalMaterial, MAX_WALL_CRYSTALS]} frustumCulled={false} />
      {activeSegments.map((segment, segIdx) => (
        <mesh key={segIdx} ref={el => { if (el) frostMeshesRef.current.set(segIdx, el); }} geometry={SHARED_GEOMETRIES.cylinder8} material={wallFrostMaterial} position={[segment.position.x, segment.position.y + 0.02, segment.position.z]} rotation={[Math.PI / 2, 0, 0]} scale={[segment.width * 0.5, 0.08, segment.width * 0.5]} />
      ))}
    </group>
  );
}

// ============================================================================
// FROST STORM EFFECT - Glacier Q ability visual (snow storm around player)
// ============================================================================

const FROST_STORM_PARTICLE_COUNT = 60;
const FROST_STORM_RADIUS = 2.5;
const FROST_STORM_HEIGHT = 3.5;

// Pre-create materials for frost storm
let frostStormParticleMaterial: THREE.MeshBasicMaterial | null = null;
let frostStormSnowMaterial: THREE.MeshBasicMaterial | null = null;
let frostStormGlowMaterial: THREE.MeshBasicMaterial | null = null;

function getFrostStormMaterials() {
  if (!frostStormParticleMaterial) {
    frostStormParticleMaterial = new THREE.MeshBasicMaterial({
      color: GLACIER_COLORS.frost,
      transparent: true,
      opacity: 0.7,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
  }
  if (!frostStormSnowMaterial) {
    frostStormSnowMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
  }
  if (!frostStormGlowMaterial) {
    frostStormGlowMaterial = new THREE.MeshBasicMaterial({
      color: GLACIER_COLORS.iceLight,
      transparent: true,
      opacity: 0.15,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
  }
  return { frostStormParticleMaterial, frostStormSnowMaterial, frostStormGlowMaterial };
}

// Particle initial positions
interface FrostStormParticle {
  angle: number;
  height: number;
  radius: number;
  speed: number;
  size: number;
  type: 'snow' | 'ice';
}

function FrostStormEffect() {
  const { camera } = useThree();
  const groupRef = useRef<THREE.Group>(null);
  const particleRefs = useRef<(THREE.Mesh | null)[]>([]);
  const glowRingRef = useRef<THREE.Mesh>(null);
  const innerGlowRef = useRef<THREE.Mesh>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  
  const frostStormStartTime = useGameStore(state => state.frostStormStartTime);
  const frostStormShield = useGameStore(state => state.frostStormShield);
  const localPlayer = useGameStore(state => state.localPlayer);
  
  const { frostStormParticleMaterial, frostStormSnowMaterial, frostStormGlowMaterial } = getFrostStormMaterials();
  
  // Generate particle configs once
  const particleConfigs = useRef<FrostStormParticle[]>([]);
  if (particleConfigs.current.length === 0) {
    for (let i = 0; i < FROST_STORM_PARTICLE_COUNT; i++) {
      particleConfigs.current.push({
        angle: (i / FROST_STORM_PARTICLE_COUNT) * Math.PI * 2,
        height: Math.random() * FROST_STORM_HEIGHT,
        radius: FROST_STORM_RADIUS * (0.5 + Math.random() * 0.5),
        speed: 2 + Math.random() * 3,
        size: 0.04 + Math.random() * 0.06,
        type: Math.random() > 0.4 ? 'snow' : 'ice',
      });
    }
  }
  
  useFrame(() => {
    if (!groupRef.current || !localPlayer) return;
    
    const now = Date.now();
    const elapsed = (now - frostStormStartTime) / 1000;
    
    // Follow player position (first person - use camera position)
    groupRef.current.position.set(
      camera.position.x,
      camera.position.y - 0.9, // Center storm around player body
      camera.position.z
    );
    
    // Calculate intensity based on shield remaining (75 max)
    const shieldIntensity = frostStormShield / 75;
    const fadeIn = Math.min(elapsed * 2, 1); // Fade in over 0.5 seconds
    const intensity = fadeIn * shieldIntensity;
    
    // Update particles - spiral motion
    for (let i = 0; i < particleRefs.current.length; i++) {
      const particle = particleRefs.current[i];
      const config = particleConfigs.current[i];
      if (!particle || !config) continue;
      
      const time = elapsed * config.speed + config.angle;
      const heightOscillation = Math.sin(time * 0.5 + i) * 0.3;
      
      // Spiral outward and upward
      const currentRadius = config.radius * (0.8 + Math.sin(time * 0.3) * 0.2);
      const x = Math.cos(time) * currentRadius;
      const z = Math.sin(time) * currentRadius;
      const y = (config.height + heightOscillation + elapsed * 0.5) % FROST_STORM_HEIGHT;
      
      particle.position.set(x, y, z);
      particle.scale.setScalar(config.size * intensity * (0.8 + Math.sin(time * 2) * 0.2));
      
      // Fade based on height (particles fade as they rise)
      const heightFade = 1 - (y / FROST_STORM_HEIGHT) * 0.5;
      const mat = particle.material as THREE.MeshBasicMaterial;
      mat.opacity = (config.type === 'snow' ? 0.8 : 0.7) * intensity * heightFade;
    }
    
    // Update glow ring
    if (glowRingRef.current) {
      glowRingRef.current.scale.setScalar(1 + Math.sin(elapsed * 3) * 0.1);
      const glowMat = glowRingRef.current.material as THREE.MeshBasicMaterial;
      glowMat.opacity = 0.15 * intensity * (0.8 + Math.sin(elapsed * 2) * 0.2);
    }
    
    // Update inner glow
    if (innerGlowRef.current) {
      innerGlowRef.current.scale.setScalar(0.8 + Math.sin(elapsed * 4) * 0.1);
      const innerMat = innerGlowRef.current.material as THREE.MeshBasicMaterial;
      innerMat.opacity = 0.2 * intensity;
    }
    
    // Update light
    if (lightRef.current) {
      lightRef.current.intensity = 2 * intensity * (0.9 + Math.sin(elapsed * 5) * 0.1);
    }
  });
  
  return (
    <group ref={groupRef}>
      {/* Glow ring around player */}
      <mesh ref={glowRingRef} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[FROST_STORM_RADIUS * 0.8, FROST_STORM_RADIUS * 1.2, 32]} />
        <meshBasicMaterial
          color={GLACIER_COLORS.iceGlow}
          transparent
          opacity={0.15}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>
      
      {/* Inner glow sphere */}
      <mesh ref={innerGlowRef}>
        <sphereGeometry args={[FROST_STORM_RADIUS * 0.6, 16, 16]} />
        <meshBasicMaterial
          color={GLACIER_COLORS.iceCrystal}
          transparent
          opacity={0.1}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      
      {/* Storm particles */}
      {particleConfigs.current.map((config, i) => (
        <mesh
          key={i}
          ref={el => particleRefs.current[i] = el}
          geometry={SHARED_GEOMETRIES.sphere4}
          material={config.type === 'snow' ? frostStormSnowMaterial! : frostStormParticleMaterial!}
        />
      ))}
      
      {/* Light source */}
      <pointLight
        ref={lightRef}
        color={GLACIER_COLORS.iceLight}
        intensity={2}
        distance={6}
        decay={2}
        position={[0, 1.5, 0]}
      />
    </group>
  );
}

// ============================================================================
// GLACIER EFFECTS MANAGER
// ============================================================================

export function GlacierEffectsManager() {
  const iceMalletSwings = useGameStore(state => state.iceMalletSwings);
  const iceWallRushes = useGameStore(state => state.iceWallRushes);
  const iceWallRushActive = useGameStore(state => state.iceWallRushActive);
  const localPlayer = useGameStore(state => state.localPlayer);
  const gamePhase = useGameStore(state => state.gamePhase);
  const glacierSwingHeld = useGameStore(state => state.glacierSwingHeld);
  const glacierShieldActive = useGameStore(state => state.glacierShieldActive);
  const frostStormActive = useGameStore(state => state.frostStormActive);
  
  const wasShieldActiveRef = useRef(false);
  const shieldLoweringRef = useRef(false);
  const [shieldVisible, setShieldVisible] = useState(false);
  const [isLowering, setIsLowering] = useState(false);
  const [lowerStartTime, setLowerStartTime] = useState(0);
  
  const isGlacier = localPlayer?.heroId === 'glacier';
  const isPlaying = gamePhase === 'playing' || gamePhase === 'countdown';
  const hasActiveSwings = iceMalletSwings.some(swing => swing.ownerId === localPlayer?.id);
  const isSwinging = hasActiveSwings || glacierSwingHeld;
  
  useEffect(() => {
    if (glacierShieldActive && !wasShieldActiveRef.current) {
      setShieldVisible(true);
      setIsLowering(false);
      shieldLoweringRef.current = false;
    } else if (!glacierShieldActive && wasShieldActiveRef.current) {
      setIsLowering(true);
      setLowerStartTime(Date.now());
      shieldLoweringRef.current = true;
      setTimeout(() => {
        if (shieldLoweringRef.current) {
          setShieldVisible(false);
          setIsLowering(false);
          shieldLoweringRef.current = false;
        }
      }, ICE_SHIELD_LOWER_DURATION * 1000);
    }
    wasShieldActiveRef.current = glacierShieldActive;
  }, [glacierShieldActive]);
  
  useEffect(() => {
    const interval = setInterval(() => {
      useGameStore.getState().clearExpiredIceMalletSwings();
      useGameStore.getState().clearExpiredIceWallRushes();
      // Cleanup expired ice wall colliders (matches ICE_WALL_DURATION)
      cleanupExpiredIceWallColliders(ICE_WALL_DURATION * 1000);
    }, 100);
    return () => clearInterval(interval);
  }, []);
  
  return (
    <group>
      {isGlacier && isPlaying && !isSwinging && !shieldVisible && !iceWallRushActive && <IdleMallet />}
      {isGlacier && isPlaying && shieldVisible && <IceShield isLowering={isLowering} lowerStartTime={lowerStartTime} />}
      {isGlacier && isPlaying && frostStormActive && <FrostStormEffect />}
      {iceMalletSwings.map(swing => <IceMalletSwing key={swing.id} swing={swing} />)}
      {iceWallRushes.map(rush => <IceWallRush key={rush.id} rush={rush} />)}
    </group>
  );
}

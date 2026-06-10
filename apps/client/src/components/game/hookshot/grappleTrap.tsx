import React, { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useGameStore, type GrappleTrapData } from '../../../store/gameStore';
import { checkGroundWithNormal, isPhysicsReady, raycastDirection } from '../../../hooks/usePhysics';
import { triggerTerrainImpact } from '../TerrainImpactEffects';
import { BudgetedPointLight } from '../systems/DynamicLightBudget';
import { getFrameClock } from '../../../utils/frameClock';
import { 
  SHARED_GEOMETRIES, 
  HOOKSHOT_COLORS, 
  TEMP_VECTORS,
} from '../effectResources';

// ============================================================================
// GRAPPLE TRAP - AOE trap that hooks enemies (Ultimate / F ability)
// THROWN LIKE A GRENADE: Flies in arc affected by gravity, lands and activates
// VISUALS: Red circle border + hook device in center
// ============================================================================

const GRAPPLE_TRAP_RADIUS = 8;
const GRAPPLE_TRAP_DOT_DAMAGE = 15;
const GRAPPLE_TRAP_GRAVITY = 25; // Gravity affecting the thrown device
const TRAP_ARM_INDICES = [0, 1, 2, 3] as const;
const TRAP_TARGET_SAMPLE_FACTORS = [0.5, 1, 1.5] as const;

const GRAPPLE_TRAP_MATERIALS = {
  body: new THREE.MeshStandardMaterial({ color: 0x3a3a3a, metalness: 0.9, roughness: 0.2 }),
  cap: new THREE.MeshStandardMaterial({ color: 0x555555, metalness: 0.85, roughness: 0.25 }),
  ring: new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.9, roughness: 0.2, side: THREE.DoubleSide }),
  arm: new THREE.MeshStandardMaterial({ color: 0x4a4a4a, metalness: 0.85, roughness: 0.25 }),
  tip: new THREE.MeshStandardMaterial({
    color: HOOKSHOT_COLORS.energyGlow,
    metalness: 0.9,
    roughness: 0.15,
    emissive: HOOKSHOT_COLORS.energy,
    emissiveIntensity: 0.3,
  }),
  core: new THREE.MeshBasicMaterial({ color: HOOKSHOT_COLORS.energy, transparent: true, opacity: 0.8 }),
  coreGlow: new THREE.MeshBasicMaterial({ color: HOOKSHOT_COLORS.energyGlow, transparent: true, opacity: 0.3 }),
  activeRing: new THREE.MeshBasicMaterial({
    color: HOOKSHOT_COLORS.energy,
    transparent: true,
    opacity: 0.8,
    side: THREE.DoubleSide,
  }),
  targetRingValid: new THREE.MeshBasicMaterial({
    color: HOOKSHOT_COLORS.energy,
    transparent: true,
    opacity: 0.8,
    side: THREE.DoubleSide,
  }),
  targetRingInvalid: new THREE.MeshBasicMaterial({
    color: HOOKSHOT_COLORS.energyGlow,
    transparent: true,
    opacity: 0.8,
    side: THREE.DoubleSide,
  }),
  targetCenter: new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.9,
    side: THREE.DoubleSide,
  }),
  targetLineValid: new THREE.MeshBasicMaterial({
    color: HOOKSHOT_COLORS.energy,
    transparent: true,
    opacity: 0.5,
    side: THREE.DoubleSide,
  }),
  targetLineInvalid: new THREE.MeshBasicMaterial({
    color: HOOKSHOT_COLORS.energyGlow,
    transparent: true,
    opacity: 0.5,
    side: THREE.DoubleSide,
  }),
};

interface GrappleTrapProps {
  trap: GrappleTrapData;
}

export const GrappleTrapEffect = React.memo(({ trap }: GrappleTrapProps) => {
  const groupRef = useRef<THREE.Group>(null);
  const deviceRef = useRef<THREE.Group>(null);
  const circleRef = useRef<THREE.Mesh>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  
  // Flying state for grenade arc
  const isLandedRef = useRef(false);
  const currentPosRef = useRef({ 
    x: trap.startPosition?.x ?? trap.position.x, 
    y: trap.startPosition?.y ?? trap.position.y, 
    z: trap.startPosition?.z ?? trap.position.z 
  });
  const velocityRef = useRef({ 
    x: trap.velocity?.x ?? 0, 
    y: trap.velocity?.y ?? 0, 
    z: trap.velocity?.z ?? 0 
  });
  const landedPosRef = useRef({ x: trap.position.x, y: trap.position.y, z: trap.position.z });
  const landedTimeRef = useRef<number | null>(null);
  const startFrameTimeRef = useRef(getFrameClock().nowMs - Math.max(0, Date.now() - trap.startTime));
  
  const lastDamageTimeRef = useRef<Map<string, number>>(new Map());
  
  useFrame((state, delta) => {
    if (!groupRef.current || !deviceRef.current) return;
    
    const time = state.clock.elapsedTime;
    const frameNow = getFrameClock().nowMs;
    
    // Check if trap has expired
    if (landedTimeRef.current !== null) {
      const landedElapsed = (frameNow - landedTimeRef.current) / 1000;
      if (landedElapsed >= trap.duration) return;
    }
    
    // === FLYING PHASE (grenade arc) ===
    if (!isLandedRef.current) {
      const pos = currentPosRef.current;
      const vel = velocityRef.current;
      
      // Apply gravity
      vel.y -= GRAPPLE_TRAP_GRAVITY * delta;
      
      // Move device
      pos.x += vel.x * delta;
      pos.y += vel.y * delta;
      pos.z += vel.z * delta;
      
      // Check for ground collision
      if (isPhysicsReady()) {
        const groundCheck = checkGroundWithNormal(pos.x, pos.y + 2, pos.z, 10, {
          priority: 'visual',
          feature: 'effect:hookshotTrapGround',
        });
        if (groundCheck && pos.y <= groundCheck.groundY + 0.1) {
          // Landed!
          isLandedRef.current = true;
          landedPosRef.current = { x: pos.x, y: groundCheck.groundY, z: pos.z };
          landedTimeRef.current = frameNow;
          pos.y = groundCheck.groundY;
          triggerTerrainImpact('hookshot_trap', landedPosRef.current, {
            normal: groundCheck.normal,
            scale: 1.05,
          });
        }
      } else if (pos.y <= 0) {
        // Fallback ground check
        isLandedRef.current = true;
        landedPosRef.current = { x: pos.x, y: 0, z: pos.z };
        landedTimeRef.current = frameNow;
        pos.y = 0;
        triggerTerrainImpact('hookshot_trap', landedPosRef.current, { scale: 1.05 });
      }
      
      // Update device position while flying
      groupRef.current.position.set(pos.x, pos.y, pos.z);
      
      // Spin while flying
      deviceRef.current.rotation.x += delta * 8;
      deviceRef.current.rotation.z += delta * 6;
      
      // Hide circle while flying
      if (circleRef.current) {
        circleRef.current.visible = false;
      }
      
      return;
    }
    
    // === LANDED PHASE (active trap) ===
    const { players, localPlayer } = useGameStore.getState();
    const landedPos = landedPosRef.current;
    
    // Position group at landed location
    groupRef.current.position.set(landedPos.x, landedPos.y, landedPos.z);
    
    // Show and animate circle
    if (circleRef.current) {
      circleRef.current.visible = true;
    }
    
    // Check for players in AOE and apply damage
    for (const [playerId, player] of players) {
      if (playerId === localPlayer?.id && trap.ownerTeam === localPlayer?.team) continue;
      if (player.state !== 'alive') continue;
      if (localPlayer && player.team === trap.ownerTeam) continue;
      
      const dx = player.position.x - landedPos.x;
      const dz = player.position.z - landedPos.z;
      
      if (dx * dx + dz * dz <= trap.radius * trap.radius) {
        const lastDamage = lastDamageTimeRef.current.get(playerId) || 0;
        
        if (frameNow - lastDamage > 1000) {
          lastDamageTimeRef.current.set(playerId, frameNow);
          
        }
      }
    }
    
    // Animate device - slow spin when landed
    deviceRef.current.rotation.y += delta * 1.5;
    deviceRef.current.position.y = 0.4 + Math.sin(time * 2) * 0.05;
    
    // Animate light pulse
    if (lightRef.current) {
      lightRef.current.intensity = 2 + Math.sin(time * 4) * 0.5;
    }
  });
  
  // Check if already expired on mount
  const elapsed = (getFrameClock().nowMs - startFrameTimeRef.current) / 1000;
  if (elapsed >= trap.duration + 5) return null; // Extra time for flight
  
  return (
    <group ref={groupRef} position={[currentPosRef.current.x, currentPosRef.current.y, currentPosRef.current.z]}>
      {/* === HOOK DEVICE - Central mechanical trap device === */}
      <group ref={deviceRef} position={[0, 0.4, 0]}>
        {/* Main body - cylindrical core */}
        <mesh geometry={SHARED_GEOMETRIES.cylinder8} scale={[0.2, 0.15, 0.2]} material={GRAPPLE_TRAP_MATERIALS.body} />
        
        {/* Top cap with hook ring */}
        <mesh position={[0, 0.1, 0]} geometry={SHARED_GEOMETRIES.cylinder8} scale={[0.25, 0.05, 0.25]} material={GRAPPLE_TRAP_MATERIALS.cap} />
        
        {/* Hook attachment ring on top */}
        <mesh position={[0, 0.15, 0]} rotation={[Math.PI / 2, 0, 0]} geometry={SHARED_GEOMETRIES.ring16} scale={[0.12, 0.12, 0.04]} material={GRAPPLE_TRAP_MATERIALS.ring} />
        
        {/* Four hook arms extending outward */}
        {TRAP_ARM_INDICES.map(i => {
          const angle = (i * Math.PI / 2);
          return (
            <group key={i} rotation={[0, angle, 0]}>
              {/* Arm */}
              <mesh position={[0.18, -0.02, 0]} rotation={[0, 0, 0.6]} geometry={SHARED_GEOMETRIES.cylinder8} scale={[0.04, 0.15, 0.04]} material={GRAPPLE_TRAP_MATERIALS.arm} />
              {/* Hook tip */}
              <mesh position={[0.28, -0.08, 0]} rotation={[0, 0, 1.8]} geometry={SHARED_GEOMETRIES.cone6} scale={[0.035, 0.08, 0.035]} material={GRAPPLE_TRAP_MATERIALS.tip} />
            </group>
          );
        })}
        
        {/* Bottom base */}
        <mesh position={[0, -0.1, 0]} geometry={SHARED_GEOMETRIES.cylinder8} scale={[0.22, 0.05, 0.22]} material={GRAPPLE_TRAP_MATERIALS.cap} />
        
        {/* Cyan energy core glow - matches hookshot theme */}
        <mesh geometry={SHARED_GEOMETRIES.sphere8} scale={0.12} material={GRAPPLE_TRAP_MATERIALS.core} />
        <mesh geometry={SHARED_GEOMETRIES.sphere8} scale={0.2} material={GRAPPLE_TRAP_MATERIALS.coreGlow} />
        
        {/* Device light */}
        <BudgetedPointLight budgetPriority={2} color={HOOKSHOT_COLORS.energy} intensity={2} distance={4} decay={2} />
      </group>
      
      {/* === CYAN CIRCLE BORDER - AOE indicator matching hookshot theme === */}
      <mesh ref={circleRef} rotation-x={-Math.PI / 2} position-y={0.05} geometry={SHARED_GEOMETRIES.ring24} scale={[trap.radius, trap.radius, 1]} material={GRAPPLE_TRAP_MATERIALS.activeRing} />
      
      {/* Ground light when active */}
      <BudgetedPointLight budgetPriority={3} ref={lightRef} color={HOOKSHOT_COLORS.energy} intensity={2} distance={trap.radius * 1.2} decay={2} position={[0, 0.5, 0]} />
    </group>
  );
}, (prev, next) => {
  // Custom comparison: only re-render if trap.id or startTime changes
  return prev.trap.id === next.trap.id && prev.trap.startTime === next.trap.startTime;
});

// ============================================================================
// GRAPPLE TRAP TARGETING INDICATOR
// ============================================================================

interface GrappleTrapTargetingProps {
  isActive: boolean;
  onTargetUpdate: (position: THREE.Vector3 | null, isValid: boolean) => void;
}

const TRAP_MAX_RANGE = 30;
const TRAP_MIN_RANGE = 3;

export const GrappleTrapTargetingIndicator = React.memo(({ isActive, onTargetUpdate }: GrappleTrapTargetingProps) => {
  const indicatorRef = useRef<THREE.Group>(null);
  const isValidRef = useRef(false);
  const reportedTargetRef = useRef(new THREE.Vector3());
  const lastReportedTargetRef = useRef(new THREE.Vector3(Number.POSITIVE_INFINITY, 0, 0));
  const lastReportedValidRef = useRef(false);
  const lastReportAtRef = useRef(0);
  const wasActiveRef = useRef(false);
  const { camera } = useThree();
  
  useFrame(() => {
    const now = getFrameClock().nowMs;

    if (!isActive) {
      if (indicatorRef.current) indicatorRef.current.visible = false;
      if (wasActiveRef.current) {
        wasActiveRef.current = false;
        lastReportedTargetRef.current.set(Number.POSITIVE_INFINITY, 0, 0);
        lastReportedValidRef.current = false;
        lastReportAtRef.current = now;
        onTargetUpdate(null, false);
      }
      return;
    }
    wasActiveRef.current = true;
    
    const localPlayer = useGameStore.getState().localPlayer;
    if (!localPlayer) {
      if (lastReportedValidRef.current || lastReportedTargetRef.current.x !== Number.POSITIVE_INFINITY) {
        lastReportedTargetRef.current.set(Number.POSITIVE_INFINITY, 0, 0);
        lastReportedValidRef.current = false;
        lastReportAtRef.current = now;
        onTargetUpdate(null, false);
      }
      return;
    }
    
    TEMP_VECTORS.v1.set(0, 0, -1).applyQuaternion(camera.quaternion);
    
    let targetX = camera.position.x;
    let targetY = camera.position.y;
    let targetZ = camera.position.z;
    let isValid = false;
    let foundTarget = false;
    
    if (isPhysicsReady()) {
      const directHit = raycastDirection(
        camera.position.x, camera.position.y, camera.position.z,
        TEMP_VECTORS.v1.x, TEMP_VECTORS.v1.y, TEMP_VECTORS.v1.z,
        TRAP_MAX_RANGE + 10,
        {
          priority: 'visual',
          feature: 'targeting:hookshotTrap',
        }
      );
      
      if (directHit && directHit.hit) {
        targetX = directHit.point.x;
        targetY = directHit.point.y;
        targetZ = directHit.point.z;
        foundTarget = true;
        
        if (!directHit.isWalkable) {
          const groundBelow = checkGroundWithNormal(targetX, targetY + 5, targetZ, 50, {
            priority: 'visual',
            feature: 'targeting:hookshotTrap',
          });
          if (groundBelow?.isWalkable) {
            targetY = groundBelow.groundY + 0.1;
          }
        } else {
          targetY += 0.1;
        }
      }
      
      if (!foundTarget) {
        const pitch = Math.asin(Math.max(-1, Math.min(1, -TEMP_VECTORS.v1.y)));
        const baseDist = pitch > 0.3 ? 15 : (pitch > 0 ? 20 : 25);
        for (let sampleIndex = 0; sampleIndex < 4; sampleIndex++) {
          const dist = sampleIndex === 3 ? TRAP_MAX_RANGE : baseDist * TRAP_TARGET_SAMPLE_FACTORS[sampleIndex];
          const sampleX = camera.position.x + TEMP_VECTORS.v1.x * dist;
          const sampleY = camera.position.y + TEMP_VECTORS.v1.y * dist;
          const sampleZ = camera.position.z + TEMP_VECTORS.v1.z * dist;
          
          const groundCheck = checkGroundWithNormal(sampleX, Math.max(sampleY + 50, camera.position.y + 50), sampleZ, 150, {
            priority: 'visual',
            feature: 'targeting:hookshotTrap',
          });
          
          if (groundCheck?.isWalkable) {
            targetX = sampleX;
            targetY = groundCheck.groundY + 0.1;
            targetZ = sampleZ;
            foundTarget = true;
            break;
          }
        }
      }
      
      if (foundTarget) {
        const dx = targetX - localPlayer.position.x;
        const dz = targetZ - localPlayer.position.z;
        const distH = Math.sqrt(dx * dx + dz * dz);
        
        if (distH > TRAP_MAX_RANGE) {
          const scale = TRAP_MAX_RANGE / distH;
          targetX = localPlayer.position.x + dx * scale;
          targetZ = localPlayer.position.z + dz * scale;
          
          const groundCheck = checkGroundWithNormal(targetX, targetY + 30, targetZ, 100, {
            priority: 'visual',
            feature: 'targeting:hookshotTrap',
          });
          if (groundCheck?.isWalkable) {
            targetY = groundCheck.groundY + 0.1;
          } else {
            foundTarget = false;
          }
        }
        
        if (foundTarget && distH >= TRAP_MIN_RANGE) {
          isValid = true;
        }
      }
    }
    
    TEMP_VECTORS.v4.set(targetX, targetY, targetZ);
    isValidRef.current = isValid;
    
    if (indicatorRef.current) {
      indicatorRef.current.visible = true;
      indicatorRef.current.position.copy(TEMP_VECTORS.v4);
    }
    
    const targetMoved = lastReportedTargetRef.current.distanceToSquared(TEMP_VECTORS.v4) > 0.04;
    const validityChanged = lastReportedValidRef.current !== isValid;
    const cadenceElapsed = now - lastReportAtRef.current >= 100;

    if (targetMoved || validityChanged || cadenceElapsed) {
      reportedTargetRef.current.copy(TEMP_VECTORS.v4);
      lastReportedTargetRef.current.copy(TEMP_VECTORS.v4);
      lastReportedValidRef.current = isValid;
      lastReportAtRef.current = now;
      onTargetUpdate(reportedTargetRef.current, isValid);
    }
  });
  
  if (!isActive) return null;
  
  // Cyan color scheme for trap targeting - matches hookshot hero theme
  const targetRingMaterial = isValidRef.current ? GRAPPLE_TRAP_MATERIALS.targetRingValid : GRAPPLE_TRAP_MATERIALS.targetRingInvalid;
  const targetLineMaterial = isValidRef.current ? GRAPPLE_TRAP_MATERIALS.targetLineValid : GRAPPLE_TRAP_MATERIALS.targetLineInvalid;
  
  return (
    <group ref={indicatorRef}>
      {/* Main AOE ring - cyan border matching hookshot theme */}
      <mesh rotation-x={-Math.PI / 2} position-y={0.1} geometry={SHARED_GEOMETRIES.ring24} scale={[GRAPPLE_TRAP_RADIUS, GRAPPLE_TRAP_RADIUS, 1]} material={targetRingMaterial} />
      {/* Center marker - white crosshair */}
      <mesh rotation-x={-Math.PI / 2} position-y={0.15} geometry={SHARED_GEOMETRIES.circle16} scale={[0.4, 0.4, 1]} material={GRAPPLE_TRAP_MATERIALS.targetCenter} />
      {/* Cross hairs */}
      <mesh rotation-x={-Math.PI / 2} position-y={0.15} geometry={SHARED_GEOMETRIES.plane} scale={[0.12, GRAPPLE_TRAP_RADIUS * 2, 1]} material={targetLineMaterial} />
      <mesh rotation-x={-Math.PI / 2} rotation-z={Math.PI / 2} position-y={0.15} geometry={SHARED_GEOMETRIES.plane} scale={[0.12, GRAPPLE_TRAP_RADIUS * 2, 1]} material={targetLineMaterial} />
      
      <BudgetedPointLight budgetPriority={2} color={HOOKSHOT_COLORS.energy} intensity={2} distance={GRAPPLE_TRAP_RADIUS} decay={2} position-y={0.5} />
    </group>
  );
});

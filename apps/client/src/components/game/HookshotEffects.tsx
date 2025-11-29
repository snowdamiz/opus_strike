import { useRef, useMemo, useState, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import * as THREE from 'three';
import { useGameStore, type HookProjectileData, type DragHookData, type GrappleTrapData, type SwingLineData, type GrappleLineData } from '../../store/gameStore';
import { checkGroundWithNormal, isPhysicsReady, raycastDirection } from '../../hooks/usePhysics';
import { damageNpc } from '../ui/GameConsole';

// ============================================================================
// SHARED GEOMETRIES - Created once, reused everywhere
// ============================================================================

const SHARED_GEOMETRIES = {
  sphere8: new THREE.SphereGeometry(1, 8, 8),
  sphere12: new THREE.SphereGeometry(1, 12, 12),
  cone6: new THREE.ConeGeometry(1, 1, 6),
  cone8: new THREE.ConeGeometry(1, 1, 8),
  ring16: new THREE.RingGeometry(0.8, 1, 16),
  ring24: new THREE.RingGeometry(0.8, 1, 24),
  circle16: new THREE.CircleGeometry(1, 16),
  plane: new THREE.PlaneGeometry(1, 1),
  box: new THREE.BoxGeometry(1, 1, 1),
  cylinder8: new THREE.CylinderGeometry(1, 1, 1, 8),
  cylinder12: new THREE.CylinderGeometry(1, 1, 1, 12),
};

// Hookshot color palette - industrial/mechanical theme
const HOOKSHOT_COLORS = {
  metal: 0x4a4a4a,
  metalLight: 0x6a6a6a,
  metalDark: 0x2a2a2a,
  rope: 0x8b7355, // Brown rope
  ropeHighlight: 0xa08060,
  hookTip: 0xcccccc,
  energy: 0x00ccff, // Cyan energy
  energyGlow: 0x0099cc,
  trap: 0xff6600, // Orange for trap
  trapGlow: 0xff9944,
  danger: 0xff3333,
};

// ============================================================================
// HOOK PROJECTILE - Short range chain hooks (basic attack)
// ============================================================================

const HOOK_SPEED = 60;
const HOOK_MAX_DISTANCE = 12;
const HOOK_DAMAGE = 25;
const HOOK_HIT_RADIUS = 1.0;
const HOOK_RETRACT_SPEED = 80;

interface HookProjectileProps {
  hook: HookProjectileData;
}

function HookProjectile({ hook }: HookProjectileProps) {
  const groupRef = useRef<THREE.Group>(null);
  const hookRef = useRef<THREE.Group>(null);
  const ropeRef = useRef<THREE.Mesh>(null);
  const hasHitRef = useRef(false);
  
  const currentPos = useRef({ ...hook.position });
  const removeHookProjectile = useGameStore(state => state.removeHookProjectile);
  const updateHookProjectile = useGameStore(state => state.updateHookProjectile);
  
  useFrame((_, delta) => {
    if (!groupRef.current || !hookRef.current || !ropeRef.current) return;
    
    const { players, localPlayer } = useGameStore.getState();
    
    // Calculate distance from start
    const dx = currentPos.current.x - hook.startPosition.x;
    const dy = currentPos.current.y - hook.startPosition.y;
    const dz = currentPos.current.z - hook.startPosition.z;
    const distanceFromStart = Math.sqrt(dx * dx + dy * dy + dz * dz);
    
    if (hook.state === 'extending') {
      // Move forward
      currentPos.current.x += hook.velocity.x * delta;
      currentPos.current.y += hook.velocity.y * delta;
      currentPos.current.z += hook.velocity.z * delta;
      
      // Check max distance
      if (distanceFromStart >= hook.maxDistance) {
        updateHookProjectile(hook.id, { state: 'retracting' });
      }
      
      // Check terrain collision
      if (isPhysicsReady()) {
        const speed = Math.sqrt(hook.velocity.x ** 2 + hook.velocity.y ** 2 + hook.velocity.z ** 2);
        const dir = {
          x: hook.velocity.x / speed,
          y: hook.velocity.y / speed,
          z: hook.velocity.z / speed,
        };
        const hit = raycastDirection(
          currentPos.current.x, currentPos.current.y, currentPos.current.z,
          dir.x, dir.y, dir.z,
          delta * speed + 0.5
        );
        if (hit?.hit) {
          updateHookProjectile(hook.id, { state: 'retracting' });
        }
      }
      
      // Check enemy collision
      if (!hasHitRef.current) {
        for (const [playerId, player] of players) {
          if (playerId === localPlayer?.id) continue;
          if (player.state !== 'alive') continue;
          if (localPlayer && player.team === localPlayer.team) continue;
          
          const pdx = player.position.x - currentPos.current.x;
          const pdy = (player.position.y + 0.9) - currentPos.current.y;
          const pdz = player.position.z - currentPos.current.z;
          const distance = Math.sqrt(pdx * pdx + pdy * pdy + pdz * pdz);
          
          if (distance <= HOOK_HIT_RADIUS) {
            hasHitRef.current = true;
            console.log(`[HookProjectile] HIT! ${player.name}`);
            
            if (playerId.startsWith('npc_')) {
              const result = damageNpc(playerId, HOOK_DAMAGE);
              if (result) {
                console.log(`[HookProjectile] Dealt ${HOOK_DAMAGE} damage to ${result.npcName}`);
              }
            }
            
            updateHookProjectile(hook.id, { state: 'retracting' });
            break;
          }
        }
      }
    } else if (hook.state === 'retracting') {
      // Move back toward start position
      const toStartX = hook.startPosition.x - currentPos.current.x;
      const toStartY = hook.startPosition.y - currentPos.current.y;
      const toStartZ = hook.startPosition.z - currentPos.current.z;
      const toStartDist = Math.sqrt(toStartX * toStartX + toStartY * toStartY + toStartZ * toStartZ);
      
      if (toStartDist < 0.5) {
        removeHookProjectile(hook.id);
        return;
      }
      
      const retractSpeed = HOOK_RETRACT_SPEED * delta;
      currentPos.current.x += (toStartX / toStartDist) * retractSpeed;
      currentPos.current.y += (toStartY / toStartDist) * retractSpeed;
      currentPos.current.z += (toStartZ / toStartDist) * retractSpeed;
    }
    
    // Update visual positions
    hookRef.current.position.set(currentPos.current.x, currentPos.current.y, currentPos.current.z);
    
    // Point hook in direction of travel
    const vel = hook.state === 'extending' 
      ? new THREE.Vector3(hook.velocity.x, hook.velocity.y, hook.velocity.z)
      : new THREE.Vector3(
          hook.startPosition.x - currentPos.current.x,
          hook.startPosition.y - currentPos.current.y,
          hook.startPosition.z - currentPos.current.z
        );
    if (vel.length() > 0.01) {
      vel.normalize();
      const quat = new THREE.Quaternion();
      quat.setFromUnitVectors(new THREE.Vector3(0, 0, -1), vel);
      hookRef.current.quaternion.copy(quat);
    }
    
    // Update rope - use localPlayer already fetched above for start position
    let ropeStartPos = hook.startPosition;
    if (localPlayer && hook.ownerId === localPlayer.id) {
      ropeStartPos = {
        x: localPlayer.position.x,
        y: localPlayer.position.y + 0.6,
        z: localPlayer.position.z,
      };
    }
    
    const ropeStart = new THREE.Vector3(ropeStartPos.x, ropeStartPos.y, ropeStartPos.z);
    const ropeEnd = new THREE.Vector3(currentPos.current.x, currentPos.current.y, currentPos.current.z);
    const ropeMid = ropeStart.clone().add(ropeEnd).multiplyScalar(0.5);
    const ropeLength = ropeStart.distanceTo(ropeEnd);
    
    ropeRef.current.position.copy(ropeMid);
    ropeRef.current.scale.set(0.04, ropeLength, 0.04);
    ropeRef.current.lookAt(ropeEnd);
    ropeRef.current.rotateX(Math.PI / 2);
  });
  
  return (
    <group ref={groupRef}>
      {/* Small grappling hook - for basic attack */}
      <group ref={hookRef} position={[hook.position.x, hook.position.y, hook.position.z]}>
        {/* Hook shaft */}
        <mesh geometry={SHARED_GEOMETRIES.cylinder8} scale={[0.05, 0.2, 0.05]} rotation={[Math.PI / 2, 0, 0]}>
          <meshStandardMaterial color={0x666666} metalness={0.8} roughness={0.3} />
        </mesh>
        
        {/* Hook tip - pointed */}
        <mesh position={[0, 0, -0.15]} rotation={[Math.PI / 2, 0, 0]} geometry={SHARED_GEOMETRIES.cone8} scale={[0.06, 0.1, 0.06]}>
          <meshStandardMaterial color={0xaaaaaa} metalness={0.9} roughness={0.2} />
        </mesh>
        
        {/* Curved hook claw */}
        <group position={[0, 0, -0.2]}>
          {/* Main curved part */}
          <mesh position={[0, -0.08, 0]} rotation={[0.4, 0, 0]} geometry={SHARED_GEOMETRIES.cylinder8} scale={[0.03, 0.15, 0.03]}>
            <meshStandardMaterial color={0x888888} metalness={0.8} roughness={0.3} />
          </mesh>
          {/* Hook barb */}
          <mesh position={[0, -0.18, 0.05]} rotation={[-0.7, 0, 0]} geometry={SHARED_GEOMETRIES.cone6} scale={[0.025, 0.08, 0.025]}>
            <meshStandardMaterial color={0xcccccc} metalness={0.9} roughness={0.2} />
          </mesh>
        </group>
        
        {/* Small light on hook */}
        <pointLight color={0xffaa00} intensity={1} distance={2} decay={2} />
      </group>
      
      {/* Chain/rope */}
      <mesh ref={ropeRef} geometry={SHARED_GEOMETRIES.cylinder8}>
        <meshStandardMaterial color={0x8b7355} metalness={0.3} roughness={0.7} />
      </mesh>
    </group>
  );
}

// ============================================================================
// DRAG HOOK - Long range hook that pulls enemies (heavy attack)
// Looks like a large grappling hook with thick chain
// ============================================================================

const DRAG_HOOK_SPEED = 50;
const DRAG_HOOK_MAX_DISTANCE = 35;
const DRAG_HOOK_DAMAGE = 40;
const DRAG_HOOK_PULL_SPEED = 25;
const DRAG_HOOK_HIT_RADIUS = 1.2;

// Create a custom hook geometry for better visual
const HOOK_GEOMETRY = (() => {
  const shape = new THREE.Shape();
  // Draw a hook profile
  shape.moveTo(0, 0);
  shape.lineTo(0.15, 0);
  shape.lineTo(0.15, 0.4);
  shape.quadraticCurveTo(0.15, 0.55, 0.05, 0.6);
  shape.quadraticCurveTo(-0.1, 0.65, -0.15, 0.5);
  shape.lineTo(-0.12, 0.45);
  shape.quadraticCurveTo(-0.05, 0.55, 0.05, 0.5);
  shape.lineTo(0.05, 0);
  shape.closePath();
  
  const extrudeSettings = { depth: 0.08, bevelEnabled: false };
  return new THREE.ExtrudeGeometry(shape, extrudeSettings);
})();

interface DragHookProps {
  hook: DragHookData;
}

function DragHookEffect({ hook }: DragHookProps) {
  const groupRef = useRef<THREE.Group>(null);
  const hookRef = useRef<THREE.Group>(null);
  const ropeRef = useRef<THREE.Mesh>(null);
  const chainSegmentsRef = useRef<(THREE.Mesh | null)[]>([]);
  const glowRef = useRef<THREE.Mesh>(null);
  
  const currentPos = useRef({ ...hook.position });
  const targetPosRef = useRef<{ x: number; y: number; z: number } | null>(null);
  const removeDragHook = useGameStore(state => state.removeDragHook);
  const updateDragHook = useGameStore(state => state.updateDragHook);
  
  useFrame((state, delta) => {
    if (!groupRef.current || !hookRef.current) return;
    
    const time = state.clock.elapsedTime;
    const { players, localPlayer } = useGameStore.getState();
    
    // Update hook start position to follow player
    let startPos = hook.startPosition;
    if (localPlayer && hook.ownerId === localPlayer.id) {
      startPos = {
        x: localPlayer.position.x,
        y: localPlayer.position.y + 0.6,
        z: localPlayer.position.z,
      };
    }
    
    if (hook.state === 'flying') {
      // Move forward
      currentPos.current.x += hook.velocity.x * delta;
      currentPos.current.y += hook.velocity.y * delta;
      currentPos.current.z += hook.velocity.z * delta;
      
      // Check max distance
      const dx = currentPos.current.x - startPos.x;
      const dy = currentPos.current.y - startPos.y;
      const dz = currentPos.current.z - startPos.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      
      if (dist >= DRAG_HOOK_MAX_DISTANCE) {
        removeDragHook(hook.id);
        return;
      }
      
      // Check terrain collision
      if (isPhysicsReady()) {
        const speed = Math.sqrt(hook.velocity.x ** 2 + hook.velocity.y ** 2 + hook.velocity.z ** 2);
        const dir = { x: hook.velocity.x / speed, y: hook.velocity.y / speed, z: hook.velocity.z / speed };
        const hit = raycastDirection(
          currentPos.current.x, currentPos.current.y, currentPos.current.z,
          dir.x, dir.y, dir.z,
          delta * speed + 0.3
        );
        if (hit?.hit) {
          removeDragHook(hook.id);
          return;
        }
      }
      
      // Check enemy collision
      for (const [playerId, player] of players) {
        if (playerId === localPlayer?.id) continue;
        if (player.state !== 'alive') continue;
        if (localPlayer && player.team === localPlayer.team) continue;
        
        const pdx = player.position.x - currentPos.current.x;
        const pdy = (player.position.y + 0.9) - currentPos.current.y;
        const pdz = player.position.z - currentPos.current.z;
        const distance = Math.sqrt(pdx * pdx + pdy * pdy + pdz * pdz);
        
        if (distance <= DRAG_HOOK_HIT_RADIUS) {
          console.log(`[DragHook] HOOKED! ${player.name}`);
          updateDragHook(hook.id, { 
            state: 'attached', 
            targetId: playerId,
            position: currentPos.current,
          });
          targetPosRef.current = { ...player.position };
          
          // Apply initial damage
          if (playerId.startsWith('npc_')) {
            damageNpc(playerId, DRAG_HOOK_DAMAGE);
          }
          break;
        }
      }
    } else if (hook.state === 'attached' || hook.state === 'pulling') {
      // Pull target toward player
      if (hook.targetId) {
        const target = players.get(hook.targetId);
        if (target && target.state === 'alive') {
          // Keep hook attached to target
          currentPos.current.x = target.position.x;
          currentPos.current.y = target.position.y + 0.9;
          currentPos.current.z = target.position.z;
          
          // Check if target is close enough
          const toPlayer = {
            x: startPos.x - target.position.x,
            y: startPos.y - 0.6 - target.position.y,
            z: startPos.z - target.position.z,
          };
          const dist = Math.sqrt(toPlayer.x ** 2 + toPlayer.y ** 2 + toPlayer.z ** 2);
          
          if (dist < 2) {
            removeDragHook(hook.id);
            return;
          }
        } else {
          removeDragHook(hook.id);
          return;
        }
      }
    }
    
    // Update hook position
    hookRef.current.position.set(currentPos.current.x, currentPos.current.y, currentPos.current.z);
    
    // Point hook in direction of travel
    const dir = hook.state === 'flying'
      ? new THREE.Vector3(hook.velocity.x, hook.velocity.y, hook.velocity.z).normalize()
      : new THREE.Vector3(
          startPos.x - currentPos.current.x,
          startPos.y - currentPos.current.y,
          startPos.z - currentPos.current.z
        ).normalize();
    
    if (dir.length() > 0.01) {
      const quat = new THREE.Quaternion();
      quat.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
      hookRef.current.quaternion.copy(quat);
    }
    
    // Update rope
    const ropeStart = new THREE.Vector3(startPos.x, startPos.y, startPos.z);
    const ropeEnd = new THREE.Vector3(currentPos.current.x, currentPos.current.y, currentPos.current.z);
    const ropeMid = ropeStart.clone().add(ropeEnd).multiplyScalar(0.5);
    const ropeLength = ropeStart.distanceTo(ropeEnd);
    
    if (ropeRef.current) {
      ropeRef.current.position.copy(ropeMid);
      ropeRef.current.scale.set(0.04, ropeLength, 0.04);
      ropeRef.current.lookAt(ropeEnd);
      ropeRef.current.rotateX(Math.PI / 2);
    }
    
    // Animate glow
    if (glowRef.current) {
      const pulse = 0.8 + Math.sin(time * 10) * 0.2;
      glowRef.current.scale.setScalar(pulse * 0.3);
      (glowRef.current.material as THREE.MeshBasicMaterial).opacity = 0.5 + Math.sin(time * 8) * 0.2;
    }
  });
  
  return (
    <group ref={groupRef}>
      {/* MASSIVE GRAPPLING HOOK - Very visible drag hook */}
      <group ref={hookRef}>
        {/* Main hook shaft - thick and industrial */}
        <mesh geometry={SHARED_GEOMETRIES.cylinder12} scale={[0.12, 0.5, 0.12]} rotation={[Math.PI / 2, 0, 0]}>
          <meshStandardMaterial color={0x444444} metalness={0.85} roughness={0.25} />
        </mesh>
        
        {/* Reinforcement rings on shaft */}
        <mesh position={[0, 0, 0.1]} rotation={[Math.PI / 2, 0, 0]} geometry={SHARED_GEOMETRIES.ring16} scale={[0.14, 0.14, 0.03]}>
          <meshStandardMaterial color={0x666666} metalness={0.8} roughness={0.3} side={THREE.DoubleSide} />
        </mesh>
        <mesh position={[0, 0, -0.1]} rotation={[Math.PI / 2, 0, 0]} geometry={SHARED_GEOMETRIES.ring16} scale={[0.14, 0.14, 0.03]}>
          <meshStandardMaterial color={0x666666} metalness={0.8} roughness={0.3} side={THREE.DoubleSide} />
        </mesh>
        
        {/* Hook tip - large pointed spear head */}
        <mesh position={[0, 0, -0.35]} rotation={[Math.PI / 2, 0, 0]} geometry={SHARED_GEOMETRIES.cone8} scale={[0.15, 0.25, 0.15]}>
          <meshStandardMaterial color={0xdddddd} metalness={0.95} roughness={0.15} />
        </mesh>
        
        {/* THE HOOK CLAW - Large curved grappling hook */}
        <group position={[0, 0, -0.5]}>
          {/* Main curved hook arm - pointing down and back */}
          <mesh position={[0, -0.15, 0.05]} rotation={[0.4, 0, 0]} geometry={SHARED_GEOMETRIES.cylinder8} scale={[0.07, 0.35, 0.07]}>
            <meshStandardMaterial color={0x555555} metalness={0.85} roughness={0.25} />
          </mesh>
          {/* Hook tip - curved back for grabbing */}
          <mesh position={[0, -0.38, 0.18]} rotation={[-0.9, 0, 0]} geometry={SHARED_GEOMETRIES.cone6} scale={[0.06, 0.18, 0.06]}>
            <meshStandardMaterial color={0xeeeeee} metalness={0.95} roughness={0.1} />
          </mesh>
          
          {/* Side hooks for extra grabbing power */}
          <mesh position={[0.12, -0.12, 0]} rotation={[0.3, 0.3, 0]} geometry={SHARED_GEOMETRIES.cylinder8} scale={[0.05, 0.25, 0.05]}>
            <meshStandardMaterial color={0x555555} metalness={0.85} roughness={0.25} />
          </mesh>
          <mesh position={[0.18, -0.28, 0.1]} rotation={[-0.7, 0.3, 0]} geometry={SHARED_GEOMETRIES.cone6} scale={[0.04, 0.12, 0.04]}>
            <meshStandardMaterial color={0xeeeeee} metalness={0.95} roughness={0.1} />
          </mesh>
          
          <mesh position={[-0.12, -0.12, 0]} rotation={[0.3, -0.3, 0]} geometry={SHARED_GEOMETRIES.cylinder8} scale={[0.05, 0.25, 0.05]}>
            <meshStandardMaterial color={0x555555} metalness={0.85} roughness={0.25} />
          </mesh>
          <mesh position={[-0.18, -0.28, 0.1]} rotation={[-0.7, -0.3, 0]} geometry={SHARED_GEOMETRIES.cone6} scale={[0.04, 0.12, 0.04]}>
            <meshStandardMaterial color={0xeeeeee} metalness={0.95} roughness={0.1} />
          </mesh>
        </group>
        
        {/* Ring at base where chain attaches */}
        <mesh position={[0, 0, 0.3]} rotation={[Math.PI / 2, 0, 0]} geometry={SHARED_GEOMETRIES.ring24} scale={[0.15, 0.15, 0.06]}>
          <meshStandardMaterial color={0x888888} metalness={0.8} roughness={0.3} side={THREE.DoubleSide} />
        </mesh>
        
        {/* ENERGY EFFECTS - Cyan energy surrounding the hook */}
        <mesh ref={glowRef} geometry={SHARED_GEOMETRIES.sphere12} scale={0.5}>
          <meshBasicMaterial color={HOOKSHOT_COLORS.energy} transparent opacity={0.35} />
        </mesh>
        
        {/* Secondary glow - larger, more diffuse */}
        <mesh geometry={SHARED_GEOMETRIES.sphere8} scale={0.7}>
          <meshBasicMaterial color={HOOKSHOT_COLORS.energyGlow} transparent opacity={0.15} />
        </mesh>
        
        {/* Energy crackling effect around hook */}
        <mesh position={[0, -0.3, -0.3]} rotation={[Math.PI / 4, 0, 0]} geometry={SHARED_GEOMETRIES.ring16} scale={[0.25, 0.25, 0.02]}>
          <meshBasicMaterial color={HOOKSHOT_COLORS.energy} transparent opacity={0.6} side={THREE.DoubleSide} />
        </mesh>
        
        {/* Hook light - intense */}
        <pointLight color={HOOKSHOT_COLORS.energy} intensity={5} distance={6} decay={2} />
        <pointLight color={0xffffff} intensity={2} distance={3} decay={2} position={[0, 0, -0.4]} />
      </group>
      
      {/* HEAVY CHAIN - Energy infused */}
      <mesh ref={ropeRef} geometry={SHARED_GEOMETRIES.cylinder12}>
        <meshStandardMaterial 
          color={0x555555} 
          metalness={0.75} 
          roughness={0.35}
          emissive={HOOKSHOT_COLORS.energyGlow}
          emissiveIntensity={0.15}
        />
      </mesh>
      
      {/* Chain energy glow effect - outer */}
      {chainSegmentsRef.current.length === 0 && (
        <mesh geometry={SHARED_GEOMETRIES.cylinder8}>
          <meshBasicMaterial color={HOOKSHOT_COLORS.energy} transparent opacity={0.25} />
        </mesh>
      )}
    </group>
  );
}

// ============================================================================
// GRAPPLE TRAP - AOE trap that hooks enemies (Ultimate)
// ============================================================================

const GRAPPLE_TRAP_RADIUS = 8;
const GRAPPLE_TRAP_HOOK_DAMAGE = 30;
const GRAPPLE_TRAP_DOT_DAMAGE = 10;
const GRAPPLE_TRAP_PULL_STRENGTH = 15;

interface GrappleTrapProps {
  trap: GrappleTrapData;
}

function GrappleTrapEffect({ trap }: GrappleTrapProps) {
  const groupRef = useRef<THREE.Group>(null);
  const deviceRef = useRef<THREE.Group>(null);
  const chainsRef = useRef<(THREE.Mesh | null)[]>([]);
  const pulseRingsRef = useRef<(THREE.Mesh | null)[]>([]);
  const lightRef = useRef<THREE.PointLight>(null);
  
  const lastDamageTimeRef = useRef<Map<string, number>>(new Map());
  
  useFrame((state, delta) => {
    if (!groupRef.current) return;
    
    const time = state.clock.elapsedTime;
    const elapsed = (Date.now() - trap.startTime) / 1000;
    const remaining = trap.duration - elapsed;
    
    if (remaining <= 0) return;
    
    const { players, localPlayer } = useGameStore.getState();
    
    // Check for players in AOE
    for (const [playerId, player] of players) {
      if (playerId === localPlayer?.id && trap.ownerTeam === localPlayer?.team) continue;
      if (player.state !== 'alive') continue;
      if (localPlayer && player.team === trap.ownerTeam) continue;
      
      const dx = player.position.x - trap.position.x;
      const dz = player.position.z - trap.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      
      if (dist <= trap.radius) {
        // Apply DOT damage every second
        const lastDamage = lastDamageTimeRef.current.get(playerId) || 0;
        const now = Date.now();
        
        if (now - lastDamage > 1000) {
          lastDamageTimeRef.current.set(playerId, now);
          
          if (playerId.startsWith('npc_')) {
            damageNpc(playerId, GRAPPLE_TRAP_DOT_DAMAGE);
            console.log(`[GrappleTrap] DOT damage to ${player.name}`);
          }
        }
      }
    }
    
    // Animate device rotation
    if (deviceRef.current) {
      deviceRef.current.rotation.y += delta * 2;
      const bob = Math.sin(time * 3) * 0.1;
      deviceRef.current.position.y = trap.position.y + 0.3 + bob;
    }
    
    // Animate chains - extend outward
    const numChains = 8;
    chainsRef.current.forEach((chain, i) => {
      if (chain) {
        const angle = (i / numChains) * Math.PI * 2 + time * 0.5;
        const extend = trap.radius * 0.8;
        chain.position.set(
          Math.cos(angle) * extend * 0.5,
          0.1 + Math.sin(time * 4 + i) * 0.05,
          Math.sin(angle) * extend * 0.5
        );
        chain.scale.set(0.03, extend, 0.03);
        chain.rotation.set(0, angle, Math.PI / 2);
      }
    });
    
    // Animate pulse rings
    pulseRingsRef.current.forEach((ring, i) => {
      if (ring) {
        const pulseProgress = ((time * 0.5 + i * 0.33) % 1);
        const scale = 0.5 + pulseProgress * trap.radius;
        ring.scale.set(scale, scale, 1);
        (ring.material as THREE.MeshBasicMaterial).opacity = (1 - pulseProgress) * 0.5;
      }
    });
    
    // Update light
    if (lightRef.current) {
      lightRef.current.intensity = 3 + Math.sin(time * 6) * 1;
    }
  });
  
  const elapsed = (Date.now() - trap.startTime) / 1000;
  if (elapsed >= trap.duration) return null;
  
  return (
    <group ref={groupRef} position={[trap.position.x, trap.position.y, trap.position.z]}>
      {/* Central device */}
      <group ref={deviceRef} position={[0, 0.3, 0]}>
        {/* Core */}
        <mesh geometry={SHARED_GEOMETRIES.sphere12} scale={0.25}>
          <meshBasicMaterial color={HOOKSHOT_COLORS.trap} />
        </mesh>
        {/* Outer ring */}
        <mesh rotation={[Math.PI / 2, 0, 0]} geometry={SHARED_GEOMETRIES.ring24} scale={[0.4, 0.4, 1]}>
          <meshBasicMaterial color={HOOKSHOT_COLORS.trapGlow} transparent opacity={0.8} side={THREE.DoubleSide} />
        </mesh>
        {/* Spinning arms */}
        {[0, 1, 2, 3].map(i => (
          <mesh 
            key={i} 
            position={[Math.cos(i * Math.PI / 2) * 0.2, 0, Math.sin(i * Math.PI / 2) * 0.2]}
            geometry={SHARED_GEOMETRIES.box}
            scale={[0.1, 0.05, 0.3]}
          >
            <meshBasicMaterial color={HOOKSHOT_COLORS.metal} />
          </mesh>
        ))}
      </group>
      
      {/* AOE boundary ring */}
      <mesh rotation-x={-Math.PI / 2} position-y={0.05} geometry={SHARED_GEOMETRIES.ring24} scale={[trap.radius, trap.radius, 1]}>
        <meshBasicMaterial color={HOOKSHOT_COLORS.danger} transparent opacity={0.6} side={THREE.DoubleSide} />
      </mesh>
      
      {/* Inner warning ring */}
      <mesh rotation-x={-Math.PI / 2} position-y={0.08} geometry={SHARED_GEOMETRIES.ring16} scale={[trap.radius * 0.6, trap.radius * 0.6, 1]}>
        <meshBasicMaterial color={HOOKSHOT_COLORS.trap} transparent opacity={0.5} side={THREE.DoubleSide} />
      </mesh>
      
      {/* Ground fill */}
      <mesh rotation-x={-Math.PI / 2} position-y={0.02} geometry={SHARED_GEOMETRIES.circle16} scale={[trap.radius, trap.radius, 1]}>
        <meshBasicMaterial color={HOOKSHOT_COLORS.trap} transparent opacity={0.15} side={THREE.DoubleSide} />
      </mesh>
      
      {/* Chains extending outward */}
      {Array.from({ length: 8 }).map((_, i) => (
        <mesh 
          key={`chain-${i}`}
          ref={el => chainsRef.current[i] = el}
          geometry={SHARED_GEOMETRIES.cylinder8}
        >
          <meshBasicMaterial color={HOOKSHOT_COLORS.rope} />
        </mesh>
      ))}
      
      {/* Pulse rings */}
      {[0, 1, 2].map(i => (
        <mesh
          key={`pulse-${i}`}
          ref={el => pulseRingsRef.current[i] = el}
          rotation-x={-Math.PI / 2}
          position-y={0.1}
          geometry={SHARED_GEOMETRIES.ring16}
        >
          <meshBasicMaterial color={HOOKSHOT_COLORS.trapGlow} transparent opacity={0.4} side={THREE.DoubleSide} />
        </mesh>
      ))}
      
      <pointLight ref={lightRef} color={HOOKSHOT_COLORS.trap} intensity={4} distance={trap.radius * 1.5} decay={2} position={[0, 1, 0]} />
    </group>
  );
}

// ============================================================================
// SWING LINE - Apex Legends Pathfinder style grapple (E ability)
// Hook shoots out first, then player swings with momentum
// ============================================================================

interface SwingLineProps {
  line: SwingLineData;
}

function SwingLineEffect({ line }: SwingLineProps) {
  const groupRef = useRef<THREE.Group>(null);
  const hookRef = useRef<THREE.Group>(null);
  
  // Track hook extension distance (how far from player the hook has traveled)
  const hookExtensionRef = useRef(0);
  const hasReachedRef = useRef(false);
  const frameCount = useRef(0);
  
  // State for rope points - using simple arrays for better React change detection
  const [ropePoints, setRopePoints] = useState<[[number, number, number], [number, number, number]]>([
    [line.startPosition.x, line.startPosition.y, line.startPosition.z],
    [line.startPosition.x, line.startPosition.y, line.startPosition.z]
  ]);
  
  const removeSwingLine = useGameStore(state => state.removeSwingLine);
  const updateSwingLine = useGameStore(state => state.updateSwingLine);
  
  // Log when effect mounts
  useEffect(() => {
    console.log('[SwingLine] MOUNTED - ID:', line.id, 'State:', line.state);
    return () => console.log('[SwingLine] UNMOUNTED:', line.id);
  }, [line.id]);
  
  useFrame((state, delta) => {
    frameCount.current++;
    
    if (!groupRef.current || !hookRef.current) return;
    
    const time = state.clock.elapsedTime;
    
    // Get localPlayer fresh each frame
    const { localPlayer, players } = useGameStore.getState();
    
    // Player position (rope start) - get from the actual player who owns this line
    let playerPos = line.startPosition;
    
    if (localPlayer && line.ownerId === localPlayer.id) {
      playerPos = {
        x: localPlayer.position.x,
        y: localPlayer.position.y + 0.6,
        z: localPlayer.position.z,
      };
    } else {
      const owner = players.get(line.ownerId);
      if (owner) {
        playerPos = {
          x: owner.position.x,
          y: owner.position.y + 0.6,
          z: owner.position.z,
        };
      }
    }
    
    // Calculate direction from player to target attach point
    const toTarget = {
      x: line.attachPoint.x - playerPos.x,
      y: line.attachPoint.y - playerPos.y,
      z: line.attachPoint.z - playerPos.z,
    };
    const totalDist = Math.sqrt(toTarget.x ** 2 + toTarget.y ** 2 + toTarget.z ** 2);
    const dirX = totalDist > 0 ? toTarget.x / totalDist : 0;
    const dirY = totalDist > 0 ? toTarget.y / totalDist : 0;
    const dirZ = totalDist > 0 ? toTarget.z / totalDist : 0;
    
    // Calculate current hook position based on extension distance and state
    let hookPos = { x: playerPos.x, y: playerPos.y, z: playerPos.z };
    
    if (line.state === 'extending' && !hasReachedRef.current) {
      // Hook is flying out toward target
      const speed = 90 * delta; // Fast hook extension
      hookExtensionRef.current += speed;
      
      // Calculate initial distance (from original start position to attach point)
      const initialDist = Math.sqrt(
        (line.attachPoint.x - line.startPosition.x) ** 2 +
        (line.attachPoint.y - line.startPosition.y) ** 2 +
        (line.attachPoint.z - line.startPosition.z) ** 2
      );
      
      if (hookExtensionRef.current >= initialDist) {
        // Hook reached target
        hasReachedRef.current = true;
        hookPos = { ...line.attachPoint };
        console.log('[SwingLine] Hook attached!');
        updateSwingLine(line.id, { state: 'attached' });
      } else {
        // Position hook along the line from player toward target
        hookPos = {
          x: playerPos.x + dirX * hookExtensionRef.current,
          y: playerPos.y + dirY * hookExtensionRef.current,
          z: playerPos.z + dirZ * hookExtensionRef.current,
        };
      }
    } else if (line.state === 'attached' || line.state === 'swinging') {
      // Hook is attached - stays at target position
      hasReachedRef.current = true;
      hookPos = { ...line.attachPoint };
    } else if (line.state === 'done') {
      // Swing is done - remove line
      removeSwingLine(line.id);
      return;
    }
    
    // Check timeout/duration
    const elapsed = (Date.now() - line.startTime) / 1000;
    if (elapsed > line.duration + 1) {
      removeSwingLine(line.id);
      return;
    }
    
    // Update hook visual position
    hookRef.current.position.set(hookPos.x, hookPos.y, hookPos.z);
    
    // Point hook toward target (away from player)
    if (totalDist > 0.01) {
      const quat = new THREE.Quaternion();
      quat.setFromUnitVectors(new THREE.Vector3(0, 0, -1), new THREE.Vector3(dirX, dirY, dirZ));
      hookRef.current.quaternion.copy(quat);
    }
    
    // Update rope points
    setRopePoints([
      [playerPos.x, playerPos.y, playerPos.z],
      [hookPos.x, hookPos.y, hookPos.z]
    ]);
  });
  
  if (!line.isActive && line.state === 'done') return null;
  
  return (
    <group ref={groupRef}>
      {/* ANCHOR-STYLE GRAPPLING HOOK (same as Q ability for consistency) */}
      <group ref={hookRef} position={[line.startPosition.x, line.startPosition.y, line.startPosition.z]}>
        {/* === ANCHOR RING (top) - where rope attaches === */}
        <mesh position={[0, 0, 0.35]} rotation={[Math.PI / 2, 0, 0]} geometry={SHARED_GEOMETRIES.ring16} scale={[0.2, 0.2, 0.08]}>
          <meshStandardMaterial color={0x888888} metalness={0.9} roughness={0.2} side={THREE.DoubleSide} />
        </mesh>
        
        {/* === MAIN SHAFT (vertical bar) === */}
        <mesh rotation={[Math.PI / 2, 0, 0]} geometry={SHARED_GEOMETRIES.cylinder8} scale={[0.08, 0.8, 0.08]}>
          <meshStandardMaterial color={0x666666} metalness={0.85} roughness={0.25} />
        </mesh>
        
        {/* === CROWN/STOCK (horizontal bar near top) === */}
        <mesh position={[0, 0, 0.15]} rotation={[0, 0, Math.PI / 2]} geometry={SHARED_GEOMETRIES.cylinder8} scale={[0.05, 0.5, 0.05]}>
          <meshStandardMaterial color={0x777777} metalness={0.85} roughness={0.25} />
        </mesh>
        
        {/* === ANCHOR ARMS/FLUKES (curved hooks at bottom) === */}
        {/* Left arm */}
        <group position={[-0.15, 0, -0.3]}>
          <mesh rotation={[0.3, 0, -0.8]} geometry={SHARED_GEOMETRIES.cylinder8} scale={[0.06, 0.35, 0.06]}>
            <meshStandardMaterial color={0x666666} metalness={0.85} roughness={0.25} />
          </mesh>
          <mesh position={[-0.2, 0, -0.15]} rotation={[0.5, 0, -1.2]} geometry={SHARED_GEOMETRIES.cone8} scale={[0.08, 0.2, 0.04]}>
            <meshStandardMaterial color={0xaaaaaa} metalness={0.9} roughness={0.15} />
          </mesh>
        </group>
        
        {/* Right arm */}
        <group position={[0.15, 0, -0.3]}>
          <mesh rotation={[0.3, 0, 0.8]} geometry={SHARED_GEOMETRIES.cylinder8} scale={[0.06, 0.35, 0.06]}>
            <meshStandardMaterial color={0x666666} metalness={0.85} roughness={0.25} />
          </mesh>
          <mesh position={[0.2, 0, -0.15]} rotation={[0.5, 0, 1.2]} geometry={SHARED_GEOMETRIES.cone8} scale={[0.08, 0.2, 0.04]}>
            <meshStandardMaterial color={0xaaaaaa} metalness={0.9} roughness={0.15} />
          </mesh>
        </group>
        
        {/* === BOTTOM POINT === */}
        <mesh position={[0, 0, -0.45]} rotation={[Math.PI / 2, 0, 0]} geometry={SHARED_GEOMETRIES.cone8} scale={[0.1, 0.15, 0.1]}>
          <meshStandardMaterial color={0xcccccc} metalness={0.95} roughness={0.1} />
        </mesh>
        
        {/* Small point light so the hook is visible */}
        <pointLight color={0xffffff} intensity={2} distance={4} decay={2} />
      </group>
      
      {/* ENERGY ROPE - Main thick line (same style as Q ability) */}
      <Line
        points={ropePoints}
        color={HOOKSHOT_COLORS.energy}
        lineWidth={8}
        transparent
        opacity={1}
      />
      
      {/* ENERGY ROPE - Outer glow effect (thicker, more transparent) */}
      <Line
        points={ropePoints}
        color={HOOKSHOT_COLORS.energyGlow}
        lineWidth={16}
        transparent
        opacity={0.4}
      />
      
      {/* ENERGY ROPE - Inner bright core */}
      <Line
        points={ropePoints}
        color={0xffffff}
        lineWidth={3}
        transparent
        opacity={0.8}
      />
    </group>
  );
}

// ============================================================================
// GRAPPLE LINE - Quick grapple to geometry (Q ability)
// Shows a hook shooting out and rope connecting player to hook
// ============================================================================

interface GrappleLineProps {
  line: GrappleLineData;
}

function GrappleLineEffect({ line }: GrappleLineProps) {
  const groupRef = useRef<THREE.Group>(null);
  const hookRef = useRef<THREE.Group>(null);
  
  // Track hook extension distance (how far from player the hook has traveled)
  const hookExtensionRef = useRef(0);
  const hasReachedRef = useRef(false);
  const frameCount = useRef(0);
  
  // State for rope points - using simple arrays for better React change detection
  const [ropePoints, setRopePoints] = useState<[[number, number, number], [number, number, number]]>([
    [line.startPosition.x, line.startPosition.y, line.startPosition.z],
    [line.startPosition.x, line.startPosition.y, line.startPosition.z]
  ]);
  
  const removeGrappleLine = useGameStore(state => state.removeGrappleLine);
  
  // Log when effect mounts
  useEffect(() => {
    console.log('[GrappleLine] MOUNTED - ID:', line.id);
    return () => console.log('[GrappleLine] UNMOUNTED:', line.id);
  }, [line.id]);
  
  useFrame((state, delta) => {
    frameCount.current++;
    
    if (!groupRef.current || !hookRef.current) {
      return;
    }
    
    // Get localPlayer fresh each frame - ALWAYS use current position
    const { localPlayer, players } = useGameStore.getState();
    
    // Player position (rope start) - get from the actual player who owns this line
    let playerPos = line.startPosition;
    
    // First check if this is the local player's line
    if (localPlayer && line.ownerId === localPlayer.id) {
      playerPos = {
        x: localPlayer.position.x,
        y: localPlayer.position.y + 0.6,
        z: localPlayer.position.z,
      };
    } else {
      // Check if it's another player's line
      const owner = players.get(line.ownerId);
      if (owner) {
        playerPos = {
          x: owner.position.x,
          y: owner.position.y + 0.6,
          z: owner.position.z,
        };
      }
    }
    
    // Debug: log on first few frames to verify position is updating
    if (frameCount.current <= 5) {
      console.log(`[GrappleLine] Frame ${frameCount.current}: playerPos =`, playerPos, 'localPlayer.id =', localPlayer?.id, 'line.ownerId =', line.ownerId);
    }
    
    // Calculate direction from player to target
    const toTarget = {
      x: line.endPosition.x - playerPos.x,
      y: line.endPosition.y - playerPos.y,
      z: line.endPosition.z - playerPos.z,
    };
    const totalDist = Math.sqrt(toTarget.x ** 2 + toTarget.y ** 2 + toTarget.z ** 2);
    const dirX = totalDist > 0 ? toTarget.x / totalDist : 0;
    const dirY = totalDist > 0 ? toTarget.y / totalDist : 0;
    const dirZ = totalDist > 0 ? toTarget.z / totalDist : 0;
    
    // Calculate current hook position based on extension distance
    let hookPos = { x: playerPos.x, y: playerPos.y, z: playerPos.z };
    
    // Hook extension logic
    if (!hasReachedRef.current && line.state === 'extending') {
      // Extend the hook outward from player
      const speed = 80 * delta;
      hookExtensionRef.current += speed;
      
      if (hookExtensionRef.current >= totalDist) {
        // Hook reached target
        hasReachedRef.current = true;
        hookPos = { ...line.endPosition };
        console.log('[GrappleLine] Hook attached!');
        useGameStore.getState().updateGrappleLine(line.id, { state: 'attached' });
      } else {
        // Position hook along the line from player toward target
        hookPos = {
          x: playerPos.x + dirX * hookExtensionRef.current,
          y: playerPos.y + dirY * hookExtensionRef.current,
          z: playerPos.z + dirZ * hookExtensionRef.current,
        };
      }
    } else if (line.state === 'attached' || line.state === 'pulling') {
      // Hook is attached to geometry - stays at target position
      hasReachedRef.current = true;
      hookPos = { ...line.endPosition };
    }
    
    // Check completion - player reached the hook
    if (hasReachedRef.current && totalDist < 1.5) {
      removeGrappleLine(line.id);
      return;
    }
    
    // Timeout
    const elapsed = (Date.now() - line.startTime) / 1000;
    if (elapsed > 5.0) {
      removeGrappleLine(line.id);
      return;
    }
    
    // Update hook visual position
    hookRef.current.position.set(hookPos.x, hookPos.y, hookPos.z);
    
    // Point hook toward target (away from player)
    if (totalDist > 0.01) {
      const quat = new THREE.Quaternion();
      quat.setFromUnitVectors(new THREE.Vector3(0, 0, -1), new THREE.Vector3(dirX, dirY, dirZ));
      hookRef.current.quaternion.copy(quat);
    }
    
    // UPDATE ROPE POINTS - Always from current player position to current hook position
    setRopePoints([
      [playerPos.x, playerPos.y, playerPos.z],
      [hookPos.x, hookPos.y, hookPos.z]
    ]);
    
  });
  
  return (
    <group ref={groupRef}>
      {/* ANCHOR-STYLE GRAPPLING HOOK */}
      <group ref={hookRef} position={[line.startPosition.x, line.startPosition.y, line.startPosition.z]}>
        {/* === ANCHOR RING (top) - where rope attaches === */}
        <mesh position={[0, 0, 0.35]} rotation={[Math.PI / 2, 0, 0]} geometry={SHARED_GEOMETRIES.ring16} scale={[0.2, 0.2, 0.08]}>
          <meshStandardMaterial color={0x888888} metalness={0.9} roughness={0.2} side={THREE.DoubleSide} />
        </mesh>
        
        {/* === MAIN SHAFT (vertical bar) === */}
        <mesh rotation={[Math.PI / 2, 0, 0]} geometry={SHARED_GEOMETRIES.cylinder8} scale={[0.08, 0.8, 0.08]}>
          <meshStandardMaterial color={0x666666} metalness={0.85} roughness={0.25} />
        </mesh>
        
        {/* === CROWN/STOCK (horizontal bar near top) === */}
        <mesh position={[0, 0, 0.15]} rotation={[0, 0, Math.PI / 2]} geometry={SHARED_GEOMETRIES.cylinder8} scale={[0.05, 0.5, 0.05]}>
          <meshStandardMaterial color={0x777777} metalness={0.85} roughness={0.25} />
        </mesh>
        
        {/* === ANCHOR ARMS/FLUKES (curved hooks at bottom) === */}
        {/* Left arm */}
        <group position={[-0.15, 0, -0.3]}>
          {/* Arm going outward and down */}
          <mesh rotation={[0.3, 0, -0.8]} geometry={SHARED_GEOMETRIES.cylinder8} scale={[0.06, 0.35, 0.06]}>
            <meshStandardMaterial color={0x666666} metalness={0.85} roughness={0.25} />
          </mesh>
          {/* Curved fluke tip */}
          <mesh position={[-0.2, 0, -0.15]} rotation={[0.5, 0, -1.2]} geometry={SHARED_GEOMETRIES.cone8} scale={[0.08, 0.2, 0.04]}>
            <meshStandardMaterial color={0xaaaaaa} metalness={0.9} roughness={0.15} />
          </mesh>
        </group>
        
        {/* Right arm */}
        <group position={[0.15, 0, -0.3]}>
          {/* Arm going outward and down */}
          <mesh rotation={[0.3, 0, 0.8]} geometry={SHARED_GEOMETRIES.cylinder8} scale={[0.06, 0.35, 0.06]}>
            <meshStandardMaterial color={0x666666} metalness={0.85} roughness={0.25} />
          </mesh>
          {/* Curved fluke tip */}
          <mesh position={[0.2, 0, -0.15]} rotation={[0.5, 0, 1.2]} geometry={SHARED_GEOMETRIES.cone8} scale={[0.08, 0.2, 0.04]}>
            <meshStandardMaterial color={0xaaaaaa} metalness={0.9} roughness={0.15} />
          </mesh>
        </group>
        
        {/* === BOTTOM POINT === */}
        <mesh position={[0, 0, -0.45]} rotation={[Math.PI / 2, 0, 0]} geometry={SHARED_GEOMETRIES.cone8} scale={[0.1, 0.15, 0.1]}>
          <meshStandardMaterial color={0xcccccc} metalness={0.95} roughness={0.1} />
        </mesh>
        
        {/* Small point light so the hook is visible */}
        <pointLight color={0xffffff} intensity={2} distance={4} decay={2} />
      </group>
      
      {/* ENERGY ROPE - Main thick line */}
      <Line
        points={ropePoints}
        color={HOOKSHOT_COLORS.energy}
        lineWidth={8}
        transparent
        opacity={1}
      />
      
      {/* ENERGY ROPE - Outer glow effect (thicker, more transparent) */}
      <Line
        points={ropePoints}
        color={HOOKSHOT_COLORS.energyGlow}
        lineWidth={16}
        transparent
        opacity={0.4}
      />
      
      {/* ENERGY ROPE - Inner bright core */}
      <Line
        points={ropePoints}
        color={0xffffff}
        lineWidth={3}
        transparent
        opacity={0.8}
      />
    </group>
  );
}

// ============================================================================
// GRAPPLE TRAP TARGETING INDICATOR
// ============================================================================

interface GrappleTrapTargetingProps {
  isActive: boolean;
  onTargetUpdate: (position: THREE.Vector3 | null, isValid: boolean) => void;
}

const TRAP_MAX_RANGE = 30;
const TRAP_MIN_RANGE = 3;

const _trapLookDir = new THREE.Vector3();
const _trapTargetPos = new THREE.Vector3();

export function GrappleTrapTargetingIndicator({ isActive, onTargetUpdate }: GrappleTrapTargetingProps) {
  const indicatorRef = useRef<THREE.Group>(null);
  const isValidRef = useRef(false);
  const { camera } = useThree();
  
  useFrame(() => {
    if (!isActive) {
      if (indicatorRef.current) indicatorRef.current.visible = false;
      onTargetUpdate(null, false);
      return;
    }
    
    const localPlayer = useGameStore.getState().localPlayer;
    if (!localPlayer) {
      onTargetUpdate(null, false);
      return;
    }
    
    _trapLookDir.set(0, 0, -1).applyQuaternion(camera.quaternion);
    
    let targetX = camera.position.x;
    let targetY = camera.position.y;
    let targetZ = camera.position.z;
    let isValid = false;
    let foundTarget = false;
    
    if (isPhysicsReady()) {
      const directHit = raycastDirection(
        camera.position.x, camera.position.y, camera.position.z,
        _trapLookDir.x, _trapLookDir.y, _trapLookDir.z,
        TRAP_MAX_RANGE + 10
      );
      
      if (directHit && directHit.hit) {
        targetX = directHit.point.x;
        targetY = directHit.point.y;
        targetZ = directHit.point.z;
        foundTarget = true;
        
        if (!directHit.isWalkable) {
          const groundBelow = checkGroundWithNormal(targetX, targetY + 5, targetZ, 50);
          if (groundBelow?.isWalkable) {
            targetY = groundBelow.groundY + 0.1;
          }
        } else {
          targetY += 0.1;
        }
      }
      
      if (!foundTarget) {
        const pitch = Math.asin(Math.max(-1, Math.min(1, -_trapLookDir.y)));
        const baseDist = pitch > 0.3 ? 15 : (pitch > 0 ? 20 : 25);
        const sampleDistances = [baseDist * 0.5, baseDist, baseDist * 1.5, TRAP_MAX_RANGE];
        
        for (const dist of sampleDistances) {
          const sampleX = camera.position.x + _trapLookDir.x * dist;
          const sampleY = camera.position.y + _trapLookDir.y * dist;
          const sampleZ = camera.position.z + _trapLookDir.z * dist;
          
          const groundCheck = checkGroundWithNormal(sampleX, Math.max(sampleY + 50, camera.position.y + 50), sampleZ, 150);
          
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
          
          const groundCheck = checkGroundWithNormal(targetX, targetY + 30, targetZ, 100);
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
    
    _trapTargetPos.set(targetX, targetY, targetZ);
    isValidRef.current = isValid;
    
    if (indicatorRef.current) {
      indicatorRef.current.visible = true;
      indicatorRef.current.position.copy(_trapTargetPos);
    }
    
    onTargetUpdate(_trapTargetPos.clone(), isValid);
  });
  
  if (!isActive) return null;
  
  const baseColor = isValidRef.current ? HOOKSHOT_COLORS.trap : HOOKSHOT_COLORS.danger;
  
  return (
    <group ref={indicatorRef}>
      {/* Main AOE ring */}
      <mesh rotation-x={-Math.PI / 2} position-y={0.1} geometry={SHARED_GEOMETRIES.ring24} scale={[GRAPPLE_TRAP_RADIUS, GRAPPLE_TRAP_RADIUS, 1]}>
        <meshBasicMaterial color={baseColor} transparent opacity={0.7} side={THREE.DoubleSide} />
      </mesh>
      {/* Inner ring */}
      <mesh rotation-x={-Math.PI / 2} position-y={0.12} geometry={SHARED_GEOMETRIES.ring16} scale={[GRAPPLE_TRAP_RADIUS * 0.5, GRAPPLE_TRAP_RADIUS * 0.5, 1]}>
        <meshBasicMaterial color={HOOKSHOT_COLORS.trapGlow} transparent opacity={0.8} side={THREE.DoubleSide} />
      </mesh>
      {/* Center marker */}
      <mesh rotation-x={-Math.PI / 2} position-y={0.15} geometry={SHARED_GEOMETRIES.circle16} scale={[0.5, 0.5, 1]}>
        <meshBasicMaterial color={0xffffff} transparent opacity={1} side={THREE.DoubleSide} />
      </mesh>
      {/* Ground fill */}
      <mesh rotation-x={-Math.PI / 2} position-y={0.05} geometry={SHARED_GEOMETRIES.circle16} scale={[GRAPPLE_TRAP_RADIUS, GRAPPLE_TRAP_RADIUS, 1]}>
        <meshBasicMaterial color={baseColor} transparent opacity={0.15} side={THREE.DoubleSide} />
      </mesh>
      {/* Cross hairs */}
      <mesh rotation-x={-Math.PI / 2} position-y={0.15} geometry={SHARED_GEOMETRIES.plane} scale={[0.15, GRAPPLE_TRAP_RADIUS * 2, 1]}>
        <meshBasicMaterial color={baseColor} transparent opacity={0.6} side={THREE.DoubleSide} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} rotation-z={Math.PI / 2} position-y={0.15} geometry={SHARED_GEOMETRIES.plane} scale={[0.15, GRAPPLE_TRAP_RADIUS * 2, 1]}>
        <meshBasicMaterial color={baseColor} transparent opacity={0.6} side={THREE.DoubleSide} />
      </mesh>
      
      <pointLight color={baseColor} intensity={3} distance={GRAPPLE_TRAP_RADIUS} decay={2} position-y={0.5} />
    </group>
  );
}

// ============================================================================
// HOOKSHOT EFFECTS MANAGER
// ============================================================================

export function HookshotEffectsManager() {
  const hookProjectiles = useGameStore(state => state.hookProjectiles);
  const dragHooks = useGameStore(state => state.dragHooks);
  const grappleTraps = useGameStore(state => state.grappleTraps);
  const swingLines = useGameStore(state => state.swingLines);
  const grappleLines = useGameStore(state => state.grappleLines);
  
  // Log when grapple lines change
  useEffect(() => {
    if (grappleLines.length > 0) {
      console.log('[HookshotEffects] === GRAPPLE LINES UPDATE ===');
      console.log('[HookshotEffects] Count:', grappleLines.length);
      grappleLines.forEach(line => {
        console.log('[HookshotEffects] Line:', line.id, 'State:', line.state);
      });
    }
  }, [grappleLines]);
  
  // Cleanup interval
  useEffect(() => {
    const interval = setInterval(() => {
      useGameStore.getState().clearExpiredHookProjectiles();
      useGameStore.getState().clearExpiredDragHooks();
      useGameStore.getState().clearExpiredGrappleTraps();
      useGameStore.getState().clearExpiredSwingLines();
      useGameStore.getState().clearExpiredGrappleLines();
    }, 150);
    
    return () => clearInterval(interval);
  }, []);
  
  return (
    <group>
      {/* Basic attack hooks */}
      {hookProjectiles.map(hook => (
        <HookProjectile key={hook.id} hook={hook} />
      ))}
      
      {/* Heavy attack drag hooks */}
      {dragHooks.map(hook => (
        <DragHookEffect key={hook.id} hook={hook} />
      ))}
      
      {/* Ultimate grapple traps */}
      {grappleTraps.map(trap => (
        <GrappleTrapEffect key={trap.id} trap={trap} />
      ))}
      
      {/* Swing lines (E ability) */}
      {swingLines.map(line => (
        <SwingLineEffect key={line.id} line={line} />
      ))}
      
      {/* Grapple lines (Q ability) */}
      {grappleLines.map(line => (
        <GrappleLineEffect key={line.id} line={line} />
      ))}
    </group>
  );
}



import { useRef, useMemo, useState, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useGameStore, type RocketData, type BombData } from '../../store/gameStore';
import { checkGroundWithNormal, isPhysicsReady } from '../../hooks/usePhysics';

// ============================================================================
// SHARED MATERIALS - Reuse materials across all effects to reduce draw calls
// ============================================================================

const SHARED_MATERIALS = {
  // Fire colors
  fireCore: new THREE.MeshBasicMaterial({ color: 0xffffcc, transparent: true, opacity: 0.95 }),
  fireInner: new THREE.MeshBasicMaterial({ color: 0xffaa00, transparent: true, opacity: 0.85 }),
  fireOuter: new THREE.MeshBasicMaterial({ color: 0xff5500, transparent: true, opacity: 0.6 }),
  fireRed: new THREE.MeshBasicMaterial({ color: 0xff2200, transparent: true, opacity: 0.4 }),
  
  // Explosion colors
  explosionFlash: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true }),
  explosionCore: new THREE.MeshBasicMaterial({ color: 0xffffaa, transparent: true }),
  explosionMid: new THREE.MeshBasicMaterial({ color: 0xff7700, transparent: true }),
  explosionOuter: new THREE.MeshBasicMaterial({ color: 0xff3300, transparent: true }),
  
  // Warning indicators
  warningRed: new THREE.MeshBasicMaterial({ color: 0xff0000, transparent: true, side: THREE.DoubleSide }),
  warningOrange: new THREE.MeshBasicMaterial({ color: 0xff4400, transparent: true, side: THREE.DoubleSide }),
  warningYellow: new THREE.MeshBasicMaterial({ color: 0xffaa00, transparent: true, side: THREE.DoubleSide }),
  targetYellow: new THREE.MeshBasicMaterial({ color: 0xffff00, transparent: true, side: THREE.DoubleSide }),
  dangerFill: new THREE.MeshBasicMaterial({ color: 0xff2200, transparent: true, side: THREE.DoubleSide }),
  
  // Rocket/bomb body
  metalDark: new THREE.MeshBasicMaterial({ color: 0x333333 }),
  metalLight: new THREE.MeshBasicMaterial({ color: 0x555555 }),
  rocketTip: new THREE.MeshBasicMaterial({ color: 0xff6600 }),
  
  // Smoke
  smoke: new THREE.MeshBasicMaterial({ color: 0x444444, transparent: true, opacity: 0.4 }),
  smokeDark: new THREE.MeshBasicMaterial({ color: 0x222222, transparent: true, opacity: 0.3 }),
};

// ============================================================================
// SHARED GEOMETRIES - Reuse geometries to reduce GPU memory
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
};

// ============================================================================
// BLAZE ROCKET EFFECT - OPTIMIZED
// Simple rocket with efficient trail
// ============================================================================

interface RocketEffectProps {
  rocket: RocketData;
}

// Pre-allocated vectors for rocket calculations
const _rocketPos = new THREE.Vector3();
const _rocketDir = new THREE.Vector3();
const _rocketLookAt = new THREE.Vector3();

export function RocketEffect({ rocket }: RocketEffectProps) {
  const groupRef = useRef<THREE.Group>(null);
  
  useFrame(() => {
    if (!groupRef.current) return;
    
    const elapsed = (Date.now() - rocket.startTime) / 1000;
    
    // Update position
    _rocketPos.set(
      rocket.position.x + rocket.velocity.x * elapsed,
      rocket.position.y + rocket.velocity.y * elapsed - elapsed * elapsed,
      rocket.position.z + rocket.velocity.z * elapsed
    );
    groupRef.current.position.copy(_rocketPos);
    
    // Rotate to face velocity
    _rocketDir.set(rocket.velocity.x, rocket.velocity.y - 2 * elapsed, rocket.velocity.z).normalize();
    _rocketLookAt.copy(_rocketPos).add(_rocketDir);
    groupRef.current.lookAt(_rocketLookAt);
  });
  
  return (
    <group ref={groupRef}>
      {/* Rocket body */}
      <mesh rotation={[Math.PI / 2, 0, 0]} geometry={SHARED_GEOMETRIES.cone8} scale={[0.1, 0.4, 0.1]} material={SHARED_MATERIALS.metalDark} />
      
      {/* Rocket tip */}
      <mesh position={[0, 0, -0.22]} rotation={[Math.PI / 2, 0, 0]} geometry={SHARED_GEOMETRIES.cone6} scale={[0.05, 0.1, 0.05]} material={SHARED_MATERIALS.rocketTip} />
      
      {/* Fire trail - single layered cone instead of multiple */}
      <mesh position={[0, 0, 0.25]} rotation={[Math.PI / 2, 0, 0]} geometry={SHARED_GEOMETRIES.cone8} scale={[0.08, 0.6, 0.08]} material={SHARED_MATERIALS.fireCore} />
      <mesh position={[0, 0, 0.35]} rotation={[Math.PI / 2, 0, 0]} geometry={SHARED_GEOMETRIES.cone8} scale={[0.12, 0.5, 0.12]} material={SHARED_MATERIALS.fireInner} />
      
      {/* Single light instead of multiple */}
      <pointLight color={0xff6600} intensity={2} distance={6} decay={2} />
    </group>
  );
}

// ============================================================================
// ROCKET JUMP EXPLOSION EFFECT - OPTIMIZED
// Dramatic but efficient explosion
// ============================================================================

interface RocketJumpExplosionData {
  id: string;
  position: { x: number; y: number; z: number };
  startTime: number;
}

const rocketJumpExplosions: RocketJumpExplosionData[] = [];
let explosionIdCounter = 0;

export function triggerRocketJumpExplosion(position: { x: number; y: number; z: number }) {
  rocketJumpExplosions.push({
    id: `rj_${explosionIdCounter++}`,
    position: { ...position },
    startTime: Date.now(),
  });
}

const ROCKET_JUMP_DURATION = 600;

function RocketJumpExplosion({ explosion }: { explosion: RocketJumpExplosionData }) {
  const groupRef = useRef<THREE.Group>(null);
  const coreRef = useRef<THREE.Mesh>(null);
  const midRef = useRef<THREE.Mesh>(null);
  const outerRef = useRef<THREE.Mesh>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  
  useFrame(() => {
    const elapsed = Date.now() - explosion.startTime;
    if (elapsed > ROCKET_JUMP_DURATION) return;
    
    const progress = elapsed / ROCKET_JUMP_DURATION;
    const easeOut = 1 - Math.pow(1 - progress, 2);
    const fadeOut = Math.max(0, 1 - progress * 1.3);
    
    // Scale and fade the explosion layers
    if (coreRef.current) {
      const s = 0.3 + easeOut * 2;
      coreRef.current.scale.set(s, s, s);
      (coreRef.current.material as THREE.MeshBasicMaterial).opacity = fadeOut * 0.9;
    }
    if (midRef.current) {
      const s = 0.5 + easeOut * 2.5;
      midRef.current.scale.set(s, s, s);
      (midRef.current.material as THREE.MeshBasicMaterial).opacity = fadeOut * 0.7;
    }
    if (outerRef.current) {
      const s = 0.6 + easeOut * 3;
      outerRef.current.scale.set(s, s, s);
      (outerRef.current.material as THREE.MeshBasicMaterial).opacity = fadeOut * 0.5;
    }
    if (ringRef.current) {
      const s = 0.5 + easeOut * 4;
      ringRef.current.scale.set(s, s, s);
      (ringRef.current.material as THREE.MeshBasicMaterial).opacity = fadeOut * 0.6;
    }
    if (lightRef.current) {
      lightRef.current.intensity = fadeOut * 15;
    }
  });
  
  const elapsed = Date.now() - explosion.startTime;
  if (elapsed > ROCKET_JUMP_DURATION) return null;
  
  return (
    <group ref={groupRef} position={[explosion.position.x, explosion.position.y - 0.5, explosion.position.z]}>
      {/* Core - hot yellow */}
      <mesh ref={coreRef} geometry={SHARED_GEOMETRIES.sphere8}>
        <meshBasicMaterial color={0xffffaa} transparent opacity={0.9} />
      </mesh>
      
      {/* Mid - orange */}
      <mesh ref={midRef} geometry={SHARED_GEOMETRIES.sphere8}>
        <meshBasicMaterial color={0xff7700} transparent opacity={0.7} />
      </mesh>
      
      {/* Outer - red */}
      <mesh ref={outerRef} geometry={SHARED_GEOMETRIES.sphere8}>
        <meshBasicMaterial color={0xff3300} transparent opacity={0.5} />
      </mesh>
      
      {/* Ground shockwave ring */}
      <mesh ref={ringRef} rotation-x={-Math.PI / 2} position-y={0.1} geometry={SHARED_GEOMETRIES.ring16}>
        <meshBasicMaterial color={0xff6600} transparent opacity={0.6} side={THREE.DoubleSide} />
      </mesh>
      
      {/* Single light */}
      <pointLight ref={lightRef} color={0xff5500} intensity={15} distance={12} decay={2} />
    </group>
  );
}

// ============================================================================
// AIR STRIKE EFFECT - OPTIMIZED
// Fewer bombs, simpler visuals
// ============================================================================

interface AirStrikeData {
  id: string;
  centerPosition: { x: number; y: number; z: number };
  startTime: number;
  bombs: { x: number; z: number; delay: number }[];
}

const airStrikes: AirStrikeData[] = [];
let airStrikeIdCounter = 0;

export function triggerAirStrike(position: { x: number; y: number; z: number }) {
  // Reduced bomb count for performance
  const bombs: { x: number; z: number; delay: number }[] = [];
  const bombCount = 8; // Reduced from 15
  
  for (let i = 0; i < bombCount; i++) {
    const angle = (i / bombCount) * Math.PI * 2;
    const r = 3 + (i / bombCount) * 8;
    bombs.push({
      x: position.x + Math.cos(angle) * r,
      z: position.z + Math.sin(angle) * r,
      delay: i * 180,
    });
  }
  
  bombs.push({ x: position.x, z: position.z, delay: bombCount * 180 + 200 });
  
  airStrikes.push({
    id: `airstrike_${airStrikeIdCounter++}`,
    centerPosition: { ...position },
    startTime: Date.now(),
    bombs,
  });
}

const AIR_STRIKE_DURATION = 3000;
const AIR_BOMB_FALL_TIME = 600;

function AirStrikeBomb({ x, z, fallbackGroundY, delay, startTime }: { 
  x: number; z: number; fallbackGroundY: number; delay: number; startTime: number;
}) {
  const bombRef = useRef<THREE.Mesh>(null);
  const warningRef = useRef<THREE.Group>(null);
  const explosionRef = useRef<THREE.Group>(null);
  const hasExplodedRef = useRef(false);
  const groundYRef = useRef(fallbackGroundY);
  const groundCheckedRef = useRef(false);
  
  useFrame(() => {
    // Ground check once
    if (!groundCheckedRef.current && isPhysicsReady()) {
      groundCheckedRef.current = true;
      const groundCheck = checkGroundWithNormal(x, fallbackGroundY + 50, z, 100);
      if (groundCheck?.isWalkable) {
        groundYRef.current = groundCheck.groundY;
      }
    }
    
    const elapsed = Date.now() - startTime - delay;
    const groundY = groundYRef.current;
    
    if (elapsed < 0) {
      if (bombRef.current) bombRef.current.visible = false;
      if (warningRef.current) warningRef.current.visible = false;
      if (explosionRef.current) explosionRef.current.visible = false;
      return;
    }
    
    const fallProgress = Math.min(1, elapsed / AIR_BOMB_FALL_TIME);
    
    // Bomb falling
    if (fallProgress < 1 && bombRef.current) {
      bombRef.current.visible = true;
      if (warningRef.current) warningRef.current.visible = true;
      if (explosionRef.current) explosionRef.current.visible = false;
      
      const startY = groundY + 50;
      const y = startY - (startY - groundY) * fallProgress * fallProgress;
      bombRef.current.position.set(x, y, z);
      bombRef.current.rotation.x += 0.15;
      bombRef.current.rotation.z += 0.1;
      
      // Pulse warning
      if (warningRef.current) {
        const pulse = 0.8 + Math.sin(elapsed * 0.02) * 0.2;
        warningRef.current.scale.setScalar(pulse);
      }
    } else if (!hasExplodedRef.current) {
      hasExplodedRef.current = true;
    }
    
    // Explosion
    if (hasExplodedRef.current) {
      if (bombRef.current) bombRef.current.visible = false;
      if (warningRef.current) warningRef.current.visible = false;
      if (explosionRef.current) {
        explosionRef.current.visible = true;
        const explosionElapsed = elapsed - AIR_BOMB_FALL_TIME;
        const explosionProgress = Math.min(1, explosionElapsed / 500);
        const easeOut = 1 - Math.pow(1 - explosionProgress, 2);
        const fadeOut = Math.max(0, 1 - explosionProgress * 1.5);
        const scale = 0.5 + easeOut * 3;
        explosionRef.current.scale.setScalar(scale);
        explosionRef.current.children.forEach(child => {
          if ((child as THREE.Mesh).material) {
            ((child as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = fadeOut;
          }
        });
      }
    }
  });
  
  return (
    <group>
      {/* Falling bomb */}
      <mesh ref={bombRef} visible={false} geometry={SHARED_GEOMETRIES.sphere8} scale={0.25} material={SHARED_MATERIALS.metalDark} />
      
      {/* Warning circle */}
      <group ref={warningRef} visible={false} position={[x, groundYRef.current + 0.1, z]}>
        <mesh rotation-x={-Math.PI / 2} geometry={SHARED_GEOMETRIES.ring16} scale={[2, 2, 1]}>
          <meshBasicMaterial color={0xff0000} transparent opacity={0.7} side={THREE.DoubleSide} />
        </mesh>
      </group>
      
      {/* Explosion */}
      <group ref={explosionRef} visible={false} position={[x, groundYRef.current + 0.5, z]}>
        <mesh geometry={SHARED_GEOMETRIES.sphere8}>
          <meshBasicMaterial color={0xffcc00} transparent opacity={0.9} />
        </mesh>
        <mesh geometry={SHARED_GEOMETRIES.sphere8} scale={1.3}>
          <meshBasicMaterial color={0xff5500} transparent opacity={0.6} />
        </mesh>
        <pointLight color={0xff4400} intensity={10} distance={8} decay={2} />
      </group>
    </group>
  );
}

function AirStrikeEffect({ strike }: { strike: AirStrikeData }) {
  const elapsed = Date.now() - strike.startTime;
  if (elapsed > AIR_STRIKE_DURATION + 1000) return null;
  
  return (
    <group>
      {strike.bombs.map((bomb, i) => (
        <AirStrikeBomb
          key={i}
          x={bomb.x}
          z={bomb.z}
          fallbackGroundY={strike.centerPosition.y}
          delay={bomb.delay}
          startTime={strike.startTime}
        />
      ))}
    </group>
  );
}

// ============================================================================
// BLAZE BOMB EFFECT - OPTIMIZED
// Single falling bomb with efficient explosion
// ============================================================================

interface BombEffectProps {
  bomb: BombData;
}

const BOMB_FALL_DURATION = 1500;
const EXPLOSION_DURATION = 1200;

export function BombEffect({ bomb }: BombEffectProps) {
  const bombRef = useRef<THREE.Group>(null);
  const warningRef = useRef<THREE.Group>(null);
  const explosionRef = useRef<THREE.Group>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  const hasExplodedRef = useRef(bomb.hasExploded);
  
  useFrame(() => {
    const now = Date.now();
    const elapsed = now - bomb.startTime;
    const fallProgress = Math.min(1, elapsed / BOMB_FALL_DURATION);
    
    if (!hasExplodedRef.current && fallProgress < 1) {
      // Bomb falling
      if (bombRef.current) {
        bombRef.current.visible = true;
        const startY = bomb.targetPosition.y + 50;
        const y = startY + (bomb.targetPosition.y - startY) * fallProgress * fallProgress;
        bombRef.current.position.set(bomb.targetPosition.x, y, bomb.targetPosition.z);
        bombRef.current.rotation.x += 0.1;
        bombRef.current.rotation.z += 0.08;
      }
      if (warningRef.current) {
        warningRef.current.visible = true;
        const pulse = 0.9 + Math.sin(elapsed * 0.015) * 0.1;
        warningRef.current.scale.setScalar(pulse);
      }
      if (explosionRef.current) explosionRef.current.visible = false;
    } else if (fallProgress >= 1 && !hasExplodedRef.current) {
      hasExplodedRef.current = true;
    }
    
    if (hasExplodedRef.current) {
      if (bombRef.current) bombRef.current.visible = false;
      if (warningRef.current) warningRef.current.visible = false;
      
      const explosionElapsed = now - bomb.impactTime;
      const explosionProgress = Math.min(1, explosionElapsed / EXPLOSION_DURATION);
      
      if (explosionProgress < 1 && explosionRef.current) {
        explosionRef.current.visible = true;
        const easeOut = 1 - Math.pow(1 - explosionProgress, 2);
        const fadeOut = Math.max(0, 1 - explosionProgress * 1.2);
        const scale = 1 + easeOut * 6;
        explosionRef.current.scale.setScalar(scale);
        
        // Update opacity on children
        explosionRef.current.children.forEach((child, i) => {
          if ((child as THREE.Mesh).isMesh && (child as THREE.Mesh).material) {
            const mat = (child as THREE.Mesh).material as THREE.MeshBasicMaterial;
            mat.opacity = fadeOut * (1 - i * 0.15);
          }
        });
        
        if (lightRef.current) {
          lightRef.current.intensity = fadeOut * 40;
        }
      } else if (explosionProgress >= 1 && explosionRef.current) {
        explosionRef.current.visible = false;
      }
    }
  });
  
  return (
    <group>
      {/* Falling bomb */}
      <group ref={bombRef}>
        <mesh geometry={SHARED_GEOMETRIES.sphere8} scale={[0.8, 1.2, 0.8]} material={SHARED_MATERIALS.metalDark} />
        <mesh position={[0, -0.8, 0]} geometry={SHARED_GEOMETRIES.cone6} scale={[0.5, 0.6, 0.5]} material={SHARED_MATERIALS.metalDark} />
        <mesh position={[0, 1.2, 0]} rotation={[Math.PI, 0, 0]} geometry={SHARED_GEOMETRIES.cone8} scale={[0.3, 1.5, 0.3]} material={SHARED_MATERIALS.fireInner} />
        <pointLight color={0xff4400} intensity={3} distance={10} decay={2} />
      </group>
      
      {/* Warning zone */}
      <group ref={warningRef} position={[bomb.targetPosition.x, bomb.targetPosition.y + 0.15, bomb.targetPosition.z]}>
        <mesh rotation-x={-Math.PI / 2} geometry={SHARED_GEOMETRIES.ring24} scale={[5, 5, 1]}>
          <meshBasicMaterial color={0xff0000} transparent opacity={0.7} side={THREE.DoubleSide} />
        </mesh>
        <mesh rotation-x={-Math.PI / 2} geometry={SHARED_GEOMETRIES.ring16} scale={[3, 3, 1]}>
          <meshBasicMaterial color={0xff4400} transparent opacity={0.6} side={THREE.DoubleSide} />
        </mesh>
        <mesh rotation-x={-Math.PI / 2} geometry={SHARED_GEOMETRIES.circle16} scale={[5, 5, 1]} position-y={-0.1}>
          <meshBasicMaterial color={0xff2200} transparent opacity={0.2} side={THREE.DoubleSide} />
        </mesh>
        <mesh rotation-x={-Math.PI / 2} geometry={SHARED_GEOMETRIES.plane} scale={[0.15, 10, 1]}>
          <meshBasicMaterial color={0xff0000} transparent opacity={0.5} side={THREE.DoubleSide} />
        </mesh>
        <mesh rotation-x={-Math.PI / 2} rotation-z={Math.PI / 2} geometry={SHARED_GEOMETRIES.plane} scale={[0.15, 10, 1]}>
          <meshBasicMaterial color={0xff0000} transparent opacity={0.5} side={THREE.DoubleSide} />
        </mesh>
      </group>
      
      {/* Explosion */}
      <group ref={explosionRef} visible={false} position={[bomb.targetPosition.x, bomb.targetPosition.y + 1, bomb.targetPosition.z]}>
        <mesh geometry={SHARED_GEOMETRIES.sphere12}>
          <meshBasicMaterial color={0xffffcc} transparent opacity={0.95} />
        </mesh>
        <mesh geometry={SHARED_GEOMETRIES.sphere12} scale={1.3}>
          <meshBasicMaterial color={0xff8800} transparent opacity={0.8} />
        </mesh>
        <mesh geometry={SHARED_GEOMETRIES.sphere8} scale={1.6}>
          <meshBasicMaterial color={0xff4400} transparent opacity={0.6} />
        </mesh>
        <mesh geometry={SHARED_GEOMETRIES.sphere8} scale={1.9}>
          <meshBasicMaterial color={0xff2200} transparent opacity={0.4} />
        </mesh>
        <mesh rotation-x={-Math.PI / 2} position-y={-0.5} geometry={SHARED_GEOMETRIES.ring24} scale={[2, 2, 1]}>
          <meshBasicMaterial color={0xff6600} transparent opacity={0.7} side={THREE.DoubleSide} />
        </mesh>
        <pointLight ref={lightRef} color={0xff5500} intensity={40} distance={30} decay={2} />
      </group>
    </group>
  );
}

// ============================================================================
// BOMB TARGETING INDICATOR - OPTIMIZED
// ============================================================================

interface BombTargetingIndicatorProps {
  isActive: boolean;
  onTargetUpdate: (position: THREE.Vector3 | null, isValid: boolean) => void;
}

const BOMB_MAX_RANGE = 60;
const BOMB_MIN_RANGE = 5;

// Pre-allocated vectors for targeting
const _lookDir = new THREE.Vector3();
const _horizontalDir = new THREE.Vector3();
const _targetPos = new THREE.Vector3();

export function BombTargetingIndicator({ isActive, onTargetUpdate }: BombTargetingIndicatorProps) {
  const indicatorRef = useRef<THREE.Group>(null);
  const rotationRef = useRef(0);
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
    
    _lookDir.set(0, 0, -1).applyQuaternion(camera.quaternion);
    const playerFeetY = localPlayer.position.y - 0.9;
    
    let targetX = camera.position.x;
    let targetZ = camera.position.z;
    let targetY = playerFeetY;
    let isValid = false;
    let foundGround = false;
    
    if (isPhysicsReady()) {
      _horizontalDir.set(_lookDir.x, 0, _lookDir.z);
      const horizontalLength = _horizontalDir.length();
      
      if (horizontalLength > 0.01) {
        _horizontalDir.normalize();
        const pitch = Math.asin(Math.max(-1, Math.min(1, -_lookDir.y)));
        
        if (pitch > 0.1 && _lookDir.y < -0.01) {
          const t = (playerFeetY - camera.position.y) / _lookDir.y;
          if (t > 0 && t < 200) {
            targetX = camera.position.x + _lookDir.x * t;
            targetZ = camera.position.z + _lookDir.z * t;
            const groundCheck = checkGroundWithNormal(targetX, playerFeetY + 30, targetZ, 60);
            if (groundCheck?.isWalkable) {
              targetY = groundCheck.groundY + 0.1;
              foundGround = true;
            }
          }
        }
        
        if (!foundGround) {
          const distanceFactor = Math.max(0.2, Math.cos(pitch));
          const projectionDist = BOMB_MIN_RANGE + (BOMB_MAX_RANGE - BOMB_MIN_RANGE) * distanceFactor * 0.5;
          targetX = localPlayer.position.x + _horizontalDir.x * projectionDist;
          targetZ = localPlayer.position.z + _horizontalDir.z * projectionDist;
          const groundCheck = checkGroundWithNormal(targetX, localPlayer.position.y + 30, targetZ, 60);
          if (groundCheck?.isWalkable) {
            targetY = groundCheck.groundY + 0.1;
            foundGround = true;
          }
        }
        
        if (foundGround) {
          const dx = targetX - localPlayer.position.x;
          const dz = targetZ - localPlayer.position.z;
          const horizontalDist = Math.sqrt(dx * dx + dz * dz);
          
          if (horizontalDist > BOMB_MAX_RANGE) {
            const scale = BOMB_MAX_RANGE / horizontalDist;
            targetX = localPlayer.position.x + dx * scale;
            targetZ = localPlayer.position.z + dz * scale;
            const groundCheck = checkGroundWithNormal(targetX, localPlayer.position.y + 30, targetZ, 60);
            if (groundCheck?.isWalkable) {
              targetY = groundCheck.groundY + 0.1;
            } else {
              foundGround = false;
            }
          }
          
          const finalDist = Math.sqrt((targetX - localPlayer.position.x) ** 2 + (targetZ - localPlayer.position.z) ** 2);
          if (foundGround && finalDist >= BOMB_MIN_RANGE) {
            isValid = true;
          }
        }
      }
    }
    
    _targetPos.set(targetX, targetY, targetZ);
    isValidRef.current = isValid;
    
    if (indicatorRef.current) {
      indicatorRef.current.visible = true;
      indicatorRef.current.position.copy(_targetPos);
      rotationRef.current += 0.02;
    }
    
    onTargetUpdate(_targetPos.clone(), isValid);
  });
  
  if (!isActive) return null;
  
  const baseColor = isValidRef.current ? 0xff4400 : 0xff0000;
  
  return (
    <group ref={indicatorRef}>
      {/* Main rings */}
      <mesh rotation-x={-Math.PI / 2} position-y={0.1} geometry={SHARED_GEOMETRIES.ring24} scale={[5, 5, 1]}>
        <meshBasicMaterial color={baseColor} transparent opacity={0.7} side={THREE.DoubleSide} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={0.15} geometry={SHARED_GEOMETRIES.ring16} scale={[3, 3, 1]}>
        <meshBasicMaterial color={0xff6600} transparent opacity={0.8} side={THREE.DoubleSide} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={0.2} geometry={SHARED_GEOMETRIES.ring16} scale={[1.5, 1.5, 1]}>
        <meshBasicMaterial color={0xffaa00} transparent opacity={0.9} side={THREE.DoubleSide} />
      </mesh>
      
      {/* Center */}
      <mesh rotation-x={-Math.PI / 2} position-y={0.25} geometry={SHARED_GEOMETRIES.circle16} scale={[0.5, 0.5, 1]}>
        <meshBasicMaterial color={0xffff00} transparent opacity={1} side={THREE.DoubleSide} />
      </mesh>
      
      {/* Fill */}
      <mesh rotation-x={-Math.PI / 2} position-y={0.05} geometry={SHARED_GEOMETRIES.circle16} scale={[5, 5, 1]}>
        <meshBasicMaterial color={0xff2200} transparent opacity={0.15} side={THREE.DoubleSide} />
      </mesh>
      
      {/* Cross */}
      <mesh rotation-x={-Math.PI / 2} position-y={0.15} geometry={SHARED_GEOMETRIES.plane} scale={[0.12, 10, 1]}>
        <meshBasicMaterial color={baseColor} transparent opacity={0.7} side={THREE.DoubleSide} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} rotation-z={Math.PI / 2} position-y={0.15} geometry={SHARED_GEOMETRIES.plane} scale={[0.12, 10, 1]}>
        <meshBasicMaterial color={baseColor} transparent opacity={0.7} side={THREE.DoubleSide} />
      </mesh>
      
      {/* Vertical pillar */}
      <mesh position-y={20} geometry={SHARED_GEOMETRIES.cylinder8} scale={[0.06, 40, 0.06]}>
        <meshBasicMaterial color={0xff6600} transparent opacity={0.3} />
      </mesh>
      
      {/* Top marker */}
      <mesh position-y={42} geometry={SHARED_GEOMETRIES.sphere8} scale={0.4}>
        <meshBasicMaterial color={0xff4400} transparent opacity={0.7} />
      </mesh>
      
      <pointLight color={baseColor} intensity={2} distance={6} decay={2} position-y={0.5} />
    </group>
  );
}

// ============================================================================
// JETPACK EFFECT - OPTIMIZED
// Efficient dual flames
// ============================================================================

interface JetpackEffectProps {
  isActive: boolean;
  playerPosition: { x: number; y: number; z: number };
}

export function JetpackEffect({ isActive, playerPosition }: JetpackEffectProps) {
  const groupRef = useRef<THREE.Group>(null);
  const leftFlameRef = useRef<THREE.Group>(null);
  const rightFlameRef = useRef<THREE.Group>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  
  useFrame((state) => {
    if (!isActive || !groupRef.current) return;
    
    const time = state.clock.elapsedTime * 20;
    const flicker = 0.85 + Math.sin(time) * 0.1 + Math.sin(time * 3.7) * 0.05;
    
    if (leftFlameRef.current) {
      leftFlameRef.current.scale.set(flicker, flicker * 1.2, flicker);
    }
    if (rightFlameRef.current) {
      rightFlameRef.current.scale.set(flicker, flicker * 1.1, flicker);
    }
    if (lightRef.current) {
      lightRef.current.intensity = flicker * 5;
    }
  });
  
  if (!isActive) return null;
  
  const thrusterOffset = 0.25;
  
  return (
    <group ref={groupRef} position={[playerPosition.x, playerPosition.y - 1.0, playerPosition.z]}>
      {/* Left thruster */}
      <group ref={leftFlameRef} position={[-thrusterOffset, 0, 0]}>
        <mesh position={[0, -0.2, 0]} geometry={SHARED_GEOMETRIES.cone8} scale={[0.08, 0.4, 0.08]}>
          <meshBasicMaterial color={0xffffff} transparent opacity={0.95} />
        </mesh>
        <mesh position={[0, -0.4, 0]} geometry={SHARED_GEOMETRIES.cone8} scale={[0.12, 0.6, 0.12]}>
          <meshBasicMaterial color={0xffaa00} transparent opacity={0.85} />
        </mesh>
        <mesh position={[0, -0.55, 0]} geometry={SHARED_GEOMETRIES.cone8} scale={[0.18, 0.8, 0.18]}>
          <meshBasicMaterial color={0xff5500} transparent opacity={0.6} />
        </mesh>
      </group>
      
      {/* Right thruster */}
      <group ref={rightFlameRef} position={[thrusterOffset, 0, 0]}>
        <mesh position={[0, -0.2, 0]} geometry={SHARED_GEOMETRIES.cone8} scale={[0.08, 0.4, 0.08]}>
          <meshBasicMaterial color={0xffffff} transparent opacity={0.95} />
        </mesh>
        <mesh position={[0, -0.4, 0]} geometry={SHARED_GEOMETRIES.cone8} scale={[0.12, 0.6, 0.12]}>
          <meshBasicMaterial color={0xffaa00} transparent opacity={0.85} />
        </mesh>
        <mesh position={[0, -0.55, 0]} geometry={SHARED_GEOMETRIES.cone8} scale={[0.18, 0.8, 0.18]}>
          <meshBasicMaterial color={0xff5500} transparent opacity={0.6} />
        </mesh>
      </group>
      
      {/* Single light for both thrusters */}
      <pointLight ref={lightRef} color={0xff6600} intensity={5} distance={8} decay={2} position={[0, -0.4, 0]} />
    </group>
  );
}

// ============================================================================
// BLAZE EFFECTS MANAGER
// ============================================================================

export function BlazeEffectsManager() {
  const rockets = useGameStore(state => state.rockets);
  const bombs = useGameStore(state => state.bombs);
  const localPlayer = useGameStore(state => state.localPlayer);
  const jetpackActive = useGameStore(state => state.jetpackActive);
  
  const [activeRocketJumpExplosions, setActiveRocketJumpExplosions] = useState<RocketJumpExplosionData[]>([]);
  const [activeAirStrikes, setActiveAirStrikes] = useState<AirStrikeData[]>([]);
  
  // Cleanup expired effects periodically
  useEffect(() => {
    const interval = setInterval(() => {
      useGameStore.getState().clearExpiredRockets();
      useGameStore.getState().clearExpiredBombs();
      
      const now = Date.now();
      const activeExplosions = rocketJumpExplosions.filter(e => now - e.startTime < ROCKET_JUMP_DURATION);
      rocketJumpExplosions.length = 0;
      rocketJumpExplosions.push(...activeExplosions);
      setActiveRocketJumpExplosions([...activeExplosions]);
      
      const activeStrks = airStrikes.filter(s => now - s.startTime < AIR_STRIKE_DURATION + 1000);
      airStrikes.length = 0;
      airStrikes.push(...activeStrks);
      setActiveAirStrikes([...activeStrks]);
    }, 150); // Slightly less frequent cleanup
    
    return () => clearInterval(interval);
  }, []);
  
  return (
    <group>
      {rockets.map(rocket => (
        <RocketEffect key={rocket.id} rocket={rocket} />
      ))}
      
      {bombs.map(bomb => (
        <BombEffect key={bomb.id} bomb={bomb} />
      ))}
      
      {activeRocketJumpExplosions.map(explosion => (
        <RocketJumpExplosion key={explosion.id} explosion={explosion} />
      ))}
      
      {activeAirStrikes.map(strike => (
        <AirStrikeEffect key={strike.id} strike={strike} />
      ))}
      
      {localPlayer && jetpackActive && (
        <JetpackEffect isActive={true} playerPosition={localPlayer.position} />
      )}
    </group>
  );
}

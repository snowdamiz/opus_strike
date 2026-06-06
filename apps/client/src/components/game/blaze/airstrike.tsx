import { useRef, useState, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import React from 'react';
import { useGameStore } from '../../../store/gameStore';
import { checkGroundWithNormal, isPhysicsReady, raycastDirection } from '../../../hooks/usePhysics';
import { SHARED_GEOMETRIES } from '../effectResources';

// ============================================================================
// AIR STRIKE EFFECT - DRAMATIC BOMBING RUN
// More bombs, longer duration, spectacular visuals
// ============================================================================

interface AirStrikeData {
  id: string;
  centerPosition: { x: number; y: number; z: number };
  startTime: number;
  bombs: { x: number; z: number; delay: number; groundY: number; size: number }[];
}

const airStrikes: AirStrikeData[] = [];
let airStrikeIdCounter = 0;
const AIR_STRIKE_AREA_RADIUS = 7.75;
const AIR_STRIKE_INNER_RADIUS = AIR_STRIKE_AREA_RADIUS * 0.34;
const AIR_STRIKE_MIDDLE_RADIUS = AIR_STRIKE_AREA_RADIUS * 0.58;
const AIR_STRIKE_OUTER_RADIUS = AIR_STRIKE_AREA_RADIUS * 0.86;

export function triggerAirStrike(position: { x: number; y: number; z: number }) {
  const bombs: { x: number; z: number; delay: number; groundY: number; size: number }[] = [];
  
  // Wave 1: Inner ring (4 bombs) - starts immediately
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2 + Math.random() * 0.3;
    const r = AIR_STRIKE_INNER_RADIUS + Math.random() * 1.0;
    const bx = position.x + Math.cos(angle) * r;
    const bz = position.z + Math.sin(angle) * r;
    
    let groundY = position.y;
    if (isPhysicsReady()) {
      const check = checkGroundWithNormal(bx, position.y + 60, bz, 120);
      if (check?.isWalkable) groundY = check.groundY;
    }
    bombs.push({ x: bx, z: bz, delay: i * 120 + Math.random() * 80, groundY, size: 0.8 + Math.random() * 0.4 });
  }
  
  // Wave 2: Middle ring (6 bombs) - starts at 400ms
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2 + Math.random() * 0.4;
    const r = AIR_STRIKE_MIDDLE_RADIUS + Math.random() * 1.6;
    const bx = position.x + Math.cos(angle) * r;
    const bz = position.z + Math.sin(angle) * r;
    
    let groundY = position.y;
    if (isPhysicsReady()) {
      const check = checkGroundWithNormal(bx, position.y + 60, bz, 120);
      if (check?.isWalkable) groundY = check.groundY;
    }
    bombs.push({ x: bx, z: bz, delay: 400 + i * 100 + Math.random() * 60, groundY, size: 1.0 + Math.random() * 0.5 });
  }
  
  // Wave 3: Outer ring (8 bombs) - starts at 900ms
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2 + Math.random() * 0.3;
    const r = AIR_STRIKE_OUTER_RADIUS + Math.random() * 2.4;
    const bx = position.x + Math.cos(angle) * r;
    const bz = position.z + Math.sin(angle) * r;
    
    let groundY = position.y;
    if (isPhysicsReady()) {
      const check = checkGroundWithNormal(bx, position.y + 60, bz, 120);
      if (check?.isWalkable) groundY = check.groundY;
    }
    bombs.push({ x: bx, z: bz, delay: 900 + i * 80 + Math.random() * 50, groundY, size: 1.2 + Math.random() * 0.6 });
  }
  
  // Final big bomb in center
  bombs.push({ 
    x: position.x, 
    z: position.z, 
    delay: 1800, 
    groundY: position.y,
    size: 2.0 // Bigger center explosion
  });
  
  airStrikes.push({
    id: `airstrike_${airStrikeIdCounter++}`,
    centerPosition: { ...position },
    startTime: Date.now(),
    bombs,
  });
}

export const AIR_STRIKE_DURATION = 4500; // Longer duration
const AIR_BOMB_FALL_TIME = 600;
const AIR_EXPLOSION_TIME = 700; // Longer explosions

// Single optimized component for all air strike visuals
const AirStrikeEffect = React.memo(({ strike }: { strike: AirStrikeData }) => {
  const bombMeshes = useRef<(THREE.Mesh | null)[]>([]);
  const trailMeshes = useRef<(THREE.Mesh | null)[]>([]);
  const warningMeshes = useRef<(THREE.Mesh | null)[]>([]);
  const warningFillMeshes = useRef<(THREE.Mesh | null)[]>([]);
  const explosionGroups = useRef<(THREE.Group | null)[]>([]);
  const lightRef = useRef<THREE.PointLight>(null);
  const explodedFlags = useRef<boolean[]>(strike.bombs.map(() => false));
  
  useFrame(() => {
    const now = Date.now();
    const elapsed = now - strike.startTime;
    
    let activeExplosions = 0;
    let lightX = strike.centerPosition.x;
    let lightY = strike.centerPosition.y + 3;
    let lightZ = strike.centerPosition.z;
    
    strike.bombs.forEach((bomb, i) => {
      const bombElapsed = elapsed - bomb.delay;
      const bombMesh = bombMeshes.current[i];
      const trailMesh = trailMeshes.current[i];
      const warningMesh = warningMeshes.current[i];
      const warningFill = warningFillMeshes.current[i];
      const explosionGroup = explosionGroups.current[i];
      
      if (bombElapsed < 0) {
        // Not started - show early warning
        if (bombMesh) bombMesh.visible = false;
        if (trailMesh) trailMesh.visible = false;
        if (explosionGroup) explosionGroup.visible = false;
        
        // Show warning 500ms before bomb starts falling
        const warningElapsed = bombElapsed + 500;
        if (warningElapsed > 0 && warningMesh && warningFill) {
          warningMesh.visible = true;
          warningFill.visible = true;
          const warningProgress = Math.min(1, warningElapsed / 500);
          const pulse = 0.86 + Math.sin(warningElapsed * 0.035) * 0.16;
          warningMesh.rotation.z = warningElapsed * 0.006;
          warningMesh.scale.setScalar((0.65 + warningProgress * 0.45) * pulse * bomb.size);
          warningFill.scale.setScalar((0.6 + warningProgress * 0.34) * bomb.size);
          (warningMesh.material as THREE.MeshBasicMaterial).opacity = 0.35 + warningProgress * 0.35;
          (warningFill.material as THREE.MeshBasicMaterial).opacity = 0.08 + warningProgress * 0.13;
        } else {
          if (warningMesh) warningMesh.visible = false;
          if (warningFill) warningFill.visible = false;
        }
        return;
      }
      
      const fallProgress = Math.min(1, bombElapsed / AIR_BOMB_FALL_TIME);
      
      if (fallProgress < 1) {
        // Falling
        if (bombMesh) {
          bombMesh.visible = true;
          const startY = bomb.groundY + 55;
          const y = startY - (startY - bomb.groundY) * fallProgress * fallProgress;
          bombMesh.position.set(bomb.x, y, bomb.z);
          bombMesh.rotation.x += 0.15;
          bombMesh.rotation.z += 0.1;
          bombMesh.scale.set(0.18 * bomb.size, 0.34 * bomb.size, 0.18 * bomb.size);
        }
        if (trailMesh) {
          trailMesh.visible = true;
          const startY = bomb.groundY + 55;
          const y = startY - (startY - bomb.groundY) * fallProgress * fallProgress;
          trailMesh.position.set(bomb.x, y + 0.8 * bomb.size, bomb.z);
          trailMesh.scale.set(
            0.16 * bomb.size * (1 - fallProgress * 0.25),
            1.5 * bomb.size * (0.75 + fallProgress * 0.35),
            0.16 * bomb.size * (1 - fallProgress * 0.25)
          );
          (trailMesh.material as THREE.MeshBasicMaterial).opacity = 0.45 + fallProgress * 0.4;
        }
        if (warningMesh) {
          warningMesh.visible = true;
          const pulse = 0.94 + Math.sin(bombElapsed * 0.03) * 0.08;
          warningMesh.rotation.z = bombElapsed * 0.01;
          warningMesh.scale.setScalar((1 + fallProgress * 0.18) * pulse * bomb.size);
          (warningMesh.material as THREE.MeshBasicMaterial).opacity = 0.75;
        }
        if (warningFill) {
          warningFill.visible = true;
          warningFill.scale.setScalar((0.92 + fallProgress * 0.16) * bomb.size);
          (warningFill.material as THREE.MeshBasicMaterial).opacity = 0.16 + fallProgress * 0.12;
        }
        if (explosionGroup) explosionGroup.visible = false;
      } else {
        // Exploded
        if (!explodedFlags.current[i]) {
          explodedFlags.current[i] = true;
        }
        
        if (bombMesh) bombMesh.visible = false;
        if (trailMesh) trailMesh.visible = false;
        if (warningMesh) warningMesh.visible = false;
        if (warningFill) warningFill.visible = false;
        
        const explosionElapsed = bombElapsed - AIR_BOMB_FALL_TIME;
        const explosionProgress = Math.min(1, explosionElapsed / AIR_EXPLOSION_TIME);
        
        if (explosionProgress < 1 && explosionGroup) {
          explosionGroup.visible = true;
          activeExplosions++;
          const easeOut = 1 - Math.pow(1 - explosionProgress, 2);
          const fadeOut = Math.max(0, 1 - explosionProgress * 1.2);
          const scale = (0.28 + easeOut * 1.35) * bomb.size;
          explosionGroup.scale.setScalar(scale);
          
          // Track light position
          lightX = bomb.x;
          lightY = bomb.groundY + 2 * bomb.size;
          lightZ = bomb.z;
          
          // Update opacity on all children
          explosionGroup.children.forEach((child, ci) => {
            const mesh = child as THREE.Mesh;
            if (mesh.material) {
              const material = mesh.material as THREE.MeshBasicMaterial;
              material.opacity = Math.max(0, fadeOut * (1 - ci * 0.09));
            }

            switch (ci) {
              case 0:
                mesh.scale.setScalar(0.55 + (1 - explosionProgress) * 0.35);
                break;
              case 1:
                mesh.scale.setScalar(0.78 + easeOut * 0.34);
                break;
              case 2:
                mesh.scale.setScalar(1.02 + easeOut * 0.46);
                break;
              case 3:
                mesh.scale.setScalar(1.18 + easeOut * 0.54);
                break;
              case 4: {
                const ringScale = 0.8 + easeOut * 0.85;
                mesh.scale.set(ringScale, ringScale, 1);
                break;
              }
              case 5: {
                const shockScale = 0.92 + easeOut * 1.08;
                mesh.scale.set(shockScale, shockScale, 1);
                break;
              }
              case 6:
                mesh.scale.setScalar(0.95 + easeOut * 0.72);
                break;
            }
          });
        } else if (explosionGroup) {
          explosionGroup.visible = false;
        }
      }
    });
    
    // Update dynamic light
    if (lightRef.current) {
      lightRef.current.position.set(lightX, lightY, lightZ);
      lightRef.current.intensity = activeExplosions > 0 ? Math.min(activeExplosions * 8, 26) : 3;
    }
  });
  
  const elapsed = Date.now() - strike.startTime;
  if (elapsed > AIR_STRIKE_DURATION) return null;
  
  return (
    <group>
      {strike.bombs.map((bomb, i) => (
        <group key={i}>
          {/* Falling bomb */}
          <mesh 
            ref={el => bombMeshes.current[i] = el}
            visible={false}
            geometry={SHARED_GEOMETRIES.sphere8}
          >
            <meshBasicMaterial color={0x1a1a1a} />
          </mesh>
          
          {/* Fire trail */}
          <mesh
            ref={el => trailMeshes.current[i] = el}
            visible={false}
            rotation={[Math.PI, 0, 0]}
            geometry={SHARED_GEOMETRIES.cone8}
          >
            <meshBasicMaterial color={0xff6600} transparent opacity={0.8} />
          </mesh>
          
          {/* Warning ring */}
          <mesh
            ref={el => warningMeshes.current[i] = el}
            visible={false}
            position={[bomb.x, bomb.groundY + 0.12, bomb.z]}
            rotation-x={-Math.PI / 2}
            geometry={SHARED_GEOMETRIES.ring24}
            scale={[2.5, 2.5, 1]}
          >
            <meshBasicMaterial color={0xff0000} transparent opacity={0.8} side={THREE.DoubleSide} />
          </mesh>
          
          {/* Warning fill */}
          <mesh
            ref={el => warningFillMeshes.current[i] = el}
            visible={false}
            position={[bomb.x, bomb.groundY + 0.08, bomb.z]}
            rotation-x={-Math.PI / 2}
            geometry={SHARED_GEOMETRIES.circle16}
            scale={[2.5, 2.5, 1]}
          >
            <meshBasicMaterial color={0xff2200} transparent opacity={0.25} side={THREE.DoubleSide} />
          </mesh>
          
          {/* Explosion - multiple layers */}
          <group 
            ref={el => explosionGroups.current[i] = el}
            visible={false}
            position={[bomb.x, bomb.groundY + 0.8, bomb.z]}
          >
            {/* Core flash */}
            <mesh geometry={SHARED_GEOMETRIES.sphere8}>
              <meshBasicMaterial color={0xffffcc} transparent opacity={1} depthWrite={false} blending={THREE.AdditiveBlending} />
            </mesh>
            {/* Inner fire */}
            <mesh geometry={SHARED_GEOMETRIES.sphere8} scale={1.3}>
              <meshBasicMaterial color={0xffcc44} transparent opacity={0.9} depthWrite={false} blending={THREE.AdditiveBlending} />
            </mesh>
            {/* Outer fire */}
            <mesh geometry={SHARED_GEOMETRIES.sphere8} scale={1.6}>
              <meshBasicMaterial color={0xff5a00} transparent opacity={0.7} depthWrite={false} blending={THREE.AdditiveBlending} />
            </mesh>
            {/* Smoke ring */}
            <mesh geometry={SHARED_GEOMETRIES.sphere8} scale={1.4}>
              <meshBasicMaterial color={0x6b2a12} transparent opacity={0.34} depthWrite={false} />
            </mesh>
            {/* Ground ring */}
            <mesh rotation-x={-Math.PI / 2} position-y={-0.5} geometry={SHARED_GEOMETRIES.ring16} scale={[1.1, 1.1, 1]}>
              <meshBasicMaterial color={0xff7a00} transparent opacity={0.6} side={THREE.DoubleSide} depthWrite={false} blending={THREE.AdditiveBlending} />
            </mesh>
            {/* Shockwave */}
            <mesh rotation-x={-Math.PI / 2} position-y={-0.46} geometry={SHARED_GEOMETRIES.ring24} scale={[1.35, 1.35, 1]}>
              <meshBasicMaterial color={0xffffaa} transparent opacity={0.42} side={THREE.DoubleSide} depthWrite={false} blending={THREE.AdditiveBlending} />
            </mesh>
            {/* Lingering smoke dome */}
            <mesh geometry={SHARED_GEOMETRIES.sphere8} scale={1.55}>
              <meshBasicMaterial color={0x2a211c} transparent opacity={0.24} depthWrite={false} />
            </mesh>
          </group>
        </group>
      ))}
      
      {/* Dynamic light that follows active explosions */}
      <pointLight 
        ref={lightRef}
        position={[strike.centerPosition.x, strike.centerPosition.y + 3, strike.centerPosition.z]}
        color={0xff4400} 
        intensity={10} 
        distance={24} 
        decay={2} 
      />
    </group>
  );
}, (prev, next) => {
  // Custom comparison for object props (strike)
  return (
    prev.strike.id === next.strike.id &&
    prev.strike.centerPosition.x === next.strike.centerPosition.x &&
    prev.strike.centerPosition.y === next.strike.centerPosition.y &&
    prev.strike.centerPosition.z === next.strike.centerPosition.z &&
    prev.strike.startTime === next.strike.startTime
  );
});

// ============================================================================
// AIR STRIKE TARGETING INDICATOR - Simplified for performance
// ============================================================================

interface AirStrikeTargetingIndicatorProps {
  isActive: boolean;
  onTargetUpdate: (position: THREE.Vector3 | null, isValid: boolean) => void;
}

const AIRSTRIKE_MAX_RANGE = 80;
const AIRSTRIKE_MIN_RANGE = 10;

// Pre-allocated vectors for airstrike targeting (local to avoid conflicts)
const _asLookDir = new THREE.Vector3();
const _asTargetPos = new THREE.Vector3();
const _asHorizDir = new THREE.Vector3();

export function AirStrikeTargetingIndicator({ isActive, onTargetUpdate }: AirStrikeTargetingIndicatorProps) {
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
    
    _asLookDir.set(0, 0, -1).applyQuaternion(camera.quaternion);
    
    let targetX = camera.position.x;
    let targetY = camera.position.y;
    let targetZ = camera.position.z;
    let isValid = false;
    let foundTarget = false;
    
    if (isPhysicsReady()) {
      const directHit = raycastDirection(
        camera.position.x, camera.position.y, camera.position.z,
        _asLookDir.x, _asLookDir.y, _asLookDir.z,
        AIRSTRIKE_MAX_RANGE + 20
      );
      
      if (directHit && directHit.hit) {
        targetX = directHit.point.x;
        targetY = directHit.point.y;
        targetZ = directHit.point.z;
        foundTarget = true;
        
        if (!directHit.isWalkable) {
          const groundBelow = checkGroundWithNormal(targetX, targetY + 10, targetZ, 60);
          if (groundBelow?.isWalkable) {
            targetY = groundBelow.groundY + 0.1;
          }
        } else {
          targetY += 0.1;
        }
      }
      
      if (!foundTarget) {
        const pitch = Math.asin(Math.max(-1, Math.min(1, -_asLookDir.y)));
        const baseDist = pitch > 0.3 ? 20 : (pitch > 0 ? 35 : 50);
        const sampleDistances = [baseDist * 0.5, baseDist, baseDist * 1.5, AIRSTRIKE_MAX_RANGE];
        
        for (const dist of sampleDistances) {
          const sampleX = camera.position.x + _asLookDir.x * dist;
          const sampleY = camera.position.y + _asLookDir.y * dist;
          const sampleZ = camera.position.z + _asLookDir.z * dist;
          
          const groundCheck = checkGroundWithNormal(sampleX, Math.max(sampleY + 60, camera.position.y + 60), sampleZ, 180);
          
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
        const dy = targetY - localPlayer.position.y;
        const dz = targetZ - localPlayer.position.z;
        const dist3D = Math.sqrt(dx * dx + dy * dy + dz * dz);
        
        if (dist3D > AIRSTRIKE_MAX_RANGE) {
          const scale = AIRSTRIKE_MAX_RANGE / dist3D;
          targetX = localPlayer.position.x + dx * scale;
          targetY = localPlayer.position.y + dy * scale;
          targetZ = localPlayer.position.z + dz * scale;
          
          const groundCheck = checkGroundWithNormal(targetX, targetY + 40, targetZ, 120);
          if (groundCheck?.isWalkable) {
            targetY = groundCheck.groundY + 0.1;
          } else {
            foundTarget = false;
          }
        }
        
        const finalDistH = Math.sqrt(
          (targetX - localPlayer.position.x) ** 2 + 
          (targetZ - localPlayer.position.z) ** 2
        );
        
        if (foundTarget && finalDistH >= AIRSTRIKE_MIN_RANGE) {
          isValid = true;
        }
      }
      
      if (!foundTarget) {
        const fallbackDist = 30;
        _asHorizDir.set(_asLookDir.x, 0, _asLookDir.z).normalize();
        targetX = localPlayer.position.x + _asHorizDir.x * fallbackDist;
        targetZ = localPlayer.position.z + _asHorizDir.z * fallbackDist;
        
        const groundCheck = checkGroundWithNormal(targetX, localPlayer.position.y + 40, targetZ, 120);
        if (groundCheck?.isWalkable) {
          targetY = groundCheck.groundY + 0.1;
          isValid = Math.sqrt(
            (targetX - localPlayer.position.x) ** 2 + 
            (targetZ - localPlayer.position.z) ** 2
          ) >= AIRSTRIKE_MIN_RANGE;
        }
      }
    }
    
    _asTargetPos.set(targetX, targetY, targetZ);
    isValidRef.current = isValid;
    
    if (indicatorRef.current) {
      indicatorRef.current.visible = true;
      indicatorRef.current.position.copy(_asTargetPos);
    }
    
    onTargetUpdate(_asTargetPos.clone(), isValid);
  });
  
  if (!isActive) return null;
  
  const baseColor = isValidRef.current ? 0xff2200 : 0x880000;
  const middleRadius = AIR_STRIKE_AREA_RADIUS * 0.68;
  const innerRadius = AIR_STRIKE_AREA_RADIUS * 0.38;
  const crossLength = AIR_STRIKE_AREA_RADIUS * 2.08;
  
  return (
    <group ref={indicatorRef}>
      {/* Large danger zone indicator */}
      <mesh rotation-x={-Math.PI / 2} position-y={0.1} geometry={SHARED_GEOMETRIES.ring24} scale={[AIR_STRIKE_AREA_RADIUS, AIR_STRIKE_AREA_RADIUS, 1]}>
        <meshBasicMaterial color={0xff2200} transparent opacity={0.62} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={0.12} geometry={SHARED_GEOMETRIES.ring24} scale={[middleRadius, middleRadius, 1]}>
        <meshBasicMaterial color={baseColor} transparent opacity={0.72} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={0.14} geometry={SHARED_GEOMETRIES.ring16} scale={[innerRadius, innerRadius, 1]}>
        <meshBasicMaterial color={0xffaa00} transparent opacity={0.82} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={0.2} geometry={SHARED_GEOMETRIES.circle16} scale={[0.65, 0.65, 1]}>
        <meshBasicMaterial color={0xffff66} transparent opacity={1} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={0.05} geometry={SHARED_GEOMETRIES.circle16} scale={[AIR_STRIKE_AREA_RADIUS, AIR_STRIKE_AREA_RADIUS, 1]}>
        <meshBasicMaterial color={0xff3300} transparent opacity={0.08} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      
      {/* Cross */}
      <mesh rotation-x={-Math.PI / 2} position-y={0.15} geometry={SHARED_GEOMETRIES.plane} scale={[0.16, crossLength, 1]}>
        <meshBasicMaterial color={0xff3300} transparent opacity={0.58} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} rotation-z={Math.PI / 2} position-y={0.15} geometry={SHARED_GEOMETRIES.plane} scale={[0.16, crossLength, 1]}>
        <meshBasicMaterial color={0xff3300} transparent opacity={0.58} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      
      <pointLight color={0xff3300} intensity={2.6} distance={10} decay={2} position-y={1} />
    </group>
  );
}

// Hook to manage air strikes
export function useAirStrikes() {
  const [activeStrikes, setActiveStrikes] = useState<AirStrikeData[]>([]);
  
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      const active = airStrikes.filter(s => now - s.startTime < AIR_STRIKE_DURATION + 500);
      airStrikes.length = 0;
      airStrikes.push(...active);
      setActiveStrikes([...active]);
    }, 150);
    
    return () => clearInterval(interval);
  }, []);
  
  return activeStrikes;
}

export function AirStrikeEffects() {
  const activeStrikes = useAirStrikes();
  
  return (
    <>
      {activeStrikes.map(strike => (
        <AirStrikeEffect key={strike.id} strike={strike} />
      ))}
    </>
  );
}

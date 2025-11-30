import { useRef, useState, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
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

export function triggerAirStrike(position: { x: number; y: number; z: number }) {
  const bombs: { x: number; z: number; delay: number; groundY: number; size: number }[] = [];
  
  // Wave 1: Inner ring (4 bombs) - starts immediately
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2 + Math.random() * 0.3;
    const r = 3 + Math.random() * 2;
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
    const r = 6 + Math.random() * 3;
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
    const r = 10 + Math.random() * 4;
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
function AirStrikeEffect({ strike }: { strike: AirStrikeData }) {
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
          const pulse = 0.7 + Math.sin(warningElapsed * 0.03) * 0.3;
          warningMesh.scale.setScalar(pulse * bomb.size);
          warningFill.scale.setScalar(pulse * bomb.size);
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
          bombMesh.scale.setScalar(0.25 * bomb.size);
        }
        if (trailMesh) {
          trailMesh.visible = true;
          const startY = bomb.groundY + 55;
          const y = startY - (startY - bomb.groundY) * fallProgress * fallProgress;
          trailMesh.position.set(bomb.x, y + 0.8 * bomb.size, bomb.z);
          trailMesh.scale.set(0.2 * bomb.size, 1.2 * bomb.size, 0.2 * bomb.size);
        }
        if (warningMesh) {
          warningMesh.visible = true;
          const pulse = 0.8 + Math.sin(bombElapsed * 0.025) * 0.2;
          warningMesh.scale.setScalar(pulse * bomb.size);
        }
        if (warningFill) {
          warningFill.visible = true;
          warningFill.scale.setScalar(bomb.size);
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
          const scale = (0.5 + easeOut * 3) * bomb.size;
          explosionGroup.scale.setScalar(scale);
          
          // Track light position
          lightX = bomb.x;
          lightY = bomb.groundY + 2 * bomb.size;
          lightZ = bomb.z;
          
          // Update opacity on all children
          explosionGroup.children.forEach((child, ci) => {
            if ((child as THREE.Mesh).material) {
              ((child as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = fadeOut * (1 - ci * 0.15);
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
      lightRef.current.intensity = activeExplosions > 0 ? Math.min(activeExplosions * 12, 40) : 5;
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
              <meshBasicMaterial color={0xffffcc} transparent opacity={1} />
            </mesh>
            {/* Inner fire */}
            <mesh geometry={SHARED_GEOMETRIES.sphere8} scale={1.3}>
              <meshBasicMaterial color={0xffaa00} transparent opacity={0.9} />
            </mesh>
            {/* Outer fire */}
            <mesh geometry={SHARED_GEOMETRIES.sphere8} scale={1.6}>
              <meshBasicMaterial color={0xff5500} transparent opacity={0.7} />
            </mesh>
            {/* Smoke ring */}
            <mesh geometry={SHARED_GEOMETRIES.sphere8} scale={2.0}>
              <meshBasicMaterial color={0xff2200} transparent opacity={0.4} />
            </mesh>
            {/* Ground ring */}
            <mesh rotation-x={-Math.PI / 2} position-y={-0.5} geometry={SHARED_GEOMETRIES.ring16} scale={[1.5, 1.5, 1]}>
              <meshBasicMaterial color={0xff6600} transparent opacity={0.6} side={THREE.DoubleSide} />
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
        distance={35} 
        decay={2} 
      />
    </group>
  );
}

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
  
  return (
    <group ref={indicatorRef}>
      {/* Large danger zone indicator */}
      <mesh rotation-x={-Math.PI / 2} position-y={0.1} geometry={SHARED_GEOMETRIES.ring24} scale={[10, 10, 1]}>
        <meshBasicMaterial color={0xff0000} transparent opacity={0.6} side={THREE.DoubleSide} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={0.12} geometry={SHARED_GEOMETRIES.ring24} scale={[7, 7, 1]}>
        <meshBasicMaterial color={baseColor} transparent opacity={0.7} side={THREE.DoubleSide} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={0.14} geometry={SHARED_GEOMETRIES.ring16} scale={[4, 4, 1]}>
        <meshBasicMaterial color={0xff4400} transparent opacity={0.8} side={THREE.DoubleSide} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={0.2} geometry={SHARED_GEOMETRIES.circle16} scale={[0.8, 0.8, 1]}>
        <meshBasicMaterial color={0xffff00} transparent opacity={1} side={THREE.DoubleSide} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={0.05} geometry={SHARED_GEOMETRIES.circle16} scale={[10, 10, 1]}>
        <meshBasicMaterial color={0xff0000} transparent opacity={0.1} side={THREE.DoubleSide} />
      </mesh>
      
      {/* Cross */}
      <mesh rotation-x={-Math.PI / 2} position-y={0.15} geometry={SHARED_GEOMETRIES.plane} scale={[0.2, 22, 1]}>
        <meshBasicMaterial color={0xff0000} transparent opacity={0.6} side={THREE.DoubleSide} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} rotation-z={Math.PI / 2} position-y={0.15} geometry={SHARED_GEOMETRIES.plane} scale={[0.2, 22, 1]}>
        <meshBasicMaterial color={0xff0000} transparent opacity={0.6} side={THREE.DoubleSide} />
      </mesh>
      
      <pointLight color={0xff2200} intensity={3} distance={12} decay={2} position-y={1} />
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


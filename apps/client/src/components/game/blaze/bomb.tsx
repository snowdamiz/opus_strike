import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useGameStore, type BombData } from '../../../store/gameStore';
import { checkGroundWithNormal, isPhysicsReady, raycastDirection } from '../../../hooks/usePhysics';
import { SHARED_GEOMETRIES } from '../effectResources';

// ============================================================================
// BLAZE BOMB EFFECT - Enhanced Visuals
// ============================================================================

const BOMB_FALL_DURATION = 1500;
const EXPLOSION_DURATION = 1500; // Longer for more dramatic effect

// Pre-generate debris directions
const BOMB_DEBRIS = Array.from({ length: 16 }, (_, i) => ({
  angle: (i / 16) * Math.PI * 2 + Math.random() * 0.3,
  speed: 8 + Math.random() * 12,
  ySpeed: 5 + Math.random() * 10,
  size: 0.08 + Math.random() * 0.12,
}));

interface BombEffectProps {
  bomb: BombData;
}

export function BombEffect({ bomb }: BombEffectProps) {
  const bombRef = useRef<THREE.Group>(null);
  const trailRef = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.Mesh>(null);
  const warningRef = useRef<THREE.Group>(null);
  const warningPulseRef = useRef<THREE.Mesh>(null);
  const explosionRef = useRef<THREE.Group>(null);
  const flashRef = useRef<THREE.Mesh>(null);
  const shockwaveRef = useRef<THREE.Mesh>(null);
  const shockwave2Ref = useRef<THREE.Mesh>(null);
  const smokeRefs = useRef<(THREE.Mesh | null)[]>([]);
  const debrisRefs = useRef<(THREE.Mesh | null)[]>([]);
  const lightRef = useRef<THREE.PointLight>(null);
  const hasExplodedRef = useRef(bomb.hasExploded);
  
  useFrame(() => {
    const now = Date.now();
    const elapsed = now - bomb.startTime;
    const fallProgress = Math.min(1, elapsed / BOMB_FALL_DURATION);
    
    if (!hasExplodedRef.current && fallProgress < 1) {
      if (bombRef.current) {
        bombRef.current.visible = true;
        const startY = bomb.targetPosition.y + 60;
        const y = startY + (bomb.targetPosition.y - startY) * fallProgress * fallProgress;
        bombRef.current.position.set(bomb.targetPosition.x, y, bomb.targetPosition.z);
        bombRef.current.rotation.x += 0.12;
        bombRef.current.rotation.z += 0.08;
      }
      
      // Fire trail behind bomb
      if (trailRef.current && bombRef.current) {
        trailRef.current.visible = true;
        trailRef.current.position.copy(bombRef.current.position);
        trailRef.current.position.y += 1.5;
        const trailScale = 0.8 + Math.sin(elapsed * 0.05) * 0.2;
        trailRef.current.scale.set(0.4 * trailScale, 2.5 * trailScale, 0.4 * trailScale);
      }
      
      // Glow around bomb
      if (glowRef.current && bombRef.current) {
        glowRef.current.visible = true;
        glowRef.current.position.copy(bombRef.current.position);
        const glowPulse = 1 + Math.sin(elapsed * 0.03) * 0.2;
        glowRef.current.scale.setScalar(1.8 * glowPulse);
      }
      
      if (warningRef.current) {
        warningRef.current.visible = true;
        // Faster pulsing as bomb gets closer
        const pulseSpeed = 0.01 + fallProgress * 0.03;
        const pulse = 0.85 + Math.sin(elapsed * pulseSpeed) * 0.15;
        warningRef.current.scale.setScalar(pulse);
      }
      
      // Pulsing fill that intensifies
      if (warningPulseRef.current) {
        warningPulseRef.current.visible = true;
        const intensity = 0.15 + fallProgress * 0.25;
        (warningPulseRef.current.material as THREE.MeshBasicMaterial).opacity = intensity * (0.8 + Math.sin(elapsed * 0.02) * 0.2);
      }
      
      if (explosionRef.current) explosionRef.current.visible = false;
      if (flashRef.current) flashRef.current.visible = false;
    } else if (fallProgress >= 1 && !hasExplodedRef.current) {
      hasExplodedRef.current = true;
    }
    
    if (hasExplodedRef.current) {
      if (bombRef.current) bombRef.current.visible = false;
      if (trailRef.current) trailRef.current.visible = false;
      if (glowRef.current) glowRef.current.visible = false;
      if (warningRef.current) warningRef.current.visible = false;
      if (warningPulseRef.current) warningPulseRef.current.visible = false;
      
      const explosionElapsed = now - bomb.impactTime;
      const explosionProgress = Math.min(1, explosionElapsed / EXPLOSION_DURATION);
      
      if (explosionProgress < 1 && explosionRef.current) {
        explosionRef.current.visible = true;
        const easeOut = 1 - Math.pow(1 - explosionProgress, 2);
        const easeOutQuart = 1 - Math.pow(1 - explosionProgress, 4);
        const fadeOut = Math.max(0, 1 - explosionProgress * 1.1);
        const scale = 1 + easeOut * 7;
        explosionRef.current.scale.setScalar(scale);
        
        explosionRef.current.children.forEach((child, i) => {
          if ((child as THREE.Mesh).isMesh && (child as THREE.Mesh).material) {
            const mat = (child as THREE.Mesh).material as THREE.MeshBasicMaterial;
            mat.opacity = fadeOut * (1 - i * 0.12);
          }
        });
        
        // Initial flash
        if (flashRef.current) {
          const flashProgress = Math.min(1, explosionElapsed / 100);
          flashRef.current.visible = flashProgress < 1;
          flashRef.current.scale.setScalar(2 + flashProgress * 4);
          (flashRef.current.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - flashProgress * 2);
        }
        
        // Shockwaves
        if (shockwaveRef.current) {
          const s = 1 + easeOutQuart * 10;
          shockwaveRef.current.scale.set(s, s, 1);
          (shockwaveRef.current.material as THREE.MeshBasicMaterial).opacity = fadeOut * 0.8;
        }
        if (shockwave2Ref.current) {
          const s = 0.5 + easeOutQuart * 8;
          shockwave2Ref.current.scale.set(s, s, 1);
          (shockwave2Ref.current.material as THREE.MeshBasicMaterial).opacity = fadeOut * 0.5;
        }
        
        // Rising smoke column
        smokeRefs.current.forEach((smoke, i) => {
          if (smoke) {
            const smokeDelay = i * 80;
            const smokeElapsed = Math.max(0, explosionElapsed - smokeDelay);
            const smokeProgress = Math.min(1, smokeElapsed / 1000);
            const y = 1 + smokeProgress * (5 + i * 1.5);
            const smokeScale = 0.8 + smokeProgress * (2 + i * 0.5);
            const spread = smokeProgress * (i * 0.3);
            smoke.position.set(
              Math.sin(i * 2.1) * spread,
              y,
              Math.cos(i * 2.1) * spread
            );
            smoke.scale.setScalar(smokeScale);
            (smoke.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.6 - smokeProgress * 0.6);
          }
        });
        
        // Flying debris
        const t = explosionElapsed / 1000;
        debrisRefs.current.forEach((debris, i) => {
          if (debris && i < BOMB_DEBRIS.length) {
            const d = BOMB_DEBRIS[i];
            const dx = Math.cos(d.angle) * d.speed * t;
            const dy = d.ySpeed * t - 20 * t * t;
            const dz = Math.sin(d.angle) * d.speed * t;
            debris.position.set(dx, Math.max(-0.5, dy), dz);
            debris.scale.setScalar(d.size * fadeOut);
            (debris.material as THREE.MeshBasicMaterial).opacity = dy > 0 ? fadeOut : 0;
          }
        });
        
        if (lightRef.current) {
          lightRef.current.intensity = fadeOut * 60;
        }
      } else if (explosionProgress >= 1 && explosionRef.current) {
        explosionRef.current.visible = false;
      }
    }
  });
  
  return (
    <group>
      {/* Falling bomb assembly */}
      <group ref={bombRef}>
        {/* Main body - elongated */}
        <mesh geometry={SHARED_GEOMETRIES.sphere8} scale={[0.9, 1.4, 0.9]}>
          <meshBasicMaterial color={0x1a1a1a} />
        </mesh>
        {/* Metal band */}
        <mesh position={[0, 0.2, 0]} geometry={SHARED_GEOMETRIES.cylinder8} scale={[1.0, 0.15, 1.0]}>
          <meshBasicMaterial color={0x444444} />
        </mesh>
        {/* Nose cone */}
        <mesh position={[0, -1.0, 0]} geometry={SHARED_GEOMETRIES.cone8} scale={[0.7, 0.8, 0.7]}>
          <meshBasicMaterial color={0x111111} />
        </mesh>
        {/* Tail fins - 4 of them */}
        {[0, 1, 2, 3].map(i => (
          <mesh key={`fin-${i}`} position={[0, 0.9, 0]} rotation={[0, (i / 4) * Math.PI * 2, 0]}>
            <mesh position={[0.5, 0, 0]} geometry={SHARED_GEOMETRIES.plane} scale={[0.4, 0.5, 1]} rotation={[0, Math.PI / 2, 0]}>
              <meshBasicMaterial color={0x222222} side={THREE.DoubleSide} />
            </mesh>
          </mesh>
        ))}
        {/* Red warning stripe */}
        <mesh position={[0, -0.3, 0]} geometry={SHARED_GEOMETRIES.cylinder8} scale={[0.95, 0.1, 0.95]}>
          <meshBasicMaterial color={0xcc0000} />
        </mesh>
        {/* Bomb light */}
        <pointLight color={0xff4400} intensity={5} distance={15} decay={2} />
      </group>
      
      {/* Fire trail */}
      <mesh ref={trailRef} visible={false} rotation={[Math.PI, 0, 0]} geometry={SHARED_GEOMETRIES.cone8}>
        <meshBasicMaterial color={0xff6600} transparent opacity={0.8} />
      </mesh>
      
      {/* Glow around bomb */}
      <mesh ref={glowRef} visible={false} geometry={SHARED_GEOMETRIES.sphere8}>
        <meshBasicMaterial color={0xff4400} transparent opacity={0.25} />
      </mesh>
      
      {/* Warning zone */}
      <group ref={warningRef} position={[bomb.targetPosition.x, bomb.targetPosition.y + 0.15, bomb.targetPosition.z]}>
        {/* Outer danger ring */}
        <mesh rotation-x={-Math.PI / 2} geometry={SHARED_GEOMETRIES.ring24} scale={[6, 6, 1]}>
          <meshBasicMaterial color={0xff0000} transparent opacity={0.8} side={THREE.DoubleSide} />
        </mesh>
        {/* Inner ring */}
        <mesh rotation-x={-Math.PI / 2} geometry={SHARED_GEOMETRIES.ring16} scale={[4, 4, 1]}>
          <meshBasicMaterial color={0xff4400} transparent opacity={0.7} side={THREE.DoubleSide} />
        </mesh>
        {/* Center ring */}
        <mesh rotation-x={-Math.PI / 2} geometry={SHARED_GEOMETRIES.ring16} scale={[2, 2, 1]}>
          <meshBasicMaterial color={0xffaa00} transparent opacity={0.6} side={THREE.DoubleSide} />
        </mesh>
        {/* Crosshairs */}
        <mesh rotation-x={-Math.PI / 2} geometry={SHARED_GEOMETRIES.plane} scale={[0.2, 12, 1]}>
          <meshBasicMaterial color={0xff0000} transparent opacity={0.6} side={THREE.DoubleSide} />
        </mesh>
        <mesh rotation-x={-Math.PI / 2} rotation-z={Math.PI / 2} geometry={SHARED_GEOMETRIES.plane} scale={[0.2, 12, 1]}>
          <meshBasicMaterial color={0xff0000} transparent opacity={0.6} side={THREE.DoubleSide} />
        </mesh>
        {/* Diagonal lines */}
        <mesh rotation-x={-Math.PI / 2} rotation-z={Math.PI / 4} geometry={SHARED_GEOMETRIES.plane} scale={[0.1, 8, 1]}>
          <meshBasicMaterial color={0xff4400} transparent opacity={0.4} side={THREE.DoubleSide} />
        </mesh>
        <mesh rotation-x={-Math.PI / 2} rotation-z={-Math.PI / 4} geometry={SHARED_GEOMETRIES.plane} scale={[0.1, 8, 1]}>
          <meshBasicMaterial color={0xff4400} transparent opacity={0.4} side={THREE.DoubleSide} />
        </mesh>
      </group>
      
      {/* Pulsing danger fill */}
      <mesh 
        ref={warningPulseRef}
        visible={false}
        position={[bomb.targetPosition.x, bomb.targetPosition.y + 0.08, bomb.targetPosition.z]}
        rotation-x={-Math.PI / 2} 
        geometry={SHARED_GEOMETRIES.circle16} 
        scale={[6, 6, 1]}
      >
        <meshBasicMaterial color={0xff2200} transparent opacity={0.2} side={THREE.DoubleSide} />
      </mesh>
      
      {/* Initial flash */}
      <mesh 
        ref={flashRef}
        visible={false}
        position={[bomb.targetPosition.x, bomb.targetPosition.y + 1, bomb.targetPosition.z]}
        geometry={SHARED_GEOMETRIES.sphere8}
      >
        <meshBasicMaterial color={0xffffff} transparent opacity={1} />
      </mesh>
      
      {/* Explosion group */}
      <group ref={explosionRef} visible={false} position={[bomb.targetPosition.x, bomb.targetPosition.y + 1.5, bomb.targetPosition.z]}>
        {/* White hot core */}
        <mesh geometry={SHARED_GEOMETRIES.sphere12}>
          <meshBasicMaterial color={0xffffee} transparent opacity={0.95} />
        </mesh>
        {/* Bright yellow */}
        <mesh geometry={SHARED_GEOMETRIES.sphere12} scale={1.2}>
          <meshBasicMaterial color={0xffcc00} transparent opacity={0.9} />
        </mesh>
        {/* Orange fire */}
        <mesh geometry={SHARED_GEOMETRIES.sphere8} scale={1.4}>
          <meshBasicMaterial color={0xff8800} transparent opacity={0.8} />
        </mesh>
        {/* Red fire */}
        <mesh geometry={SHARED_GEOMETRIES.sphere8} scale={1.7}>
          <meshBasicMaterial color={0xff4400} transparent opacity={0.6} />
        </mesh>
        {/* Dark red outer */}
        <mesh geometry={SHARED_GEOMETRIES.sphere8} scale={2.0}>
          <meshBasicMaterial color={0xcc2200} transparent opacity={0.4} />
        </mesh>
        
        {/* Rising smoke column */}
        {[0, 1, 2, 3, 4].map(i => (
          <mesh 
            key={`smoke-${i}`}
            ref={el => smokeRefs.current[i] = el}
            geometry={SHARED_GEOMETRIES.sphere8}
          >
            <meshBasicMaterial color={i < 2 ? 0x444444 : 0x333333} transparent opacity={0.5} />
          </mesh>
        ))}
        
        {/* Flying debris */}
        {BOMB_DEBRIS.map((_, i) => (
          <mesh 
            key={`debris-${i}`}
            ref={el => debrisRefs.current[i] = el}
            geometry={SHARED_GEOMETRIES.sphere8}
          >
            <meshBasicMaterial color={i % 2 === 0 ? 0xff6600 : 0xffaa00} transparent opacity={1} />
          </mesh>
        ))}
        
        <pointLight ref={lightRef} color={0xff5500} intensity={60} distance={40} decay={2} />
      </group>
      
      {/* Ground shockwave */}
      <mesh 
        ref={shockwaveRef}
        position={[bomb.targetPosition.x, bomb.targetPosition.y + 0.2, bomb.targetPosition.z]}
        rotation-x={-Math.PI / 2} 
        geometry={SHARED_GEOMETRIES.ring24}
      >
        <meshBasicMaterial color={0xff6600} transparent opacity={0.8} side={THREE.DoubleSide} />
      </mesh>
      
      {/* Secondary inner shockwave */}
      <mesh 
        ref={shockwave2Ref}
        position={[bomb.targetPosition.x, bomb.targetPosition.y + 0.25, bomb.targetPosition.z]}
        rotation-x={-Math.PI / 2} 
        geometry={SHARED_GEOMETRIES.ring16}
      >
        <meshBasicMaterial color={0xffaa00} transparent opacity={0.5} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

// ============================================================================
// BOMB TARGETING INDICATOR - TRUE 3D RAYCASTING
// ============================================================================

interface BombTargetingIndicatorProps {
  isActive: boolean;
  onTargetUpdate: (position: THREE.Vector3 | null, isValid: boolean) => void;
}

const BOMB_MAX_RANGE = 60;
const BOMB_MIN_RANGE = 3;

// Pre-allocated vectors for bomb targeting (local to avoid conflicts)
const _bombLookDir = new THREE.Vector3();
const _bombTargetPos = new THREE.Vector3();
const _bombHorizDir = new THREE.Vector3();

export function BombTargetingIndicator({ isActive, onTargetUpdate }: BombTargetingIndicatorProps) {
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
    
    _bombLookDir.set(0, 0, -1).applyQuaternion(camera.quaternion);
    
    let targetX = camera.position.x;
    let targetY = camera.position.y;
    let targetZ = camera.position.z;
    let isValid = false;
    let foundTarget = false;
    
    if (isPhysicsReady()) {
      const directHit = raycastDirection(
        camera.position.x, camera.position.y, camera.position.z,
        _bombLookDir.x, _bombLookDir.y, _bombLookDir.z,
        BOMB_MAX_RANGE + 10
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
        const pitch = Math.asin(Math.max(-1, Math.min(1, -_bombLookDir.y)));
        const baseDist = pitch > 0.3 ? 15 : (pitch > 0 ? 25 : 40);
        const sampleDistances = [baseDist * 0.5, baseDist, baseDist * 1.5, BOMB_MAX_RANGE];
        
        for (const dist of sampleDistances) {
          const sampleX = camera.position.x + _bombLookDir.x * dist;
          const sampleY = camera.position.y + _bombLookDir.y * dist;
          const sampleZ = camera.position.z + _bombLookDir.z * dist;
          
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
        const dy = targetY - localPlayer.position.y;
        const dz = targetZ - localPlayer.position.z;
        const dist3D = Math.sqrt(dx * dx + dy * dy + dz * dz);
        
        if (dist3D > BOMB_MAX_RANGE) {
          const scale = BOMB_MAX_RANGE / dist3D;
          targetX = localPlayer.position.x + dx * scale;
          targetY = localPlayer.position.y + dy * scale;
          targetZ = localPlayer.position.z + dz * scale;
          
          const groundCheck = checkGroundWithNormal(targetX, targetY + 30, targetZ, 100);
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
        
        if (foundTarget && finalDistH >= BOMB_MIN_RANGE) {
          isValid = true;
        }
      }
      
      if (!foundTarget) {
        const fallbackDist = 20;
        _bombHorizDir.set(_bombLookDir.x, 0, _bombLookDir.z).normalize();
        targetX = localPlayer.position.x + _bombHorizDir.x * fallbackDist;
        targetZ = localPlayer.position.z + _bombHorizDir.z * fallbackDist;
        
        const groundCheck = checkGroundWithNormal(targetX, localPlayer.position.y + 30, targetZ, 100);
        if (groundCheck?.isWalkable) {
          targetY = groundCheck.groundY + 0.1;
          isValid = Math.sqrt(
            (targetX - localPlayer.position.x) ** 2 + 
            (targetZ - localPlayer.position.z) ** 2
          ) >= BOMB_MIN_RANGE;
        }
      }
    }
    
    _bombTargetPos.set(targetX, targetY, targetZ);
    isValidRef.current = isValid;
    
    if (indicatorRef.current) {
      indicatorRef.current.visible = true;
      indicatorRef.current.position.copy(_bombTargetPos);
    }
    
    onTargetUpdate(_bombTargetPos.clone(), isValid);
  });
  
  if (!isActive) return null;
  
  const baseColor = isValidRef.current ? 0xff4400 : 0xff0000;
  
  return (
    <group ref={indicatorRef}>
      <mesh rotation-x={-Math.PI / 2} position-y={0.1} geometry={SHARED_GEOMETRIES.ring24} scale={[5, 5, 1]}>
        <meshBasicMaterial color={baseColor} transparent opacity={0.7} side={THREE.DoubleSide} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={0.15} geometry={SHARED_GEOMETRIES.ring16} scale={[3, 3, 1]}>
        <meshBasicMaterial color={0xff6600} transparent opacity={0.8} side={THREE.DoubleSide} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={0.2} geometry={SHARED_GEOMETRIES.ring16} scale={[1.5, 1.5, 1]}>
        <meshBasicMaterial color={0xffaa00} transparent opacity={0.9} side={THREE.DoubleSide} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={0.25} geometry={SHARED_GEOMETRIES.circle16} scale={[0.5, 0.5, 1]}>
        <meshBasicMaterial color={0xffff00} transparent opacity={1} side={THREE.DoubleSide} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={0.05} geometry={SHARED_GEOMETRIES.circle16} scale={[5, 5, 1]}>
        <meshBasicMaterial color={0xff2200} transparent opacity={0.15} side={THREE.DoubleSide} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={0.15} geometry={SHARED_GEOMETRIES.plane} scale={[0.12, 10, 1]}>
        <meshBasicMaterial color={baseColor} transparent opacity={0.7} side={THREE.DoubleSide} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} rotation-z={Math.PI / 2} position-y={0.15} geometry={SHARED_GEOMETRIES.plane} scale={[0.12, 10, 1]}>
        <meshBasicMaterial color={baseColor} transparent opacity={0.7} side={THREE.DoubleSide} />
      </mesh>
      <mesh position-y={20} geometry={SHARED_GEOMETRIES.cylinder8} scale={[0.06, 40, 0.06]}>
        <meshBasicMaterial color={0xff6600} transparent opacity={0.3} />
      </mesh>
      <mesh position-y={42} geometry={SHARED_GEOMETRIES.sphere8} scale={0.4}>
        <meshBasicMaterial color={0xff4400} transparent opacity={0.7} />
      </mesh>
      <pointLight color={baseColor} intensity={2} distance={6} decay={2} position-y={0.5} />
    </group>
  );
}


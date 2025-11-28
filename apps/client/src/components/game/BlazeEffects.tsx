import { useRef, useMemo, useState, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useGameStore, type RocketData, type BombData } from '../../store/gameStore';
import { checkGroundWithNormal, isPhysicsReady, raycastDirection } from '../../hooks/usePhysics';

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
};

// ============================================================================
// ROCKET EFFECT - Individual rockets with good visuals
// Optimized by using shared geometries and minimal state
// ============================================================================

const MAX_ROCKETS = 30;
const ROCKET_LIFETIME = 5000;

// Pre-allocated vectors to avoid GC in useFrame
const _rocketPos = new THREE.Vector3();
const _rocketDir = new THREE.Vector3();
const _rocketLookAt = new THREE.Vector3();

interface RocketEffectProps {
  rocket: RocketData;
}

function RocketEffect({ rocket }: RocketEffectProps) {
  const groupRef = useRef<THREE.Group>(null);
  
  useFrame(() => {
    if (!groupRef.current) return;
    
    const elapsed = (Date.now() - rocket.startTime) / 1000;
    
    // Update position with gravity
    _rocketPos.set(
      rocket.position.x + rocket.velocity.x * elapsed,
      rocket.position.y + rocket.velocity.y * elapsed - elapsed * elapsed,
      rocket.position.z + rocket.velocity.z * elapsed
    );
    groupRef.current.position.copy(_rocketPos);
    
    // Rotate to face velocity direction
    _rocketDir.set(rocket.velocity.x, rocket.velocity.y - 2 * elapsed, rocket.velocity.z).normalize();
    _rocketLookAt.copy(_rocketPos).add(_rocketDir);
    groupRef.current.lookAt(_rocketLookAt);
  });
  
  return (
    <group ref={groupRef}>
      {/* Rocket body - dark metallic */}
      <mesh rotation={[Math.PI / 2, 0, 0]} geometry={SHARED_GEOMETRIES.cone8} scale={[0.08, 0.35, 0.08]}>
        <meshBasicMaterial color={0x333333} />
      </mesh>
      
      {/* Rocket nose - glowing orange */}
      <mesh position={[0, 0, -0.2]} rotation={[Math.PI / 2, 0, 0]} geometry={SHARED_GEOMETRIES.cone6} scale={[0.04, 0.08, 0.04]}>
        <meshBasicMaterial color={0xff6600} />
      </mesh>
      
      {/* Fire core - bright white/yellow */}
      <mesh position={[0, 0, 0.22]} rotation={[Math.PI / 2, 0, 0]} geometry={SHARED_GEOMETRIES.cone8} scale={[0.05, 0.35, 0.05]}>
        <meshBasicMaterial color={0xffffcc} transparent opacity={0.95} />
      </mesh>
      
      {/* Fire inner - bright orange */}
      <mesh position={[0, 0, 0.32]} rotation={[Math.PI / 2, 0, 0]} geometry={SHARED_GEOMETRIES.cone8} scale={[0.08, 0.45, 0.08]}>
        <meshBasicMaterial color={0xffaa00} transparent opacity={0.9} />
      </mesh>
      
      {/* Fire outer - red/orange */}
      <mesh position={[0, 0, 0.4]} rotation={[Math.PI / 2, 0, 0]} geometry={SHARED_GEOMETRIES.cone8} scale={[0.12, 0.5, 0.12]}>
        <meshBasicMaterial color={0xff5500} transparent opacity={0.7} />
      </mesh>
      
      {/* Smoke trail hint */}
      <mesh position={[0, 0, 0.55]} rotation={[Math.PI / 2, 0, 0]} geometry={SHARED_GEOMETRIES.cone6} scale={[0.15, 0.4, 0.15]}>
        <meshBasicMaterial color={0xff3300} transparent opacity={0.4} />
      </mesh>
    </group>
  );
}

// Rocket manager - renders rockets without individual lights for performance
export function RocketsManager() {
  const rockets = useGameStore(state => state.rockets);
  const lightRef = useRef<THREE.PointLight>(null);
  
  // Update single shared light position
  useFrame(() => {
    if (!lightRef.current || rockets.length === 0) {
      if (lightRef.current) lightRef.current.intensity = 0;
      return;
    }
    
    const now = Date.now();
    let avgX = 0, avgY = 0, avgZ = 0;
    let count = 0;
    
    for (const rocket of rockets) {
      if (now - rocket.startTime < ROCKET_LIFETIME) {
        const elapsed = (now - rocket.startTime) / 1000;
        avgX += rocket.position.x + rocket.velocity.x * elapsed;
        avgY += rocket.position.y + rocket.velocity.y * elapsed - elapsed * elapsed;
        avgZ += rocket.position.z + rocket.velocity.z * elapsed;
        count++;
      }
    }
    
    if (count > 0) {
      lightRef.current.position.set(avgX / count, avgY / count, avgZ / count);
      lightRef.current.intensity = Math.min(count * 2, 10);
    } else {
      lightRef.current.intensity = 0;
    }
  });
  
  return (
    <group>
      {rockets.slice(0, MAX_ROCKETS).map(rocket => (
        <RocketEffect key={rocket.id} rocket={rocket} />
      ))}
      {/* Single shared light for all rockets */}
      <pointLight ref={lightRef} color={0xff6600} intensity={0} distance={12} decay={2} />
    </group>
  );
}

// ============================================================================
// ROCKET JUMP EXPLOSION - Optimized
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

const ROCKET_JUMP_DURATION = 900; // Longer for more dramatic effect

// Pre-generate spark directions for rocket jump
const ROCKET_JUMP_SPARKS = Array.from({ length: 12 }, (_, i) => ({
  angle: (i / 12) * Math.PI * 2 + Math.random() * 0.5,
  speed: 4 + Math.random() * 6,
  ySpeed: 6 + Math.random() * 8,
  size: 0.04 + Math.random() * 0.06,
}));

function RocketJumpExplosion({ explosion }: { explosion: RocketJumpExplosionData }) {
  const groupRef = useRef<THREE.Group>(null);
  const flashRef = useRef<THREE.Mesh>(null);
  const coreRef = useRef<THREE.Mesh>(null);
  const midRef = useRef<THREE.Mesh>(null);
  const outerRef = useRef<THREE.Mesh>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const ring2Ref = useRef<THREE.Mesh>(null);
  const smokeRefs = useRef<(THREE.Mesh | null)[]>([]);
  const sparkRefs = useRef<(THREE.Mesh | null)[]>([]);
  const lightRef = useRef<THREE.PointLight>(null);
  
  useFrame(() => {
    const elapsed = Date.now() - explosion.startTime;
    if (elapsed > ROCKET_JUMP_DURATION) return;
    
    const progress = elapsed / ROCKET_JUMP_DURATION;
    const easeOut = 1 - Math.pow(1 - progress, 2);
    const easeOutQuart = 1 - Math.pow(1 - progress, 4);
    const fadeOut = Math.max(0, 1 - progress * 1.2);
    const fadeOutSlow = Math.max(0, 1 - progress);
    
    // Initial flash (very quick)
    if (flashRef.current) {
      const flashProgress = Math.min(1, elapsed / 80);
      const flashScale = 0.5 + flashProgress * 2;
      flashRef.current.scale.setScalar(flashScale);
      (flashRef.current.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - flashProgress * 2);
    }
    
    // Core explosion
    if (coreRef.current) {
      const s = 0.4 + easeOut * 2.5;
      coreRef.current.scale.setScalar(s);
      (coreRef.current.material as THREE.MeshBasicMaterial).opacity = fadeOut * 0.95;
    }
    if (midRef.current) {
      const s = 0.6 + easeOut * 3;
      midRef.current.scale.setScalar(s);
      (midRef.current.material as THREE.MeshBasicMaterial).opacity = fadeOut * 0.8;
    }
    if (outerRef.current) {
      const s = 0.8 + easeOut * 3.5;
      outerRef.current.scale.setScalar(s);
      (outerRef.current.material as THREE.MeshBasicMaterial).opacity = fadeOut * 0.5;
    }
    
    // Shockwave rings
    if (ringRef.current) {
      const s = 0.5 + easeOutQuart * 5;
      ringRef.current.scale.set(s, s, 1);
      (ringRef.current.material as THREE.MeshBasicMaterial).opacity = fadeOut * 0.7;
    }
    if (ring2Ref.current) {
      const s = 0.3 + easeOutQuart * 4;
      ring2Ref.current.scale.set(s, s, 1);
      (ring2Ref.current.material as THREE.MeshBasicMaterial).opacity = fadeOut * 0.5;
    }
    
    // Rising smoke puffs
    smokeRefs.current.forEach((smoke, i) => {
      if (smoke) {
        const smokeDelay = i * 50;
        const smokeElapsed = Math.max(0, elapsed - smokeDelay);
        const smokeProgress = Math.min(1, smokeElapsed / 600);
        const y = smokeProgress * (2 + i * 0.5);
        const smokeScale = 0.3 + smokeProgress * (0.8 + i * 0.2);
        smoke.position.y = y;
        smoke.scale.setScalar(smokeScale);
        (smoke.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.5 - smokeProgress * 0.5);
      }
    });
    
    // Flying sparks
    const t = elapsed / 1000;
    sparkRefs.current.forEach((spark, i) => {
      if (spark && i < ROCKET_JUMP_SPARKS.length) {
        const s = ROCKET_JUMP_SPARKS[i];
        const sparkX = Math.cos(s.angle) * s.speed * t;
        const sparkY = s.ySpeed * t - 15 * t * t;
        const sparkZ = Math.sin(s.angle) * s.speed * t;
        spark.position.set(sparkX, Math.max(-0.3, sparkY), sparkZ);
        spark.scale.setScalar(s.size * fadeOutSlow);
        (spark.material as THREE.MeshBasicMaterial).opacity = sparkY > 0 ? fadeOutSlow : 0;
      }
    });
    
    // Light
    if (lightRef.current) {
      lightRef.current.intensity = fadeOut * 25;
    }
  });
  
  const elapsed = Date.now() - explosion.startTime;
  if (elapsed > ROCKET_JUMP_DURATION) return null;
  
  return (
    <group ref={groupRef} position={[explosion.position.x, explosion.position.y - 0.3, explosion.position.z]}>
      {/* Initial bright flash */}
      <mesh ref={flashRef} geometry={SHARED_GEOMETRIES.sphere8}>
        <meshBasicMaterial color={0xffffff} transparent opacity={1} />
      </mesh>
      
      {/* Core - white hot */}
      <mesh ref={coreRef} geometry={SHARED_GEOMETRIES.sphere8}>
        <meshBasicMaterial color={0xffffcc} transparent opacity={0.95} />
      </mesh>
      
      {/* Mid - orange fire */}
      <mesh ref={midRef} geometry={SHARED_GEOMETRIES.sphere8}>
        <meshBasicMaterial color={0xff8800} transparent opacity={0.8} />
      </mesh>
      
      {/* Outer - red fire */}
      <mesh ref={outerRef} geometry={SHARED_GEOMETRIES.sphere8}>
        <meshBasicMaterial color={0xff3300} transparent opacity={0.5} />
      </mesh>
      
      {/* Primary shockwave ring */}
      <mesh ref={ringRef} rotation-x={-Math.PI / 2} position-y={0.1} geometry={SHARED_GEOMETRIES.ring24}>
        <meshBasicMaterial color={0xff6600} transparent opacity={0.7} side={THREE.DoubleSide} />
      </mesh>
      
      {/* Secondary inner ring */}
      <mesh ref={ring2Ref} rotation-x={-Math.PI / 2} position-y={0.15} geometry={SHARED_GEOMETRIES.ring16}>
        <meshBasicMaterial color={0xffaa00} transparent opacity={0.5} side={THREE.DoubleSide} />
      </mesh>
      
      {/* Rising smoke puffs */}
      {[0, 1, 2, 3].map(i => (
        <mesh 
          key={`smoke-${i}`}
          ref={el => smokeRefs.current[i] = el}
          position={[Math.sin(i * 1.5) * 0.3, 0, Math.cos(i * 1.5) * 0.3]}
          geometry={SHARED_GEOMETRIES.sphere8}
        >
          <meshBasicMaterial color={0x555555} transparent opacity={0.4} />
        </mesh>
      ))}
      
      {/* Flying sparks */}
      {ROCKET_JUMP_SPARKS.map((_, i) => (
        <mesh 
          key={`spark-${i}`}
          ref={el => sparkRefs.current[i] = el}
          geometry={SHARED_GEOMETRIES.sphere8}
        >
          <meshBasicMaterial color={0xffcc00} transparent opacity={1} />
        </mesh>
      ))}
      
      {/* Ground scorch */}
      <mesh rotation-x={-Math.PI / 2} position-y={0.02} geometry={SHARED_GEOMETRIES.circle16} scale={[1.5, 1.5, 1]}>
        <meshBasicMaterial color={0x331100} transparent opacity={0.4} side={THREE.DoubleSide} />
      </mesh>
      
      <pointLight ref={lightRef} color={0xff5500} intensity={25} distance={15} decay={2} />
    </group>
  );
}

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

const AIR_STRIKE_DURATION = 4500; // Longer duration
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
// BLAZE BOMB EFFECT - Enhanced Visuals
// ============================================================================

interface BombEffectProps {
  bomb: BombData;
}

const BOMB_FALL_DURATION = 1500;
const EXPLOSION_DURATION = 1500; // Longer for more dramatic effect

// Pre-generate debris directions
const BOMB_DEBRIS = Array.from({ length: 16 }, (_, i) => ({
  angle: (i / 16) * Math.PI * 2 + Math.random() * 0.3,
  speed: 8 + Math.random() * 12,
  ySpeed: 5 + Math.random() * 10,
  size: 0.08 + Math.random() * 0.12,
}));

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

const _lookDir = new THREE.Vector3();
const _targetPos = new THREE.Vector3();

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
    
    _lookDir.set(0, 0, -1).applyQuaternion(camera.quaternion);
    
    let targetX = camera.position.x;
    let targetY = camera.position.y;
    let targetZ = camera.position.z;
    let isValid = false;
    let foundTarget = false;
    
    if (isPhysicsReady()) {
      const directHit = raycastDirection(
        camera.position.x, camera.position.y, camera.position.z,
        _lookDir.x, _lookDir.y, _lookDir.z,
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
        const pitch = Math.asin(Math.max(-1, Math.min(1, -_lookDir.y)));
        const baseDist = pitch > 0.3 ? 15 : (pitch > 0 ? 25 : 40);
        const sampleDistances = [baseDist * 0.5, baseDist, baseDist * 1.5, BOMB_MAX_RANGE];
        
        for (const dist of sampleDistances) {
          const sampleX = camera.position.x + _lookDir.x * dist;
          const sampleY = camera.position.y + _lookDir.y * dist;
          const sampleZ = camera.position.z + _lookDir.z * dist;
          
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
        const horizDir = new THREE.Vector3(_lookDir.x, 0, _lookDir.z).normalize();
        targetX = localPlayer.position.x + horizDir.x * fallbackDist;
        targetZ = localPlayer.position.z + horizDir.z * fallbackDist;
        
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
    
    _targetPos.set(targetX, targetY, targetZ);
    isValidRef.current = isValid;
    
    if (indicatorRef.current) {
      indicatorRef.current.visible = true;
      indicatorRef.current.position.copy(_targetPos);
    }
    
    onTargetUpdate(_targetPos.clone(), isValid);
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

// ============================================================================
// AIR STRIKE TARGETING INDICATOR - Simplified for performance
// ============================================================================

interface AirStrikeTargetingIndicatorProps {
  isActive: boolean;
  onTargetUpdate: (position: THREE.Vector3 | null, isValid: boolean) => void;
}

const AIRSTRIKE_MAX_RANGE = 80;
const AIRSTRIKE_MIN_RANGE = 10;

const _asLookDir = new THREE.Vector3();
const _asTargetPos = new THREE.Vector3();

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
        const horizDir = new THREE.Vector3(_asLookDir.x, 0, _asLookDir.z).normalize();
        targetX = localPlayer.position.x + horizDir.x * fallbackDist;
        targetZ = localPlayer.position.z + horizDir.z * fallbackDist;
        
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

// ============================================================================
// JETPACK EFFECT - Enhanced Visuals
// ============================================================================

interface JetpackEffectProps {
  isActive: boolean;
  playerPosition: { x: number; y: number; z: number };
}

// Pre-generate smoke particle data
const JETPACK_SMOKE_PARTICLES = Array.from({ length: 8 }, (_, i) => ({
  xOffset: (Math.random() - 0.5) * 0.15,
  zOffset: (Math.random() - 0.5) * 0.15,
  speed: 2 + Math.random() * 2,
  size: 0.06 + Math.random() * 0.04,
  side: i < 4 ? -1 : 1, // Left or right thruster
}));

export function JetpackEffect({ isActive, playerPosition }: JetpackEffectProps) {
  const groupRef = useRef<THREE.Group>(null);
  const leftFlameRef = useRef<THREE.Group>(null);
  const rightFlameRef = useRef<THREE.Group>(null);
  const leftGlowRef = useRef<THREE.Mesh>(null);
  const rightGlowRef = useRef<THREE.Mesh>(null);
  const smokeRefs = useRef<(THREE.Mesh | null)[]>([]);
  const sparkRefs = useRef<(THREE.Mesh | null)[]>([]);
  const lightRef = useRef<THREE.PointLight>(null);
  const startTimeRef = useRef(Date.now());
  
  useFrame((state) => {
    if (!isActive || !groupRef.current) return;
    
    const time = state.clock.elapsedTime * 25;
    const elapsed = (Date.now() - startTimeRef.current) / 1000;
    
    // Main flame flicker - more chaotic for realism
    const flicker1 = 0.8 + Math.sin(time) * 0.12 + Math.sin(time * 2.3) * 0.08 + Math.sin(time * 5.7) * 0.04;
    const flicker2 = 0.8 + Math.sin(time * 1.1 + 1) * 0.12 + Math.sin(time * 2.7 + 0.5) * 0.08 + Math.sin(time * 6.1) * 0.04;
    
    if (leftFlameRef.current) {
      leftFlameRef.current.scale.set(flicker1, flicker1 * 1.3, flicker1);
    }
    if (rightFlameRef.current) {
      rightFlameRef.current.scale.set(flicker2, flicker2 * 1.25, flicker2);
    }
    
    // Glow pulse
    if (leftGlowRef.current) {
      const glowScale = 0.4 + flicker1 * 0.3;
      leftGlowRef.current.scale.setScalar(glowScale);
      (leftGlowRef.current.material as THREE.MeshBasicMaterial).opacity = 0.3 + flicker1 * 0.15;
    }
    if (rightGlowRef.current) {
      const glowScale = 0.4 + flicker2 * 0.3;
      rightGlowRef.current.scale.setScalar(glowScale);
      (rightGlowRef.current.material as THREE.MeshBasicMaterial).opacity = 0.3 + flicker2 * 0.15;
    }
    
    // Animated smoke particles falling down
    const thrusterOffset = 0.3;
    smokeRefs.current.forEach((smoke, i) => {
      if (smoke && i < JETPACK_SMOKE_PARTICLES.length) {
        const p = JETPACK_SMOKE_PARTICLES[i];
        const cycleTime = (elapsed * p.speed) % 1.5;
        const y = -0.6 - cycleTime * 1.2;
        const spread = cycleTime * 0.3;
        const opacity = Math.max(0, 0.4 - cycleTime * 0.35);
        const scale = p.size + cycleTime * 0.15;
        
        smoke.position.set(
          p.side * thrusterOffset + p.xOffset + spread * (p.xOffset > 0 ? 1 : -1),
          y,
          p.zOffset + spread * (p.zOffset > 0 ? 1 : -1)
        );
        smoke.scale.setScalar(scale);
        (smoke.material as THREE.MeshBasicMaterial).opacity = opacity;
      }
    });
    
    // Sparks shooting down randomly
    sparkRefs.current.forEach((spark, i) => {
      if (spark) {
        const sparkCycle = ((elapsed * 4 + i * 0.3) % 1);
        const sparkY = -0.4 - sparkCycle * 2;
        const sparkX = (i < 3 ? -1 : 1) * thrusterOffset + (Math.sin(elapsed * 20 + i) * 0.1);
        const sparkZ = Math.cos(elapsed * 15 + i * 2) * 0.1;
        spark.position.set(sparkX, sparkY, sparkZ);
        spark.scale.setScalar(sparkCycle < 0.7 ? 0.02 + Math.random() * 0.02 : 0);
        (spark.material as THREE.MeshBasicMaterial).opacity = sparkCycle < 0.7 ? 0.9 : 0;
      }
    });
    
    // Light intensity
    if (lightRef.current) {
      lightRef.current.intensity = (flicker1 + flicker2) * 4;
    }
  });
  
  // Reset start time when becoming active
  if (isActive && Date.now() - startTimeRef.current > 5000) {
    startTimeRef.current = Date.now();
  }
  
  if (!isActive) return null;
  
  const thrusterOffset = 0.3;
  // Fixed position - moved up closer to player feet
  const yOffset = -0.5;
  
  return (
    <group ref={groupRef} position={[playerPosition.x, playerPosition.y + yOffset, playerPosition.z]}>
      {/* Left thruster assembly */}
      <group ref={leftFlameRef} position={[-thrusterOffset, 0, 0.05]}>
        {/* Thruster nozzle */}
        <mesh position={[0, 0.05, 0]} geometry={SHARED_GEOMETRIES.cylinder8} scale={[0.08, 0.08, 0.08]}>
          <meshBasicMaterial color={0x333333} />
        </mesh>
        {/* White hot core */}
        <mesh position={[0, -0.15, 0]} geometry={SHARED_GEOMETRIES.cone8} scale={[0.06, 0.35, 0.06]}>
          <meshBasicMaterial color={0xffffff} transparent opacity={0.98} />
        </mesh>
        {/* Bright yellow inner */}
        <mesh position={[0, -0.3, 0]} geometry={SHARED_GEOMETRIES.cone8} scale={[0.1, 0.5, 0.1]}>
          <meshBasicMaterial color={0xffffaa} transparent opacity={0.92} />
        </mesh>
        {/* Orange mid flame */}
        <mesh position={[0, -0.45, 0]} geometry={SHARED_GEOMETRIES.cone8} scale={[0.14, 0.7, 0.14]}>
          <meshBasicMaterial color={0xffaa00} transparent opacity={0.8} />
        </mesh>
        {/* Red outer flame */}
        <mesh position={[0, -0.6, 0]} geometry={SHARED_GEOMETRIES.cone8} scale={[0.2, 0.9, 0.2]}>
          <meshBasicMaterial color={0xff5500} transparent opacity={0.55} />
        </mesh>
        {/* Dark red tip */}
        <mesh position={[0, -0.75, 0]} geometry={SHARED_GEOMETRIES.cone8} scale={[0.25, 1.0, 0.25]}>
          <meshBasicMaterial color={0xcc2200} transparent opacity={0.3} />
        </mesh>
      </group>
      
      {/* Left glow */}
      <mesh ref={leftGlowRef} position={[-thrusterOffset, -0.3, 0.05]} geometry={SHARED_GEOMETRIES.sphere8}>
        <meshBasicMaterial color={0xff6600} transparent opacity={0.35} />
      </mesh>
      
      {/* Right thruster assembly */}
      <group ref={rightFlameRef} position={[thrusterOffset, 0, 0.05]}>
        {/* Thruster nozzle */}
        <mesh position={[0, 0.05, 0]} geometry={SHARED_GEOMETRIES.cylinder8} scale={[0.08, 0.08, 0.08]}>
          <meshBasicMaterial color={0x333333} />
        </mesh>
        {/* White hot core */}
        <mesh position={[0, -0.15, 0]} geometry={SHARED_GEOMETRIES.cone8} scale={[0.06, 0.35, 0.06]}>
          <meshBasicMaterial color={0xffffff} transparent opacity={0.98} />
        </mesh>
        {/* Bright yellow inner */}
        <mesh position={[0, -0.3, 0]} geometry={SHARED_GEOMETRIES.cone8} scale={[0.1, 0.5, 0.1]}>
          <meshBasicMaterial color={0xffffaa} transparent opacity={0.92} />
        </mesh>
        {/* Orange mid flame */}
        <mesh position={[0, -0.45, 0]} geometry={SHARED_GEOMETRIES.cone8} scale={[0.14, 0.7, 0.14]}>
          <meshBasicMaterial color={0xffaa00} transparent opacity={0.8} />
        </mesh>
        {/* Red outer flame */}
        <mesh position={[0, -0.6, 0]} geometry={SHARED_GEOMETRIES.cone8} scale={[0.2, 0.9, 0.2]}>
          <meshBasicMaterial color={0xff5500} transparent opacity={0.55} />
        </mesh>
        {/* Dark red tip */}
        <mesh position={[0, -0.75, 0]} geometry={SHARED_GEOMETRIES.cone8} scale={[0.25, 1.0, 0.25]}>
          <meshBasicMaterial color={0xcc2200} transparent opacity={0.3} />
        </mesh>
      </group>
      
      {/* Right glow */}
      <mesh ref={rightGlowRef} position={[thrusterOffset, -0.3, 0.05]} geometry={SHARED_GEOMETRIES.sphere8}>
        <meshBasicMaterial color={0xff6600} transparent opacity={0.35} />
      </mesh>
      
      {/* Smoke particles */}
      {JETPACK_SMOKE_PARTICLES.map((_, i) => (
        <mesh 
          key={`smoke-${i}`}
          ref={el => smokeRefs.current[i] = el}
          geometry={SHARED_GEOMETRIES.sphere8}
        >
          <meshBasicMaterial color={0x666666} transparent opacity={0.3} />
        </mesh>
      ))}
      
      {/* Sparks */}
      {[0, 1, 2, 3, 4, 5].map(i => (
        <mesh 
          key={`spark-${i}`}
          ref={el => sparkRefs.current[i] = el}
          geometry={SHARED_GEOMETRIES.sphere8}
        >
          <meshBasicMaterial color={0xffdd00} transparent opacity={0.9} />
        </mesh>
      ))}
      
      {/* Heat distortion ring at nozzles */}
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.1, 0.05]} geometry={SHARED_GEOMETRIES.ring16} scale={[0.5, 0.5, 1]}>
        <meshBasicMaterial color={0xff8800} transparent opacity={0.15} side={THREE.DoubleSide} />
      </mesh>
      
      <pointLight ref={lightRef} color={0xff6600} intensity={8} distance={12} decay={2} position={[0, -0.5, 0]} />
    </group>
  );
}

// ============================================================================
// BLAZE EFFECTS MANAGER
// ============================================================================

export function BlazeEffectsManager() {
  const bombs = useGameStore(state => state.bombs);
  const localPlayer = useGameStore(state => state.localPlayer);
  const jetpackActive = useGameStore(state => state.jetpackActive);
  
  const [activeRocketJumpExplosions, setActiveRocketJumpExplosions] = useState<RocketJumpExplosionData[]>([]);
  const [activeAirStrikes, setActiveAirStrikes] = useState<AirStrikeData[]>([]);
  
  useEffect(() => {
    const interval = setInterval(() => {
      useGameStore.getState().clearExpiredRockets();
      useGameStore.getState().clearExpiredBombs();
      
      const now = Date.now();
      const activeExplosions = rocketJumpExplosions.filter(e => now - e.startTime < ROCKET_JUMP_DURATION);
      rocketJumpExplosions.length = 0;
      rocketJumpExplosions.push(...activeExplosions);
      setActiveRocketJumpExplosions([...activeExplosions]);
      
      const activeStrks = airStrikes.filter(s => now - s.startTime < AIR_STRIKE_DURATION + 500);
      airStrikes.length = 0;
      airStrikes.push(...activeStrks);
      setActiveAirStrikes([...activeStrks]);
    }, 150);
    
    return () => clearInterval(interval);
  }, []);
  
  return (
    <group>
      {/* Rockets with shared light */}
      <RocketsManager />
      
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

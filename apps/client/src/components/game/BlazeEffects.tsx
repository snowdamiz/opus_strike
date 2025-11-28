import { useRef, useMemo, useState, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useGameStore, type RocketData, type BombData } from '../../store/gameStore';
import { checkGroundWithNormal, isPhysicsReady } from '../../hooks/usePhysics';

// ============================================================================
// BLAZE ROCKET EFFECT
// A rocket projectile with flame trail - OPTIMIZED for performance
// ============================================================================

interface RocketEffectProps {
  rocket: RocketData;
}

export function RocketEffect({ rocket }: RocketEffectProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const trailMeshRef = useRef<THREE.Mesh>(null);
  
  // Pre-calculate the position based on elapsed time
  const positionRef = useRef(new THREE.Vector3());
  
  useFrame(() => {
    if (!meshRef.current) return;
    
    const elapsed = (Date.now() - rocket.startTime) / 1000;
    
    // Update rocket position with slight gravity
    const x = rocket.position.x + rocket.velocity.x * elapsed;
    const y = rocket.position.y + rocket.velocity.y * elapsed - 0.5 * 2 * elapsed * elapsed;
    const z = rocket.position.z + rocket.velocity.z * elapsed;
    
    positionRef.current.set(x, y, z);
    meshRef.current.position.copy(positionRef.current);
    
    // Rotate rocket to face velocity direction
    const lookAhead = new THREE.Vector3(
      x + rocket.velocity.x * 0.1,
      y + rocket.velocity.y * 0.1,
      z + rocket.velocity.z * 0.1
    );
    meshRef.current.lookAt(lookAhead);
    meshRef.current.rotateX(Math.PI / 2); // Cylinder points up by default
    
    // Update trail position
    if (trailMeshRef.current) {
      trailMeshRef.current.position.copy(positionRef.current);
      trailMeshRef.current.lookAt(lookAhead);
      trailMeshRef.current.rotateX(Math.PI / 2);
    }
  });
  
  return (
    <group>
      {/* Rocket body */}
      <mesh ref={meshRef}>
        <coneGeometry args={[0.1, 0.4, 8]} />
        <meshBasicMaterial color={0xff4500} />
      </mesh>
      
      {/* Simple flame trail - no particles, just a stretched cone */}
      <mesh ref={trailMeshRef}>
        <coneGeometry args={[0.15, 0.8, 8]} />
        <meshBasicMaterial 
          color={0xff6600} 
          transparent 
          opacity={0.6}
        />
      </mesh>
    </group>
  );
}

// ============================================================================
// ROCKET JUMP EXPLOSION EFFECT
// Visual explosion at player's feet when rocket jumping
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

const ROCKET_JUMP_DURATION = 500; // ms

function RocketJumpExplosion({ explosion }: { explosion: RocketJumpExplosionData }) {
  const groupRef = useRef<THREE.Group>(null);
  const [scale, setScale] = useState(0.1);
  const [opacity, setOpacity] = useState(1);
  
  useFrame(() => {
    const elapsed = Date.now() - explosion.startTime;
    const progress = Math.min(1, elapsed / ROCKET_JUMP_DURATION);
    
    setScale(0.5 + progress * 3);
    setOpacity(1 - progress);
  });
  
  const elapsed = Date.now() - explosion.startTime;
  if (elapsed > ROCKET_JUMP_DURATION) return null;
  
  return (
    <group ref={groupRef} position={[explosion.position.x, explosion.position.y - 0.5, explosion.position.z]}>
      {/* Explosion sphere */}
      <mesh scale={scale}>
        <sphereGeometry args={[0.5, 16, 16]} />
        <meshBasicMaterial 
          color={0xff4400} 
          transparent 
          opacity={opacity * 0.8}
        />
      </mesh>
      
      {/* Ground ring */}
      <mesh rotation-x={-Math.PI / 2} scale={scale}>
        <ringGeometry args={[0.3, 1, 16]} />
        <meshBasicMaterial 
          color={0xff6600} 
          transparent 
          opacity={opacity * 0.6}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}

// ============================================================================
// AIR STRIKE EFFECT
// Multiple bombs falling in an area for the ultimate
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
  // Create multiple bomb positions in a pattern
  const bombs: { x: number; z: number; delay: number }[] = [];
  const radius = 8;
  const bombCount = 12;
  
  for (let i = 0; i < bombCount; i++) {
    const angle = (i / bombCount) * Math.PI * 2;
    const r = radius * (0.3 + Math.random() * 0.7);
    bombs.push({
      x: position.x + Math.cos(angle) * r,
      z: position.z + Math.sin(angle) * r,
      delay: i * 150 + Math.random() * 100, // Staggered drops
    });
  }
  
  // Add center bomb
  bombs.push({ x: position.x, z: position.z, delay: bombCount * 100 });
  
  airStrikes.push({
    id: `airstrike_${airStrikeIdCounter++}`,
    centerPosition: { ...position },
    startTime: Date.now(),
    bombs,
  });
}

const AIR_STRIKE_DURATION = 3000; // 3 seconds total
const BOMB_FALL_TIME = 800; // Each bomb takes 0.8s to fall

function AirStrikeBomb({ x, z, fallbackGroundY, delay, startTime }: { x: number; z: number; fallbackGroundY: number; delay: number; startTime: number }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const [hasExploded, setHasExploded] = useState(false);
  const [explosionScale, setExplosionScale] = useState(0.1);
  const [explosionOpacity, setExplosionOpacity] = useState(1);
  const [actualGroundY, setActualGroundY] = useState<number | null>(null);
  const groundCheckedRef = useRef(false);
  
  // Get actual ground level using raycasting
  const groundY = actualGroundY ?? fallbackGroundY;
  
  useFrame(() => {
    // Do ground check once when bomb starts falling
    if (!groundCheckedRef.current && isPhysicsReady()) {
      groundCheckedRef.current = true;
      const groundCheck = checkGroundWithNormal(x, fallbackGroundY + 50, z, 100);
      if (groundCheck && groundCheck.isWalkable) {
        setActualGroundY(groundCheck.groundY);
      }
    }
    
    const elapsed = Date.now() - startTime - delay;
    
    if (elapsed < 0) {
      // Not started yet
      if (meshRef.current) meshRef.current.visible = false;
      return;
    }
    
    if (meshRef.current) meshRef.current.visible = true;
    
    const fallProgress = Math.min(1, elapsed / BOMB_FALL_TIME);
    
    if (fallProgress < 1 && meshRef.current) {
      // Falling
      const startY = groundY + 50;
      const y = startY - (startY - groundY) * fallProgress;
      meshRef.current.position.set(x, y, z);
      meshRef.current.rotation.x += 0.1;
      meshRef.current.rotation.z += 0.05;
    } else if (!hasExploded) {
      setHasExploded(true);
    }
    
    if (hasExploded) {
      const explosionElapsed = elapsed - BOMB_FALL_TIME;
      const explosionProgress = Math.min(1, explosionElapsed / 500);
      setExplosionScale(1 + explosionProgress * 4);
      setExplosionOpacity(1 - explosionProgress);
    }
  });
  
  return (
    <group>
      {/* Falling bomb */}
      {!hasExploded && (
        <mesh ref={meshRef}>
          <sphereGeometry args={[0.3, 8, 8]} />
          <meshBasicMaterial color={0x333333} />
        </mesh>
      )}
      
      {/* Warning circle */}
      {!hasExploded && (
        <mesh position={[x, groundY + 0.1, z]} rotation-x={-Math.PI / 2}>
          <ringGeometry args={[1.5, 2, 16]} />
          <meshBasicMaterial 
            color={0xff0000} 
            transparent 
            opacity={0.5}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}
      
      {/* Explosion */}
      {hasExploded && explosionOpacity > 0 && (
        <group position={[x, groundY + 0.5, z]} scale={explosionScale}>
          <mesh>
            <sphereGeometry args={[0.5, 12, 12]} />
            <meshBasicMaterial 
              color={0xffaa00} 
              transparent 
              opacity={explosionOpacity}
            />
          </mesh>
          <pointLight 
            color={0xff4400} 
            intensity={explosionOpacity * 5} 
            distance={10} 
          />
        </group>
      )}
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
// BLAZE BOMB EFFECT
// A falling bomb with impact explosion - LARGE and VISIBLE
// ============================================================================

interface BombEffectProps {
  bomb: BombData;
}

const BOMB_FALL_DURATION = 1500;
const EXPLOSION_DURATION = 1200;

export function BombEffect({ bomb }: BombEffectProps) {
  const bombMeshRef = useRef<THREE.Mesh>(null);
  const trailRef = useRef<THREE.Mesh>(null);
  const [hasExploded, setHasExploded] = useState(bomb.hasExploded);
  const [explosionScale, setExplosionScale] = useState(0.1);
  const [explosionOpacity, setExplosionOpacity] = useState(1);
  const [bombPos, setBombPos] = useState({ x: 0, y: 50, z: 0 });
  
  useFrame(() => {
    const now = Date.now();
    const elapsed = now - bomb.startTime;
    const fallProgress = Math.min(1, elapsed / BOMB_FALL_DURATION);
    
    if (!hasExploded && fallProgress < 1) {
      // Bomb falls from high above (50 units up)
      const startY = bomb.targetPosition.y + 50;
      const endY = bomb.targetPosition.y;
      
      const t = fallProgress;
      // Accelerating fall (quadratic easing)
      const easedT = t * t;
      const x = bomb.targetPosition.x;
      const z = bomb.targetPosition.z;
      const y = startY + (endY - startY) * easedT;
      
      setBombPos({ x, y, z });
      
      if (bombMeshRef.current) {
        bombMeshRef.current.position.set(x, y, z);
        bombMeshRef.current.rotation.x += 0.15;
        bombMeshRef.current.rotation.z += 0.1;
      }
      
      // Update trail
      if (trailRef.current) {
        trailRef.current.position.set(x, y + 1, z);
      }
    } else if (fallProgress >= 1 && !hasExploded) {
      setHasExploded(true);
    }
    
    if (hasExploded) {
      const explosionElapsed = now - bomb.impactTime;
      const explosionProgress = Math.min(1, explosionElapsed / EXPLOSION_DURATION);
      setExplosionScale(1 + explosionProgress * 8);
      setExplosionOpacity(Math.max(0, 1 - explosionProgress));
    }
  });
  
  const elapsed = Date.now() - bomb.startTime;
  const showBomb = elapsed < BOMB_FALL_DURATION && !hasExploded;
  const showExplosion = hasExploded && explosionOpacity > 0.01;
  
  return (
    <group>
      {/* Falling bomb - LARGE */}
      {showBomb && (
        <>
          <mesh ref={bombMeshRef}>
            {/* Main bomb body */}
            <sphereGeometry args={[1.2, 16, 16]} />
            <meshBasicMaterial color={0x111111} />
          </mesh>
          
          {/* Flame trail */}
          <mesh ref={trailRef}>
            <coneGeometry args={[0.5, 3, 8]} />
            <meshBasicMaterial color={0xff4400} transparent opacity={0.7} />
          </mesh>
          
          {/* Bomb glow */}
          <pointLight
            position={[bombPos.x, bombPos.y, bombPos.z]}
            color={0xff4400}
            intensity={3}
            distance={10}
          />
        </>
      )}
      
      {/* Warning circle on ground - pulsing */}
      {showBomb && (
        <group position={[bomb.targetPosition.x, bomb.targetPosition.y + 0.2, bomb.targetPosition.z]}>
          {/* Outer danger ring */}
          <mesh rotation-x={-Math.PI / 2}>
            <ringGeometry args={[4, 4.5, 32]} />
            <meshBasicMaterial
              color={0xff0000}
              transparent
              opacity={0.8}
              side={THREE.DoubleSide}
            />
          </mesh>
          
          {/* Middle ring */}
          <mesh rotation-x={-Math.PI / 2}>
            <ringGeometry args={[2.5, 3, 32]} />
            <meshBasicMaterial
              color={0xff4400}
              transparent
              opacity={0.7}
              side={THREE.DoubleSide}
            />
          </mesh>
          
          {/* Inner ring */}
          <mesh rotation-x={-Math.PI / 2}>
            <ringGeometry args={[1, 1.3, 32]} />
            <meshBasicMaterial
              color={0xffaa00}
              transparent
              opacity={0.9}
              side={THREE.DoubleSide}
            />
          </mesh>
          
          {/* Filled danger area */}
          <mesh rotation-x={-Math.PI / 2} position-y={-0.1}>
            <circleGeometry args={[4.5, 32]} />
            <meshBasicMaterial
              color={0xff2200}
              transparent
              opacity={0.25}
              side={THREE.DoubleSide}
            />
          </mesh>
          
          {/* Cross lines */}
          <mesh rotation-x={-Math.PI / 2}>
            <planeGeometry args={[0.2, 10]} />
            <meshBasicMaterial color={0xff0000} transparent opacity={0.6} side={THREE.DoubleSide} />
          </mesh>
          <mesh rotation-x={-Math.PI / 2} rotation-z={Math.PI / 2}>
            <planeGeometry args={[0.2, 10]} />
            <meshBasicMaterial color={0xff0000} transparent opacity={0.6} side={THREE.DoubleSide} />
          </mesh>
        </group>
      )}
      
      {/* EXPLOSION - BIG AND DRAMATIC */}
      {showExplosion && (
        <group 
          position={[bomb.targetPosition.x, bomb.targetPosition.y + 1, bomb.targetPosition.z]}
        >
          {/* Core flash - bright yellow/white */}
          <mesh scale={explosionScale * 0.8}>
            <sphereGeometry args={[1, 16, 16]} />
            <meshBasicMaterial
              color={0xffffaa}
              transparent
              opacity={explosionOpacity}
            />
          </mesh>
          
          {/* Fire ball - orange */}
          <mesh scale={explosionScale}>
            <sphereGeometry args={[1.5, 16, 16]} />
            <meshBasicMaterial
              color={0xff6600}
              transparent
              opacity={explosionOpacity * 0.8}
            />
          </mesh>
          
          {/* Outer fire ring */}
          <mesh scale={explosionScale * 1.2}>
            <sphereGeometry args={[2, 12, 12]} />
            <meshBasicMaterial
              color={0xff2200}
              transparent
              opacity={explosionOpacity * 0.5}
            />
          </mesh>
          
          {/* Ground ring */}
          <mesh rotation-x={-Math.PI / 2} position-y={-0.5} scale={explosionScale * 1.5}>
            <ringGeometry args={[1, 3, 32]} />
            <meshBasicMaterial
              color={0xff4400}
              transparent
              opacity={explosionOpacity * 0.7}
              side={THREE.DoubleSide}
            />
          </mesh>
          
          {/* Explosion light - VERY BRIGHT */}
          <pointLight
            color={0xff4400}
            intensity={explosionOpacity * 50}
            distance={30}
          />
        </group>
      )}
    </group>
  );
}

// ============================================================================
// BOMB TARGETING INDICATOR
// Shows where the bomb will land - uses proper ground detection like ShadowStep
// ============================================================================

interface BombTargetingIndicatorProps {
  isActive: boolean;
  onTargetUpdate: (position: THREE.Vector3 | null, isValid: boolean) => void;
}

// Maximum and minimum bomb range
const BOMB_MAX_RANGE = 60;
const BOMB_MIN_RANGE = 5;

export function BombTargetingIndicator({ isActive, onTargetUpdate }: BombTargetingIndicatorProps) {
  const indicatorRef = useRef<THREE.Group>(null);
  const pulseRef = useRef(0);
  const { camera } = useThree();
  const targetPositionRef = useRef<THREE.Vector3>(new THREE.Vector3());
  const isValidRef = useRef(false);
  
  useFrame((state) => {
    if (!isActive) {
      if (indicatorRef.current) {
        indicatorRef.current.visible = false;
      }
      onTargetUpdate(null, false);
      return;
    }
    
    const localPlayer = useGameStore.getState().localPlayer;
    if (!localPlayer) {
      onTargetUpdate(null, false);
      return;
    }
    
    // Get camera look direction
    const lookDir = new THREE.Vector3(0, 0, -1);
    lookDir.applyQuaternion(camera.quaternion);
    
    // Player feet position for range calculation
    const playerFeetY = localPlayer.position.y - 0.9;
    
    let targetX = camera.position.x;
    let targetZ = camera.position.z;
    let targetY = playerFeetY;
    let isValid = false;
    let foundGround = false;
    
    if (isPhysicsReady()) {
      const horizontalDir = new THREE.Vector3(lookDir.x, 0, lookDir.z);
      const horizontalLength = horizontalDir.length();
      
      if (horizontalLength > 0.01) {
        horizontalDir.normalize();
        
        // Calculate pitch angle
        const pitch = Math.asin(Math.max(-1, Math.min(1, -lookDir.y)));
        
        // If looking down, use ray-plane intersection
        if (pitch > 0.1 && lookDir.y < -0.01) {
          // Start with player's ground level as reference
          const groundY = playerFeetY;
          const t = (groundY - camera.position.y) / lookDir.y;
          
          if (t > 0 && t < 200) {
            targetX = camera.position.x + lookDir.x * t;
            targetZ = camera.position.z + lookDir.z * t;
            
            // Use physics to find actual ground at this position
            const groundCheck = checkGroundWithNormal(targetX, groundY + 30, targetZ, 60);
            if (groundCheck && groundCheck.isWalkable) {
              targetY = groundCheck.groundY + 0.1;
              foundGround = true;
            }
          }
        }
        
        // If not looking down enough or no ground found, project forward
        if (!foundGround) {
          const distanceFactor = Math.max(0.2, Math.cos(pitch));
          const projectionDist = BOMB_MIN_RANGE + (BOMB_MAX_RANGE - BOMB_MIN_RANGE) * distanceFactor * 0.5;
          
          targetX = localPlayer.position.x + horizontalDir.x * projectionDist;
          targetZ = localPlayer.position.z + horizontalDir.z * projectionDist;
          
          // Use physics to find ground at this position
          const groundCheck = checkGroundWithNormal(targetX, localPlayer.position.y + 30, targetZ, 60);
          if (groundCheck && groundCheck.isWalkable) {
            targetY = groundCheck.groundY + 0.1;
            foundGround = true;
          }
        }
        
        // Validate range and clamp if needed
        if (foundGround) {
          const dx = targetX - localPlayer.position.x;
          const dz = targetZ - localPlayer.position.z;
          const horizontalDist = Math.sqrt(dx * dx + dz * dz);
          
          // Clamp to max range
          if (horizontalDist > BOMB_MAX_RANGE) {
            const scale = BOMB_MAX_RANGE / horizontalDist;
            targetX = localPlayer.position.x + dx * scale;
            targetZ = localPlayer.position.z + dz * scale;
            
            // Re-check ground at clamped position
            const groundCheck = checkGroundWithNormal(targetX, localPlayer.position.y + 30, targetZ, 60);
            if (groundCheck && groundCheck.isWalkable) {
              targetY = groundCheck.groundY + 0.1;
            } else {
              foundGround = false;
            }
          }
          
          // Valid if in range and ground found
          const finalDist = Math.sqrt(
            (targetX - localPlayer.position.x) ** 2 + 
            (targetZ - localPlayer.position.z) ** 2
          );
          
          if (foundGround && finalDist >= BOMB_MIN_RANGE) {
            isValid = true;
          }
        }
      }
    }
    
    // Update refs and indicator
    targetPositionRef.current.set(targetX, targetY, targetZ);
    isValidRef.current = isValid;
    
    if (indicatorRef.current) {
      indicatorRef.current.visible = true;
      indicatorRef.current.position.set(targetX, targetY, targetZ);
      
      // Pulsing animation
      pulseRef.current = (pulseRef.current + 0.05) % (Math.PI * 2);
      const pulse = 1 + Math.sin(pulseRef.current) * 0.1;
      indicatorRef.current.scale.setScalar(pulse);
    }
    
    // Report to parent
    onTargetUpdate(targetPositionRef.current.clone(), isValid);
  });
  
  if (!isActive) return null;
  
  const ringColor = isValidRef.current ? 0xff4400 : 0xff0000;
  
  return (
    <group ref={indicatorRef}>
      {/* Large outer pulsing ring */}
      <mesh rotation-x={-Math.PI / 2} position-y={0.1}>
        <ringGeometry args={[4, 4.5, 32]} />
        <meshBasicMaterial
          color={ringColor}
          transparent
          opacity={0.7}
          side={THREE.DoubleSide}
        />
      </mesh>
      
      {/* Middle ring */}
      <mesh rotation-x={-Math.PI / 2} position-y={0.15}>
        <ringGeometry args={[2.5, 3, 32]} />
        <meshBasicMaterial
          color={0xff6600}
          transparent
          opacity={0.8}
          side={THREE.DoubleSide}
        />
      </mesh>
      
      {/* Inner ring */}
      <mesh rotation-x={-Math.PI / 2} position-y={0.2}>
        <ringGeometry args={[1, 1.3, 32]} />
        <meshBasicMaterial
          color={0xffaa00}
          transparent
          opacity={0.9}
          side={THREE.DoubleSide}
        />
      </mesh>
      
      {/* Center bright dot */}
      <mesh rotation-x={-Math.PI / 2} position-y={0.25}>
        <circleGeometry args={[0.5, 16]} />
        <meshBasicMaterial
          color={0xffff00}
          transparent
          opacity={1}
          side={THREE.DoubleSide}
        />
      </mesh>
      
      {/* Blast radius filled area */}
      <mesh rotation-x={-Math.PI / 2} position-y={0.05}>
        <circleGeometry args={[4.5, 32]} />
        <meshBasicMaterial
          color={0xff2200}
          transparent
          opacity={0.2}
          side={THREE.DoubleSide}
        />
      </mesh>
      
      {/* Cross lines - horizontal */}
      <mesh rotation-x={-Math.PI / 2} position-y={0.15}>
        <planeGeometry args={[0.15, 10]} />
        <meshBasicMaterial color={ringColor} transparent opacity={0.7} side={THREE.DoubleSide} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} rotation-z={Math.PI / 2} position-y={0.15}>
        <planeGeometry args={[0.15, 10]} />
        <meshBasicMaterial color={ringColor} transparent opacity={0.7} side={THREE.DoubleSide} />
      </mesh>
      
      {/* Vertical pillar to show bomb drop path */}
      <mesh position-y={20}>
        <cylinderGeometry args={[0.08, 0.08, 40, 8]} />
        <meshBasicMaterial color={0xff6600} transparent opacity={0.4} />
      </mesh>
      
      {/* Top marker - where bomb comes from */}
      <mesh position-y={40}>
        <sphereGeometry args={[0.5, 8, 8]} />
        <meshBasicMaterial color={0xff4400} transparent opacity={0.7} />
      </mesh>
    </group>
  );
}

// ============================================================================
// JETPACK EFFECT
// Visual fire effect below player when using jetpack
// ============================================================================

interface JetpackEffectProps {
  isActive: boolean;
  playerPosition: { x: number; y: number; z: number };
}

export function JetpackEffect({ isActive, playerPosition }: JetpackEffectProps) {
  const flameRef = useRef<THREE.Mesh>(null);
  const [scale, setScale] = useState(1);
  
  useFrame((state) => {
    if (flameRef.current && isActive) {
      // Flickering flame effect
      const flicker = 0.8 + Math.sin(state.clock.elapsedTime * 30) * 0.2;
      setScale(flicker);
    }
  });
  
  if (!isActive) return null;
  
  return (
    <group position={[playerPosition.x, playerPosition.y - 1.2, playerPosition.z]}>
      {/* Main flame */}
      <mesh ref={flameRef} scale={[scale, scale * 1.5, scale]}>
        <coneGeometry args={[0.3, 1.2, 8]} />
        <meshBasicMaterial color={0xff4400} transparent opacity={0.8} />
      </mesh>
      
      {/* Inner hot core */}
      <mesh scale={[scale * 0.5, scale, scale * 0.5]}>
        <coneGeometry args={[0.15, 0.8, 8]} />
        <meshBasicMaterial color={0xffff00} transparent opacity={0.9} />
      </mesh>
      
      {/* Light */}
      <pointLight color={0xff4400} intensity={2} distance={5} />
    </group>
  );
}

// ============================================================================
// BLAZE EFFECTS MANAGER
// Tracks and renders all active Blaze effects
// ============================================================================

export function BlazeEffectsManager() {
  const rockets = useGameStore(state => state.rockets);
  const bombs = useGameStore(state => state.bombs);
  const localPlayer = useGameStore(state => state.localPlayer);
  
  const [activeRocketJumpExplosions, setActiveRocketJumpExplosions] = useState<RocketJumpExplosionData[]>([]);
  const [activeAirStrikes, setActiveAirStrikes] = useState<AirStrikeData[]>([]);
  const [jetpackActive, setJetpackActive] = useState(false);
  
  // Get jetpack state from store
  const jetpackActiveFromStore = useGameStore(state => state.jetpackActive);
  
  useEffect(() => {
    setJetpackActive(jetpackActiveFromStore || false);
  }, [jetpackActiveFromStore]);
  
  // Cleanup expired effects periodically (not every frame)
  useEffect(() => {
    const interval = setInterval(() => {
      useGameStore.getState().clearExpiredRockets();
      useGameStore.getState().clearExpiredBombs();
      
      // Clean up rocket jump explosions
      const now = Date.now();
      const activeExplosions = rocketJumpExplosions.filter(e => now - e.startTime < ROCKET_JUMP_DURATION);
      rocketJumpExplosions.length = 0;
      rocketJumpExplosions.push(...activeExplosions);
      setActiveRocketJumpExplosions([...activeExplosions]);
      
      // Clean up air strikes
      const activeStrikes = airStrikes.filter(s => now - s.startTime < AIR_STRIKE_DURATION + 1000);
      airStrikes.length = 0;
      airStrikes.push(...activeStrikes);
      setActiveAirStrikes([...activeStrikes]);
    }, 100);
    
    return () => clearInterval(interval);
  }, []);
  
  return (
    <group>
      {/* Render all rockets */}
      {rockets.map(rocket => (
        <RocketEffect key={rocket.id} rocket={rocket} />
      ))}
      
      {/* Render all bombs */}
      {bombs.map(bomb => (
        <BombEffect key={bomb.id} bomb={bomb} />
      ))}
      
      {/* Render rocket jump explosions */}
      {activeRocketJumpExplosions.map(explosion => (
        <RocketJumpExplosion key={explosion.id} explosion={explosion} />
      ))}
      
      {/* Render air strikes */}
      {activeAirStrikes.map(strike => (
        <AirStrikeEffect key={strike.id} strike={strike} />
      ))}
      
      {/* Render jetpack effect */}
      {localPlayer && jetpackActive && (
        <JetpackEffect isActive={true} playerPosition={localPlayer.position} />
      )}
    </group>
  );
}

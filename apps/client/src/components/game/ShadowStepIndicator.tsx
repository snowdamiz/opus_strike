import { useRef, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useGameStore } from '../../store/gameStore';
import { checkGroundWithNormal, isPhysicsReady, validateTeleportDestination, checkWallCollision } from '../../hooks/usePhysics';

const PLAYER_HEIGHT = 1.8;
const PLAYER_RADIUS = 0.4;

// Maximum teleport range
const MAX_RANGE = 25;
const MIN_RANGE = 2;

interface ShadowStepIndicatorProps {
  isActive: boolean;
  onTargetUpdate: (position: THREE.Vector3 | null, isValid: boolean) => void;
}

export function ShadowStepIndicator({ isActive, onTargetUpdate }: ShadowStepIndicatorProps) {
  const { camera } = useThree();
  const { localPlayer } = useGameStore();
  
  const indicatorRef = useRef<THREE.Group>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const pillarRef = useRef<THREE.Mesh>(null);
  const targetPositionRef = useRef<THREE.Vector3>(new THREE.Vector3());
  const isValidRef = useRef(false);

  // Create materials
  const validMaterial = useMemo(() => new THREE.MeshBasicMaterial({ 
    color: 0xa855f7, // Purple
    transparent: true, 
    opacity: 0.6,
    side: THREE.DoubleSide,
  }), []);

  const invalidMaterial = useMemo(() => new THREE.MeshBasicMaterial({ 
    color: 0xef4444, // Red
    transparent: true, 
    opacity: 0.6,
    side: THREE.DoubleSide,
  }), []);

  const pillarMaterial = useMemo(() => new THREE.MeshBasicMaterial({ 
    color: 0xa855f7,
    transparent: true, 
    opacity: 0.3,
  }), []);

  useFrame(() => {
    if (!isActive || !localPlayer || !indicatorRef.current) {
      if (indicatorRef.current) {
        indicatorRef.current.visible = false;
      }
      return;
    }

    indicatorRef.current.visible = true;

    // Get camera position and look direction
    const cameraPos = camera.position.clone();
    const lookDir = new THREE.Vector3(0, 0, -1);
    lookDir.applyQuaternion(camera.quaternion);

    // Player feet position (for range calculation)
    const playerFeetY = localPlayer.position.y - 0.9;

    // Use raycasting approach - find where the look ray hits a ground plane
    // Cast multiple rays at different distances to find ground intersection
    let targetX = cameraPos.x;
    let targetZ = cameraPos.z;
    let targetY = playerFeetY;
    let isValid = false;
    let foundGround = false;

    if (isPhysicsReady()) {
      // Sample points along the look ray to find where it hits ground
      const horizontalDir = new THREE.Vector3(lookDir.x, 0, lookDir.z);
      const horizontalLength = horizontalDir.length();
      
      if (horizontalLength > 0.01) {
        horizontalDir.normalize();
        
        // If looking down, use ray intersection with ground plane
        // If looking up/forward, project forward and find ground
        const pitch = Math.asin(Math.max(-1, Math.min(1, -lookDir.y)));
        
        if (pitch > 0.1) {
          // Looking down - calculate where ray hits ground level
          // Ray: P = cameraPos + t * lookDir
          // Ground: y = playerFeetY (approximately)
          // Solve for t: cameraPos.y + t * lookDir.y = playerFeetY
          const groundY = playerFeetY;
          if (lookDir.y < -0.01) {
            const t = (groundY - cameraPos.y) / lookDir.y;
            if (t > 0 && t < 100) {
              targetX = cameraPos.x + lookDir.x * t;
              targetZ = cameraPos.z + lookDir.z * t;
              
              // Verify there's actual ground there
              const groundCheck = checkGroundWithNormal(targetX, groundY + 10, targetZ, 20);
              if (groundCheck && groundCheck.isWalkable) {
                targetY = groundCheck.groundY + 0.05;
                foundGround = true;
              }
            }
          }
        }
        
        // If didn't find ground via raycast, use forward projection
        if (!foundGround) {
          // Calculate distance based on pitch - further when looking forward
          const distanceFactor = Math.max(0.2, Math.cos(pitch));
          const projectionDist = MIN_RANGE + (MAX_RANGE - MIN_RANGE) * distanceFactor;
          
          targetX = localPlayer.position.x + horizontalDir.x * projectionDist;
          targetZ = localPlayer.position.z + horizontalDir.z * projectionDist;
          
          // Find ground at that position
          const groundCheck = checkGroundWithNormal(targetX, localPlayer.position.y + 20, targetZ, 50);
          if (groundCheck && groundCheck.isWalkable) {
            targetY = groundCheck.groundY + 0.05;
            foundGround = true;
          }
        }
        
        // Validate the target
        if (foundGround) {
          const dx = targetX - localPlayer.position.x;
          const dz = targetZ - localPlayer.position.z;
          const horizontalDist = Math.sqrt(dx * dx + dz * dz);
          const heightDiff = Math.abs(targetY - playerFeetY);
          
          // Clamp to max range if needed
          if (horizontalDist > MAX_RANGE) {
            const scale = MAX_RANGE / horizontalDist;
            targetX = localPlayer.position.x + dx * scale;
            targetZ = localPlayer.position.z + dz * scale;
            
            // Re-check ground at clamped position
            const groundCheck = checkGroundWithNormal(targetX, localPlayer.position.y + 20, targetZ, 50);
            if (groundCheck && groundCheck.isWalkable) {
              targetY = groundCheck.groundY + 0.05;
            } else {
              foundGround = false;
            }
          }
          
          // Additional validation: check if position is inside geometry
          if (foundGround && horizontalDist >= MIN_RANGE && heightDiff < 15) {
            const dx = targetX - localPlayer.position.x;
            const dz = targetZ - localPlayer.position.z;
            const dist = Math.sqrt(dx * dx + dz * dz);
            const dirX = dx / dist;
            const dirZ = dz / dist;
            
            // For elevated targets (like stairs), we need smarter wall checking
            // If target is higher, cast rays from an elevated position to avoid hitting stair faces
            const elevationDiff = targetY - playerFeetY;
            const isElevatedTarget = elevationDiff > 0.3; // Target is notably higher
            
            let wallBlocking = false;
            
            if (!isElevatedTarget) {
              // Flat or lower target - check for walls normally
              const checkHeights = [0.9, 1.5]; // center, head only
              for (const h of checkHeights) {
                const wallCheck = checkWallCollision(
                  localPlayer.position.x, 
                  localPlayer.position.y - PLAYER_HEIGHT/2 + h, 
                  localPlayer.position.z,
                  dirX, dirZ,
                  dist
                );
                // Only count as wall if normal is wall-like (not floor)
                const normalY = Math.abs(wallCheck.normal.y);
                if (wallCheck.hit && wallCheck.distance < dist - 1.5 && normalY < 0.5) {
                  wallBlocking = true;
                  break;
                }
              }
            } else {
              // Elevated target (stairs, ledges) - check from ABOVE the target height
              // This avoids detecting the stair face itself as a wall
              const elevatedCheckY = targetY + 1.0; // Check from above the target ground
              const wallCheck = checkWallCollision(
                localPlayer.position.x,
                elevatedCheckY,
                localPlayer.position.z,
                dirX, dirZ,
                dist
              );
              // Only block if there's a real wall (vertical surface) in the path at head height
              const normalY = Math.abs(wallCheck.normal.y);
              if (wallCheck.hit && wallCheck.distance < dist - 2.0 && normalY < 0.3) {
                wallBlocking = true;
              }
            }
            
            if (wallBlocking) {
              isValid = false;
            } else {
              // Validate the destination itself - for elevated targets, be more lenient
              const teleportY = targetY + PLAYER_HEIGHT / 2 + 0.1;
              const validation = validateTeleportDestination(targetX, teleportY, targetZ, PLAYER_HEIGHT, PLAYER_RADIUS);
              
              // For elevated targets (stairs/ledges), also accept if we just have valid ground
              if (validation.valid) {
                isValid = true;
                if (validation.adjustedPosition) {
                  targetY = validation.adjustedPosition.y - PLAYER_HEIGHT / 2;
                }
              } else if (isElevatedTarget) {
                // Fallback for elevated targets: if ground is walkable, allow it
                // This handles stairs where the geometry validation might be too strict
                const groundRecheck = checkGroundWithNormal(targetX, teleportY + 2, targetZ, 5);
                if (groundRecheck && groundRecheck.isWalkable) {
                  isValid = true;
                  targetY = groundRecheck.groundY + 0.05;
                }
              }
            }
          }
        }
      }
    }

    // Update indicator position
    targetPositionRef.current.set(targetX, targetY, targetZ);
    isValidRef.current = isValid;
    
    indicatorRef.current.position.set(targetX, targetY, targetZ);

    // Update materials based on validity
    if (ringRef.current) {
      (ringRef.current.material as THREE.MeshBasicMaterial) = isValid ? validMaterial : invalidMaterial;
    }

    // Animate the indicator
    const time = Date.now() * 0.003;
    if (ringRef.current) {
      ringRef.current.rotation.y = time;
      ringRef.current.scale.setScalar(1 + Math.sin(time * 2) * 0.1);
    }
    if (pillarRef.current) {
      pillarRef.current.scale.y = 1 + Math.sin(time * 3) * 0.2;
      pillarRef.current.material.opacity = 0.2 + Math.sin(time * 2) * 0.1;
    }

    // Report target to parent
    onTargetUpdate(targetPositionRef.current.clone(), isValid);
  });

  if (!isActive) return null;

  return (
    <group ref={indicatorRef}>
      {/* Ground ring */}
      <mesh ref={ringRef} rotation-x={-Math.PI / 2} position-y={0.1}>
        <ringGeometry args={[0.8, 1.2, 32]} />
        <meshBasicMaterial color={0xa855f7} transparent opacity={0.6} side={THREE.DoubleSide} />
      </mesh>

      {/* Inner circle */}
      <mesh rotation-x={-Math.PI / 2} position-y={0.05}>
        <circleGeometry args={[0.6, 32]} />
        <meshBasicMaterial color={0xa855f7} transparent opacity={0.3} side={THREE.DoubleSide} />
      </mesh>

      {/* Vertical pillar effect */}
      <mesh ref={pillarRef} position-y={1}>
        <cylinderGeometry args={[0.3, 0.5, 2, 16, 1, true]} />
        <primitive object={pillarMaterial} />
      </mesh>

      {/* Top marker */}
      <mesh position-y={2.2}>
        <octahedronGeometry args={[0.2]} />
        <meshBasicMaterial color={0xa855f7} transparent opacity={0.8} />
      </mesh>

      {/* Particle ring effect */}
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <mesh 
          key={i} 
          position={[
            Math.cos((i / 6) * Math.PI * 2) * 1,
            0.3 + Math.sin(Date.now() * 0.005 + i) * 0.2,
            Math.sin((i / 6) * Math.PI * 2) * 1
          ]}
        >
          <sphereGeometry args={[0.08, 8, 8]} />
          <meshBasicMaterial color={0xc084fc} transparent opacity={0.7} />
        </mesh>
      ))}
    </group>
  );
}


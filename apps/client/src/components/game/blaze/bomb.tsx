import { useEffect, useRef, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import React from 'react';
import {
  BLAZE_BOMB_AEGIS_COLLISION_RADIUS,
  BLAZE_BOMB_MAX_RANGE,
  BLAZE_BOMB_MIN_RANGE,
  BLAZE_BOMB_SPLASH_RADIUS,
  getBlazeMeteorPath,
} from '@voxel-strike/shared';
import { useGameStore, type BombData } from '../../../store/gameStore';
import { getFirstChronosAegisVisualHit } from '../chronos/aegisCollision';
import { checkGroundWithNormal, isPhysicsReady, raycastDirection } from '../../../hooks/usePhysics';
import { SHARED_GEOMETRIES } from '../effectResources';
import { BudgetedPointLight } from '../systems/DynamicLightBudget';
import { getFrameClock } from '../../../utils/frameClock';
import { measureFrameWork } from '../../../movement/networkDiagnostics';
import {
  getBombBodyMaterial,
  getBombBandMaterial,
  getBombNoseMaterial,
  getBombFinMaterial,
  getBombStripeMaterial,
  getBombTrailMaterial,
  getBombGlowMaterial,
  getWarningOuterRingMaterial,
  getWarningInnerRingMaterial,
  getWarningCenterRingMaterial,
  getWarningCrossMainMaterial,
  getWarningCrossDiagMaterial,
  getWarningPulseFillMaterial,
  getExplosionFlashMaterial,
  getExplosionWhiteMaterial,
  getExplosionYellowMaterial,
  getExplosionOrangeMaterial,
  getExplosionRedMaterial,
  getExplosionDarkRedMaterial,
  getExplosionSmokeDarkMaterial,
  getExplosionSmokeLightMaterial,
  getExplosionDebrisOrangeMaterial,
  getExplosionDebrisYellowMaterial,
  getShockwaveOuterMaterial,
  getShockwaveInnerMaterial,
  getTargetRing1Material,
  getTargetRing2Material,
  getTargetRing3Material,
  getTargetCenterMaterial,
  getTargetFillMaterial,
  getTargetCrossMaterial,
  getTargetBeamMaterial,
  getTargetBeamTopMaterial,
} from './materials';

// ============================================================================
// BLAZE METEOR STRIKE EFFECT - Enhanced Visuals
// ============================================================================

const EXPLOSION_DURATION = 1500; // Longer for more dramatic effect
const METEOR_TRAIL_BACK_OFFSET = 3.6;
const METEOR_WAKE_BACK_OFFSET = 7.5;
const METEOR_BODY_FORWARD = new THREE.Vector3(0, -1, 0);
const METEOR_TRAIL_FORWARD = new THREE.Vector3(0, 1, 0);

// Pre-generate debris directions
const METEOR_DEBRIS = Array.from({ length: 16 }, (_, i) => ({
  angle: (i / 16) * Math.PI * 2 + Math.random() * 0.3,
  speed: 8 + Math.random() * 12,
  ySpeed: 5 + Math.random() * 10,
  size: 0.08 + Math.random() * 0.12,
}));

interface BombEffectProps {
  bomb: BombData;
}

function sameOptionalVec3(
  a: { x: number; y: number; z: number } | undefined,
  b: { x: number; y: number; z: number } | undefined
): boolean {
  if (!a || !b) return a === b;
  return a.x === b.x && a.y === b.y && a.z === b.z;
}

export const BombEffect = React.memo(({ bomb }: BombEffectProps) => {
  const removeBomb = useGameStore(state => state.removeBomb);
  const bombRef = useRef<THREE.Group>(null);
  const trailRef = useRef<THREE.Mesh>(null);
  const wakeRef = useRef<THREE.Mesh>(null);
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
  const hasRemovedRef = useRef(false);
  const createdAtMs = Date.now();
  const createdFrameTimeMs = getFrameClock().nowMs;
  const warningStartFrameTimeRef = useRef(
    createdFrameTimeMs - (createdAtMs - (bomb.warningStartTime ?? bomb.startTime))
  );
  const startFrameTimeRef = useRef(createdFrameTimeMs - (createdAtMs - bomb.startTime));
  const impactFrameTimeRef = useRef(startFrameTimeRef.current + Math.max(0, bomb.impactTime - bomb.startTime));
  const fallDurationRef = useRef(Math.max(60, impactFrameTimeRef.current - startFrameTimeRef.current));
  const blastRadius = Math.max(0.1, bomb.radius || BLAZE_BOMB_SPLASH_RADIUS);
  const blastDiameter = blastRadius * 2;

  const meteorPath = useMemo(() => {
    const sharedPath = getBlazeMeteorPath({
      id: bomb.id,
      startPosition: bomb.startPosition,
      targetPosition: bomb.targetPosition,
    });
    const entryPosition = new THREE.Vector3(
      sharedPath.entryPosition.x,
      sharedPath.entryPosition.y,
      sharedPath.entryPosition.z
    );
    const groundImpactPosition = new THREE.Vector3(
      sharedPath.impactPosition.x,
      sharedPath.impactPosition.y,
      sharedPath.impactPosition.z
    );
    const hasServerInterceptionFlag = bomb.interceptedByChronosAegis !== undefined;
    const explicitShieldImpactPosition = bomb.interceptedByChronosAegis
      ? bomb.impactPosition ?? bomb.interceptPosition
      : undefined;
    const visualAegisHit = explicitShieldImpactPosition || hasServerInterceptionFlag
      ? null
      : getFirstChronosAegisVisualHit(
        sharedPath.entryPosition,
        sharedPath.travelDirection,
        sharedPath.distance,
        bomb.ownerTeam,
        bomb.ownerId,
        BLAZE_BOMB_AEGIS_COLLISION_RADIUS
      );
    const shieldImpactPosition = explicitShieldImpactPosition ?? visualAegisHit?.point;
    const intercepted = Boolean(shieldImpactPosition);
    const impactPosition = shieldImpactPosition
      ? new THREE.Vector3(
        shieldImpactPosition.x,
        shieldImpactPosition.y,
        shieldImpactPosition.z
      )
      : groundImpactPosition;
    const visualFallDurationMs = visualAegisHit
      ? Math.max(
        60,
        Math.round(
          Math.max(60, bomb.impactTime - bomb.startTime) *
          Math.sqrt(visualAegisHit.distance / Math.max(0.0001, sharedPath.distance))
        )
      )
      : Math.max(60, bomb.impactTime - bomb.startTime);
    impactFrameTimeRef.current = startFrameTimeRef.current + visualFallDurationMs;
    fallDurationRef.current = visualFallDurationMs;

    const travelDirection = impactPosition.clone().sub(entryPosition);
    if (travelDirection.lengthSq() < 0.0001) {
      travelDirection.set(
        sharedPath.travelDirection.x,
        sharedPath.travelDirection.y,
        sharedPath.travelDirection.z
      );
    }
    travelDirection.normalize();
    const trailDirection = travelDirection.clone().multiplyScalar(-1);
    const bodyQuaternion = new THREE.Quaternion().setFromUnitVectors(METEOR_BODY_FORWARD, travelDirection);
    const trailQuaternion = new THREE.Quaternion().setFromUnitVectors(METEOR_TRAIL_FORWARD, trailDirection);
    const flashPosition = intercepted
      ? impactPosition.clone()
      : new THREE.Vector3(bomb.targetPosition.x, bomb.targetPosition.y + 1, bomb.targetPosition.z);
    const explosionPosition = intercepted
      ? impactPosition.clone()
      : new THREE.Vector3(bomb.targetPosition.x, bomb.targetPosition.y + 1.5, bomb.targetPosition.z);
    const shockwavePosition = new THREE.Vector3(
      bomb.targetPosition.x,
      bomb.targetPosition.y + 0.2,
      bomb.targetPosition.z
    );
    const shockwave2Position = new THREE.Vector3(
      bomb.targetPosition.x,
      bomb.targetPosition.y + 0.25,
      bomb.targetPosition.z
    );

    return {
      impactPosition,
      entryPosition,
      travelDirection,
      bodyQuaternion,
      trailQuaternion,
      flashPosition,
      explosionPosition,
      shockwavePosition,
      shockwave2Position,
      intercepted,
    };
  }, [
    bomb.id,
    bomb.interceptPosition?.x,
    bomb.interceptPosition?.y,
    bomb.interceptPosition?.z,
    bomb.impactPosition?.x,
    bomb.impactPosition?.y,
    bomb.impactPosition?.z,
    bomb.interceptedByChronosAegis,
    bomb.impactTime,
    bomb.startPosition.x,
    bomb.startPosition.y,
    bomb.startPosition.z,
    bomb.targetPosition.x,
    bomb.targetPosition.y,
    bomb.targetPosition.z,
  ]);
  
  // Get pre-cached static materials (shared across all Meteor Strike instances)
  const staticMaterials = useMemo(() => ({
    bombBody: getBombBodyMaterial(),
    bombBand: getBombBandMaterial(),
    bombNose: getBombNoseMaterial(),
    bombFin: getBombFinMaterial(),
    bombStripe: getBombStripeMaterial(),
    bombTrail: getBombTrailMaterial(),
    bombGlow: getBombGlowMaterial(),
    warningOuterRing: getWarningOuterRingMaterial(),
    warningInnerRing: getWarningInnerRingMaterial(),
    warningCenterRing: getWarningCenterRingMaterial(),
    warningCrossMain: getWarningCrossMainMaterial(),
    warningCrossDiag: getWarningCrossDiagMaterial(),
  }), []);
  
  // Clone materials that need per-instance opacity animation
  // Cloning from pre-cached materials is instant since shaders are already compiled
  const animatedMaterials = useMemo(() => ({
    warningPulseFill: getWarningPulseFillMaterial().clone(),
    explosionFlash: getExplosionFlashMaterial().clone(),
    explosionWhite: getExplosionWhiteMaterial().clone(),
    explosionYellow: getExplosionYellowMaterial().clone(),
    explosionOrange: getExplosionOrangeMaterial().clone(),
    explosionRed: getExplosionRedMaterial().clone(),
    explosionDarkRed: getExplosionDarkRedMaterial().clone(),
    shockwaveOuter: getShockwaveOuterMaterial().clone(),
    shockwaveInner: getShockwaveInnerMaterial().clone(),
    // Smoke materials (5 smoke puffs)
    smoke: Array.from({ length: 5 }, (_, i) => 
      (i < 2 ? getExplosionSmokeLightMaterial() : getExplosionSmokeDarkMaterial()).clone()
    ),
    // Debris materials (16 debris pieces)
    debris: METEOR_DEBRIS.map((_, i) => 
      (i % 2 === 0 ? getExplosionDebrisOrangeMaterial() : getExplosionDebrisYellowMaterial()).clone()
    ),
  }), []);

  useEffect(() => () => {
    animatedMaterials.warningPulseFill.dispose();
    animatedMaterials.explosionFlash.dispose();
    animatedMaterials.explosionWhite.dispose();
    animatedMaterials.explosionYellow.dispose();
    animatedMaterials.explosionOrange.dispose();
    animatedMaterials.explosionRed.dispose();
    animatedMaterials.explosionDarkRed.dispose();
    animatedMaterials.shockwaveOuter.dispose();
    animatedMaterials.shockwaveInner.dispose();
    animatedMaterials.smoke.forEach((material) => material.dispose());
    animatedMaterials.debris.forEach((material) => material.dispose());
  }, [animatedMaterials]);
  
  useFrame(() => measureFrameWork('frame.effects.blazeBomb', () => {
    const now = getFrameClock().nowMs;
    const elapsed = now - startFrameTimeRef.current;
    const fallProgress = Math.max(0, Math.min(1, elapsed / fallDurationRef.current));
    const warningDuration = Math.max(60, impactFrameTimeRef.current - warningStartFrameTimeRef.current);
    const warningElapsed = now - warningStartFrameTimeRef.current;
    const warningProgress = Math.max(0, Math.min(1, warningElapsed / warningDuration));
    const meteorActive = elapsed >= 0 && fallProgress < 1;
    
    if (!hasExplodedRef.current && now < impactFrameTimeRef.current) {
      if (bombRef.current) {
        bombRef.current.visible = meteorActive;
        if (meteorActive) {
          const travelProgress = fallProgress * fallProgress;
          bombRef.current.position.lerpVectors(
            meteorPath.entryPosition,
            meteorPath.impactPosition,
            travelProgress
          );
          bombRef.current.quaternion.copy(meteorPath.bodyQuaternion);
          bombRef.current.rotateY(elapsed * 0.012);
        }
      }
      
      // Fire trail behind the meteor.
      if (trailRef.current && bombRef.current) {
        trailRef.current.visible = meteorActive;
        if (meteorActive) {
          trailRef.current.position.copy(bombRef.current.position);
          trailRef.current.position.addScaledVector(meteorPath.travelDirection, -METEOR_TRAIL_BACK_OFFSET);
          trailRef.current.quaternion.copy(meteorPath.trailQuaternion);
          const trailScale = 0.95 + Math.sin(elapsed * 0.05) * 0.16;
          trailRef.current.scale.set(0.95 * trailScale, 6.4 * trailScale, 0.95 * trailScale);
        }
      }

      if (wakeRef.current && bombRef.current) {
        wakeRef.current.visible = meteorActive;
        if (meteorActive) {
          wakeRef.current.position.copy(bombRef.current.position);
          wakeRef.current.position.addScaledVector(meteorPath.travelDirection, -METEOR_WAKE_BACK_OFFSET);
          wakeRef.current.quaternion.copy(meteorPath.trailQuaternion);
          const wakePulse = 0.85 + Math.sin(elapsed * 0.035) * 0.1;
          wakeRef.current.scale.set(0.18 * wakePulse, 9.2 * wakePulse, 0.18 * wakePulse);
        }
      }
      
      // Glow around meteor
      if (glowRef.current && bombRef.current) {
        glowRef.current.visible = meteorActive;
        if (meteorActive) {
          glowRef.current.position.copy(bombRef.current.position);
          const glowPulse = 1 + Math.sin(elapsed * 0.03) * 0.2;
          glowRef.current.quaternion.copy(meteorPath.bodyQuaternion);
          glowRef.current.scale.set(2.2 * glowPulse, 3.1 * glowPulse, 2.2 * glowPulse);
        }
      }
      
      if (warningRef.current) {
        warningRef.current.visible = true;
        const pulseSpeed = 0.012 + warningProgress * 0.032;
        const pulse = 0.9 + warningProgress * 0.05 + (Math.sin(warningElapsed * pulseSpeed) + 1) * 0.025;
        warningRef.current.rotation.y = warningElapsed * 0.0018;
        warningRef.current.scale.setScalar(pulse);
      }
      
      // Pulsing fill that intensifies
      if (warningPulseRef.current) {
        warningPulseRef.current.visible = true;
        const intensity = 0.12 + warningProgress * 0.34;
        const fillPulse = 0.82 + warningProgress * 0.12 + (Math.sin(warningElapsed * 0.022) + 1) * 0.03;
        warningPulseRef.current.scale.set(blastRadius * fillPulse, blastRadius * fillPulse, 1);
        animatedMaterials.warningPulseFill.opacity = intensity * (0.78 + Math.sin(warningElapsed * 0.022) * 0.22);
      }
      
      if (explosionRef.current) explosionRef.current.visible = false;
      if (flashRef.current) flashRef.current.visible = false;
      if (shockwaveRef.current) shockwaveRef.current.visible = false;
      if (shockwave2Ref.current) shockwave2Ref.current.visible = false;
    } else if (now >= impactFrameTimeRef.current && !hasExplodedRef.current) {
      hasExplodedRef.current = true;
    }
    
    if (hasExplodedRef.current) {
      if (bombRef.current) bombRef.current.visible = false;
      if (trailRef.current) trailRef.current.visible = false;
      if (wakeRef.current) wakeRef.current.visible = false;
      if (glowRef.current) glowRef.current.visible = false;
      if (warningRef.current) warningRef.current.visible = false;
      if (warningPulseRef.current) warningPulseRef.current.visible = false;
      
      const explosionElapsed = now - impactFrameTimeRef.current;
      const explosionProgress = Math.min(1, explosionElapsed / EXPLOSION_DURATION);
      
      if (explosionProgress < 1 && explosionRef.current) {
        explosionRef.current.visible = true;
        const easeOut = 1 - Math.pow(1 - explosionProgress, 2);
        const easeOutQuart = 1 - Math.pow(1 - explosionProgress, 4);
        const fadeOut = Math.max(0, 1 - explosionProgress * 1.1);
        const scale = 0.7 + easeOut * blastRadius * 0.9;
        explosionRef.current.scale.setScalar(scale);
        
        // Update explosion material opacities
        animatedMaterials.explosionWhite.opacity = fadeOut * 0.95;
        animatedMaterials.explosionYellow.opacity = fadeOut * 0.83;
        animatedMaterials.explosionOrange.opacity = fadeOut * 0.71;
        animatedMaterials.explosionRed.opacity = fadeOut * 0.59;
        animatedMaterials.explosionDarkRed.opacity = fadeOut * 0.47;
        
        // Initial flash
        if (flashRef.current) {
          const flashProgress = Math.min(1, explosionElapsed / 100);
          flashRef.current.visible = flashProgress < 1;
          flashRef.current.scale.setScalar(0.5 + flashProgress * blastRadius);
          animatedMaterials.explosionFlash.opacity = Math.max(0, 1 - flashProgress * 2);
        }
        
        // Shockwaves
        if (shockwaveRef.current) {
          shockwaveRef.current.visible = true;
          const s = blastRadius * THREE.MathUtils.lerp(0.15, 1, easeOutQuart);
          shockwaveRef.current.scale.set(s, s, 1);
          animatedMaterials.shockwaveOuter.opacity = fadeOut * 0.8;
        }
        if (shockwave2Ref.current) {
          shockwave2Ref.current.visible = true;
          const s = blastRadius * THREE.MathUtils.lerp(0.1, 0.72, easeOutQuart);
          shockwave2Ref.current.scale.set(s, s, 1);
          animatedMaterials.shockwaveInner.opacity = fadeOut * 0.5;
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
            animatedMaterials.smoke[i].opacity = Math.max(0, 0.6 - smokeProgress * 0.6);
          }
        });
        
        // Flying debris
        const t = explosionElapsed / 1000;
        debrisRefs.current.forEach((debris, i) => {
          if (debris && i < METEOR_DEBRIS.length) {
            const d = METEOR_DEBRIS[i];
            const dx = Math.cos(d.angle) * d.speed * t;
            const dy = d.ySpeed * t - 20 * t * t;
            const dz = Math.sin(d.angle) * d.speed * t;
            debris.position.set(dx, Math.max(-0.5, dy), dz);
            debris.scale.setScalar(d.size * fadeOut);
            animatedMaterials.debris[i].opacity = dy > 0 ? fadeOut : 0;
          }
        });
        
        if (lightRef.current) {
          lightRef.current.intensity = fadeOut * 60;
        }
      } else if (explosionProgress >= 1) {
        if (explosionRef.current) explosionRef.current.visible = false;
        if (shockwaveRef.current) shockwaveRef.current.visible = false;
        if (shockwave2Ref.current) shockwave2Ref.current.visible = false;
        if (!hasRemovedRef.current) {
          hasRemovedRef.current = true;
          removeBomb(bomb.id);
        }
      }
    }
  }));
  
  return (
    <group>
      {/* Falling meteor assembly */}
      <group ref={bombRef}>
        <mesh geometry={SHARED_GEOMETRIES.sphere8} scale={[1.15, 1.35, 0.95]} material={staticMaterials.bombBody} />
        <mesh position={[0.32, 0.04, 0.16]} geometry={SHARED_GEOMETRIES.sphere8} scale={[0.48, 0.7, 0.38]} material={staticMaterials.bombBand} />
        <mesh position={[-0.36, 0.2, -0.18]} geometry={SHARED_GEOMETRIES.sphere8} scale={[0.36, 0.52, 0.32]} material={staticMaterials.bombFin} />
        <mesh position={[0.1, -0.88, -0.04]} geometry={SHARED_GEOMETRIES.cone8} scale={[0.88, 0.78, 0.88]} material={staticMaterials.bombNose} />
        <mesh position={[0.22, -0.18, -0.34]} geometry={SHARED_GEOMETRIES.cylinder8} scale={[0.08, 0.82, 0.08]} rotation={[0.75, 0.25, 0.2]} material={staticMaterials.bombStripe} />
        <mesh position={[-0.34, 0.08, 0.24]} geometry={SHARED_GEOMETRIES.cylinder8} scale={[0.06, 0.64, 0.06]} rotation={[-0.55, 0.25, 0.7]} material={staticMaterials.bombStripe} />
        <BudgetedPointLight budgetPriority={1.5} color={0xff7a00} intensity={7} distance={18} decay={2} />
      </group>
      
      {/* Fire trail */}
      <mesh ref={trailRef} visible={false} geometry={SHARED_GEOMETRIES.cone8} material={staticMaterials.bombTrail} />
      <mesh ref={wakeRef} visible={false} geometry={SHARED_GEOMETRIES.cylinder8} material={staticMaterials.bombGlow} />
      
      {/* Glow around meteor */}
      <mesh ref={glowRef} visible={false} geometry={SHARED_GEOMETRIES.sphere8} material={staticMaterials.bombGlow} />
      
      {/* Warning zone */}
      <group ref={warningRef} position={[bomb.targetPosition.x, bomb.targetPosition.y + 0.15, bomb.targetPosition.z]}>
        {/* Outer danger ring */}
        <mesh rotation-x={-Math.PI / 2} geometry={SHARED_GEOMETRIES.ring24} scale={[blastRadius, blastRadius, 1]} material={staticMaterials.warningOuterRing} />
        {/* Inner ring */}
        <mesh rotation-x={-Math.PI / 2} geometry={SHARED_GEOMETRIES.ring16} scale={[blastRadius * 0.66, blastRadius * 0.66, 1]} material={staticMaterials.warningInnerRing} />
        {/* Center ring */}
        <mesh rotation-x={-Math.PI / 2} geometry={SHARED_GEOMETRIES.ring16} scale={[blastRadius * 0.33, blastRadius * 0.33, 1]} material={staticMaterials.warningCenterRing} />
        {/* Crosshairs */}
        <mesh rotation-x={-Math.PI / 2} geometry={SHARED_GEOMETRIES.plane} scale={[0.2, blastDiameter, 1]} material={staticMaterials.warningCrossMain} />
        <mesh rotation-x={-Math.PI / 2} rotation-z={Math.PI / 2} geometry={SHARED_GEOMETRIES.plane} scale={[0.2, blastDiameter, 1]} material={staticMaterials.warningCrossMain} />
        {/* Diagonal lines */}
        <mesh rotation-x={-Math.PI / 2} rotation-z={Math.PI / 4} geometry={SHARED_GEOMETRIES.plane} scale={[0.1, blastRadius * 1.4, 1]} material={staticMaterials.warningCrossDiag} />
        <mesh rotation-x={-Math.PI / 2} rotation-z={-Math.PI / 4} geometry={SHARED_GEOMETRIES.plane} scale={[0.1, blastRadius * 1.4, 1]} material={staticMaterials.warningCrossDiag} />
      </group>
      
      {/* Pulsing danger fill */}
      <mesh 
        ref={warningPulseRef}
        visible={false}
        position={[bomb.targetPosition.x, bomb.targetPosition.y + 0.08, bomb.targetPosition.z]}
        rotation-x={-Math.PI / 2} 
        geometry={SHARED_GEOMETRIES.circle16} 
        scale={[blastRadius, blastRadius, 1]}
        material={animatedMaterials.warningPulseFill}
      />
      
      {/* Initial flash */}
      <mesh 
        ref={flashRef}
        visible={false}
        position={meteorPath.flashPosition}
        geometry={SHARED_GEOMETRIES.sphere8}
        material={animatedMaterials.explosionFlash}
      />
      
      {/* Explosion group */}
      <group ref={explosionRef} visible={false} position={meteorPath.explosionPosition}>
        {/* White hot core */}
        <mesh geometry={SHARED_GEOMETRIES.sphere12} material={animatedMaterials.explosionWhite} />
        {/* Bright yellow */}
        <mesh geometry={SHARED_GEOMETRIES.sphere12} scale={1.2} material={animatedMaterials.explosionYellow} />
        {/* Orange fire */}
        <mesh geometry={SHARED_GEOMETRIES.sphere8} scale={1.4} material={animatedMaterials.explosionOrange} />
        {/* Red fire */}
        <mesh geometry={SHARED_GEOMETRIES.sphere8} scale={1.7} material={animatedMaterials.explosionRed} />
        {/* Dark red outer */}
        <mesh geometry={SHARED_GEOMETRIES.sphere8} scale={2.0} material={animatedMaterials.explosionDarkRed} />
        
        {/* Rising smoke column */}
        {[0, 1, 2, 3, 4].map(i => (
          <mesh 
            key={`smoke-${i}`}
            ref={el => smokeRefs.current[i] = el}
            geometry={SHARED_GEOMETRIES.sphere8}
            material={animatedMaterials.smoke[i]}
          />
        ))}
        
        {/* Flying debris */}
        {METEOR_DEBRIS.map((_, i) => (
          <mesh 
            key={`debris-${i}`}
            ref={el => debrisRefs.current[i] = el}
            geometry={SHARED_GEOMETRIES.sphere8}
            material={animatedMaterials.debris[i]}
          />
        ))}
        
        <BudgetedPointLight budgetPriority={8} ref={lightRef} color={0xff5500} intensity={60} distance={40} decay={2} />
      </group>
      
      {/* Ground shockwave */}
      {!meteorPath.intercepted && (
        <mesh
          ref={shockwaveRef}
          visible={false}
          position={meteorPath.shockwavePosition}
          rotation-x={-Math.PI / 2}
          geometry={SHARED_GEOMETRIES.ring24}
          material={animatedMaterials.shockwaveOuter}
        />
      )}
      
      {/* Secondary inner shockwave */}
      {!meteorPath.intercepted && (
        <mesh
          ref={shockwave2Ref}
          visible={false}
          position={meteorPath.shockwave2Position}
          rotation-x={-Math.PI / 2}
          geometry={SHARED_GEOMETRIES.ring16}
          material={animatedMaterials.shockwaveInner}
        />
      )}
    </group>
  );
}, (prev, next) => {
  // Custom comparison for object props
  return (
    prev.bomb.id === next.bomb.id &&
    prev.bomb.targetPosition.x === next.bomb.targetPosition.x &&
    prev.bomb.targetPosition.y === next.bomb.targetPosition.y &&
    prev.bomb.targetPosition.z === next.bomb.targetPosition.z &&
    sameOptionalVec3(prev.bomb.interceptPosition, next.bomb.interceptPosition) &&
    prev.bomb.warningStartTime === next.bomb.warningStartTime &&
    prev.bomb.startTime === next.bomb.startTime &&
    prev.bomb.hasExploded === next.bomb.hasExploded &&
    prev.bomb.impactTime === next.bomb.impactTime &&
    prev.bomb.radius === next.bomb.radius
  );
});

// ============================================================================
// METEOR STRIKE TARGETING INDICATOR - TRUE 3D RAYCASTING
// ============================================================================

interface BombTargetingIndicatorProps {
  isActive: boolean;
  showIndicator?: boolean;
  onTargetUpdate: (position: THREE.Vector3 | null, isValid: boolean) => void;
}

const BOMB_TARGET_SAMPLE_FACTORS = [0.5, 1, 1.5] as const;
const BOMB_TARGET_PHYSICS_SAMPLE_INTERVAL_MS = 34;

// Pre-allocated vectors for Meteor Strike targeting (local to avoid conflicts)
const _bombLookDir = new THREE.Vector3();
const _bombTargetPos = new THREE.Vector3();
const _bombHorizDir = new THREE.Vector3();

export function BombTargetingIndicator({ isActive, showIndicator = true, onTargetUpdate }: BombTargetingIndicatorProps) {
  const indicatorRef = useRef<THREE.Group>(null);
  const targetOuterRef = useRef<THREE.Mesh>(null);
  const targetMiddleRef = useRef<THREE.Mesh>(null);
  const targetInnerRef = useRef<THREE.Mesh>(null);
  const targetCenterRef = useRef<THREE.Mesh>(null);
  const targetFillRef = useRef<THREE.Mesh>(null);
  const targetBeamRef = useRef<THREE.Mesh>(null);
  const targetBeamTopRef = useRef<THREE.Mesh>(null);
  const isValidRef = useRef(false);
  const cachedTargetRef = useRef(new THREE.Vector3());
  const cachedTargetValidRef = useRef(false);
  const hasCachedTargetRef = useRef(false);
  const lastPhysicsSampleAtRef = useRef(Number.NEGATIVE_INFINITY);
  const reportedTargetRef = useRef(new THREE.Vector3());
  const lastReportedTargetRef = useRef(new THREE.Vector3(Number.POSITIVE_INFINITY, 0, 0));
  const lastReportedValidRef = useRef(false);
  const lastReportAtRef = useRef(0);
  const wasActiveRef = useRef(false);
  const { camera } = useThree();
  
  // Get pre-cached targeting materials (targeting indicator is only one at a time, so safe to share)
  const materials = useMemo(() => ({
    ring1: getTargetRing1Material(),
    ring2: getTargetRing2Material(),
    ring3: getTargetRing3Material(),
    center: getTargetCenterMaterial(),
    fill: getTargetFillMaterial(),
    cross: getTargetCrossMaterial(),
    beam: getTargetBeamMaterial(),
    beamTop: getTargetBeamTopMaterial(),
  }), []);
  
  useFrame(() => {
    const now = getFrameClock().nowMs;

    if (!isActive) {
      if (indicatorRef.current) indicatorRef.current.visible = false;
      if (wasActiveRef.current) {
        wasActiveRef.current = false;
        lastReportedTargetRef.current.set(Number.POSITIVE_INFINITY, 0, 0);
        lastReportedValidRef.current = false;
        hasCachedTargetRef.current = false;
        cachedTargetValidRef.current = false;
        lastPhysicsSampleAtRef.current = Number.NEGATIVE_INFINITY;
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
        hasCachedTargetRef.current = false;
        cachedTargetValidRef.current = false;
        lastReportAtRef.current = now;
        onTargetUpdate(null, false);
      }
      return;
    }

    let isValid = cachedTargetValidRef.current;

    if (!hasCachedTargetRef.current || now - lastPhysicsSampleAtRef.current >= BOMB_TARGET_PHYSICS_SAMPLE_INTERVAL_MS) {
      lastPhysicsSampleAtRef.current = now;
      _bombLookDir.set(0, 0, -1).applyQuaternion(camera.quaternion);

      let targetX = camera.position.x;
      let targetY = camera.position.y;
      let targetZ = camera.position.z;
      let foundTarget = false;
      isValid = false;

      if (isPhysicsReady()) {
        const directHit = raycastDirection(
          camera.position.x, camera.position.y, camera.position.z,
          _bombLookDir.x, _bombLookDir.y, _bombLookDir.z,
          BLAZE_BOMB_MAX_RANGE + 10,
          {
            priority: 'visual',
            feature: 'targeting:blazeBomb',
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
              feature: 'targeting:blazeBomb',
            });
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
          for (let sampleIndex = 0; sampleIndex < 4; sampleIndex++) {
            const dist = sampleIndex === 3
              ? BLAZE_BOMB_MAX_RANGE
              : baseDist * BOMB_TARGET_SAMPLE_FACTORS[sampleIndex];
            const sampleX = camera.position.x + _bombLookDir.x * dist;
            const sampleY = camera.position.y + _bombLookDir.y * dist;
            const sampleZ = camera.position.z + _bombLookDir.z * dist;

            const groundCheck = checkGroundWithNormal(sampleX, Math.max(sampleY + 50, camera.position.y + 50), sampleZ, 150, {
              priority: 'visual',
              feature: 'targeting:blazeBomb',
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
          const dy = targetY - localPlayer.position.y;
          const dz = targetZ - localPlayer.position.z;
          const dist3D = Math.sqrt(dx * dx + dy * dy + dz * dz);

          if (dist3D > BLAZE_BOMB_MAX_RANGE) {
            const scale = BLAZE_BOMB_MAX_RANGE / dist3D;
            targetX = localPlayer.position.x + dx * scale;
            targetY = localPlayer.position.y + dy * scale;
            targetZ = localPlayer.position.z + dz * scale;

            const groundCheck = checkGroundWithNormal(targetX, targetY + 30, targetZ, 100, {
              priority: 'visual',
              feature: 'targeting:blazeBomb',
            });
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

          if (foundTarget && finalDistH >= BLAZE_BOMB_MIN_RANGE) {
            isValid = true;
          }
        }

        if (!foundTarget) {
          const fallbackDist = 20;
          _bombHorizDir.set(_bombLookDir.x, 0, _bombLookDir.z).normalize();
          targetX = localPlayer.position.x + _bombHorizDir.x * fallbackDist;
          targetZ = localPlayer.position.z + _bombHorizDir.z * fallbackDist;

          const groundCheck = checkGroundWithNormal(targetX, localPlayer.position.y + 30, targetZ, 100, {
            priority: 'visual',
            feature: 'targeting:blazeBomb',
          });
          if (groundCheck?.isWalkable) {
            targetY = groundCheck.groundY + 0.1;
            isValid = Math.sqrt(
              (targetX - localPlayer.position.x) ** 2 +
              (targetZ - localPlayer.position.z) ** 2
            ) >= BLAZE_BOMB_MIN_RANGE;
          }
        }
      }

      cachedTargetRef.current.set(targetX, targetY, targetZ);
      cachedTargetValidRef.current = isValid;
      hasCachedTargetRef.current = true;
    }

    _bombTargetPos.copy(cachedTargetRef.current);
    isValidRef.current = isValid;
    
    if (indicatorRef.current) {
      indicatorRef.current.visible = true;
      indicatorRef.current.position.copy(_bombTargetPos);
    }

    const time = now * 0.001;
    const validity = isValid ? 1 : 0.45;
    const pulse = 0.96 + Math.sin(time * 5.4) * 0.04 * validity;
    const slowPulse = 0.93 + (Math.sin(time * 2.2) + 1) * 0.035 * validity;

    materials.ring1.opacity = 0.42 + validity * 0.32;
    materials.ring2.opacity = 0.46 + validity * 0.34;
    materials.ring3.opacity = 0.54 + validity * 0.36;
    materials.fill.opacity = 0.06 + validity * 0.12;
    materials.cross.opacity = 0.38 + validity * 0.28;
    materials.beam.opacity = 0.14 + validity * 0.2;
    materials.beamTop.opacity = 0.4 + validity * 0.35;

    if (targetOuterRef.current) {
      targetOuterRef.current.rotation.z = time * 0.75;
      targetOuterRef.current.scale.set(BLAZE_BOMB_SPLASH_RADIUS * pulse, BLAZE_BOMB_SPLASH_RADIUS * pulse, 1);
    }
    if (targetMiddleRef.current) {
      targetMiddleRef.current.rotation.z = -time * 1.1;
      const radius = BLAZE_BOMB_SPLASH_RADIUS * 0.66 * slowPulse;
      targetMiddleRef.current.scale.set(radius, radius, 1);
    }
    if (targetInnerRef.current) {
      targetInnerRef.current.rotation.z = time * 1.8;
      const radius = BLAZE_BOMB_SPLASH_RADIUS * 0.33 * pulse;
      targetInnerRef.current.scale.set(radius, radius, 1);
    }
    if (targetCenterRef.current) {
      targetCenterRef.current.scale.setScalar(0.42 + validity * 0.18 + Math.sin(time * 7) * 0.04);
    }
    if (targetFillRef.current) {
      const fillScale = BLAZE_BOMB_SPLASH_RADIUS * (0.9 + Math.sin(time * 3.4) * 0.04 * validity);
      targetFillRef.current.scale.set(fillScale, fillScale, 1);
    }
    if (targetBeamRef.current) {
      const beamWidth = 0.045 + validity * 0.025 + Math.sin(time * 8) * 0.006;
      targetBeamRef.current.scale.set(beamWidth, 34 + Math.sin(time * 3) * 2.5 * validity, beamWidth);
    }
    if (targetBeamTopRef.current) {
      targetBeamTopRef.current.scale.setScalar(0.28 + validity * 0.18 + Math.sin(time * 6) * 0.025);
    }
    
    const targetMoved = lastReportedTargetRef.current.distanceToSquared(_bombTargetPos) > 0.04;
    const validityChanged = lastReportedValidRef.current !== isValid;
    const cadenceElapsed = now - lastReportAtRef.current >= 100;

    if (targetMoved || validityChanged || cadenceElapsed) {
      reportedTargetRef.current.copy(_bombTargetPos);
      lastReportedTargetRef.current.copy(_bombTargetPos);
      lastReportedValidRef.current = isValid;
      lastReportAtRef.current = now;
      onTargetUpdate(reportedTargetRef.current, isValid);
    }
  });
  
  if (!isActive || !showIndicator) return null;
  
  return (
    <group ref={indicatorRef}>
      <mesh ref={targetOuterRef} rotation-x={-Math.PI / 2} position-y={0.1} geometry={SHARED_GEOMETRIES.ring24} scale={[BLAZE_BOMB_SPLASH_RADIUS, BLAZE_BOMB_SPLASH_RADIUS, 1]} material={materials.ring1} />
      <mesh ref={targetMiddleRef} rotation-x={-Math.PI / 2} position-y={0.15} geometry={SHARED_GEOMETRIES.ring16} scale={[BLAZE_BOMB_SPLASH_RADIUS * 0.66, BLAZE_BOMB_SPLASH_RADIUS * 0.66, 1]} material={materials.ring2} />
      <mesh ref={targetInnerRef} rotation-x={-Math.PI / 2} position-y={0.2} geometry={SHARED_GEOMETRIES.ring16} scale={[BLAZE_BOMB_SPLASH_RADIUS * 0.33, BLAZE_BOMB_SPLASH_RADIUS * 0.33, 1]} material={materials.ring3} />
      <mesh ref={targetCenterRef} rotation-x={-Math.PI / 2} position-y={0.25} geometry={SHARED_GEOMETRIES.circle16} scale={[0.5, 0.5, 1]} material={materials.center} />
      <mesh ref={targetFillRef} rotation-x={-Math.PI / 2} position-y={0.05} geometry={SHARED_GEOMETRIES.circle16} scale={[BLAZE_BOMB_SPLASH_RADIUS, BLAZE_BOMB_SPLASH_RADIUS, 1]} material={materials.fill} />
      <mesh rotation-x={-Math.PI / 2} position-y={0.15} geometry={SHARED_GEOMETRIES.plane} scale={[0.12, BLAZE_BOMB_SPLASH_RADIUS * 2, 1]} material={materials.cross} />
      <mesh rotation-x={-Math.PI / 2} rotation-z={Math.PI / 2} position-y={0.15} geometry={SHARED_GEOMETRIES.plane} scale={[0.12, BLAZE_BOMB_SPLASH_RADIUS * 2, 1]} material={materials.cross} />
      <mesh ref={targetBeamRef} position-y={20} geometry={SHARED_GEOMETRIES.cylinder8} scale={[0.06, 40, 0.06]} material={materials.beam} />
      <mesh ref={targetBeamTopRef} position-y={42} geometry={SHARED_GEOMETRIES.sphere8} scale={0.4} material={materials.beamTop} />
      <BudgetedPointLight budgetPriority={2} color={0xff4400} intensity={2} distance={6} decay={2} position-y={0.5} />
    </group>
  );
}

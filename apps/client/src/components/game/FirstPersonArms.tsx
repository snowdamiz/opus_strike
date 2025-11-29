import { useRef, useMemo, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useGameStore } from '../../store/gameStore';

// ============================================================================
// FIRST PERSON ARMS - PHANTOM
// Ethereal, void-touched arms with mystical energy effects
// ============================================================================

// Shared geometries for performance
const ARM_GEOMETRIES = {
  // Upper arm - thicker, connects to shoulder
  upperArm: new THREE.BoxGeometry(0.065, 0.065, 0.18),
  // Elbow joint
  elbow: new THREE.SphereGeometry(0.038, 8, 8),
  // Forearm - slightly thinner
  forearm: new THREE.BoxGeometry(0.055, 0.055, 0.2),
  // Wrist
  wrist: new THREE.BoxGeometry(0.05, 0.035, 0.05),
  // Hand/palm - flat and wide
  hand: new THREE.BoxGeometry(0.08, 0.022, 0.09),
  // Fingers - longer and thinner
  finger: new THREE.BoxGeometry(0.016, 0.016, 0.07),
  fingerTip: new THREE.BoxGeometry(0.014, 0.014, 0.035),
  // Thumb - thicker
  thumb: new THREE.BoxGeometry(0.02, 0.02, 0.05),
  thumbTip: new THREE.BoxGeometry(0.018, 0.018, 0.03),
  // Wrappings/bands
  band: new THREE.BoxGeometry(0.07, 0.07, 0.02),
  bandForearm: new THREE.BoxGeometry(0.06, 0.06, 0.018),
  // Energy orb for palm
  orb: new THREE.SphereGeometry(0.025, 8, 8),
  // Energy particles - much smaller
  particle: new THREE.SphereGeometry(0.004, 4, 4),
  // Blink flash effect
  blinkFlash: new THREE.SphereGeometry(0.12, 12, 12),
};

// Effect durations
const BLINK_EFFECT_DURATION = 400; // ms
const FIRE_EFFECT_DURATION = 200; // ms
const SHADOWSTEP_EFFECT_DURATION = 800; // ms

interface PhantomArmsProps {
  isActive: boolean;
}

export function PhantomFirstPersonArms({ isActive }: PhantomArmsProps) {
  const { camera } = useThree();
  const groupRef = useRef<THREE.Group>(null);
  const leftArmRef = useRef<THREE.Group>(null);
  const rightArmRef = useRef<THREE.Group>(null);
  const leftOrbRef = useRef<THREE.Mesh>(null);
  const rightOrbRef = useRef<THREE.Mesh>(null);
  const particleRefs = useRef<(THREE.Mesh | null)[]>([]);
  const leftBlinkFlashRef = useRef<THREE.Mesh>(null);
  const rightBlinkFlashRef = useRef<THREE.Mesh>(null);
  const leftLightRef = useRef<THREE.PointLight>(null);
  const rightLightRef = useRef<THREE.PointLight>(null);
  
  // Animation state
  const timeRef = useRef(0);
  const lastVelocityRef = useRef({ x: 0, z: 0 });
  const bobPhaseRef = useRef(0);
  const swayRef = useRef({ x: 0, y: 0 });
  
  // Ability effect state
  const blinkEffectTimeRef = useRef(0);
  const fireEffectTimeRef = useRef(0);
  const lastFireSideRef = useRef<'left' | 'right'>('right');
  const shadowStepTimeRef = useRef(0);
  const lastBlinkCooldownRef = useRef<number>(0);
  const lastFireTimeRef = useRef(0);
  
  // Get game state for effects
  const localPlayer = useGameStore(state => state.localPlayer);
  const ultimateEffectActive = useGameStore(state => state.ultimateEffectActive);
  const ultimateEffectType = useGameStore(state => state.ultimateEffectType);
  const clientCooldowns = useGameStore(state => state.clientCooldowns);
  const shadowStepTargeting = useGameStore(state => state.shadowStepTargeting);
  const direBalls = useGameStore(state => state.direBalls);
  
  // Detect blink usage by watching cooldown changes
  useEffect(() => {
    const blinkCooldown = clientCooldowns['phantom_blink'];
    if (blinkCooldown && blinkCooldown > lastBlinkCooldownRef.current) {
      // Blink was just used!
      blinkEffectTimeRef.current = Date.now();
    }
    lastBlinkCooldownRef.current = blinkCooldown || 0;
  }, [clientCooldowns]);
  
  // Detect dire ball fire by watching direBalls changes
  useEffect(() => {
    if (direBalls.length > 0) {
      const latestBall = direBalls[direBalls.length - 1];
      if (latestBall.startTime > lastFireTimeRef.current) {
        // New dire ball was fired!
        fireEffectTimeRef.current = Date.now();
        lastFireSideRef.current = lastFireSideRef.current === 'left' ? 'right' : 'left';
        lastFireTimeRef.current = latestBall.startTime;
      }
    }
  }, [direBalls]);
  
  // Detect shadow step
  useEffect(() => {
    if (shadowStepTargeting) {
      shadowStepTimeRef.current = Date.now();
    }
  }, [shadowStepTargeting]);
  
  // Phantom color palette
  const colors = useMemo(() => ({
    skin: new THREE.Color(0x2a1a3a), // Deep purple-tinted skin
    skinHighlight: new THREE.Color(0x3d2850),
    wrapping: new THREE.Color(0x1a0a25), // Dark void wrappings
    wrappingGlow: new THREE.Color(0x7c3aed), // Purple glow
    energy: new THREE.Color(0x9333ea), // Bright purple energy
    energyCore: new THREE.Color(0xc084fc), // Light purple core
    veilActive: new THREE.Color(0x00ffff), // Cyan when veil is active
  }), []);
  
  // Materials (created once)
  const materials = useMemo(() => ({
    skin: new THREE.MeshStandardMaterial({
      color: colors.skin,
      roughness: 0.7,
      metalness: 0.1,
    }),
    skinHighlight: new THREE.MeshStandardMaterial({
      color: colors.skinHighlight,
      roughness: 0.6,
      metalness: 0.15,
    }),
    wrapping: new THREE.MeshStandardMaterial({
      color: colors.wrapping,
      roughness: 0.4,
      metalness: 0.3,
    }),
    wrappingGlow: new THREE.MeshStandardMaterial({
      color: colors.wrappingGlow,
      emissive: colors.wrappingGlow,
      emissiveIntensity: 0.5,
      roughness: 0.3,
      metalness: 0.5,
    }),
    energy: new THREE.MeshBasicMaterial({
      color: colors.energy,
      transparent: true,
      opacity: 0.8,
    }),
    energyCore: new THREE.MeshBasicMaterial({
      color: colors.energyCore,
      transparent: true,
      opacity: 0.9,
    }),
  }), [colors]);
  
  // Generate particle data - using golden ratio for even distribution and seamless looping
  const particleData = useMemo(() => {
    const goldenRatio = 1.618033988749895;
    return Array.from({ length: 16 }, (_, i) => {
      // Use golden ratio to distribute particles evenly in phase
      const basePhase = (i * goldenRatio * Math.PI * 2) % (Math.PI * 2);
      return {
        side: i < 8 ? 'left' : 'right',
        // Tighter clustering around hands
        baseRadius: 0.03 + (i % 4) * 0.015,
        heightOffset: -0.35 + (i % 3) * 0.08, // Around hand area
        depthOffset: -0.4 - (i % 2) * 0.05,
        speed: 0.3 + (i % 3) * 0.1, // Varied but slow speeds
        phase: basePhase,
        orbitTilt: ((i % 4) - 1.5) * 0.3, // Varied orbit tilts
      };
    });
  }, []);

  useFrame((state, delta) => {
    if (!isActive || !groupRef.current || !localPlayer) return;
    
    timeRef.current += delta;
    const time = timeRef.current;
    const now = Date.now();
    
    // Calculate ability effect progress
    const blinkProgress = blinkEffectTimeRef.current > 0 
      ? Math.min(1, (now - blinkEffectTimeRef.current) / BLINK_EFFECT_DURATION) 
      : 1;
    const isBlinking = blinkProgress < 1;
    
    const fireProgress = fireEffectTimeRef.current > 0
      ? Math.min(1, (now - fireEffectTimeRef.current) / FIRE_EFFECT_DURATION)
      : 1;
    const isFiring = fireProgress < 1;
    
    const shadowProgress = shadowStepTimeRef.current > 0
      ? Math.min(1, (now - shadowStepTimeRef.current) / SHADOWSTEP_EFFECT_DURATION)
      : 1;
    const isShadowStepping = shadowStepTargeting || shadowProgress < 1;
    
    // Get player velocity for animation
    const velocityX = localPlayer.velocity?.x ?? 0;
    const velocityZ = localPlayer.velocity?.z ?? 0;
    const horizontalSpeed = Math.sqrt(velocityX * velocityX + velocityZ * velocityZ);
    const isMoving = horizontalSpeed > 0.5;
    const isRunning = horizontalSpeed > 5;
    
    // Smooth velocity for sway calculation
    lastVelocityRef.current.x += (velocityX - lastVelocityRef.current.x) * 5 * delta;
    lastVelocityRef.current.z += (velocityZ - lastVelocityRef.current.z) * 5 * delta;
    
    // Bob animation when moving - MUCH slower and subtler
    if (isMoving) {
      const bobSpeed = isRunning ? 4 : 2.5; // Reduced from 12/8
      bobPhaseRef.current += delta * bobSpeed;
    } else {
      // Gentle idle sway - very slow breathing motion
      bobPhaseRef.current += delta * 0.5; // Reduced from 1.5
    }
    
    // Calculate bob offset - subtler movement
    const bobAmount = isMoving ? (isRunning ? 0.008 : 0.004) : 0.002; // Reduced amounts
    const bobX = Math.sin(bobPhaseRef.current) * bobAmount * 0.3;
    const bobY = Math.abs(Math.sin(bobPhaseRef.current * 2)) * bobAmount * 0.5;
    
    // Calculate sway from mouse movement (velocity-based approximation) - subtle
    const targetSwayX = -lastVelocityRef.current.x * 0.001;
    const targetSwayY = -lastVelocityRef.current.z * 0.001;
    swayRef.current.x += (targetSwayX - swayRef.current.x) * 2 * delta;
    swayRef.current.y += (targetSwayY - swayRef.current.y) * 2 * delta;
    
    // Clamp sway - smaller range
    swayRef.current.x = Math.max(-0.015, Math.min(0.015, swayRef.current.x));
    swayRef.current.y = Math.max(-0.015, Math.min(0.015, swayRef.current.y));
    
    // Position arms relative to camera
    // Copy camera world position and rotation
    groupRef.current.position.copy(camera.position);
    groupRef.current.quaternion.copy(camera.quaternion);
    
    // Fire animation - thrust arm forward
    const fireThrust = isFiring ? Math.sin(fireProgress * Math.PI) * 0.1 : 0;
    const leftFireThrust = lastFireSideRef.current === 'left' ? fireThrust : 0;
    const rightFireThrust = lastFireSideRef.current === 'right' ? fireThrust : 0;
    
    // Blink effect - arms pull back then snap forward
    const blinkOffset = isBlinking 
      ? (blinkProgress < 0.3 
        ? -0.1 * (blinkProgress / 0.3) 
        : 0.05 * (1 - (blinkProgress - 0.3) / 0.7))
      : 0;
    
    // Shadow step effect - arms become ghostly and ethereal
    const shadowAlpha = isShadowStepping 
      ? 0.5 + Math.sin(time * 15) * 0.2 
      : 1;
    
    // Apply bob and sway to arms - positioned for bent arm FPS view
    if (leftArmRef.current) {
      leftArmRef.current.position.x = -0.22 + bobX * 0.5 + swayRef.current.x;
      leftArmRef.current.position.y = -0.18 + bobY + swayRef.current.y;
      leftArmRef.current.position.z = -0.15 - leftFireThrust * 0.5 + blinkOffset * 0.5;
      
      // Subtle rotation based on movement + fire animation
      const fireRotation = lastFireSideRef.current === 'left' && isFiring 
        ? -Math.sin(fireProgress * Math.PI) * 0.1 
        : 0;
      // Very subtle bob rotation
      const bobRotation = Math.sin(bobPhaseRef.current) * 0.008;
      leftArmRef.current.rotation.x = bobRotation + fireRotation;
      leftArmRef.current.rotation.z = bobX * 0.3;
    }
    
    if (rightArmRef.current) {
      rightArmRef.current.position.x = 0.22 - bobX * 0.5 + swayRef.current.x;
      rightArmRef.current.position.y = -0.18 + bobY + swayRef.current.y;
      rightArmRef.current.position.z = -0.15 - rightFireThrust * 0.5 + blinkOffset * 0.5;
      
      // Mirror rotation + fire animation
      const fireRotation = lastFireSideRef.current === 'right' && isFiring 
        ? -Math.sin(fireProgress * Math.PI) * 0.1 
        : 0;
      const bobRotation = -Math.sin(bobPhaseRef.current) * 0.008;
      rightArmRef.current.rotation.x = bobRotation + fireRotation;
      rightArmRef.current.rotation.z = -bobX * 0.3;
    }
    
    // Animate energy orbs
    const isVeilActive = ultimateEffectActive && ultimateEffectType === 'phantom_veil';
    const orbPulse = 0.8 + Math.sin(time * 4) * 0.2;
    const baseOrbColor = isVeilActive ? colors.veilActive : colors.energy;
    // Flash bright during blink
    const orbColor = isBlinking 
      ? new THREE.Color(0xffffff).lerp(baseOrbColor, blinkProgress)
      : baseOrbColor;
    
    if (leftOrbRef.current) {
      const orbScale = orbPulse * (isVeilActive ? 1.5 : 1) * (isBlinking ? 1.5 - blinkProgress * 0.5 : 1);
      leftOrbRef.current.scale.setScalar(orbScale);
      (leftOrbRef.current.material as THREE.MeshBasicMaterial).color = orbColor;
      (leftOrbRef.current.material as THREE.MeshBasicMaterial).opacity = 
        (0.7 + Math.sin(time * 5) * 0.2) * shadowAlpha;
    }
    
    if (rightOrbRef.current) {
      const orbScale = orbPulse * (isVeilActive ? 1.5 : 1) * (isBlinking ? 1.5 - blinkProgress * 0.5 : 1);
      rightOrbRef.current.scale.setScalar(orbScale);
      (rightOrbRef.current.material as THREE.MeshBasicMaterial).color = orbColor;
      (rightOrbRef.current.material as THREE.MeshBasicMaterial).opacity = 
        (0.7 + Math.cos(time * 5) * 0.2) * shadowAlpha;
    }
    
    // Animate blink flash effects
    if (leftBlinkFlashRef.current) {
      leftBlinkFlashRef.current.visible = isBlinking && blinkProgress < 0.5;
      if (leftBlinkFlashRef.current.visible) {
        const flashScale = (1 - blinkProgress * 2) * 2;
        leftBlinkFlashRef.current.scale.setScalar(flashScale);
        (leftBlinkFlashRef.current.material as THREE.MeshBasicMaterial).opacity = 1 - blinkProgress * 2;
      }
    }
    
    if (rightBlinkFlashRef.current) {
      rightBlinkFlashRef.current.visible = isBlinking && blinkProgress < 0.5;
      if (rightBlinkFlashRef.current.visible) {
        const flashScale = (1 - blinkProgress * 2) * 2;
        rightBlinkFlashRef.current.scale.setScalar(flashScale);
        (rightBlinkFlashRef.current.material as THREE.MeshBasicMaterial).opacity = 1 - blinkProgress * 2;
      }
    }
    
    // Update arm lights based on effects
    const baseLightIntensity = 0.3;
    const blinkLightBoost = isBlinking ? (1 - blinkProgress) * 2 : 0;
    const veilLightBoost = isVeilActive ? 0.5 : 0;
    const fireLightBoost = isFiring ? (1 - fireProgress) * 0.5 : 0;
    
    if (leftLightRef.current) {
      leftLightRef.current.intensity = baseLightIntensity + blinkLightBoost + veilLightBoost + 
        (lastFireSideRef.current === 'left' ? fireLightBoost : 0);
      leftLightRef.current.color = isVeilActive ? colors.veilActive : 
        (isBlinking ? new THREE.Color(0xc084fc) : colors.energy);
    }
    
    if (rightLightRef.current) {
      rightLightRef.current.intensity = baseLightIntensity + blinkLightBoost + veilLightBoost +
        (lastFireSideRef.current === 'right' ? fireLightBoost : 0);
      rightLightRef.current.color = isVeilActive ? colors.veilActive : 
        (isBlinking ? new THREE.Color(0xc084fc) : colors.energy);
    }
    
    // Animate floating particles - seamless looping with no visible resets
    particleRefs.current.forEach((particle, i) => {
      if (particle && i < particleData.length) {
        const data = particleData[i];
        const isLeft = data.side === 'left';
        
        // Continuous smooth orbit using time - no resets
        const speedMultiplier = isBlinking ? 2 : 1;
        const orbitAngle = time * data.speed * speedMultiplier + data.phase;
        
        // Smooth radius variation using sin - continuous
        const radiusVariation = Math.sin(orbitAngle * 0.7) * 0.01;
        const currentRadius = data.baseRadius + radiusVariation;
        
        // Gentle vertical float - continuous sine wave
        const floatY = Math.sin(orbitAngle * 0.5 + data.phase) * 0.015;
        
        // Calculate position relative to hand
        const handX = isLeft ? -0.25 : 0.25;
        const orbitX = Math.cos(orbitAngle + data.orbitTilt) * currentRadius;
        const orbitZ = Math.sin(orbitAngle) * currentRadius * 0.6;
        
        particle.position.set(
          handX + orbitX * (isLeft ? 1 : -1),
          data.heightOffset + floatY,
          data.depthOffset + orbitZ
        );
        
        // Smooth opacity pulsing - never fully disappears
        const basePulse = 0.4 + Math.sin(orbitAngle * 0.3 + i * 0.5) * 0.2;
        const particleOpacity = basePulse * shadowAlpha * (isVeilActive ? 1.2 : 1) * 
          (isBlinking ? 1.3 : 1);
        (particle.material as THREE.MeshBasicMaterial).opacity = Math.min(0.8, Math.max(0.2, particleOpacity));
        (particle.material as THREE.MeshBasicMaterial).color = orbColor;
        
        // Subtle scale variation
        const scaleVariation = 0.8 + Math.sin(orbitAngle * 0.4 + i) * 0.2;
        particle.scale.setScalar(scaleVariation * (isBlinking ? 1.2 : 1));
      }
    });
    
    // Update materials for effects
    if (isVeilActive) {
      materials.wrappingGlow.emissive = colors.veilActive;
      materials.wrappingGlow.emissiveIntensity = 0.8 + Math.sin(time * 6) * 0.3;
      materials.skin.opacity = shadowAlpha;
      materials.skinHighlight.opacity = shadowAlpha;
    } else if (isBlinking) {
      materials.wrappingGlow.emissive = new THREE.Color(0xc084fc);
      materials.wrappingGlow.emissiveIntensity = 1.5 * (1 - blinkProgress);
    } else {
      materials.wrappingGlow.emissive = colors.wrappingGlow;
      materials.wrappingGlow.emissiveIntensity = 0.5 + Math.sin(time * 3) * 0.2;
    }
    
    // Shadow step ghostly effect
    if (isShadowStepping) {
      materials.skin.transparent = true;
      materials.skin.opacity = shadowAlpha;
      materials.skinHighlight.transparent = true;
      materials.skinHighlight.opacity = shadowAlpha;
    } else {
      materials.skin.transparent = false;
      materials.skin.opacity = 1;
      materials.skinHighlight.transparent = false;
      materials.skinHighlight.opacity = 1;
    }
  });
  
  if (!isActive) return null;
  
  return (
    <group ref={groupRef}>
      {/* LEFT ARM - Proper arm structure with elbow bend */}
      <group ref={leftArmRef}>
        {/* Upper arm - angled down and inward from shoulder */}
        <group position={[0.12, 0.05, 0.05]} rotation={[0.6, 0.3, 0.2]}>
          <mesh geometry={ARM_GEOMETRIES.upperArm} material={materials.skin} />
          {/* Upper arm band */}
          <mesh position={[0, 0, 0.06]} geometry={ARM_GEOMETRIES.band} material={materials.wrappingGlow} />
          
          {/* ELBOW JOINT - positioned at end of upper arm, creates the bend */}
          <group position={[0, 0, -0.1]} rotation={[-1.2, 0.1, -0.1]}>
            <mesh geometry={ARM_GEOMETRIES.elbow} material={materials.wrapping} />
            
            {/* FOREARM - extends from elbow forward/down toward view */}
            <group position={[0, 0, -0.03]} rotation={[0.2, 0, 0]}>
              <mesh position={[0, 0, -0.1]} geometry={ARM_GEOMETRIES.forearm} material={materials.skinHighlight} />
              {/* Forearm wrapping bands */}
              <mesh position={[0, 0, -0.02]} geometry={ARM_GEOMETRIES.bandForearm} material={materials.wrapping} />
              <mesh position={[0, 0, -0.16]} geometry={ARM_GEOMETRIES.bandForearm} material={materials.wrappingGlow} />
              
              {/* WRIST */}
              <mesh position={[0, 0, -0.22]} geometry={ARM_GEOMETRIES.wrist} material={materials.skin} />
              
              {/* HAND - slightly rotated for natural pose */}
              <group position={[0, 0.01, -0.27]} rotation={[-0.2, 0.05, 0.05]}>
                <mesh geometry={ARM_GEOMETRIES.hand} material={materials.skin} />
                
                {/* FINGERS - extending forward */}
                {/* Index finger */}
                <group position={[-0.025, 0.005, -0.065]}>
                  <mesh geometry={ARM_GEOMETRIES.finger} material={materials.skin} />
                  <mesh position={[0, 0, -0.05]} geometry={ARM_GEOMETRIES.fingerTip} material={materials.skinHighlight} />
                </group>
                {/* Middle finger - slightly longer */}
                <group position={[-0.008, 0.005, -0.07]}>
                  <mesh geometry={ARM_GEOMETRIES.finger} material={materials.skin} />
                  <mesh position={[0, 0, -0.05]} geometry={ARM_GEOMETRIES.fingerTip} material={materials.skinHighlight} />
                </group>
                {/* Ring finger */}
                <group position={[0.008, 0.005, -0.065]}>
                  <mesh geometry={ARM_GEOMETRIES.finger} material={materials.skin} />
                  <mesh position={[0, 0, -0.05]} geometry={ARM_GEOMETRIES.fingerTip} material={materials.skinHighlight} />
                </group>
                {/* Pinky finger - shorter */}
                <group position={[0.024, 0.005, -0.055]} rotation={[0, 0.1, 0]}>
                  <mesh scale={[0.85, 0.85, 0.8]} geometry={ARM_GEOMETRIES.finger} material={materials.skin} />
                  <mesh position={[0, 0, -0.04]} scale={[0.8, 0.8, 0.8]} geometry={ARM_GEOMETRIES.fingerTip} material={materials.skinHighlight} />
                </group>
                
                {/* Thumb - on outer side */}
                <group position={[-0.05, 0.01, -0.01]} rotation={[0.4, -0.7, -0.3]}>
                  <mesh geometry={ARM_GEOMETRIES.thumb} material={materials.skin} />
                  <mesh position={[0, 0, -0.035]} geometry={ARM_GEOMETRIES.thumbTip} material={materials.skinHighlight} />
                </group>
                
                {/* Palm energy orb */}
                <mesh 
                  ref={leftOrbRef}
                  position={[0, 0.035, -0.03]}
                  geometry={ARM_GEOMETRIES.orb}
                  material={materials.energy}
                />
              </group>
            </group>
          </group>
        </group>
        
        {/* Floating particles - positioned in world space relative to arm group */}
        {particleData.slice(0, 8).map((_, i) => (
          <mesh
            key={`left-particle-${i}`}
            ref={el => particleRefs.current[i] = el}
            geometry={ARM_GEOMETRIES.particle}
            material={materials.energyCore.clone()}
          />
        ))}
      </group>
      
      {/* RIGHT ARM - Mirror with elbow bend */}
      <group ref={rightArmRef}>
        {/* Upper arm - angled down and inward from shoulder */}
        <group position={[-0.12, 0.05, 0.05]} rotation={[0.6, -0.3, -0.2]}>
          <mesh geometry={ARM_GEOMETRIES.upperArm} material={materials.skin} />
          {/* Upper arm band */}
          <mesh position={[0, 0, 0.06]} geometry={ARM_GEOMETRIES.band} material={materials.wrappingGlow} />
          
          {/* ELBOW JOINT - positioned at end of upper arm, creates the bend */}
          <group position={[0, 0, -0.1]} rotation={[-1.2, -0.1, 0.1]}>
            <mesh geometry={ARM_GEOMETRIES.elbow} material={materials.wrapping} />
            
            {/* FOREARM - extends from elbow forward/down toward view */}
            <group position={[0, 0, -0.03]} rotation={[0.2, 0, 0]}>
              <mesh position={[0, 0, -0.1]} geometry={ARM_GEOMETRIES.forearm} material={materials.skinHighlight} />
              {/* Forearm wrapping bands */}
              <mesh position={[0, 0, -0.02]} geometry={ARM_GEOMETRIES.bandForearm} material={materials.wrapping} />
              <mesh position={[0, 0, -0.16]} geometry={ARM_GEOMETRIES.bandForearm} material={materials.wrappingGlow} />
              
              {/* WRIST */}
              <mesh position={[0, 0, -0.22]} geometry={ARM_GEOMETRIES.wrist} material={materials.skin} />
              
              {/* HAND - slightly rotated for natural pose */}
              <group position={[0, 0.01, -0.27]} rotation={[-0.2, -0.05, -0.05]}>
                <mesh geometry={ARM_GEOMETRIES.hand} material={materials.skin} />
                
                {/* FINGERS - extending forward */}
                {/* Index finger */}
                <group position={[0.025, 0.005, -0.065]}>
                  <mesh geometry={ARM_GEOMETRIES.finger} material={materials.skin} />
                  <mesh position={[0, 0, -0.05]} geometry={ARM_GEOMETRIES.fingerTip} material={materials.skinHighlight} />
                </group>
                {/* Middle finger - slightly longer */}
                <group position={[0.008, 0.005, -0.07]}>
                  <mesh geometry={ARM_GEOMETRIES.finger} material={materials.skin} />
                  <mesh position={[0, 0, -0.05]} geometry={ARM_GEOMETRIES.fingerTip} material={materials.skinHighlight} />
                </group>
                {/* Ring finger */}
                <group position={[-0.008, 0.005, -0.065]}>
                  <mesh geometry={ARM_GEOMETRIES.finger} material={materials.skin} />
                  <mesh position={[0, 0, -0.05]} geometry={ARM_GEOMETRIES.fingerTip} material={materials.skinHighlight} />
                </group>
                {/* Pinky finger - shorter */}
                <group position={[-0.024, 0.005, -0.055]} rotation={[0, -0.1, 0]}>
                  <mesh scale={[0.85, 0.85, 0.8]} geometry={ARM_GEOMETRIES.finger} material={materials.skin} />
                  <mesh position={[0, 0, -0.04]} scale={[0.8, 0.8, 0.8]} geometry={ARM_GEOMETRIES.fingerTip} material={materials.skinHighlight} />
                </group>
                
                {/* Thumb - on outer side */}
                <group position={[0.05, 0.01, -0.01]} rotation={[0.4, 0.7, 0.3]}>
                  <mesh geometry={ARM_GEOMETRIES.thumb} material={materials.skin} />
                  <mesh position={[0, 0, -0.035]} geometry={ARM_GEOMETRIES.thumbTip} material={materials.skinHighlight} />
                </group>
                
                {/* Palm energy orb */}
                <mesh 
                  ref={rightOrbRef}
                  position={[0, 0.035, -0.03]}
                  geometry={ARM_GEOMETRIES.orb}
                  material={materials.energy}
                />
              </group>
            </group>
          </group>
        </group>
        
        {/* Floating particles - positioned in world space relative to arm group */}
        {particleData.slice(8, 16).map((_, i) => (
          <mesh
            key={`right-particle-${i}`}
            ref={el => particleRefs.current[i + 8] = el}
            geometry={ARM_GEOMETRIES.particle}
            material={materials.energyCore.clone()}
          />
        ))}
      </group>
      
      {/* Blink flash effects - appear on hands during blink */}
      <mesh
        ref={leftBlinkFlashRef}
        position={[-0.25, -0.35, -0.55]}
        visible={false}
        geometry={ARM_GEOMETRIES.blinkFlash}
      >
        <meshBasicMaterial 
          color={0xc084fc} 
          transparent 
          opacity={0.7} 
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      <mesh
        ref={rightBlinkFlashRef}
        position={[0.25, -0.35, -0.55]}
        visible={false}
        geometry={ARM_GEOMETRIES.blinkFlash}
      >
        <meshBasicMaterial 
          color={0xc084fc} 
          transparent 
          opacity={0.7} 
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      
      {/* Ambient arm lighting - subtle glow, refs for dynamic updates */}
      <pointLight 
        ref={leftLightRef}
        position={[-0.25, -0.3, -0.45]} 
        color={0x9333ea} 
        intensity={0.25} 
        distance={0.6}
        decay={2}
      />
      <pointLight 
        ref={rightLightRef}
        position={[0.25, -0.3, -0.45]} 
        color={0x9333ea} 
        intensity={0.25} 
        distance={0.6}
        decay={2}
      />
    </group>
  );
}

// ============================================================================
// FIRST PERSON ARMS MANAGER
// Renders appropriate arms based on selected hero
// ============================================================================

export function FirstPersonArms() {
  const localPlayer = useGameStore(state => state.localPlayer);
  const gamePhase = useGameStore(state => state.gamePhase);
  
  // Only show during gameplay
  const isPlaying = gamePhase === 'playing' || gamePhase === 'countdown';
  
  if (!localPlayer || !isPlaying) return null;
  
  const heroId = localPlayer.heroId;
  
  // Render hero-specific arms
  switch (heroId) {
    case 'phantom':
      return <PhantomFirstPersonArms isActive={true} />;
    // Future heroes can be added here:
    // case 'blaze':
    //   return <BlazeFirstPersonArms isActive={true} />;
    // case 'hookshot':
    //   return <HookshotFirstPersonArms isActive={true} />;
    default:
      return null;
  }
}


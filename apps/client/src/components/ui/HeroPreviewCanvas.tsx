import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ContactShadows } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { HERO_DEFINITIONS } from '@voxel-strike/shared';
import type { HeroId, Team } from '@voxel-strike/shared';
import { HeroVoxelBody } from '../game/HeroVoxelBody';
import type { HeroAnimationMode } from '../game/HeroVoxelBody';
import { HERO_COLOR_SCHEMES } from '../../styles/colorTokens';
import { useHeroPreviewRotation } from './useHeroPreviewRotation';

type HeroPreviewSize = 'featured' | 'detail' | 'compact' | 'card';
type HeroPreviewActionMode = Exclude<HeroAnimationMode, 'crouchWalkLoop'>;
type Vector3Tuple = [number, number, number];
type DprSetting = number | [number, number];

interface HeroPreviewCanvasProps {
  heroId: HeroId;
  team?: Team;
  size?: HeroPreviewSize;
  interactive?: boolean;
  idleRotation?: boolean;
  idleAnimation?: boolean;
  initialYaw?: number;
  className?: string;
  accentColor?: string;
  showShadow?: boolean;
  isBot?: boolean;
  hasFlag?: boolean;
  postureScaleY?: number;
  animationMode?: HeroAnimationMode;
  'aria-label'?: string;
}

interface PreviewConfig {
  cameraPosition: Vector3Tuple;
  cameraTarget: Vector3Tuple;
  fov: number;
  dpr: DprSetting;
  bodyScale: number;
  floorScale: number;
  bodyLift: number;
  shadowOpacity: number;
  idleSpeed: number;
  idleIntensity: number;
  shadows: boolean;
  jumpFraming?: {
    fov: number;
    bodyLift: number;
    bodyScale?: number;
    floorScale?: number;
  };
  slideFraming?: {
    fov: number;
    bodyLift: number;
    bodyScale?: number;
    floorScale?: number;
  };
}

const PREVIEW_CONFIG: Record<HeroPreviewSize, PreviewConfig> = {
  featured: {
    cameraPosition: [0, 0.22, 4.35],
    cameraTarget: [0, 0.22, 0],
    fov: 40,
    dpr: [1, 1.75],
    bodyScale: 1.04,
    floorScale: 3.1,
    bodyLift: 0,
    shadowOpacity: 0.34,
    idleSpeed: 0.18,
    idleIntensity: 0.9,
    shadows: true,
    jumpFraming: {
      fov: 44,
      bodyLift: -0.22,
      floorScale: 1.08,
    },
    slideFraming: {
      fov: 38,
      bodyLift: 0.18,
      bodyScale: 0.98,
      floorScale: 1.18,
    },
  },
  detail: {
    cameraPosition: [0, 0.08, 4.45],
    cameraTarget: [0, 0.08, 0],
    fov: 32,
    dpr: [1, 1.6],
    bodyScale: 1.02,
    floorScale: 2.8,
    bodyLift: 0,
    shadowOpacity: 0.28,
    idleSpeed: 0.14,
    idleIntensity: 0.75,
    shadows: true,
    slideFraming: {
      fov: 39,
      bodyLift: 0.16,
      bodyScale: 0.94,
      floorScale: 1.14,
    },
  },
  compact: {
    cameraPosition: [0, 0.08, 4.9],
    cameraTarget: [0, 0.06, 0],
    fov: 36,
    dpr: [1, 1.15],
    bodyScale: 0.9,
    floorScale: 2.15,
    bodyLift: 0.16,
    shadowOpacity: 0.18,
    idleSpeed: 0,
    idleIntensity: 0.46,
    shadows: false,
  },
  card: {
    cameraPosition: [0, 0.09, 4.45],
    cameraTarget: [0, 0.08, 0],
    fov: 32,
    dpr: [1.5, 2.35],
    bodyScale: 1.02,
    floorScale: 2.35,
    bodyLift: 0.06,
    shadowOpacity: 0.2,
    idleSpeed: 0,
    idleIntensity: 0.5,
    shadows: false,
  },
};

const CROUCH_WALK_LOOP_SEQUENCE: Array<{ mode: HeroPreviewActionMode; duration: number }> = [
  { mode: 'idle', duration: 0.85 },
  { mode: 'walk', duration: 1.1 },
  { mode: 'crouchWalk', duration: 1.35 },
  { mode: 'walk', duration: 1.1 },
];

const CROUCH_WALK_LOOP_DURATION = CROUCH_WALK_LOOP_SEQUENCE.reduce((total, step) => total + step.duration, 0);
const RUN_SLIDE_LOOP_SEQUENCE: Array<{ mode: HeroPreviewActionMode; duration: number }> = [
  { mode: 'run', duration: 0.75 },
  { mode: 'slide', duration: 1.25 },
  { mode: 'run', duration: 0.7 },
];
const RUN_SLIDE_LOOP_DURATION = RUN_SLIDE_LOOP_SEQUENCE.reduce((total, step) => total + step.duration, 0);
const SLIDE_PREVIEW_YAW = -Math.PI / 2;

function getLoopMode(
  sequence: Array<{ mode: HeroPreviewActionMode; duration: number }>,
  duration: number,
  elapsedTime: number,
  fallbackMode: HeroPreviewActionMode
): HeroPreviewActionMode {
  let phase = elapsedTime % duration;

  for (const step of sequence) {
    if (phase < step.duration) return step.mode;
    phase -= step.duration;
  }

  return fallbackMode;
}

export const HeroPreviewCanvas = memo(function HeroPreviewCanvas({
  heroId,
  team = 'blue',
  size = 'detail',
  interactive = true,
  idleRotation,
  idleAnimation = true,
  initialYaw = Math.PI - 0.24,
  className = '',
  accentColor,
  showShadow = true,
  isBot = false,
  hasFlag = false,
  postureScaleY = 1,
  animationMode = 'idle',
  'aria-label': ariaLabel,
}: HeroPreviewCanvasProps) {
  const config = PREVIEW_CONFIG[size];
  const resolvedAccentColor = accentColor ?? HERO_COLOR_SCHEMES[heroId].primary;
  const shouldIdleRotate = idleRotation ?? interactive;
  const shouldIdleAnimate = idleAnimation && config.idleIntensity > 0;
  const rotationInitialYaw = animationMode === 'slide' ? SLIDE_PREVIEW_YAW : initialYaw;
  const { yaw, isDragging, interactionProps } = useHeroPreviewRotation({
    enabled: interactive,
    initialYaw: rotationInitialYaw,
    resetKey: `${heroId}:${animationMode === 'slide' ? 'slide' : 'default'}`,
  });

  return (
    <div
      className={`hero-preview-shell relative overflow-hidden ${interactive ? 'select-none' : 'pointer-events-none'} ${className}`}
      data-interactive={interactive ? 'true' : 'false'}
      data-dragging={isDragging ? 'true' : 'false'}
      aria-label={ariaLabel ?? `${HERO_DEFINITIONS[heroId].name} voxel preview`}
      aria-hidden={interactive ? undefined : true}
      {...interactionProps}
    >
      <Canvas
        className="absolute inset-0"
        camera={{ position: config.cameraPosition, fov: config.fov, near: 0.1, far: 60 }}
        dpr={config.dpr}
        frameloop={interactive || shouldIdleRotate || shouldIdleAnimate || animationMode !== 'idle' ? 'always' : 'demand'}
        gl={{ alpha: true, antialias: true, powerPreference: size === 'compact' ? 'default' : 'high-performance' }}
        shadows={config.shadows}
      >
        <HeroPreviewScene
          heroId={heroId}
          team={team}
          yaw={yaw}
          isDragging={isDragging}
          idleRotation={shouldIdleRotate}
          accentColor={resolvedAccentColor}
          config={config}
          showShadow={showShadow}
          isBot={isBot}
          hasFlag={hasFlag}
          postureScaleY={postureScaleY}
          idleAnimation={shouldIdleAnimate}
          animationMode={animationMode}
        />
      </Canvas>
    </div>
  );
});

interface HeroPreviewSceneProps {
  heroId: HeroId;
  team: Team;
  yaw: number;
  isDragging: boolean;
  idleRotation: boolean;
  accentColor: string;
  config: PreviewConfig;
  showShadow: boolean;
  isBot: boolean;
  hasFlag: boolean;
  postureScaleY: number;
  idleAnimation: boolean;
  animationMode: HeroAnimationMode;
}

function HeroPreviewScene({
  heroId,
  team,
  yaw,
  isDragging,
  idleRotation,
  accentColor,
  config,
  showShadow,
  isBot,
  hasFlag,
  postureScaleY,
  idleAnimation,
  animationMode,
}: HeroPreviewSceneProps) {
  const heroHeight = HERO_DEFINITIONS[heroId].stats.size.height;
  const rootRef = useRef<THREE.Group>(null);
  const idleYawRef = useRef(0);
  const loopStartedAtRef = useRef<number | null>(null);
  const [loopAnimationMode, setLoopAnimationMode] = useState<HeroPreviewActionMode>('idle');
  const bodyAnimationMode: HeroPreviewActionMode = animationMode === 'slide'
    ? loopAnimationMode === 'slide' ? 'slide' : 'run'
    : animationMode === 'crouchWalkLoop'
      ? loopAnimationMode === 'walk' || loopAnimationMode === 'crouchWalk' ? loopAnimationMode : 'idle'
      : animationMode;
  const actionFraming = bodyAnimationMode === 'jump'
    ? config.jumpFraming
    : animationMode === 'slide' || bodyAnimationMode === 'slide'
      ? config.slideFraming
      : undefined;
  const activePostureScaleY = postureScaleY;
  const previewFov = actionFraming?.fov ?? config.fov;
  const previewBodyScale = config.bodyScale * (actionFraming?.bodyScale ?? 1);
  const previewBodyLift = config.bodyLift + (actionFraming?.bodyLift ?? 0);
  const previewFloorScale = config.floorScale * (actionFraming?.floorScale ?? 1);
  const scaledHeight = heroHeight * Math.max(0.45, Math.min(1, activePostureScaleY)) * previewBodyScale;
  const bodyCenterOffset = scaledHeight * 0.5;
  const previewMovementPose = bodyAnimationMode === 'run' || bodyAnimationMode === 'slide'
    ? 'run'
    : bodyAnimationMode === 'crouchWalk'
      ? 'crouchWalk'
      : 'walk';

  useEffect(() => {
    idleYawRef.current = 0;
  }, [animationMode, heroId]);

  useEffect(() => {
    if (animationMode === 'crouchWalkLoop' || animationMode === 'slide') {
      loopStartedAtRef.current = null;
      setLoopAnimationMode(animationMode === 'slide' ? 'run' : 'idle');
    }
  }, [animationMode, heroId]);

  useFrame((state, delta) => {
    if (!rootRef.current) return;

    if (animationMode === 'crouchWalkLoop' || animationMode === 'slide') {
      if (loopStartedAtRef.current === null) {
        loopStartedAtRef.current = state.clock.elapsedTime;
      }
      const elapsedLoopTime = state.clock.elapsedTime - loopStartedAtRef.current;
      const nextLoopMode = animationMode === 'slide'
        ? getLoopMode(RUN_SLIDE_LOOP_SEQUENCE, RUN_SLIDE_LOOP_DURATION, elapsedLoopTime, 'run')
        : getLoopMode(CROUCH_WALK_LOOP_SEQUENCE, CROUCH_WALK_LOOP_DURATION, elapsedLoopTime, 'idle');
      setLoopAnimationMode((currentMode) => currentMode === nextLoopMode ? currentMode : nextLoopMode);
    }

    if (bodyAnimationMode !== 'slide' && idleRotation && !isDragging && config.idleSpeed > 0) {
      idleYawRef.current += delta * config.idleSpeed;
    }
    rootRef.current.rotation.y = yaw + idleYawRef.current;
  });

  return (
    <>
      <PreviewCamera config={config} fov={previewFov} />
      <ambientLight intensity={1.45} />
      <hemisphereLight args={['white', HERO_COLOR_SCHEMES[heroId].secondary, 1.4]} />
      <directionalLight
        color="white"
        position={[3, 4.5, 4.5]}
        intensity={2.7}
        castShadow={config.shadows}
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />
      <pointLight color={accentColor} position={[-2.4, 1.4, 2.2]} intensity={2.2} distance={6} />
      <pointLight color={accentColor} position={[2, 2.2, -1.8]} intensity={1.15} distance={5} />

      <group ref={rootRef} position={[0, previewBodyLift, 0]}>
        <group position={[0, -bodyCenterOffset, 0]} scale={previewBodyScale}>
          <HeroVoxelBody
            heroId={heroId}
            team={team}
            height={heroHeight}
            isBot={isBot}
            hasFlag={hasFlag}
            postureScaleY={activePostureScaleY}
            isMoving={bodyAnimationMode === 'walk' || bodyAnimationMode === 'crouchWalk' || bodyAnimationMode === 'run'}
            isJumping={bodyAnimationMode === 'jump'}
            isCrouching={bodyAnimationMode === 'crouch' || bodyAnimationMode === 'crouchWalk'}
            isSliding={bodyAnimationMode === 'slide'}
            movementPose={previewMovementPose}
            walkDirection={{ forward: 1, right: 0 }}
            idleIntensity={idleAnimation ? config.idleIntensity : 0}
            showTeamAccents
            castShadow={config.shadows}
          />
        </group>
      </group>

      {showShadow && (
        <ContactShadows
          position={[0, previewBodyLift - bodyCenterOffset - 0.04, 0]}
          opacity={config.shadowOpacity}
          scale={previewFloorScale}
          blur={1.8}
          far={2.2}
          color={accentColor}
        />
      )}
    </>
  );
}

function PreviewCamera({ config, fov }: { config: PreviewConfig; fov: number }) {
  const { camera } = useThree();
  const target = useMemo(() => new THREE.Vector3(...config.cameraTarget), [config.cameraTarget]);

  useLayoutEffect(() => {
    const perspectiveCamera = camera as THREE.PerspectiveCamera;
    perspectiveCamera.position.set(...config.cameraPosition);
    perspectiveCamera.fov = fov;
    perspectiveCamera.near = 0.1;
    perspectiveCamera.far = 60;
    perspectiveCamera.lookAt(target);
    perspectiveCamera.updateProjectionMatrix();
  }, [camera, config, fov, target]);

  return null;
}

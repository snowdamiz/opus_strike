import { memo, type CSSProperties, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ContactShadows } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { HERO_DEFINITIONS, getRankTheme } from '@voxel-strike/shared';
import type { HeroId, PublicRankSnapshot, Team } from '@voxel-strike/shared';
import { HeroVoxelBody } from '../game/HeroVoxelBody';
import type { HeroAnimationMode, HeroWalkDirection } from '../game/HeroVoxelBody';
import { suppressExpectedContextLossLog } from '../game/webglLifecycle';
import { HERO_COLOR_SCHEMES, HERO_PREVIEW_COLORS } from '../../styles/colorTokens';
import { useHeroPreviewRotation } from './useHeroPreviewRotation';

type HeroPreviewSize = 'featured' | 'detail' | 'compact' | 'card';
type HeroPreviewActionMode = Exclude<HeroAnimationMode, 'crouchWalkLoop'>;
export type HeroPreviewAnimationMode = HeroAnimationMode;
type HeroPreviewLoopMode = Extract<HeroPreviewAnimationMode, 'crouchWalkLoop' | 'slide'>;
type HeroPreviewLoopStep = {
  mode: HeroPreviewActionMode;
  duration: number;
  walkDirection?: HeroWalkDirection;
};
type Vector3Tuple = [number, number, number];
type DprSetting = number | [number, number];
export type HeroPreviewRank = Pick<PublicRankSnapshot, 'tier' | 'division' | 'isRanked'>;

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
  animationMode?: HeroPreviewAnimationMode;
  platformRank?: HeroPreviewRank | null;
  preserveDrawingBuffer?: boolean;
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
    bodyScale: 1.1,
    floorScale: 3.1,
    bodyLift: 0.14,
    shadowOpacity: 0.34,
    idleSpeed: 0.18,
    idleIntensity: 0.9,
    shadows: true,
    jumpFraming: {
      fov: 40,
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
    dpr: [1, 1.5],
    bodyScale: 1.02,
    floorScale: 2.35,
    bodyLift: 0.06,
    shadowOpacity: 0.2,
    idleSpeed: 0,
    idleIntensity: 0.5,
    shadows: false,
  },
};

const PREVIEW_FORWARD_DIRECTION: HeroWalkDirection = { forward: 1, right: 0 };

const CROUCH_WALK_LOOP_SEQUENCE: HeroPreviewLoopStep[] = [
  { mode: 'idle', duration: 0.85 },
  { mode: 'walk', duration: 1.1, walkDirection: PREVIEW_FORWARD_DIRECTION },
  { mode: 'crouchWalk', duration: 1.35 },
  { mode: 'walk', duration: 1.1, walkDirection: PREVIEW_FORWARD_DIRECTION },
];

const CROUCH_WALK_LOOP_DURATION = CROUCH_WALK_LOOP_SEQUENCE.reduce((total, step) => total + step.duration, 0);
const RUN_SLIDE_LOOP_SEQUENCE: HeroPreviewLoopStep[] = [
  { mode: 'run', duration: 0.75, walkDirection: PREVIEW_FORWARD_DIRECTION },
  { mode: 'slide', duration: 1.25 },
  { mode: 'run', duration: 0.7, walkDirection: PREVIEW_FORWARD_DIRECTION },
];
const RUN_SLIDE_LOOP_DURATION = RUN_SLIDE_LOOP_SEQUENCE.reduce((total, step) => total + step.duration, 0);
const PREVIEW_LOOP_CONFIG: Record<
  HeroPreviewLoopMode,
  {
    sequence: HeroPreviewLoopStep[];
    duration: number;
    initialMode: HeroPreviewActionMode;
    fallbackMode: HeroPreviewActionMode;
  }
> = {
  crouchWalkLoop: {
    sequence: CROUCH_WALK_LOOP_SEQUENCE,
    duration: CROUCH_WALK_LOOP_DURATION,
    initialMode: 'idle',
    fallbackMode: 'idle',
  },
  slide: {
    sequence: RUN_SLIDE_LOOP_SEQUENCE,
    duration: RUN_SLIDE_LOOP_DURATION,
    initialMode: 'run',
    fallbackMode: 'run',
  },
};
const SLIDE_PREVIEW_YAW = -Math.PI / 2;
const PREVIEW_CLEAR_COLOR_VAR = '--color-strike-canvas';
const PREVIEW_OFFSCREEN_ROOT_ID = 'hero-preview-offscreen-root';
const PREVIEW_SAMPLE_SIZE = 24;
const RANK_PLATFORM_PREVIEW_LIFT = 0.14;
const RANK_PLATFORM_FOV_PADDING = 3;
const RANK_PLATFORM_SEGMENTS = 48;

function getPreviewOffscreenRoot(): HTMLElement | null {
  if (typeof document === 'undefined') return null;

  const existingRoot = document.getElementById(PREVIEW_OFFSCREEN_ROOT_ID);
  if (existingRoot) return existingRoot;

  const root = document.createElement('div');
  root.id = PREVIEW_OFFSCREEN_ROOT_ID;
  root.className = 'hero-preview-offscreen-root';
  document.body.appendChild(root);
  return root;
}

function createPreviewStageElement(): HTMLDivElement | null {
  if (typeof document === 'undefined') return null;

  const element = document.createElement('div');
  element.className = 'hero-preview-stage';
  element.setAttribute('data-ready', 'false');
  return element;
}

function getCssRgbColor(variableName: string): THREE.Color {
  const channels = getComputedStyle(document.documentElement)
    .getPropertyValue(variableName)
    .trim()
    .split(/\s+/)
    .map(Number);

  if (channels.length >= 3 && channels.slice(0, 3).every(Number.isFinite)) {
    return new THREE.Color(channels[0] / 255, channels[1] / 255, channels[2] / 255);
  }

  return new THREE.Color(0, 0, 0);
}

function isCanvasSafeToReveal(canvas: HTMLCanvasElement): boolean {
  const sampleCanvas = document.createElement('canvas');
  sampleCanvas.width = PREVIEW_SAMPLE_SIZE;
  sampleCanvas.height = PREVIEW_SAMPLE_SIZE;

  const context = sampleCanvas.getContext('2d', { willReadFrequently: true });
  if (!context) return false;

  context.clearRect(0, 0, PREVIEW_SAMPLE_SIZE, PREVIEW_SAMPLE_SIZE);
  context.drawImage(canvas, 0, 0, PREVIEW_SAMPLE_SIZE, PREVIEW_SAMPLE_SIZE);

  const pixels = context.getImageData(0, 0, PREVIEW_SAMPLE_SIZE, PREVIEW_SAMPLE_SIZE).data;
  const totalPixels = PREVIEW_SAMPLE_SIZE * PREVIEW_SAMPLE_SIZE;
  let visiblePixels = 0;
  let whitePixels = 0;

  for (let index = 0; index < pixels.length; index += 4) {
    const red = pixels[index] ?? 0;
    const green = pixels[index + 1] ?? 0;
    const blue = pixels[index + 2] ?? 0;
    const alpha = pixels[index + 3] ?? 0;

    if (alpha > 8) {
      visiblePixels++;
    }

    if (alpha > 200 && red > 245 && green > 245 && blue > 245) {
      whitePixels++;
    }
  }

  if (visiblePixels < totalPixels * 0.01) return false;

  return whitePixels / totalPixels < 0.35;
}

function getLoopStep(
  sequence: HeroPreviewLoopStep[],
  duration: number,
  elapsedTime: number,
  fallbackMode: HeroPreviewActionMode
): HeroPreviewLoopStep {
  let phase = elapsedTime % duration;

  for (const step of sequence) {
    if (phase < step.duration) return step;
    phase -= step.duration;
  }

  return { mode: fallbackMode, duration: 0 };
}

function isSameLoopStep(a: HeroPreviewLoopStep, b: HeroPreviewLoopStep): boolean {
  return (
    a.mode === b.mode &&
    a.walkDirection?.forward === b.walkDirection?.forward &&
    a.walkDirection?.right === b.walkDirection?.right
  );
}

function isPreviewLoopMode(animationMode: HeroPreviewAnimationMode): animationMode is HeroPreviewLoopMode {
  return animationMode === 'crouchWalkLoop' || animationMode === 'slide';
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
  platformRank = null,
  preserveDrawingBuffer = false,
  'aria-label': ariaLabel,
}: HeroPreviewCanvasProps) {
  const config = PREVIEW_CONFIG[size];
  const resolvedAccentColor = accentColor ?? HERO_COLOR_SCHEMES[heroId].primary;
  const [isCanvasReady, setIsCanvasReady] = useState(false);
  const [shouldMountStage, setShouldMountStage] = useState(false);
  const [stageElement] = useState(createPreviewStageElement);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const shellRef = useRef<HTMLDivElement>(null);
  const hasCanvasCreatedRef = useRef(false);
  const shouldIdleRotate = idleRotation ?? interactive;
  const shouldIdleAnimate = idleAnimation && config.idleIntensity > 0;
  const rotationInitialYaw = animationMode === 'slide' ? SLIDE_PREVIEW_YAW : initialYaw;
  const platformRankKey = platformRank ? `${platformRank.tier}:${platformRank.division ?? 0}:${platformRank.isRanked}` : 'none';
  const previewReadyKey = `${heroId}:${team}:${size}:${animationMode}:${isBot}:${hasFlag}:${postureScaleY}:${platformRankKey}`;
  const previewShellStyle = {
    '--hero-preview-accent': resolvedAccentColor,
  } as CSSProperties;
  const { yaw, isDragging, interactionProps } = useHeroPreviewRotation({
    enabled: interactive,
    initialYaw: rotationInitialYaw,
    resetKey: `${heroId}:${animationMode === 'slide' ? 'slide' : 'default'}`,
  });

  useLayoutEffect(() => {
    const shell = shellRef.current;
    if (!shell) return undefined;

    const updateStageSize = () => {
      const rect = shell.getBoundingClientRect();
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(rect.height));

      setStageSize((currentSize) => (
        currentSize.width === width && currentSize.height === height
          ? currentSize
          : { width, height }
      ));
    };

    updateStageSize();

    const resizeObserver = new ResizeObserver(updateStageSize);
    resizeObserver.observe(shell);

    return () => resizeObserver.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (!stageElement) return;

    stageElement.style.setProperty('--hero-preview-stage-width', `${stageSize.width}px`);
    stageElement.style.setProperty('--hero-preview-stage-height', `${stageSize.height}px`);
  }, [stageElement, stageSize.height, stageSize.width]);

  useLayoutEffect(() => {
    if (!stageElement) return undefined;

    const parent = isCanvasReady && shellRef.current
      ? shellRef.current
      : getPreviewOffscreenRoot();

    if (parent && stageElement.parentElement !== parent) {
      parent.appendChild(stageElement);
    }

    stageElement.setAttribute('data-ready', isCanvasReady ? 'true' : 'false');
    stageElement.setAttribute('aria-hidden', isCanvasReady ? 'false' : 'true');

    return () => {
      if (stageElement.parentElement) {
        stageElement.parentElement.removeChild(stageElement);
      }
    };
  }, [isCanvasReady, stageElement]);

  useLayoutEffect(() => {
    setIsCanvasReady(false);
    setShouldMountStage(false);
    hasCanvasCreatedRef.current = false;
  }, [previewReadyKey]);

  useEffect(() => {
    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        setShouldMountStage(true);
      });
    });

    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [previewReadyKey]);

  const handleCanvasCreated = useCallback(({ gl }: { gl: THREE.WebGLRenderer }) => {
    suppressExpectedContextLossLog(gl);
    gl.setClearColor(getCssRgbColor(PREVIEW_CLEAR_COLOR_VAR), 0);
    gl.setClearAlpha(0);
    hasCanvasCreatedRef.current = true;
  }, []);

  const handlePreviewRendered = useCallback(() => {
    if (!hasCanvasCreatedRef.current) return;
    setIsCanvasReady(true);
  }, []);

  const shouldRenderPreviewStage = Boolean(
    shouldMountStage &&
    stageElement &&
    stageSize.width > 0 &&
    stageSize.height > 0
  );

  return (
    <div
      ref={shellRef}
      className={`hero-preview-shell relative overflow-hidden ${interactive ? 'select-none' : 'pointer-events-none'} ${className}`}
      data-interactive={interactive ? 'true' : 'false'}
      data-dragging={isDragging ? 'true' : 'false'}
      data-ready={isCanvasReady ? 'true' : 'false'}
      data-size={size}
      style={previewShellStyle}
      aria-label={ariaLabel ?? `${HERO_DEFINITIONS[heroId].name} voxel preview`}
      aria-hidden={interactive ? undefined : true}
      aria-busy={isCanvasReady ? undefined : true}
      {...interactionProps}
    >
      <div className="hero-preview-loading pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="hero-preview-loader-ring" />
        <span className="sr-only">Loading {HERO_DEFINITIONS[heroId].name} preview</span>
      </div>
      {stageElement && shouldRenderPreviewStage && createPortal(
        <Canvas
          className="hero-preview-canvas"
          camera={{ position: config.cameraPosition, fov: config.fov, near: 0.1, far: 60 }}
          dpr={config.dpr}
          frameloop={interactive || shouldIdleRotate || shouldIdleAnimate || animationMode !== 'idle' ? 'always' : 'demand'}
          gl={{
            alpha: true,
            antialias: true,
            premultipliedAlpha: false,
            preserveDrawingBuffer,
            powerPreference: size === 'compact' ? 'default' : 'high-performance',
          }}
          onCreated={handleCanvasCreated}
          shadows={config.shadows}
          style={{
            position: 'absolute',
            inset: 0,
            background: 'transparent',
          }}
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
            platformRank={platformRank}
          />
          <PreviewRenderReadySignal readyKey={previewReadyKey} onReady={handlePreviewRendered} />
        </Canvas>
        ,
        stageElement
      )}
    </div>
  );
});

function PreviewRenderReadySignal({
  readyKey,
  onReady,
}: {
  readyKey: string;
  onReady: () => void;
}) {
  const { gl, invalidate } = useThree();
  const renderedFramesRef = useRef(0);
  const didSignalRef = useRef(false);

  useEffect(() => {
    renderedFramesRef.current = 0;
    didSignalRef.current = false;
    invalidate();
  }, [invalidate, readyKey]);

  useFrame(() => {
    if (didSignalRef.current) return;

    renderedFramesRef.current += 1;
    if (renderedFramesRef.current < 4) {
      invalidate();
      return;
    }
    if (renderedFramesRef.current < 180 && !isCanvasSafeToReveal(gl.domElement)) {
      invalidate();
      return;
    }

    didSignalRef.current = true;
    onReady();
  });

  return null;
}

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
  animationMode: HeroPreviewAnimationMode;
  platformRank: HeroPreviewRank | null;
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
  platformRank,
}: HeroPreviewSceneProps) {
  const heroHeight = HERO_DEFINITIONS[heroId].stats.size.height;
  const rootRef = useRef<THREE.Group>(null);
  const idleYawRef = useRef(0);
  const loopStartedAtRef = useRef<number | null>(null);
  const isLoopingPreview = isPreviewLoopMode(animationMode);
  const loopConfig = isLoopingPreview ? PREVIEW_LOOP_CONFIG[animationMode] : null;
  const [loopStep, setLoopStep] = useState<HeroPreviewLoopStep>(
    () => ({ mode: loopConfig?.initialMode ?? 'idle', duration: 0 })
  );
  const bodyAnimationMode: HeroPreviewActionMode = isLoopingPreview ? loopStep.mode : animationMode;
  const previewWalkDirection = isLoopingPreview
    ? loopStep.walkDirection ?? PREVIEW_FORWARD_DIRECTION
    : PREVIEW_FORWARD_DIRECTION;
  const actionFraming = bodyAnimationMode === 'jump'
    ? config.jumpFraming
    : bodyAnimationMode === 'slide'
      ? config.slideFraming
      : undefined;
  const activePostureScaleY = postureScaleY;
  const previewFov = (actionFraming?.fov ?? config.fov) + (platformRank ? RANK_PLATFORM_FOV_PADDING : 0);
  const previewBodyScale = config.bodyScale * (actionFraming?.bodyScale ?? 1);
  const previewBodyLift = config.bodyLift + (actionFraming?.bodyLift ?? 0) + (platformRank ? RANK_PLATFORM_PREVIEW_LIFT : 0);
  const previewFloorScale = config.floorScale * (actionFraming?.floorScale ?? 1);
  const scaledHeight = heroHeight * Math.max(0.45, Math.min(1, activePostureScaleY)) * previewBodyScale;
  const bodyCenterOffset = scaledHeight * 0.5;
  const groundY = previewBodyLift - bodyCenterOffset - (platformRank ? 0.018 : 0.04);
  const shadowY = platformRank ? groundY + 0.024 : groundY;
  const shadowScale = platformRank ? Math.min(previewFloorScale, 1.95) : previewFloorScale;
  const previewMovementPose = bodyAnimationMode === 'run' || bodyAnimationMode === 'slide'
    ? 'run'
    : bodyAnimationMode === 'crouchWalk'
      ? 'crouchWalk'
      : 'walk';

  useEffect(() => {
    idleYawRef.current = 0;
  }, [animationMode, heroId]);

  useEffect(() => {
    if (loopConfig) {
      loopStartedAtRef.current = null;
      setLoopStep({ mode: loopConfig.initialMode, duration: 0 });
    }
  }, [animationMode, heroId, loopConfig]);

  useFrame((state, delta) => {
    if (!rootRef.current) return;

    if (loopConfig) {
      if (loopStartedAtRef.current === null) {
        loopStartedAtRef.current = state.clock.elapsedTime;
      }
      const elapsedLoopTime = state.clock.elapsedTime - loopStartedAtRef.current;
      const nextLoopStep = getLoopStep(
        loopConfig.sequence,
        loopConfig.duration,
        elapsedLoopTime,
        loopConfig.fallbackMode
      );
      setLoopStep((currentStep) => isSameLoopStep(currentStep, nextLoopStep) ? currentStep : nextLoopStep);
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

      {platformRank && (
        <HeroRankPlatform
          rank={platformRank}
          topY={groundY}
          receiveShadow={config.shadows}
        />
      )}

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
            isAttacking={bodyAnimationMode === 'attack'}
            movementPose={previewMovementPose}
            walkDirection={previewWalkDirection}
            idleIntensity={idleAnimation ? config.idleIntensity : 0}
            showTeamAccents
            castShadow={config.shadows}
          />
        </group>
      </group>

      {showShadow && (
        <ContactShadows
          position={[0, shadowY, 0]}
          opacity={platformRank ? Math.min(0.5, config.shadowOpacity + 0.08) : config.shadowOpacity}
          scale={shadowScale}
          blur={1.8}
          far={2.2}
          color={HERO_PREVIEW_COLORS.neutralShadow}
        />
      )}
    </>
  );
}

type HeroPlatformTier = HeroPreviewRank['tier'];
type PlatformProfile = {
  baseHeight: number;
  baseRadius: number;
  baseFootRadius: number;
  baseRotation: number;
  deckHeight: number;
  deckRadius: number;
  deckRotation: number;
  centerRadius: number;
  centerSegments: number;
  centerRotation: number;
  outerRingRadius: number;
  innerRingRadius: number;
};

const DEFAULT_PLATFORM_PROFILE: PlatformProfile = {
  baseHeight: 0.14,
  baseRadius: 0.82,
  baseFootRadius: 0.88,
  baseRotation: Math.PI / 12,
  deckHeight: 0.05,
  deckRadius: 0.72,
  deckRotation: 0,
  centerRadius: 0.31,
  centerSegments: 6,
  centerRotation: Math.PI / 6,
  outerRingRadius: 0.72,
  innerRingRadius: 0.37,
};

const PLATFORM_PROFILES = {
  unranked: DEFAULT_PLATFORM_PROFILE,
  plastic: {
    ...DEFAULT_PLATFORM_PROFILE,
    baseRotation: Math.PI / 8,
    deckRadius: 0.68,
    centerSegments: 4,
    centerRotation: Math.PI / 4,
  },
  bronze: {
    ...DEFAULT_PLATFORM_PROFILE,
    baseHeight: 0.16,
    baseRadius: 0.84,
    baseFootRadius: 0.9,
    baseRotation: Math.PI / 6,
    deckRadius: 0.7,
    deckRotation: Math.PI / 6,
    centerRadius: 0.3,
    centerSegments: 6,
    outerRingRadius: 0.7,
  },
  silver: {
    ...DEFAULT_PLATFORM_PROFILE,
    baseHeight: 0.13,
    baseRadius: 0.86,
    baseFootRadius: 0.9,
    baseRotation: Math.PI / 8,
    deckRadius: 0.76,
    deckRotation: Math.PI / 8,
    centerRadius: 0.26,
    centerSegments: 8,
    outerRingRadius: 0.75,
    innerRingRadius: 0.33,
  },
  gold: {
    ...DEFAULT_PLATFORM_PROFILE,
    baseHeight: 0.15,
    baseRadius: 0.84,
    baseFootRadius: 0.9,
    baseRotation: Math.PI / 12,
    deckRadius: 0.72,
    deckRotation: Math.PI / 12,
    centerRadius: 0.34,
    centerSegments: 6,
    outerRingRadius: 0.76,
  },
  diamond: {
    ...DEFAULT_PLATFORM_PROFILE,
    baseHeight: 0.15,
    baseRadius: 0.86,
    baseFootRadius: 0.9,
    baseRotation: Math.PI / 4,
    deckRadius: 0.72,
    deckRotation: Math.PI / 4,
    centerRadius: 0.3,
    centerSegments: 4,
    centerRotation: Math.PI / 4,
  },
  unemployed: {
    ...DEFAULT_PLATFORM_PROFILE,
    baseHeight: 0.16,
    baseRadius: 0.8,
    baseFootRadius: 0.86,
    baseRotation: Math.PI / 4,
    deckRadius: 0.68,
    deckRotation: Math.PI / 4,
    centerRadius: 0.28,
    centerSegments: 4,
    centerRotation: Math.PI / 4,
    outerRingRadius: 0.68,
    innerRingRadius: 0.32,
  },
} satisfies Record<NonNullable<HeroPlatformTier>, PlatformProfile>;

function getPlatformProfile(tier: HeroPlatformTier): PlatformProfile {
  return PLATFORM_PROFILES[tier ?? 'unranked'] ?? DEFAULT_PLATFORM_PROFILE;
}

function clampPlatformDivision(division: HeroPreviewRank['division']): number {
  if (typeof division !== 'number' || !Number.isFinite(division)) return 0;
  return Math.max(0, Math.min(4, Math.floor(division)));
}

function HeroRankPlatform({
  rank,
  topY,
  receiveShadow,
}: {
  rank: HeroPreviewRank;
  topY: number;
  receiveShadow: boolean;
}) {
  const tier = rank.tier ?? 'unranked';
  const theme = getRankTheme(tier);
  const division = clampPlatformDivision(rank.division);
  const profile = getPlatformProfile(tier);
  const outerRingTube = 0.018;
  const lipRingTube = 0.024;
  const topLocalY = 0;
  const rankedIntensity = rank.isRanked ? 1 : 0.58;

  return (
    <group position={[0, topY, 0]}>
      <pointLight
        color={theme.primary}
        position={[0, topLocalY + 0.26, 0.36]}
        intensity={(0.42 + division * 0.08) * rankedIntensity}
        distance={2.65}
      />
      <mesh
        position={[0, -profile.baseHeight * 0.52, 0]}
        rotation={[0, profile.baseRotation, 0]}
        castShadow={receiveShadow}
        receiveShadow={receiveShadow}
      >
        <cylinderGeometry
          args={[
            profile.baseRadius,
            profile.baseFootRadius,
            profile.baseHeight,
            RANK_PLATFORM_SEGMENTS,
            1,
            false,
          ]}
        />
        <meshStandardMaterial
          color={HERO_PREVIEW_COLORS.platformBase}
          emissive={theme.secondary}
          emissiveIntensity={0.035 + division * 0.006}
          metalness={0.38}
          roughness={0.52}
        />
      </mesh>
      <mesh position={[0, -profile.baseHeight + 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <torusGeometry args={[profile.baseFootRadius * 0.96, lipRingTube, 10, RANK_PLATFORM_SEGMENTS]} />
        <meshStandardMaterial
          color={HERO_PREVIEW_COLORS.platformDeck}
          emissive={theme.secondary}
          emissiveIntensity={0.035 + division * 0.006}
          metalness={0.34}
          roughness={0.5}
        />
      </mesh>
      <mesh
        position={[0, -profile.deckHeight * 0.48, 0]}
        rotation={[0, profile.deckRotation, 0]}
        castShadow={receiveShadow}
        receiveShadow={receiveShadow}
      >
        <cylinderGeometry
          args={[
            profile.deckRadius,
            profile.deckRadius * 1.06,
            profile.deckHeight,
            RANK_PLATFORM_SEGMENTS,
            1,
            false,
          ]}
        />
        <meshStandardMaterial
          color={theme.secondary}
          emissive={theme.primary}
          emissiveIntensity={0.06 + division * 0.014}
          metalness={0.32}
          roughness={0.5}
        />
      </mesh>
      <mesh position={[0, topLocalY + 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <torusGeometry args={[profile.deckRadius * 0.98, lipRingTube * 0.72, 10, RANK_PLATFORM_SEGMENTS]} />
        <meshStandardMaterial
          color={theme.secondary}
          emissive={theme.primary}
          emissiveIntensity={0.08 + division * 0.012}
          metalness={0.36}
          roughness={0.4}
        />
      </mesh>
      <mesh
        position={[0, topLocalY + 0.005, 0]}
        rotation={[-Math.PI / 2, 0, profile.deckRotation]}
        receiveShadow={receiveShadow}
      >
        <circleGeometry args={[profile.deckRadius * 0.96, RANK_PLATFORM_SEGMENTS]} />
        <meshStandardMaterial
          color={HERO_PREVIEW_COLORS.platformDeck}
          emissive={theme.primary}
          emissiveIntensity={0.025 + division * 0.008}
          metalness={0.28}
          roughness={0.56}
          side={THREE.DoubleSide}
        />
      </mesh>
      <mesh position={[0, topLocalY + 0.014, 0]} rotation={[-Math.PI / 2, 0, profile.centerRotation]}>
        <circleGeometry args={[profile.centerRadius, profile.centerSegments]} />
        <meshStandardMaterial
          color={theme.primary}
          emissive={theme.primary}
          emissiveIntensity={0.05 + division * 0.012}
          metalness={0.24}
          roughness={0.44}
          side={THREE.DoubleSide}
        />
      </mesh>
      <mesh position={[0, topLocalY + 0.023, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <torusGeometry args={[profile.outerRingRadius, outerRingTube, 10, RANK_PLATFORM_SEGMENTS]} />
        <meshStandardMaterial
          color={theme.accent}
          emissive={theme.primary}
          emissiveIntensity={0.16 + division * 0.028}
          metalness={0.36}
          roughness={0.34}
        />
      </mesh>
      <mesh position={[0, topLocalY + 0.027, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <torusGeometry args={[profile.innerRingRadius, outerRingTube * 0.48, 8, 40]} />
        <meshStandardMaterial
          color={theme.foreground}
          emissive={theme.primary}
          emissiveIntensity={0.06 + division * 0.016}
          metalness={0.24}
          roughness={0.48}
        />
      </mesh>
    </group>
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

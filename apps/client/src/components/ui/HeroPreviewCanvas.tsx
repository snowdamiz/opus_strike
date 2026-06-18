import { memo, type CSSProperties, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ContactShadows } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { HERO_DEFINITIONS } from '@voxel-strike/shared';
import type { HeroId, Team } from '@voxel-strike/shared';
import { HeroVoxelBody } from '../game/HeroVoxelBody';
import type { HeroAnimationMode, HeroWalkDirection } from '../game/HeroVoxelBody';
import { suppressExpectedContextLossLog } from '../game/webglLifecycle';
import { HERO_COLOR_SCHEMES } from '../../styles/colorTokens';
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
    bodyScale: 1.04,
    floorScale: 3.1,
    bodyLift: 0,
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
  const previewReadyKey = `${heroId}:${team}:${size}:${animationMode}:${isBot}:${hasFlag}:${postureScaleY}`;
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

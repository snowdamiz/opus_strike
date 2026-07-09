import { Canvas, useThree } from '@react-three/fiber';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/shallow';
import * as THREE from 'three';
import { GOLDEN_VOXEL_MAP_THEME_ID } from '@voxel-strike/shared';
import type { VoxelMapManifest } from '@voxel-strike/shared';
import { useGameStore } from '../../store/gameStore';
import type { LobbyPlayer, MapVoteOption } from '../../store/types';
import { useSettingsStore } from '../../store/settingsStore';
import { useNetwork } from '../../contexts/NetworkContext';
import { useUISounds } from '../../hooks/useUiAudio';
import { FACTIONS } from '../../styles/colorTokens';
import { VoxelMap } from '../game/procedural';
import { suppressExpectedContextLossLog } from '../game/webglLifecycle';
import type { WorldPerformanceBudget } from '../game/visualQuality';
import { requestMapPreviewManifest } from '../../utils/mapPreview/mapPreviewManifestClient';
import { PhaseCountdownTimer } from './PhaseCountdownTimer';
import { RankIcon, getRankForStats } from './RankBadge';

function MapGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6l5-2 6 2 5-2v14l-5 2-6-2-5 2V6z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 4v14M15 6v14" />
    </svg>
  );
}

function CheckGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.4} d="M5 13l4 4L19 7" />
    </svg>
  );
}

function ClockGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
      <circle cx="12" cy="12" r="8" strokeWidth={2} />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 2" />
    </svg>
  );
}

function VotersGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 19v-1a4 4 0 00-4-4H6a4 4 0 00-4 4v1" />
      <circle cx="9" cy="7" r="3" strokeWidth={2} />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M22 19v-1a4 4 0 00-3-3.87M16 4.13A4 4 0 0116 11.87" />
    </svg>
  );
}

function ArrowGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.6} d="M9 6l6 6-6 6" />
    </svg>
  );
}

function CaptureFrame({
  captureKey,
  ready,
  onCapture,
}: {
  captureKey: string;
  ready: boolean;
  onCapture: (image: string) => void;
}) {
  const { gl, scene, camera } = useThree();
  const capturedRef = useRef(false);

  useEffect(() => {
    capturedRef.current = false;
  }, [captureKey]);

  useEffect(() => {
    if (!ready || capturedRef.current) return undefined;

    let firstFrame = 0;
    let secondFrame = 0;
    let thirdFrame = 0;

    firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        thirdFrame = window.requestAnimationFrame(() => {
          if (capturedRef.current) return;
          gl.render(scene, camera);
          capturedRef.current = true;
          onCapture(gl.domElement.toDataURL('image/webp', 0.86));
        });
      });
    });

    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
      window.cancelAnimationFrame(thirdFrame);
    };
  }, [camera, captureKey, gl, onCapture, ready, scene]);

  return null;
}

function PreviewCamera({ manifest }: { manifest: VoxelMapManifest }) {
  const { camera } = useThree();

  useEffect(() => {
    if (!('isPerspectiveCamera' in camera)) return;

    const bounds = manifest.boundary.reduce(
      (range, point) => ({
        minX: Math.min(range.minX, point.x),
        maxX: Math.max(range.maxX, point.x),
        minZ: Math.min(range.minZ, point.z),
        maxZ: Math.max(range.maxZ, point.z),
      }),
      { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity }
    );
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerZ = (bounds.minZ + bounds.maxZ) / 2;
    const width = bounds.maxX - bounds.minX;
    const depth = bounds.maxZ - bounds.minZ;
    const span = Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ);
    const perspectiveCamera = camera as THREE.PerspectiveCamera;

    perspectiveCamera.fov = 52;
    perspectiveCamera.near = 0.1;
    perspectiveCamera.far = 500;
    perspectiveCamera.position.set(
      centerX + width * 0.12,
      Math.max(23, span * 0.38),
      centerZ + depth * 0.36
    );
    perspectiveCamera.lookAt(centerX, 4.6, centerZ - depth * 0.05);
    perspectiveCamera.updateProjectionMatrix();
    perspectiveCamera.updateMatrixWorld();
  }, [camera, manifest]);

  return null;
}

const MAP_PREVIEW_PERFORMANCE_BUDGET: WorldPerformanceBudget = {
  frameTargetFps: 60,
  cpuFrameP95Ms: 16,
  gpuFrameP95Ms: 16,
  drawCalls: 9999,
  triangles: 5_000_000,
  textures: 32,
  geometries: 9999,
  materials: 64,
  maxAtmosphereParticles: 0,
  maxWorldDressingInstances: 460,
  maxGeneratedRegionMeshesPerFrame: 10,
  maxVisualPhysicsQueriesPerFrame: 0,
};

function MapPreviewCanvas({
  option,
  onCapture,
  onFailed,
}: {
  option: MapVoteOption;
  onCapture: (image: string) => void;
  onFailed: () => void;
}) {
  const mapThemeId = option.mapThemeId ?? null;
  const [manifest, setManifest] = useState<VoxelMapManifest | null>(null);
  const previewThemeId = mapThemeId ?? manifest?.themeId ?? null;
  const optionIdentity = `${option.pregeneratedMapId ?? ''}:${option.mapArtifactId ?? ''}`;
  const optionKey = manifest
    ? `${manifest.id}:${previewThemeId}:${option.id}:${optionIdentity}`
    : `${option.seed}:${mapThemeId ?? ''}:${option.mapProfileId ?? 'arena'}:${option.mapSize}:${optionIdentity}:loading`;
  const materialQuality = useSettingsStore((state) => state.settings.materialQuality);
  const [readyKey, setReadyKey] = useState<string | null>(null);
  const mapReady = readyKey === optionKey;

  useEffect(() => {
    let cancelled = false;

    setManifest(null);
    setReadyKey(null);
    requestMapPreviewManifest({
      seed: option.seed,
      themeId: mapThemeId,
      mapSize: option.mapSize,
      mapProfileId: option.mapProfileId,
    })
      .then((nextManifest) => {
        if (!cancelled) setManifest(nextManifest);
      })
      .catch((error) => {
        if (!cancelled) {
          console.warn('[MapVote] Failed to generate map preview manifest', option.id, error);
          onFailed();
        }
      });

    return () => {
      cancelled = true;
    };
  }, [mapThemeId, onFailed, option.id, option.mapProfileId, option.mapSize, option.seed]);

  const handleMapReady = useCallback(() => {
    setReadyKey(optionKey);
  }, [optionKey]);

  if (!manifest) return null;
  const theme = manifest.theme;

  return (
    <Canvas
      dpr={1}
      camera={{ fov: 52, near: 0.1, far: 500, position: [8, 22, 40] }}
      gl={{
        antialias: true,
        preserveDrawingBuffer: true,
        powerPreference: 'low-power',
      }}
      onCreated={({ gl }) => {
        suppressExpectedContextLossLog(gl);
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.05;
        gl.shadowMap.enabled = false;
      }}
      style={{
        position: 'absolute',
        inset: 0,
        background: theme.skyColor,
      }}
    >
      <Suspense fallback={null}>
        <PreviewCamera manifest={manifest} />
        <ambientLight intensity={0.72} color={theme.ambientColor} />
        <hemisphereLight args={[theme.skyColor, theme.ground.side, 1.45]} />
        <directionalLight position={[48, 80, 36]} intensity={3.8} color={theme.sunColor} />
        <directionalLight position={[-50, 34, -58]} intensity={0.72} color={theme.structures.glass} />
        <VoxelMap
          seed={option.seed}
          manifest={manifest}
          themeId={previewThemeId}
          mapProfileId={option.mapProfileId}
          mapSize={manifest.mapSize}
          enablePhysics={false}
          shadowsEnabled={false}
          dressingShadows={false}
          dressingDensity={0.5}
          reflectionIntensity={0.35}
          materialQuality={materialQuality}
          performanceBudget={MAP_PREVIEW_PERFORMANCE_BUDGET}
          meshBuildMode="async"
          progressiveReveal
          disposeGeometryCacheOnUnmount={false}
          onReady={handleMapReady}
        />
        <fogExp2 attach="fog" args={[theme.fogColor, 0.0048]} />
        <color attach="background" args={[theme.skyColor]} />
        <CaptureFrame captureKey={optionKey} ready={mapReady} onCapture={onCapture} />
      </Suspense>
    </Canvas>
  );
}

function MapPreviewImage({
  active,
  option,
  onReady,
}: {
  active: boolean;
  option: MapVoteOption;
  onReady: (optionId: string) => void;
}) {
  const [image, setImage] = useState<string | null>(null);
  const [imageVisible, setImageVisible] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);
  const didReportReadyRef = useRef(false);

  useEffect(() => {
    setImage(null);
    setImageVisible(false);
    setPreviewFailed(false);
    didReportReadyRef.current = false;
  }, [option.id, option.mapArtifactId, option.mapProfileId, option.mapSize, option.mapThemeId, option.pregeneratedMapId, option.seed]);

  useEffect(() => {
    if (!image) {
      setImageVisible(false);
      return undefined;
    }

    const frame = window.requestAnimationFrame(() => {
      setImageVisible(true);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [image]);

  const reportReady = useCallback(() => {
    if (didReportReadyRef.current) return;
    didReportReadyRef.current = true;
    onReady(option.id);
  }, [onReady, option.id]);

  const handleCapture = useCallback((capturedImage: string) => {
    setImage((current) => current ?? capturedImage);
    reportReady();
  }, [reportReady]);

  const handleFailed = useCallback(() => {
    setPreviewFailed(true);
    reportReady();
  }, [reportReady]);

  const hasVisibleImage = Boolean(image && imageVisible);

  return (
    <div className="absolute inset-0">
      <div className={`pointer-events-none absolute inset-0 bg-black/[0.08] transition-opacity duration-300 ease-out ${hasVisibleImage ? 'opacity-100' : 'opacity-0'}`} />
      {image && (
        <img
          src={image}
          alt={option.name}
          className={`h-full w-full object-cover transition-opacity duration-300 ease-out ${hasVisibleImage ? 'opacity-[0.84]' : 'opacity-0'}`}
          draggable={false}
        />
      )}
      {!image && active && !previewFailed && (
        <div className="pointer-events-none absolute inset-0 opacity-0">
          <MapPreviewCanvas option={option} onCapture={handleCapture} onFailed={handleFailed} />
        </div>
      )}
      <div className={`pointer-events-none absolute inset-0 transition-opacity duration-200 ease-out ${hasVisibleImage ? 'opacity-0' : 'opacity-100'}`}>
        {previewFailed && !image ? <PreviewUnavailablePanel /> : <GeneratingMapPanel />}
      </div>
      <div className={`pointer-events-none absolute inset-0 bg-gradient-to-t from-black/[0.36] via-black/[0.05] to-black/[0.025] transition-opacity duration-300 ease-out ${hasVisibleImage ? 'opacity-100' : 'opacity-0'}`} />
    </div>
  );
}

function GeneratingMapPanel() {
  return (
    <div className="absolute inset-0 bg-black/[0.14] backdrop-blur-xl">
      <div className="absolute inset-0 bg-gradient-to-b from-white/[0.014] via-transparent to-black/[0.12]" />
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/15 border-t-orange-500" />
        <p className="font-display text-sm uppercase tracking-wide text-white/70">
          Generating Map
        </p>
      </div>
    </div>
  );
}

// Static stand-in when preview capture fails: the card stays votable, so show
// a calm placeholder instead of a spinner that never resolves.
function PreviewUnavailablePanel() {
  return (
    <div className="absolute inset-0 bg-strike-panel/80">
      <div className="absolute inset-0 bg-gradient-to-b from-white/[0.02] via-transparent to-black/[0.2]" />
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
        <svg className="h-7 w-7 text-white/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
        </svg>
        <p className="font-display text-sm uppercase tracking-wide text-white/55">
          Preview Unavailable
        </p>
      </div>
    </div>
  );
}

type MapVoteBadgeTone = 'idle' | 'selected' | 'winner';

const mapVoteCardClass = 'map-vote-card group relative overflow-hidden rounded-2xl border bg-strike-bg/40 shadow-2xl shadow-black/40';
const mapVoteCardMetaClass = 'map-vote-card-meta absolute inset-x-0 bottom-0 z-10 px-4 pb-4 pt-14 xl:px-5';
const GOLDEN_MAP_CARD_SHADOW = '0 20px 60px rgba(0,0,0,0.48), 0 0 34px rgb(var(--color-map-golden-glow) / 0.38), inset 0 0 0 1px rgb(var(--color-map-golden-highlight) / 0.2)';

function isGoldenMapOption(option: MapVoteOption): boolean {
  return option.mapThemeId === GOLDEN_VOXEL_MAP_THEME_ID || option.themeId === GOLDEN_VOXEL_MAP_THEME_ID;
}

function getVoteBadgeStyle(tone: MapVoteBadgeTone) {
  if (tone === 'winner') {
    return {
      background: 'rgb(var(--color-ui-success) / 0.22)',
      color: 'rgb(var(--color-ui-success-light))',
      borderColor: 'rgb(var(--color-ui-success) / 0.32)',
    };
  }

  if (tone === 'selected') {
    return {
      background: 'rgb(var(--color-accent-primary) / 0.2)',
      color: 'rgb(var(--color-accent-primary-hover))',
      borderColor: 'rgb(var(--color-accent-primary) / 0.32)',
    };
  }

  return {
    background: 'linear-gradient(180deg, rgb(var(--color-accent-primary) / 0.22), rgb(var(--color-accent-primary) / 0.12))',
    color: 'rgb(var(--color-accent-primary-hover))',
    borderColor: 'rgb(var(--color-accent-primary) / 0.34)',
  };
}

function MapVoteCardMeta({
  titleLabel,
  voteCount,
  badgeLabel,
  badgeTone = 'idle',
}: {
  titleLabel: string;
  voteCount: number;
  badgeLabel: string;
  badgeTone?: MapVoteBadgeTone;
}) {
  return (
    <div className={mapVoteCardMetaClass}>
      <div className="relative flex min-h-11 items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-display text-lg leading-none text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.85)] xl:text-xl">{titleLabel}</p>
          <p className="mt-2 flex items-center gap-1.5 truncate font-display text-[10px] uppercase tracking-[0.14em] text-white/65 drop-shadow-[0_1px_4px_rgba(0,0,0,0.9)]">
            <VotersGlyph className="h-3 w-3 shrink-0 text-white/55" />
            {getVoteLabel(voteCount)}
          </p>
        </div>

        <span
          className="map-vote-vote-btn flex shrink-0 items-center gap-1 rounded-full border px-3.5 py-2 font-display text-[11px] uppercase tracking-[0.14em] shadow-lg shadow-black/40 transition-all duration-150"
          style={getVoteBadgeStyle(badgeTone)}
        >
          {badgeLabel}
          {badgeTone !== 'winner' && <ArrowGlyph className="map-vote-vote-arrow h-3 w-3 transition-transform duration-150" />}
        </span>
      </div>
    </div>
  );
}

function PreparingMapCard() {
  return (
    <div className={`${mapVoteCardClass} map-vote-preparing-card border-white/[0.16]`} aria-hidden="true">
      <div className="map-vote-preview absolute inset-0 overflow-hidden">
        <GeneratingMapPanel />
        <div className="map-vote-scrim pointer-events-none absolute inset-0" />
      </div>
      <MapVoteCardMeta titleLabel="Preparing Map" voteCount={0} badgeLabel="Vote" />
    </div>
  );
}

function getVoteLabel(count: number): string {
  return count === 1 ? '1 vote' : `${count} votes`;
}

function getMapSizeLabel(option: MapVoteOption): string {
  if (option.mapSizeLabel) return option.mapSizeLabel;
  if (!option.mapSize) return 'Medium';

  return `${option.mapSize.charAt(0).toUpperCase()}${option.mapSize.slice(1)}`;
}

function getMapSizeBadgeStyle(option: MapVoteOption) {
  switch (option.mapSize) {
    case 'small':
      return {
        background: 'rgb(var(--color-ui-success) / 0.2)',
        borderColor: 'rgb(var(--color-ui-success) / 0.34)',
        color: 'rgb(var(--color-ui-success-light))',
      };
    case 'large':
      return {
        background: 'rgb(var(--color-accent-primary) / 0.22)',
        borderColor: 'rgb(var(--color-accent-primary) / 0.36)',
        color: 'rgb(var(--color-accent-primary-hover))',
      };
    case 'medium':
    default:
      return {
        background: 'rgba(255,255,255,0.12)',
        borderColor: 'rgba(255,255,255,0.24)',
        color: 'rgba(255,255,255,0.86)',
      };
  }
}

export function MapVoteScreen() {
  const {
    playerName,
    playerId,
    lobbyPlayers,
    mapVoteOptions,
    mapVotes,
    mapVotePhaseEndTime,
    selectedMapOptionId,
    userStats,
  } = useGameStore(
    useShallow((state) => ({
      playerName: state.playerName,
      playerId: state.playerId,
      lobbyPlayers: state.lobbyPlayers,
      mapVoteOptions: state.mapVoteOptions,
      mapVotes: state.mapVotes,
      mapVotePhaseEndTime: state.mapVotePhaseEndTime,
      selectedMapOptionId: state.selectedMapOptionId,
      userStats: state.userStats,
    }))
  );
  const { leaveLobby, voteMap, reportMapVotePreviewsReady } = useNetwork();
  const { playButtonClick } = useUISounds();
  const [thumbnailReadyIds, setThumbnailReadyIds] = useState<Set<string>>(() => new Set());
  const [pendingVoteOptionId, setPendingVoteOptionId] = useState<string | null>(null);
  const reportedPreviewSignatureRef = useRef('');

  const mapOptionSignature = useMemo(
    () => mapVoteOptions.map((option) => `${option.id}:${option.pregeneratedMapId ?? option.seed}:${option.mapArtifactId ?? ''}:${option.mapThemeId ?? ''}:${option.mapProfileId ?? ''}:${option.mapSize}`).join('|'),
    [mapVoteOptions]
  );

  useEffect(() => {
    setThumbnailReadyIds(new Set());
    reportedPreviewSignatureRef.current = '';
  }, [mapOptionSignature]);

  const playerList = useMemo(() => Array.from(lobbyPlayers.values()), [lobbyPlayers]);
  const currentPlayer = playerId ? lobbyPlayers.get(playerId) : null;
  const currentFaction = currentPlayer?.team === 'red' ? FACTIONS.red : currentPlayer?.team === 'blue' ? FACTIONS.blue : null;
  const currentRank = currentPlayer?.rank ?? getRankForStats(userStats);
  const localVote = playerId ? mapVotes.get(playerId) ?? null : null;
  const visibleVoteOptionId = pendingVoteOptionId ?? localVote;
  const isFinalized = Boolean(selectedMapOptionId);
  const isPreparingMaps = mapVoteOptions.length === 0;
  const expectedMapOptionCount = 3;
  const areMapPreviewsReady = mapVoteOptions.length > 0;
  const isVoteTimerStarted = Boolean(mapVotePhaseEndTime);
  const canSubmitVote = Boolean(
    pendingVoteOptionId &&
    pendingVoteOptionId !== localVote &&
    isVoteTimerStarted &&
    !isFinalized
  );
  const activePreviewOptionId = useMemo(
    () => mapVoteOptions.find((option) => !thumbnailReadyIds.has(option.id))?.id ?? null,
    [mapVoteOptions, thumbnailReadyIds]
  );
  const votersByOption = useMemo(() => {
    const groups = new Map<string, LobbyPlayer[]>();
    for (const option of mapVoteOptions) {
      groups.set(option.id, []);
    }

    for (const player of playerList) {
      const optionId = mapVotes.get(player.id);
      if (!optionId) continue;
      const voters = groups.get(optionId);
      if (voters) voters.push(player);
    }

    return groups;
  }, [mapVoteOptions, mapVotes, playerList]);

  useEffect(() => {
    const hasPendingOption = pendingVoteOptionId
      ? mapVoteOptions.some((option) => option.id === pendingVoteOptionId)
      : false;
    if (hasPendingOption && pendingVoteOptionId !== localVote) return;
    setPendingVoteOptionId(localVote);
  }, [localVote, mapOptionSignature, mapVoteOptions, pendingVoteOptionId]);

  const handleSelectOption = (optionId: string) => {
    if (isFinalized || !isVoteTimerStarted) return;
    playButtonClick();
    setPendingVoteOptionId(optionId);
  };

  const handleSubmitVote = () => {
    if (!pendingVoteOptionId || !canSubmitVote) return;
    playButtonClick();
    voteMap(pendingVoteOptionId);
  };

  const handlePreviewReady = useCallback((optionId: string) => {
    setThumbnailReadyIds((current) => {
      if (current.has(optionId)) return current;
      const next = new Set(current);
      next.add(optionId);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!areMapPreviewsReady || isVoteTimerStarted || reportedPreviewSignatureRef.current === mapOptionSignature) {
      return;
    }

    reportedPreviewSignatureRef.current = mapOptionSignature;
    reportMapVotePreviewsReady();
  }, [areMapPreviewsReady, isVoteTimerStarted, mapOptionSignature, reportMapVotePreviewsReady]);

  const handleLeave = () => {
    playButtonClick();
    leaveLobby();
  };

  return (
    <div className="menu-screen map-vote-screen bg-strike-bg">
      <div className="absolute inset-0">
        <div
          className="absolute inset-0 bg-cover bg-center bg-no-repeat"
          style={{ backgroundImage: 'url(/bg.jpg)' }}
        />
        <div
          className="absolute inset-0"
          style={{
            background: 'linear-gradient(to bottom, rgb(var(--color-strike-page-top) / 0.9), rgb(var(--color-strike-page-mid) / 0.84), rgb(var(--color-strike-page-bottom) / 0.96))',
          }}
        />
        <div
          className="absolute left-0 top-0 h-full w-1/2 opacity-20"
          style={{
            background: `radial-gradient(ellipse 70% 50% at 20% 50%, ${FACTIONS.red.glowColor} 0%, transparent 70%)`,
          }}
        />
        <div
          className="absolute right-0 top-0 h-full w-1/2 opacity-20"
          style={{
            background: `radial-gradient(ellipse 70% 50% at 80% 50%, ${FACTIONS.blue.glowColor} 0%, transparent 70%)`,
          }}
        />
        <div className="absolute inset-0 pattern-grid opacity-10" />
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ boxShadow: 'inset 0 0 210px 86px rgba(0,0,0,0.72)' }}
        />
      </div>

      <nav className="absolute left-0 right-0 top-0 z-20">
        <div className="menu-nav map-vote-nav relative flex items-center justify-between gap-4">
          <div className="map-vote-title-group flex min-w-0 items-center gap-3 xl:gap-4">
            <button
              type="button"
              onClick={handleLeave}
              className="menu-back-button map-vote-back-button"
              aria-label="Leave lobby"
            >
              <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>

            <div className="min-w-0">
              <h1 className="map-vote-title font-display translate-y-[0.08em] truncate text-2xl leading-none text-white xl:text-3xl">
                Map Vote
              </h1>
            </div>
          </div>

          <PhaseCountdownTimer phaseEndTime={mapVotePhaseEndTime} className="map-vote-timer" />

          <div className="map-vote-profile flex shrink-0 items-center gap-3">
            <div className="map-vote-profile-avatar flex h-9 w-9 items-center justify-center" title={currentRank.label}>
              <RankIcon rank={currentRank} size={34} labelled />
            </div>
            <div className="map-vote-profile-copy">
              <p className="font-display text-sm text-white">{playerName}</p>
              <p className="font-body text-[10px]" style={{ color: currentFaction?.primaryColor || 'rgba(255,255,255,0.4)' }}>
                {currentFaction?.fullName || 'Unassigned'}
              </p>
            </div>
          </div>
        </div>
      </nav>

      <main className="menu-main map-vote-main z-10">
        <div className="map-vote-content menu-content-wide flex h-full flex-col justify-center gap-4 py-1 xl:gap-5">
          <div className="map-vote-heading flex justify-center">
            <h2 className="font-display text-center text-2xl leading-none text-white xl:text-4xl">
              Choose the battlefield
            </h2>
          </div>

          <div className="map-vote-grid mx-auto grid w-full min-h-0 max-w-[72rem] grid-cols-1 gap-3 lg:grid-cols-3 xl:gap-4">
            {isPreparingMaps && Array.from({ length: expectedMapOptionCount }, (_, index) => (
              <PreparingMapCard key={index} />
            ))}

            {mapVoteOptions.map((option) => {
              const voters = votersByOption.get(option.id) || [];
              const isSubmittedVote = localVote === option.id;
              const isSelected = visibleVoteOptionId === option.id;
              const isWinner = selectedMapOptionId === option.id;
              const isGoldenBiome = isGoldenMapOption(option);
              const canVoteForOption = isVoteTimerStarted && !isFinalized;
              const voteBadgeLabel = isWinner
                ? 'Locked'
                : isSubmittedVote
                  ? 'Picked'
                  : isSelected
                    ? 'Selected'
                  : localVote
                    ? 'Change'
                    : isVoteTimerStarted
                      ? 'Vote'
                      : 'Preparing';
              const cardBorderClass = isGoldenBiome
                ? 'map-vote-card-golden'
                : isWinner
                  ? 'border-ui-success/70 hover:border-ui-success'
                  : isSelected
                    ? 'border-accent-primary/70 hover:border-accent-primary'
                    : 'border-white/[0.16] hover:border-orange-500/70';

              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => handleSelectOption(option.id)}
                  disabled={!canVoteForOption}
                  className={`${mapVoteCardClass} text-left outline-none focus-visible:ring-2 focus-visible:ring-accent-primary/70 disabled:cursor-default disabled:hover:border-white/[0.16] ${canVoteForOption ? 'cursor-pointer' : ''} ${cardBorderClass}`}
                  style={{
                    boxShadow: isGoldenBiome
                      ? GOLDEN_MAP_CARD_SHADOW
                      : isSelected || isWinner
                        ? `0 20px 60px rgba(0,0,0,0.48), 0 0 28px ${isWinner ? 'rgb(var(--color-ui-success) / 0.28)' : 'rgb(var(--color-accent-primary) / 0.25)'}`
                        : undefined,
                  }}
                >
                  <div className="map-vote-preview absolute inset-0 overflow-hidden">
                    <MapPreviewImage
                      active={activePreviewOptionId === option.id}
                      option={option}
                      onReady={handlePreviewReady}
                    />
                    <div className="map-vote-scrim pointer-events-none absolute inset-0" />
                  </div>
                  <div
                    className="absolute left-3 top-3 z-10 flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-display text-[10px] uppercase tracking-wider shadow-lg shadow-black/40 backdrop-blur-md"
                    style={getMapSizeBadgeStyle(option)}
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-current shadow-[0_0_6px_currentColor]" />
                    {getMapSizeLabel(option)}
                  </div>
                  {(isSelected || isWinner) && (
                    <div
                      className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full border shadow-lg shadow-black/40 backdrop-blur-md"
                      style={{
                        background: isWinner ? 'rgb(var(--color-ui-success) / 0.32)' : 'rgb(var(--color-accent-primary) / 0.32)',
                        borderColor: isWinner ? 'rgb(var(--color-ui-success) / 0.6)' : 'rgb(var(--color-accent-primary) / 0.6)',
                        color: isWinner ? 'rgb(var(--color-ui-success-light))' : 'rgb(var(--color-accent-primary-hover))',
                      }}
                    >
                      <CheckGlyph className="h-4 w-4" />
                    </div>
                  )}

                  <MapVoteCardMeta
                    titleLabel={option.name}
                    voteCount={voters.length}
                    badgeLabel={voteBadgeLabel}
                    badgeTone={isWinner ? 'winner' : isSelected ? 'selected' : 'idle'}
                  />
                </button>
              );
            })}
          </div>
        </div>
      </main>

      <div
        className="map-vote-footer absolute bottom-0 left-0 right-0 z-20"
        style={{
          background: 'linear-gradient(to top, rgb(var(--color-strike-page-top) / 0.96), rgb(var(--color-strike-page-top) / 0.62), transparent)',
        }}
      >
        <div className="flex items-center justify-center py-3 xl:py-4">
          <div className="map-vote-action-bar flex items-center gap-3 rounded-full border border-white/5 bg-white/[0.035] px-4 py-2 shadow-2xl shadow-black/30 backdrop-blur-xl xl:gap-4 xl:px-5">
            <div
              className="map-vote-action-icon flex h-8 w-8 items-center justify-center rounded-lg"
              style={{ background: `${FACTIONS.red.primaryColor}20`, color: FACTIONS.red.primaryColor }}
            >
              <MapGlyph className="h-4 w-4" />
            </div>

            <button
              type="button"
              onClick={handleSubmitVote}
              disabled={!canSubmitVote}
              className="map-vote-lock-status h-10 min-w-[13rem] rounded-full px-5 font-display text-xs uppercase tracking-wide text-white transition-all hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-white/[0.055] disabled:text-white/30"
              style={canSubmitVote ? {
                background: 'linear-gradient(135deg, rgb(var(--color-ui-success)) 0%, rgb(var(--color-ui-success-deep)) 100%)',
                boxShadow: '0 0 32px rgb(var(--color-ui-success) / 0.28)',
              } : undefined}
            >
              {isFinalized
                ? 'Launching'
                  : canSubmitVote
                  ? localVote ? 'Change Vote' : 'Vote'
                  : !isVoteTimerStarted
                    ? 'Preparing'
                    : localVote ? 'Vote Submitted' : 'Select Map'}
            </button>

            <div
              className="map-vote-action-icon flex h-8 w-8 items-center justify-center rounded-lg"
              style={{ background: `${FACTIONS.blue.primaryColor}20`, color: FACTIONS.blue.primaryColor }}
            >
              <ClockGlyph className="h-4 w-4" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

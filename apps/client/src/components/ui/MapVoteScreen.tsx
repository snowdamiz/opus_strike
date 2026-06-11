import { Canvas, useThree } from '@react-three/fiber';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { generateProceduralVoxelMap } from '@voxel-strike/shared';
import type { VoxelMapManifest } from '@voxel-strike/shared';
import { useGameStore, type LobbyPlayer, type MapVoteOption } from '../../store/gameStore';
import { useNetwork } from '../../contexts/NetworkContext';
import { useUISounds } from '../../hooks/useAudio';
import { FACTIONS } from '../../styles/colorTokens';
import { VoxelMap } from '../game/procedural';
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

function CaptureFrame({
  seed,
  ready,
  onCapture,
}: {
  seed: number;
  ready: boolean;
  onCapture: (image: string) => void;
}) {
  const { gl, scene, camera } = useThree();
  const capturedRef = useRef(false);

  useEffect(() => {
    capturedRef.current = false;
  }, [seed]);

  useEffect(() => {
    if (!ready || capturedRef.current) return;

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
  }, [camera, gl, onCapture, ready, scene, seed]);

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

function MapPreviewCanvas({
  option,
  onCapture,
}: {
  option: MapVoteOption;
  onCapture: (image: string) => void;
}) {
  const manifest = useMemo(() => generateProceduralVoxelMap(option.seed), [option.seed]);
  const theme = manifest.theme;
  const [readySeed, setReadySeed] = useState<number | null>(null);
  const mapReady = readySeed === option.seed;

  const handleMapReady = useCallback(() => {
    setReadySeed(option.seed);
  }, [option.seed]);

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
          enablePhysics={false}
          shadowsEnabled={false}
          dressingShadows={false}
          dressingDensity={0.5}
          reflectionIntensity={0.35}
          materialDetail="medium"
          meshBuildMode="sync"
          progressiveReveal={false}
          onReady={handleMapReady}
        />
        <fogExp2 attach="fog" args={[theme.fogColor, 0.0048]} />
        <color attach="background" args={[theme.skyColor]} />
        <CaptureFrame seed={option.seed} ready={mapReady} onCapture={onCapture} />
      </Suspense>
    </Canvas>
  );
}

function MapPreviewImage({
  option,
  onReady,
}: {
  option: MapVoteOption;
  onReady: (optionId: string) => void;
}) {
  const [image, setImage] = useState<string | null>(null);
  const [imageVisible, setImageVisible] = useState(false);
  const [shouldRenderPreview, setShouldRenderPreview] = useState(false);
  const didReportReadyRef = useRef(false);

  useEffect(() => {
    setImage(null);
    setImageVisible(false);
    setShouldRenderPreview(false);
    didReportReadyRef.current = false;

    let firstFrame = 0;
    let secondFrame = 0;

    firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        setShouldRenderPreview(true);
      });
    });

    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [option.seed]);

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

  const handleCapture = useCallback((capturedImage: string) => {
    setImage((current) => current ?? capturedImage);
    if (!didReportReadyRef.current) {
      didReportReadyRef.current = true;
      onReady(option.id);
    }
  }, [onReady, option.id]);

  return (
    <div className="absolute inset-0 bg-black/[0.08]">
      {image && (
        <img
          src={image}
          alt={option.name}
          className={`h-full w-full object-cover transition-opacity duration-300 ease-out ${imageVisible ? 'opacity-[0.84]' : 'opacity-0'}`}
          draggable={false}
        />
      )}
      {!image && shouldRenderPreview && (
        <div className="pointer-events-none absolute inset-0 opacity-0">
          <MapPreviewCanvas option={option} onCapture={handleCapture} />
        </div>
      )}
      <div className={`pointer-events-none absolute inset-0 transition-opacity duration-200 ease-out ${image && imageVisible ? 'opacity-0' : 'opacity-100'}`}>
        <GeneratingMapPanel />
      </div>
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/[0.36] via-black/[0.05] to-black/[0.025]" />
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

function PreparingMapCard() {
  return (
    <div className="map-vote-card map-vote-preparing-card relative overflow-hidden rounded-lg border border-white/[0.08] bg-black/[0.1] shadow-2xl shadow-black/[0.26] backdrop-blur-xl">
      <div className="map-vote-preview relative aspect-[16/8.4] overflow-hidden border-b border-white/[0.06]">
        <GeneratingMapPanel />
      </div>
      <div
        className="map-vote-card-meta relative overflow-hidden border-t border-white/[0.045] bg-black/[0.025] px-3.5 py-2.5 xl:px-4"
        style={{ backdropFilter: 'brightness(0.42) blur(2px)' }}
      >
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/[0.02] via-transparent to-black/[0.07]" />
        <div className="relative flex min-h-9 items-center justify-between gap-3">
          <div className="h-5 w-20 rounded bg-white/[0.04]" />
          <div className="h-7 w-14 rounded-full border border-white/[0.06] bg-white/[0.035]" />
        </div>
      </div>
    </div>
  );
}

function getVoteLabel(count: number): string {
  return count === 1 ? '1 vote' : `${count} votes`;
}

export function MapVoteScreen() {
  const {
    playerName,
    playerId,
    lobbyPlayers,
    isLobbyHost,
    mapVoteOptions,
    mapVotes,
    mapVotePhaseEndTime,
    selectedMapOptionId,
    userStats,
  } = useGameStore();
  const { leaveLobby, voteMap, reportMapVotePreviewsReady, finalizeMapVote } = useNetwork();
  const { playButtonClick } = useUISounds();
  const [readyPreviewIds, setReadyPreviewIds] = useState<Set<string>>(() => new Set());
  const reportedPreviewSignatureRef = useRef('');

  const mapOptionSignature = useMemo(
    () => mapVoteOptions.map((option) => `${option.id}:${option.seed}`).join('|'),
    [mapVoteOptions]
  );

  useEffect(() => {
    setReadyPreviewIds(new Set());
    reportedPreviewSignatureRef.current = '';
  }, [mapOptionSignature]);

  const playerList = useMemo(() => Array.from(lobbyPlayers.values()), [lobbyPlayers]);
  const currentPlayer = playerId ? lobbyPlayers.get(playerId) : null;
  const currentFaction = currentPlayer?.team === 'red' ? FACTIONS.red : currentPlayer?.team === 'blue' ? FACTIONS.blue : null;
  const currentRank = currentPlayer?.rank ?? getRankForStats(userStats);
  const localVote = playerId ? mapVotes.get(playerId) ?? null : null;
  const isFinalized = Boolean(selectedMapOptionId);
  const isPreparingMaps = mapVoteOptions.length === 0;
  const areMapPreviewsReady = mapVoteOptions.length > 0 && readyPreviewIds.size >= mapVoteOptions.length;
  const isVoteTimerStarted = Boolean(mapVotePhaseEndTime);

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

  const handleVote = (optionId: string) => {
    if (isFinalized || localVote === optionId) return;
    playButtonClick();
    voteMap(optionId);
  };

  const handlePreviewReady = useCallback((optionId: string) => {
    setReadyPreviewIds((current) => {
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

  const handleFinalize = () => {
    if (isFinalized || mapVoteOptions.length === 0 || !isVoteTimerStarted) return;
    playButtonClick();
    finalizeMapVote();
  };

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
              className="map-vote-back-button flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-white/60 transition-colors hover:border-white/20 hover:bg-white/10 hover:text-white"
              aria-label="Leave lobby"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
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

          <div
            className="map-vote-profile flex shrink-0 items-center gap-3 rounded-xl border py-2 pl-2 pr-4"
            style={{
              background: currentFaction
                ? `linear-gradient(135deg, ${currentFaction.bgGradient}, rgb(var(--color-strike-panel-raised) / 0.9))`
                : 'rgba(255,255,255,0.03)',
              borderColor: currentFaction?.borderColor || 'rgba(255,255,255,0.05)',
            }}
          >
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

          <div className="map-vote-grid mx-auto grid w-full max-w-[72rem] min-h-0 grid-cols-1 gap-3 lg:grid-cols-3 xl:gap-4">
            {isPreparingMaps && [0, 1, 2].map((index) => (
              <PreparingMapCard key={index} />
            ))}

            {mapVoteOptions.map((option) => {
              const voters = votersByOption.get(option.id) || [];
              const isSelected = localVote === option.id;
              const isWinner = selectedMapOptionId === option.id;
              const cardBorderClass = isWinner
                ? 'border-ui-success/70 hover:border-ui-success'
                : isSelected
                  ? 'border-accent-primary/70 hover:border-accent-primary'
                  : 'border-white/[0.16] hover:border-orange-500/70';

              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => handleVote(option.id)}
                  disabled={isFinalized}
                  className={`map-vote-card relative overflow-hidden rounded-lg border bg-black/[0.1] text-left shadow-2xl shadow-black/[0.26] outline-none backdrop-blur-xl focus-visible:ring-2 focus-visible:ring-accent-primary/70 disabled:cursor-default ${cardBorderClass}`}
                  style={{
                    boxShadow: isSelected || isWinner
                      ? `0 20px 60px rgba(0,0,0,0.48), 0 0 28px ${isWinner ? 'rgb(var(--color-ui-success) / 0.28)' : 'rgb(var(--color-accent-primary) / 0.25)'}`
                      : undefined,
                  }}
                >
                  <div className="map-vote-preview relative aspect-[16/8.4] overflow-hidden border-b border-white/[0.06]">
                    <MapPreviewImage option={option} onReady={handlePreviewReady} />
                    {(isSelected || isWinner) && (
                      <div
                        className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-lg border backdrop-blur-md"
                        style={{
                          background: isWinner ? 'rgb(var(--color-ui-success) / 0.22)' : 'rgb(var(--color-accent-primary) / 0.22)',
                          borderColor: isWinner ? 'rgb(var(--color-ui-success) / 0.45)' : 'rgb(var(--color-accent-primary) / 0.45)',
                          color: isWinner ? 'rgb(var(--color-ui-success-light))' : 'rgb(var(--color-accent-primary-hover))',
                        }}
                      >
                        <CheckGlyph className="h-4 w-4" />
                      </div>
                    )}
                  </div>

                  <div
                    className="map-vote-card-meta relative overflow-hidden border-t border-white/[0.045] bg-black/[0.025] px-3.5 py-2.5 xl:px-4"
                    style={{ backdropFilter: 'brightness(0.42) blur(2px)' }}
                  >
                    <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/[0.02] via-transparent to-black/[0.07]" />
                    <div className="relative flex min-h-9 items-center justify-between gap-3">
                      <p className="shrink-0 font-display text-lg leading-none text-white">{getVoteLabel(voters.length)}</p>

                      <span
                        className="rounded-full border px-3 py-1.5 font-display text-[11px] uppercase tracking-wide transition-colors"
                        style={{
                          background: isSelected || isWinner
                            ? isWinner
                              ? 'rgb(var(--color-ui-success) / 0.22)'
                              : 'rgb(var(--color-accent-primary) / 0.2)'
                            : 'rgba(255,255,255,0.035)',
                          color: isWinner
                            ? 'rgb(var(--color-ui-success-light))'
                            : isSelected
                              ? 'rgb(var(--color-accent-primary-hover))'
                              : 'rgba(255,255,255,0.58)',
                          borderColor: isWinner
                            ? 'rgb(var(--color-ui-success) / 0.32)'
                            : isSelected
                              ? 'rgb(var(--color-accent-primary) / 0.32)'
                              : 'rgba(255,255,255,0.08)',
                        }}
                      >
                        {isWinner ? 'Locked' : isSelected ? 'Picked' : 'Vote'}
                      </span>
                    </div>
                  </div>
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

            {isLobbyHost ? (
              <button
                type="button"
                onClick={handleFinalize}
                disabled={isFinalized || mapVoteOptions.length === 0 || !isVoteTimerStarted}
                className="map-vote-lock-button h-10 min-w-[13rem] rounded-full px-5 font-display text-xs uppercase tracking-wide text-white transition-all hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-white/[0.055] disabled:text-white/30"
                style={!isFinalized && mapVoteOptions.length > 0 && isVoteTimerStarted ? {
                  background: 'linear-gradient(135deg, rgb(var(--color-ui-success)) 0%, rgb(var(--color-ui-success-deep)) 100%)',
                  boxShadow: '0 0 32px rgb(var(--color-ui-success) / 0.28)',
                } : undefined}
              >
                {isFinalized ? 'Launching' : isVoteTimerStarted ? 'Lock Vote' : 'Generating'}
              </button>
            ) : (
              <div className="map-vote-lock-status flex h-10 min-w-[13rem] items-center justify-center rounded-full bg-white/[0.055] px-5 font-display text-xs uppercase tracking-wide text-white/[0.42]">
                {localVote ? 'Vote Locked' : 'Awaiting Vote'}
              </div>
            )}

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

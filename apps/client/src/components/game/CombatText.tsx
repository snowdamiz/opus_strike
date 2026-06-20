import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Player, PlayerMovementState } from '@voxel-strike/shared';
import { useCombatFeedbackStore, type CombatTextEvent, type CombatTextKind } from '../../store/combatFeedbackStore';
import { useGameStore } from '../../store/gameStore';
import { visualStore } from '../../store/visualStore';
import { getFrameClock } from '../../utils/frameClock';
import { getCombatTextWorldY } from './playerWorldAnchors';

interface CombatTextLayerProps {
  enabled: boolean;
}

const COMBAT_TEXT_DURATION_MS = 1360;
const COMBAT_TEXT_CANVAS_WIDTH = 384;
const COMBAT_TEXT_CANVAS_HEIGHT = 192;
const COMBAT_TEXT_ASPECT = COMBAT_TEXT_CANVAS_WIDTH / COMBAT_TEXT_CANVAS_HEIGHT;
const STACKED_TEXT_GAP_Y = 0.34;
const COMBAT_TEXT_TEXTURE_CACHE_LIMIT = 96;
const COMBAT_TEXT_PREWARM_AMOUNTS = [
  1,
  5,
  6,
  10,
  12,
  14,
  15,
  16,
  18,
  20,
  24,
  25,
  30,
  40,
  50,
  51,
  70,
  75,
  100,
  150,
  200,
] as const;
const DEFAULT_MOVEMENT: PlayerMovementState = Object.freeze({
  isGrounded: true,
  isSprinting: false,
  isCrouching: false,
  isSliding: false,
  slideTimeRemaining: 0,
  isWallRunning: false,
  wallRunSide: null,
  isGrappling: false,
  grapplePoint: null,
  isJetpacking: false,
  jetpackFuel: 0,
  isGliding: false,
});

interface CombatTextTextureEntry {
  texture: THREE.CanvasTexture;
  refCount: number;
  lastUsedAt: number;
}

const combatTextTextureCache = new Map<string, CombatTextTextureEntry>();
let combatTextTextureUseCounter = 0;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function easeOutCubic(value: number): number {
  const inverted = 1 - value;
  return 1 - inverted * inverted * inverted;
}

function easeInCubic(value: number): number {
  return value * value * value;
}

function easeOutBack(value: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(value - 1, 3) + c1 * Math.pow(value - 1, 2);
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function combatTextStackKey(event: CombatTextEvent): string {
  if (event.targetId) return event.targetId;
  return `${Math.round(event.position.x * 2)}:${Math.round(event.position.y * 2)}:${Math.round(event.position.z * 2)}`;
}

function getCombatTextColors(kind: CombatTextKind): {
  top: string;
  middle: string;
  bottom: string;
  glow: string;
} {
  if (kind === 'shieldDamage') {
    return {
      top: '#eff6ff',
      middle: '#93c5fd',
      bottom: '#2563eb',
      glow: 'rgba(96, 165, 250, 0.94)',
    };
  }

  if (kind === 'heal') {
    return {
      top: '#ecfccb',
      middle: '#86efac',
      bottom: '#10b981',
      glow: 'rgba(74, 222, 128, 0.92)',
    };
  }

  return {
    top: '#fff7ad',
    middle: '#fb923c',
    bottom: '#ef4444',
    glow: 'rgba(248, 113, 113, 0.96)',
  };
}

function drawShieldDamageIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  colors: ReturnType<typeof getCombatTextColors>
): void {
  const half = size * 0.52;
  const top = y - size * 0.62;
  const bottom = y + size * 0.68;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x, top);
  ctx.quadraticCurveTo(x + half, top + size * 0.08, x + half, y - size * 0.12);
  ctx.quadraticCurveTo(x + half * 0.92, y + size * 0.38, x, bottom);
  ctx.quadraticCurveTo(x - half * 0.92, y + size * 0.38, x - half, y - size * 0.12);
  ctx.quadraticCurveTo(x - half, top + size * 0.08, x, top);
  ctx.closePath();

  ctx.shadowColor = colors.glow;
  ctx.shadowBlur = 20;
  ctx.lineWidth = 12;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.92)';
  ctx.stroke();

  const gradient = ctx.createLinearGradient(x, top, x, bottom);
  gradient.addColorStop(0, colors.top);
  gradient.addColorStop(0.52, colors.middle);
  gradient.addColorStop(1, colors.bottom);
  ctx.fillStyle = gradient;
  ctx.fill();

  ctx.shadowBlur = 0;
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#dbeafe';
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(x, top + size * 0.22);
  ctx.lineTo(x, bottom - size * 0.2);
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.78)';
  ctx.stroke();
  ctx.restore();
}

function drawCombatTextTexture(canvas: HTMLCanvasElement, kind: CombatTextKind, amount: number): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const colors = getCombatTextColors(kind);
  const text = `${kind === 'heal' ? '+' : '-'}${Math.max(1, Math.round(amount))}`;
  const isShieldDamage = kind === 'shieldDamage';
  const textX = isShieldDamage ? 34 : 0;

  ctx.clearRect(0, 0, COMBAT_TEXT_CANVAS_WIDTH, COMBAT_TEXT_CANVAS_HEIGHT);
  ctx.save();
  ctx.translate(COMBAT_TEXT_CANVAS_WIDTH / 2, COMBAT_TEXT_CANVAS_HEIGHT / 2 + 4);
  ctx.rotate(kind === 'heal' ? 0.035 : -0.045);

  ctx.font = '900 92px Inter, ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;

  ctx.shadowColor = colors.glow;
  ctx.shadowBlur = 34;
  ctx.lineWidth = 18;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.92)';
  ctx.strokeText(text, textX, 0);

  ctx.shadowBlur = 20;
  ctx.lineWidth = 7;
  ctx.strokeStyle = kind === 'heal'
    ? 'rgba(6, 78, 59, 0.94)'
    : kind === 'shieldDamage'
      ? 'rgba(30, 64, 175, 0.94)'
      : 'rgba(127, 29, 29, 0.94)';
  ctx.strokeText(text, textX, 0);

  if (isShieldDamage) {
    drawShieldDamageIcon(ctx, -122, 2, 54, colors);
  }

  const gradient = ctx.createLinearGradient(0, -52, 0, 54);
  gradient.addColorStop(0, colors.top);
  gradient.addColorStop(0.44, colors.middle);
  gradient.addColorStop(1, colors.bottom);
  ctx.shadowBlur = 12;
  ctx.fillStyle = gradient;
  ctx.fillText(text, textX, 0);

  ctx.globalAlpha = 0.72;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, textX - 2, -8);
  ctx.restore();
}

function getCombatTextTextureKey(kind: CombatTextKind, amount: number): string {
  return `${kind}:${Math.max(1, Math.round(amount))}`;
}

function createCombatTextTexture(kind: CombatTextKind, amount: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = COMBAT_TEXT_CANVAS_WIDTH;
  canvas.height = COMBAT_TEXT_CANVAS_HEIGHT;

  drawCombatTextTexture(canvas, kind, amount);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}

function evictUnusedCombatTextTextures(): void {
  if (combatTextTextureCache.size <= COMBAT_TEXT_TEXTURE_CACHE_LIMIT) return;

  while (combatTextTextureCache.size > COMBAT_TEXT_TEXTURE_CACHE_LIMIT) {
    let oldestKey: string | null = null;
    let oldestEntry: CombatTextTextureEntry | null = null;

    for (const [key, entry] of combatTextTextureCache) {
      if (entry.refCount > 0) continue;
      if (!oldestEntry || entry.lastUsedAt < oldestEntry.lastUsedAt) {
        oldestKey = key;
        oldestEntry = entry;
      }
    }

    if (oldestKey === null || oldestEntry === null) return;
    oldestEntry.texture.dispose();
    combatTextTextureCache.delete(oldestKey);
  }
}

function acquireCombatTextTexture(kind: CombatTextKind, amount: number): THREE.CanvasTexture {
  const key = getCombatTextTextureKey(kind, amount);
  let entry = combatTextTextureCache.get(key);
  if (!entry) {
    entry = {
      texture: createCombatTextTexture(kind, amount),
      refCount: 0,
      lastUsedAt: 0,
    };
    combatTextTextureCache.set(key, entry);
  }

  entry.refCount++;
  entry.lastUsedAt = ++combatTextTextureUseCounter;
  evictUnusedCombatTextTextures();
  return entry.texture;
}

function releaseCombatTextTexture(kind: CombatTextKind, amount: number): void {
  const entry = combatTextTextureCache.get(getCombatTextTextureKey(kind, amount));
  if (!entry) return;
  entry.refCount = Math.max(0, entry.refCount - 1);
  entry.lastUsedAt = ++combatTextTextureUseCounter;
  evictUnusedCombatTextTextures();
}

export function prewarmCombatTextTextures(): void {
  if (typeof document === 'undefined') return;

  const kinds: readonly CombatTextKind[] = ['damage', 'shieldDamage', 'heal'];
  for (const kind of kinds) {
    for (const amount of COMBAT_TEXT_PREWARM_AMOUNTS) {
      const texture = acquireCombatTextTexture(kind, amount);
      releaseCombatTextTexture(kind, amount);
      texture.needsUpdate = true;
    }
  }
}

function findPlayer(targetId: string | null | undefined): Player | null {
  if (!targetId) return null;

  const store = useGameStore.getState();
  if (store.localPlayer?.id === targetId) return store.localPlayer;
  return store.players.get(targetId) ?? null;
}

function getStandaloneCombatTextY(event: CombatTextEvent): number {
  if (event.kind === 'shieldDamage') {
    return event.position.y + 0.36;
  }

  return getCombatTextWorldY(event.position.y, null, DEFAULT_MOVEMENT);
}

function resolveCombatTextAnchor(event: CombatTextEvent, target: THREE.Vector3): void {
  const player = findPlayer(event.targetId);
  if (!player) {
    target.set(event.position.x, getStandaloneCombatTextY(event), event.position.z);
    return;
  }

  const visualState = visualStore.getState();
  const position = visualState.renderedPlayerPositions.get(player.id) ??
    visualState.playerPositions.get(player.id) ??
    player.position;
  const heroId = player.heroId;
  const movement = player.movement;

  target.set(
    position.x,
    getCombatTextWorldY(position.y, heroId, movement),
    position.z
  );
}

function getAmountScale(amount: number): number {
  return Math.min(0.42, Math.log10(Math.max(1, amount)) * 0.18);
}

function getPopScale(progress: number): number {
  if (progress < 0.18) {
    return 0.36 + easeOutBack(progress / 0.18) * 0.94;
  }

  const settleProgress = clamp01((progress - 0.18) / 0.3);
  return 1.12 - easeOutCubic(settleProgress) * 0.12;
}

function getOpacity(progress: number): number {
  if (progress < 0.62) return 1;
  return 1 - easeInCubic(clamp01((progress - 0.62) / 0.38));
}

function CombatTextSprite({ event, stackIndex }: { event: CombatTextEvent; stackIndex: number }) {
  const spriteRef = useRef<THREE.Sprite>(null);
  const materialRef = useRef<THREE.SpriteMaterial>(null);
  const anchorRef = useRef(new THREE.Vector3(event.position.x, event.position.y, event.position.z));
  const drift = useMemo(() => {
    const seed = hashString(event.id);
    const angle = (seed / 0xffffffff) * Math.PI * 2;
    const radius = event.kind === 'heal' ? 0.32 : event.kind === 'shieldDamage' ? 0.38 : 0.46;
    return {
      x: Math.cos(angle) * radius,
      z: Math.sin(angle) * radius,
    };
  }, [event.id, event.kind]);
  const textureAmount = Math.max(1, Math.round(event.amount));
  const texture = useMemo(
    () => acquireCombatTextTexture(event.kind, textureAmount),
    [event.kind, textureAmount]
  );
  const baseHeight = (event.kind === 'heal' ? 0.74 : event.kind === 'shieldDamage' ? 0.78 : 0.82) + getAmountScale(event.amount);
  const baseWidth = baseHeight * COMBAT_TEXT_ASPECT;
  const initialY = event.targetId
    ? getCombatTextWorldY(event.position.y, null, DEFAULT_MOVEMENT)
    : getStandaloneCombatTextY(event);

  useEffect(() => () => releaseCombatTextTexture(event.kind, textureAmount), [event.kind, textureAmount]);

  useFrame(() => {
    const sprite = spriteRef.current;
    const material = materialRef.current;
    if (!sprite || !material) return;

    const progress = clamp01((getFrameClock().epochNowMs - event.createdAt) / COMBAT_TEXT_DURATION_MS);
    const popScale = getPopScale(progress);
    const driftProgress = easeOutCubic(progress);
    const rise = easeOutCubic(progress) * 0.92 + Math.sin(progress * Math.PI) * 0.16;
    const stackOffsetY = stackIndex * STACKED_TEXT_GAP_Y;
    resolveCombatTextAnchor(event, anchorRef.current);

    sprite.visible = progress < 1;
    sprite.position.set(
      anchorRef.current.x + drift.x * driftProgress,
      anchorRef.current.y + stackOffsetY + rise,
      anchorRef.current.z + drift.z * driftProgress
    );
    sprite.scale.set(baseWidth * popScale, baseHeight * popScale, 1);
    material.opacity = getOpacity(progress);
  });

  return (
    <sprite
      ref={spriteRef}
      position={[event.position.x, initialY, event.position.z]}
      scale={[baseWidth * 0.36, baseHeight * 0.36, 1]}
      renderOrder={45}
      frustumCulled={false}
    >
      <spriteMaterial
        ref={materialRef}
        map={texture}
        transparent
        depthTest
        depthWrite={false}
        toneMapped={false}
      />
    </sprite>
  );
}

export function CombatTextLayer({ enabled }: CombatTextLayerProps) {
  const combatTextEvents = useCombatFeedbackStore((state) => state.combatTextEvents);
  const stackIndices = useMemo(() => {
    const counts = new Map<string, number>();
    const nextIndices = new Map<string, number>();

    for (let index = combatTextEvents.length - 1; index >= 0; index--) {
      const event = combatTextEvents[index];
      const key = combatTextStackKey(event);
      const count = counts.get(key) ?? 0;
      nextIndices.set(event.id, count);
      counts.set(key, count + 1);
    }

    return nextIndices;
  }, [combatTextEvents]);

  if (!enabled || combatTextEvents.length === 0) return null;

  return (
    <group>
      {combatTextEvents.map((event) => (
        <CombatTextSprite
          key={event.id}
          event={event}
          stackIndex={stackIndices.get(event.id) ?? 0}
        />
      ))}
    </group>
  );
}

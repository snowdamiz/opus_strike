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

function drawCombatTextTexture(canvas: HTMLCanvasElement, kind: CombatTextKind, amount: number): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const colors = getCombatTextColors(kind);
  const text = `${kind === 'heal' ? '+' : '-'}${Math.max(1, Math.round(amount))}`;

  ctx.clearRect(0, 0, COMBAT_TEXT_CANVAS_WIDTH, COMBAT_TEXT_CANVAS_HEIGHT);
  ctx.save();
  ctx.translate(COMBAT_TEXT_CANVAS_WIDTH / 2, COMBAT_TEXT_CANVAS_HEIGHT / 2 + 4);
  ctx.rotate(kind === 'damage' ? -0.045 : 0.035);

  ctx.font = '900 92px Inter, ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;

  ctx.shadowColor = colors.glow;
  ctx.shadowBlur = 34;
  ctx.lineWidth = 18;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.92)';
  ctx.strokeText(text, 0, 0);

  ctx.shadowBlur = 20;
  ctx.lineWidth = 7;
  ctx.strokeStyle = kind === 'damage' ? 'rgba(127, 29, 29, 0.94)' : 'rgba(6, 78, 59, 0.94)';
  ctx.strokeText(text, 0, 0);

  const gradient = ctx.createLinearGradient(0, -52, 0, 54);
  gradient.addColorStop(0, colors.top);
  gradient.addColorStop(0.44, colors.middle);
  gradient.addColorStop(1, colors.bottom);
  ctx.shadowBlur = 12;
  ctx.fillStyle = gradient;
  ctx.fillText(text, 0, 0);

  ctx.globalAlpha = 0.72;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, -2, -8);
  ctx.restore();
}

function findPlayer(targetId: string | null | undefined): Player | null {
  if (!targetId) return null;

  const store = useGameStore.getState();
  if (store.localPlayer?.id === targetId) return store.localPlayer;
  return store.players.get(targetId) ?? null;
}

function resolveCombatTextAnchor(event: CombatTextEvent, target: THREE.Vector3): void {
  const player = findPlayer(event.targetId);
  const position = player
    ? visualStore.getState().playerPositions.get(player.id) ?? player.position
    : event.position;
  const heroId = player?.heroId ?? null;
  const movement = player?.movement ?? DEFAULT_MOVEMENT;

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
    const radius = event.kind === 'damage' ? 0.46 : 0.32;
    return {
      x: Math.cos(angle) * radius,
      z: Math.sin(angle) * radius,
    };
  }, [event.id, event.kind]);
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = COMBAT_TEXT_CANVAS_WIDTH;
    canvas.height = COMBAT_TEXT_CANVAS_HEIGHT;

    drawCombatTextTexture(canvas, event.kind, event.amount);

    const nextTexture = new THREE.CanvasTexture(canvas);
    nextTexture.colorSpace = THREE.SRGBColorSpace;
    nextTexture.minFilter = THREE.LinearFilter;
    nextTexture.magFilter = THREE.LinearFilter;
    nextTexture.generateMipmaps = false;
    return nextTexture;
  }, [event.amount, event.kind]);
  const baseHeight = (event.kind === 'damage' ? 0.82 : 0.74) + getAmountScale(event.amount);
  const baseWidth = baseHeight * COMBAT_TEXT_ASPECT;
  const initialY = getCombatTextWorldY(event.position.y, null, DEFAULT_MOVEMENT);

  useEffect(() => () => texture.dispose(), [texture]);

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

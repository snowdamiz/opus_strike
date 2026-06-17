import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import {
  TUTORIAL_BOOST_PICKUP_POSITION,
  TUTORIAL_HEALTH_PICKUP_POSITION,
  TUTORIAL_TARGET_STAND_POSITION,
} from '@voxel-strike/shared';
import { useGameStore } from '../../store/gameStore';
import { visualStore } from '../../store/visualStore';

type TutorialWorldPromptId =
  | 'move'
  | 'run'
  | 'crouch'
  | 'slide'
  | 'hop'
  | 'target'
  | 'skill'
  | 'boost'
  | 'health'
  | 'flag'
  | 'capture';

type TutorialWorldPromptIcon = TutorialWorldPromptId | 'checkpoint';

interface TutorialWorldPrompt {
  id: TutorialWorldPromptId;
  icon: TutorialWorldPromptIcon;
  title: string;
  detail: string;
  position: readonly [number, number, number];
  scale: readonly [number, number, number];
}

interface TutorialWorldPromptVisibilityInput {
  promptId: TutorialWorldPromptId;
  promptZ: number;
  playerZ: number;
  hasFlag: boolean;
  boostCollected: boolean;
  healthCollected: boolean;
}

const PROMPT_CANVAS_WIDTH = 1024;
const PROMPT_CANVAS_HEIGHT = 256;
const PROMPT_DISTANCE_FADE_START = 14;
const PROMPT_DISTANCE_FADE_END = 24;

export const TUTORIAL_WORLD_PROMPTS = [
  {
    id: 'move',
    icon: 'move',
    title: 'Move Forward',
    detail: 'Leave the red spawn pad',
    position: [0, 3.2, -38.7],
    scale: [5.2, 1.3, 1],
  },
  {
    id: 'run',
    icon: 'run',
    title: 'Hold Sprint',
    detail: 'Build speed through the gate',
    position: [0, 3.25, -31.7],
    scale: [5.6, 1.4, 1],
  },
  {
    id: 'crouch',
    icon: 'crouch',
    title: 'Crouch',
    detail: 'Duck under the low cover',
    position: [0, 2.9, -26.6],
    scale: [5.4, 1.35, 1],
  },
  {
    id: 'slide',
    icon: 'slide',
    title: 'Run Then Slide',
    detail: 'Under the low terrain',
    position: [0, 2.55, -20.5],
    scale: [5.8, 1.45, 1],
  },
  {
    id: 'hop',
    icon: 'hop',
    title: 'Bunny Hop',
    detail: 'Jump on land. Air-strafe + mouse, no W',
    position: [0, 3.35, -12.5],
    scale: [7.2, 1.55, 1],
  },
  {
    id: 'skill',
    icon: 'skill',
    title: 'Skill Gate',
    detail: 'Cast E, Q, or F',
    position: [0, 3.25, 9],
    scale: [5, 1.25, 1],
  },
  {
    id: 'boost',
    icon: 'boost',
    title: 'Boost Pickup',
    detail: 'Grab the boost from the gold pad',
    position: [
      TUTORIAL_BOOST_PICKUP_POSITION.x,
      3.15,
      TUTORIAL_BOOST_PICKUP_POSITION.z,
    ],
    scale: [6.3, 1.58, 1],
  },
  {
    id: 'health',
    icon: 'health',
    title: 'Health Pack',
    detail: 'Take the left side lane',
    position: [
      TUTORIAL_HEALTH_PICKUP_POSITION.x,
      3.15,
      TUTORIAL_HEALTH_PICKUP_POSITION.z,
    ],
    scale: [5.4, 1.35, 1],
  },
  {
    id: 'target',
    icon: 'target',
    title: 'Target Practice',
    detail: 'Down a moving hero',
    position: [
      TUTORIAL_TARGET_STAND_POSITION.x,
      3.45,
      TUTORIAL_TARGET_STAND_POSITION.z + 2.8,
    ],
    scale: [5.8, 1.45, 1],
  },
  {
    id: 'flag',
    icon: 'flag',
    title: 'Steal The Flag',
    detail: 'Take the blue flag',
    position: [0, 3.5, 39],
    scale: [5.4, 1.35, 1],
  },
  {
    id: 'capture',
    icon: 'checkpoint',
    title: 'Capture',
    detail: 'Bring it home',
    position: [0, 3.5, -39],
    scale: [4.6, 1.15, 1],
  },
] as const satisfies readonly TutorialWorldPrompt[];

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

export function getTutorialWorldPromptOpacity(input: TutorialWorldPromptVisibilityInput): number {
  if (input.promptId === 'capture') {
    if (!input.hasFlag) return 0;
    const distance = Math.abs(input.promptZ - input.playerZ);
    return 0.22 + (1 - smoothstep(42, 68, distance)) * 0.78;
  }

  if (input.hasFlag) return 0;
  if (input.promptId === 'boost' && input.boostCollected) return 0;
  if (input.promptId === 'health' && input.healthCollected) return 0;
  if (input.promptId === 'flag' && input.playerZ < 27) return 0;

  const aheadDistance = input.promptZ - input.playerZ;
  if (aheadDistance < -4 || aheadDistance > PROMPT_DISTANCE_FADE_END) return 0;
  if (aheadDistance <= PROMPT_DISTANCE_FADE_START) return 1;
  return 1 - smoothstep(PROMPT_DISTANCE_FADE_START, PROMPT_DISTANCE_FADE_END, aheadDistance);
}

function drawPromptIcon(ctx: CanvasRenderingContext2D, icon: TutorialWorldPromptIcon, x: number, y: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = '#ffffff';
  ctx.fillStyle = '#ffffff';
  ctx.lineWidth = 11;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.95)';
  ctx.shadowBlur = 22;
  ctx.shadowOffsetY = 6;

  switch (icon) {
    case 'run':
      ctx.beginPath();
      ctx.arc(0, -42, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-8, -18);
      ctx.lineTo(30, -2);
      ctx.lineTo(2, 22);
      ctx.moveTo(7, 0);
      ctx.lineTo(-34, 14);
      ctx.moveTo(0, 22);
      ctx.lineTo(-20, 58);
      ctx.moveTo(25, 4);
      ctx.lineTo(58, 36);
      ctx.stroke();
      break;
    case 'crouch':
      ctx.beginPath();
      ctx.arc(-5, -38, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-35, 16);
      ctx.lineTo(22, 16);
      ctx.lineTo(52, 46);
      ctx.moveTo(-12, -14);
      ctx.lineTo(16, 14);
      ctx.moveTo(-58, 60);
      ctx.lineTo(62, 60);
      ctx.stroke();
      break;
    case 'slide':
      ctx.beginPath();
      ctx.arc(-4, -43, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-55, 50);
      ctx.lineTo(62, 50);
      ctx.moveTo(-34, 24);
      ctx.lineTo(4, -13);
      ctx.lineTo(35, 22);
      ctx.lineTo(61, 16);
      ctx.moveTo(-63, 4);
      ctx.lineTo(-33, 4);
      ctx.stroke();
      break;
    case 'hop':
      ctx.beginPath();
      ctx.moveTo(-58, 34);
      ctx.bezierCurveTo(-24, -32, 24, -32, 58, 34);
      ctx.moveTo(0, -54);
      ctx.lineTo(0, -8);
      ctx.moveTo(-23, -32);
      ctx.lineTo(0, -56);
      ctx.lineTo(23, -32);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(-38, 42, 5, 0, Math.PI * 2);
      ctx.arc(38, 42, 5, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'target':
      ctx.beginPath();
      ctx.arc(0, 0, 62, 0, Math.PI * 2);
      ctx.arc(0, 0, 38, 0, Math.PI * 2);
      ctx.arc(0, 0, 13, 0, Math.PI * 2);
      ctx.moveTo(0, -76);
      ctx.lineTo(0, -52);
      ctx.moveTo(0, 52);
      ctx.lineTo(0, 76);
      ctx.moveTo(-76, 0);
      ctx.lineTo(-52, 0);
      ctx.moveTo(52, 0);
      ctx.lineTo(76, 0);
      ctx.stroke();
      break;
    case 'skill':
      ctx.beginPath();
      ctx.moveTo(0, -62);
      ctx.lineTo(15, -16);
      ctx.lineTo(62, 0);
      ctx.lineTo(15, 16);
      ctx.lineTo(0, 62);
      ctx.lineTo(-15, 16);
      ctx.lineTo(-62, 0);
      ctx.lineTo(-15, -16);
      ctx.closePath();
      ctx.stroke();
      break;
    case 'boost':
      ctx.beginPath();
      ctx.moveTo(2, -66);
      ctx.lineTo(39, -6);
      ctx.lineTo(10, -6);
      ctx.lineTo(24, 66);
      ctx.lineTo(-38, -10);
      ctx.lineTo(-8, -10);
      ctx.closePath();
      ctx.stroke();
      break;
    case 'health':
      ctx.beginPath();
      ctx.moveTo(0, 58);
      ctx.bezierCurveTo(-60, 20, -62, -24, -28, -38);
      ctx.bezierCurveTo(-13, -45, -2, -38, 0, -28);
      ctx.bezierCurveTo(2, -38, 13, -45, 28, -38);
      ctx.bezierCurveTo(62, -24, 60, 20, 0, 58);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, -18);
      ctx.lineTo(0, 24);
      ctx.moveTo(-22, 3);
      ctx.lineTo(22, 3);
      ctx.stroke();
      break;
    case 'flag':
      ctx.beginPath();
      ctx.moveTo(-38, 58);
      ctx.lineTo(-38, -58);
      ctx.moveTo(-38, -52);
      ctx.lineTo(42, -52);
      ctx.lineTo(28, -18);
      ctx.lineTo(46, 10);
      ctx.lineTo(-38, 10);
      ctx.moveTo(-58, 58);
      ctx.lineTo(-15, 58);
      ctx.stroke();
      break;
    case 'checkpoint':
      ctx.beginPath();
      ctx.moveTo(-44, -2);
      ctx.lineTo(-8, 35);
      ctx.lineTo(52, -42);
      ctx.stroke();
      break;
    case 'move':
    default:
      ctx.beginPath();
      ctx.moveTo(-62, 0);
      ctx.lineTo(45, 0);
      ctx.moveTo(8, -40);
      ctx.lineTo(50, 0);
      ctx.lineTo(8, 40);
      ctx.moveTo(-62, -40);
      ctx.lineTo(-28, -40);
      ctx.moveTo(-62, 40);
      ctx.lineTo(-28, 40);
      ctx.stroke();
      break;
  }

  ctx.restore();
}

function drawShadowedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  font: string,
  alpha = 1
): void {
  ctx.save();
  ctx.font = font;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
  ctx.shadowColor = 'rgba(0, 0, 0, 0.96)';
  ctx.shadowBlur = 20;
  ctx.shadowOffsetY = 6;
  ctx.lineWidth = 8;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.78)';
  ctx.strokeText(text, x, y);
  ctx.fillText(text, x, y);
  ctx.restore();
}

function createPromptTexture(prompt: TutorialWorldPrompt): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = PROMPT_CANVAS_WIDTH;
  canvas.height = PROMPT_CANVAS_HEIGHT;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return new THREE.CanvasTexture(canvas);
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawPromptIcon(ctx, prompt.icon, 118, 128);
  drawShadowedText(ctx, prompt.title.toUpperCase(), 220, 94, '400 68px "Bebas Neue", "Orbitron", sans-serif');
  drawShadowedText(ctx, prompt.detail, 224, 158, '700 34px "Exo 2", "Rajdhani", sans-serif', 0.92);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}

function TutorialWorldPromptSprite({ prompt }: { prompt: TutorialWorldPrompt }) {
  const spriteRef = useRef<THREE.Sprite>(null);
  const materialRef = useRef<THREE.SpriteMaterial>(null);
  const texture = useMemo(() => createPromptTexture(prompt), [prompt]);

  useEffect(() => {
    const sprite = spriteRef.current;
    if (sprite) {
      sprite.renderOrder = 18;
    }

    return () => {
      texture.dispose();
    };
  }, [texture]);

  useFrame(({ clock }) => {
    const store = useGameStore.getState();
    const player = store.localPlayer;
    const material = materialRef.current;
    const sprite = spriteRef.current;
    if (!material || !sprite || !player) return;

    const playerPosition = visualStore.getState().playerPositions.get(player.id) ?? player.position;
    const baseOpacity = getTutorialWorldPromptOpacity({
      promptId: prompt.id,
      promptZ: prompt.position[2],
      playerZ: playerPosition.z,
      hasFlag: player.hasFlag,
      boostCollected: store.powerupPickupCollections.has('tutorial_boost_pickup'),
      healthCollected: store.powerupPickupCollections.has('tutorial_health_pickup'),
    });
    const pulse = 0.9 + Math.sin(clock.elapsedTime * 2.2 + prompt.position[2] * 0.13) * 0.1;
    const nextOpacity = baseOpacity * pulse;

    material.opacity = nextOpacity;
    sprite.visible = nextOpacity > 0.015;
    sprite.position.y = prompt.position[1] + Math.sin(clock.elapsedTime * 1.45 + prompt.position[2] * 0.19) * 0.08;
  });

  return (
    <sprite
      ref={spriteRef}
      name={`tutorial-world-prompt-${prompt.id}`}
      position={prompt.position}
      scale={prompt.scale}
      frustumCulled={false}
    >
      <spriteMaterial
        ref={materialRef}
        map={texture}
        transparent
        opacity={0}
        depthTest={false}
        depthWrite={false}
        toneMapped={false}
      />
    </sprite>
  );
}

export function TutorialWorldPrompts() {
  const isTutorialMode = useGameStore((state) => state.isTutorialMode);
  const gamePhase = useGameStore((state) => state.gamePhase);

  if (!isTutorialMode || gamePhase !== 'playing') return null;

  return (
    <group name="tutorial-world-prompts">
      {TUTORIAL_WORLD_PROMPTS.map((prompt) => (
        <TutorialWorldPromptSprite key={prompt.id} prompt={prompt} />
      ))}
    </group>
  );
}

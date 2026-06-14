import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { VoxelMapTheme } from '@voxel-strike/shared';
import type { EnvironmentQualityConfig } from './visualQuality';
import { getBlazeGearstormSkyIntensity } from './blaze/airstrike';
import { getPhantomVeilSkyIntensity } from './phantom/veilAtmosphere';

interface WorldAtmosphereProps {
  theme: VoxelMapTheme;
  seed: number;
  config: EnvironmentQualityConfig;
}

type AtmosphereKind = 'snow' | 'rain' | 'sand' | 'ash' | 'glimmer' | 'mist';

interface AtmosphereProfile {
  kind: AtmosphereKind;
  variant: string;
  color: string;
  count: number;
  opacity: number;
  size: number;
  fallSpeed: number;
  windX: number;
  windZ: number;
  spreadX: number;
  spreadZ: number;
  minY: number;
  maxY: number;
  streakLength?: number;
  devilCount?: number;
  windScale?: number;
  turbulence?: number;
  floatStrength?: number;
  verticalDirection?: 'fall' | 'rise' | 'float';
}

type AtmosphereProfileInput = Omit<AtmosphereProfile, 'windX' | 'windZ'>;

interface PointParticleSet {
  geometry: THREE.BufferGeometry;
  speeds: Float32Array;
  sinPhase: Float32Array;
  cosPhase: Float32Array;
  sinVerticalPhase: Float32Array;
  cosVerticalPhase: Float32Array;
}

interface RainStreakSet {
  geometry: THREE.BufferGeometry;
  speeds: Float32Array;
  sinPhase: Float32Array;
  cosPhase: Float32Array;
}

interface DustDevilConfig {
  x: number;
  z: number;
  radius: number;
  height: number;
  phase: number;
  speed: number;
}

const ATMOSPHERE_MAX_STEP = 1 / 12;
const SUN_POSITION: [number, number, number] = [92, 118, -76];
const SUN_DIRECTION = new THREE.Vector3(...SUN_POSITION).normalize();
const BLAZE_SUN_CORE_COLOR = new THREE.Color('#ffd36a');
const BLAZE_SUN_CORONA_COLOR = new THREE.Color('#ff5a00');
const BLAZE_SUN_OUTER_CORONA_COLOR = new THREE.Color('#ff2700');

function getAtmosphereCount(profile: AtmosphereProfileInput): number {
  const multiplier =
    profile.kind === 'rain'
      ? 0.72
      : profile.kind === 'mist'
        ? 0.6
        : profile.kind === 'sand'
          ? 0.64
          : profile.kind === 'glimmer'
            ? 0.68
            : 0.7;
  const minCount = profile.kind === 'mist' || profile.kind === 'sand' ? 120 : 96;

  return Math.max(minCount, Math.round(profile.count * multiplier));
}

const SKY_VERTEX_SHADER = `
varying vec3 vWorldPosition;

void main() {
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vWorldPosition = worldPosition.xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SKY_FRAGMENT_SHADER = `
uniform vec3 topColor;
uniform vec3 horizonColor;
uniform vec3 hazeColor;
uniform vec3 fireTopColor;
uniform vec3 fireHorizonColor;
uniform vec3 emberColor;
uniform vec3 smokeColor;
uniform vec3 phantomTopColor;
uniform vec3 phantomHorizonColor;
uniform vec3 phantomPurpleColor;
uniform vec3 phantomStarColor;
uniform vec3 sunDirection;
uniform float fireIntensity;
uniform float phantomIntensity;
uniform float time;
varying vec3 vWorldPosition;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec3 direction = normalize(vWorldPosition);
  float height = clamp(direction.y * 0.5 + 0.5, 0.0, 1.0);
  float horizon = pow(1.0 - abs(direction.y), 3.0);
  vec3 color = mix(horizonColor, topColor, smoothstep(0.05, 1.0, height));
  color += hazeColor * horizon * 0.28;

  float azimuth = atan(direction.z, direction.x);
  float wave =
    sin(azimuth * 7.0 + time * 1.55) * 0.5 +
    sin(azimuth * 13.0 - time * 1.9 + direction.y * 4.0) * 0.32 +
    sin((direction.x - direction.z) * 10.0 + time * 2.35) * 0.18;
  float flame = smoothstep(0.18, 0.95, wave * 0.5 + 0.5);
  float lowSky = 1.0 - smoothstep(0.5, 0.92, height);
  float heatBand = horizon * (0.54 + flame * 0.46) * lowSky;
  float smoke = smoothstep(0.5, 1.0, height) * (0.56 + flame * 0.18);
  vec3 fireColor = mix(fireHorizonColor, emberColor, flame * 0.68 + horizon * 0.2);
  color = mix(color, fireColor, fireIntensity * clamp(heatBand * 1.45 + lowSky * 0.12, 0.0, 0.82));
  color = mix(color, fireTopColor, fireIntensity * smoke * 0.44);
  color += emberColor * fireIntensity * flame * horizon * 0.18;

  float sunFacing = max(dot(direction, normalize(sunDirection)), 0.0);
  float corona = pow(sunFacing, 18.0);
  float sunCore = pow(sunFacing, 220.0);
  color += fireIntensity * (fireHorizonColor * corona * 0.42 + emberColor * sunCore * 1.15);
  color = mix(color, smokeColor, fireIntensity * smoke * 0.2);

  vec3 phantomSky = mix(phantomHorizonColor, phantomTopColor, smoothstep(0.02, 1.0, height));
  float nebulaWave =
    sin(azimuth * 2.4 + direction.y * 7.5 + time * 0.08) * 0.5 +
    sin((direction.x + direction.z) * 5.2 - time * 0.06) * 0.35 +
    sin(azimuth * 5.8 - direction.y * 3.0) * 0.15;
  float nebula = smoothstep(0.28, 0.95, nebulaWave * 0.5 + 0.5) * smoothstep(0.12, 0.9, height);
  phantomSky += phantomPurpleColor * (horizon * 0.38 + nebula * 0.32);

  float polar = acos(clamp(direction.y, -1.0, 1.0)) / 3.14159265;
  vec2 starCoord = vec2(azimuth / 6.2831853 + 0.5, polar);
  vec2 starGrid = vec2(260.0, 124.0);
  vec2 starCellPosition = starCoord * starGrid;
  vec2 starCell = floor(starCellPosition);
  vec2 starLocal = fract(starCellPosition) - 0.5;
  float starSeed = hash12(starCell);
  float starRadius = mix(0.08, 0.22, hash12(starCell + 19.17));
  float starShape = 1.0 - smoothstep(starRadius * 0.28, starRadius, length(starLocal));
  float starMask = step(0.962, starSeed) * starShape * smoothstep(0.18, 0.72, height);
  float twinkle = 0.68 + sin(time * (1.8 + starSeed * 3.2) + starSeed * 43.0) * 0.32;
  phantomSky += phantomStarColor * starMask * twinkle * mix(0.65, 1.75, hash12(starCell + 4.7));

  color = mix(color, phantomSky, phantomIntensity);

  gl_FragColor = vec4(color, 1.0);
}
`;

function createThemeColor(hex: string, mixTarget: string, amount: number): THREE.Color {
  return new THREE.Color(hex).lerp(new THREE.Color(mixTarget), amount);
}

function seededValue(seed: number, salt: number): number {
  let h = (seed >>> 0) ^ Math.imul(salt, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function pickVariant<T>(seed: number, salt: number, variants: T[]): T {
  return variants[Math.floor(seededValue(seed, salt) * variants.length) % variants.length];
}

function getAtmosphereStep(delta: number): number {
  return Math.min(Math.max(delta, 0), ATMOSPHERE_MAX_STEP);
}

function withSeededWind(seed: number, profile: AtmosphereProfileInput, salt: number): AtmosphereProfile {
  const windSeed = seed ^ salt;
  const angle = seededValue(windSeed, 0x771f) * Math.PI * 2;
  const windStrength = (0.55 + seededValue(windSeed, 0x8a31) * 2.15) * (profile.windScale ?? 1);

  return {
    ...profile,
    count: getAtmosphereCount(profile),
    windX: Math.cos(angle) * windStrength,
    windZ: Math.sin(angle) * windStrength,
  };
}

function withSeededWinds(seed: number, profiles: AtmosphereProfileInput[]): AtmosphereProfile[] {
  return profiles.map((profile, index) => withSeededWind(seed, profile, 0x6d2b79f5 + index * 0x45d9f3b));
}

function pickProfileStack(seed: number, salt: number, variants: AtmosphereProfileInput[][]): AtmosphereProfile[] {
  return withSeededWinds(seed ^ salt, pickVariant(seed, salt, variants));
}

function getAtmosphereProfiles(theme: VoxelMapTheme, seed: number): AtmosphereProfile[] {
  if (theme.id === 'golden') {
    return pickProfileStack(seed, 0x906d3a, [
      [
        {
          kind: 'glimmer',
          variant: 'treasury-motes',
          color: '#fff3a8',
          count: 360,
          opacity: 0.82,
          size: 0.115,
          fallSpeed: 0.76,
          spreadX: 82,
          spreadZ: 72,
          minY: 1.4,
          maxY: 34,
          turbulence: 0.2,
          windScale: 0.72,
          floatStrength: 0.34,
          verticalDirection: 'float',
        },
        {
          kind: 'mist',
          variant: 'sunlit-vault-haze',
          color: '#f7c85f',
          count: 220,
          opacity: 0.28,
          size: 0.22,
          fallSpeed: 0.42,
          spreadX: 94,
          spreadZ: 84,
          minY: 0.4,
          maxY: 24,
          turbulence: 0.12,
          windScale: 0.5,
          floatStrength: 0.18,
          verticalDirection: 'float',
        },
      ],
      [
        {
          kind: 'glimmer',
          variant: 'coinfall-radiance',
          color: theme.structures.accent,
          count: 420,
          opacity: 0.72,
          size: 0.095,
          fallSpeed: 1.05,
          spreadX: 88,
          spreadZ: 78,
          minY: 1,
          maxY: 40,
          turbulence: 0.18,
          windScale: 0.84,
          floatStrength: 0.24,
          verticalDirection: 'fall',
        },
      ],
    ]);
  }

  if (theme.id === 'frost') {
    return pickProfileStack(seed, 0xf7057, [
      [
        {
          kind: 'snow',
          variant: 'powder-whiteout',
          color: '#f7fdff',
          count: 460,
          opacity: 0.86,
          size: 0.17,
          fallSpeed: 2.85,
          spreadX: 86,
          spreadZ: 76,
          minY: 1.2,
          maxY: 46,
          turbulence: 0.16,
          windScale: 1.05,
        },
        {
          kind: 'glimmer',
          variant: 'blue-ice-spindrift',
          color: theme.structures.glass,
          count: 180,
          opacity: 0.74,
          size: 0.1,
          fallSpeed: 1.15,
          spreadX: 78,
          spreadZ: 68,
          minY: 1,
          maxY: 30,
          turbulence: 0.18,
          windScale: 1.25,
          floatStrength: 0.2,
          verticalDirection: 'float',
        },
      ],
      [
        {
          kind: 'snow',
          variant: 'knife-edge-squall',
          color: '#e4f8ff',
          count: 560,
          opacity: 0.74,
          size: 0.12,
          fallSpeed: 4.6,
          spreadX: 92,
          spreadZ: 82,
          minY: 0.8,
          maxY: 50,
          turbulence: 0.22,
          windScale: 1.55,
        },
        {
          kind: 'snow',
          variant: 'near-ground-spindrift',
          color: '#ffffff',
          count: 220,
          opacity: 0.58,
          size: 0.08,
          fallSpeed: 1.45,
          spreadX: 88,
          spreadZ: 76,
          minY: 0.4,
          maxY: 12,
          turbulence: 0.28,
          windScale: 1.8,
        },
      ],
      [
        {
          kind: 'glimmer',
          variant: 'diamond-frost',
          color: theme.structures.glass,
          count: 360,
          opacity: 0.82,
          size: 0.12,
          fallSpeed: 0.72,
          spreadX: 82,
          spreadZ: 72,
          minY: 1.2,
          maxY: 36,
          turbulence: 0.2,
          windScale: 1.1,
          floatStrength: 0.28,
          verticalDirection: 'float',
        },
        {
          kind: 'snow',
          variant: 'soft-crystal-snow',
          color: '#f7fdff',
          count: 300,
          opacity: 0.68,
          size: 0.14,
          fallSpeed: 2.1,
          spreadX: 80,
          spreadZ: 70,
          minY: 1.2,
          maxY: 40,
          turbulence: 0.13,
          windScale: 0.9,
        },
      ],
    ]);
  }

  if (theme.id === 'desert') {
    return pickProfileStack(seed, 0xde5e27, [
      [
        {
          kind: 'sand',
          variant: 'wall-of-sand',
          color: '#e7be72',
          count: 470,
          opacity: 0.56,
          size: 0.2,
          fallSpeed: 0.82,
          spreadX: 92,
          spreadZ: 80,
          minY: 0.8,
          maxY: 21,
          devilCount: 2,
          turbulence: 0.28,
          windScale: 1.65,
        },
        {
          kind: 'mist',
          variant: 'low-amber-haze',
          color: '#ffe2a4',
          count: 240,
          opacity: 0.34,
          size: 0.29,
          fallSpeed: 0.12,
          spreadX: 86,
          spreadZ: 74,
          minY: 0.5,
          maxY: 10,
          turbulence: 0.2,
          windScale: 1.35,
          floatStrength: 0.18,
          verticalDirection: 'float',
        },
      ],
      [
        {
          kind: 'sand',
          variant: 'thermal-sand-devils',
          color: '#f0cf8b',
          count: 330,
          opacity: 0.48,
          size: 0.22,
          fallSpeed: 0.38,
          spreadX: 90,
          spreadZ: 78,
          minY: 0.8,
          maxY: 19,
          devilCount: 4,
          turbulence: 0.32,
          windScale: 1.25,
          floatStrength: 0.16,
          verticalDirection: 'float',
        },
        {
          kind: 'glimmer',
          variant: 'sunstone-flecks',
          color: theme.structures.accent,
          count: 150,
          opacity: 0.48,
          size: 0.09,
          fallSpeed: 0.24,
          spreadX: 78,
          spreadZ: 68,
          minY: 1.2,
          maxY: 18,
          turbulence: 0.14,
          windScale: 0.8,
          floatStrength: 0.2,
          verticalDirection: 'float',
        },
      ],
      [
        {
          kind: 'mist',
          variant: 'heat-haze-dust',
          color: '#ffe0a1',
          count: 360,
          opacity: 0.38,
          size: 0.31,
          fallSpeed: 0.16,
          spreadX: 86,
          spreadZ: 74,
          minY: 0.5,
          maxY: 13,
          devilCount: 3,
          turbulence: 0.24,
          windScale: 1.15,
          floatStrength: 0.24,
          verticalDirection: 'float',
        },
        {
          kind: 'sand',
          variant: 'raked-ground-dust',
          color: '#d9a960',
          count: 260,
          opacity: 0.42,
          size: 0.17,
          fallSpeed: 0.28,
          spreadX: 92,
          spreadZ: 78,
          minY: 0.3,
          maxY: 8,
          turbulence: 0.36,
          windScale: 1.7,
          verticalDirection: 'float',
        },
      ],
    ]);
  }

  if (theme.id === 'basalt' || theme.id === 'volcanic') {
    return pickProfileStack(seed, 0xba5a17, [
      [
        {
          kind: 'ash',
          variant: 'volcanic-ashfall',
          color: '#b9c0c8',
          count: 460,
          opacity: 0.66,
          size: 0.14,
          fallSpeed: 1.55,
          spreadX: 84,
          spreadZ: 74,
          minY: 0.8,
          maxY: 38,
          turbulence: 0.18,
          windScale: 1.15,
        },
        {
          kind: 'glimmer',
          variant: 'orange-cinders',
          color: '#ff8b4c',
          count: 210,
          opacity: 0.7,
          size: 0.09,
          fallSpeed: 0.52,
          spreadX: 76,
          spreadZ: 66,
          minY: 1.2,
          maxY: 28,
          turbulence: 0.2,
          windScale: 0.8,
          floatStrength: 0.34,
          verticalDirection: 'rise',
        },
      ],
      [
        {
          kind: 'rain',
          variant: 'neon-stormfront',
          color: theme.structures.glass,
          count: 340,
          opacity: 0.56,
          size: 0.1,
          fallSpeed: 11.8,
          spreadX: 88,
          spreadZ: 78,
          minY: 2,
          maxY: 48,
          streakLength: 3.7,
          windScale: 1.35,
        },
        {
          kind: 'ash',
          variant: 'wet-ash-backdraft',
          color: '#8f98a3',
          count: 230,
          opacity: 0.46,
          size: 0.12,
          fallSpeed: 0.95,
          spreadX: 82,
          spreadZ: 72,
          minY: 0.8,
          maxY: 30,
          turbulence: 0.16,
          windScale: 1.1,
        },
        {
          kind: 'glimmer',
          variant: 'cyan-static',
          color: theme.structures.accent,
          count: 150,
          opacity: 0.68,
          size: 0.08,
          fallSpeed: 0.35,
          spreadX: 72,
          spreadZ: 62,
          minY: 1.5,
          maxY: 34,
          turbulence: 0.18,
          windScale: 0.9,
          floatStrength: 0.28,
          verticalDirection: 'float',
        },
      ],
      [
        {
          kind: 'glimmer',
          variant: 'ember-static-field',
          color: theme.structures.accent,
          count: 390,
          opacity: 0.78,
          size: 0.1,
          fallSpeed: 0.42,
          spreadX: 80,
          spreadZ: 70,
          minY: 1,
          maxY: 34,
          turbulence: 0.24,
          windScale: 1,
          floatStrength: 0.38,
          verticalDirection: 'rise',
        },
        {
          kind: 'ash',
          variant: 'dark-circuit-ash',
          color: '#87909a',
          count: 300,
          opacity: 0.52,
          size: 0.12,
          fallSpeed: 1.1,
          spreadX: 82,
          spreadZ: 72,
          minY: 0.8,
          maxY: 32,
          turbulence: 0.17,
          windScale: 1.25,
        },
      ],
    ]);
  }

  if (theme.id === 'crystal') {
    return pickProfileStack(seed, 0xc2757a1, [
      [
        {
          kind: 'glimmer',
          variant: 'violet-prism-swarm',
          color: theme.structures.accent,
          count: 480,
          opacity: 0.78,
          size: 0.12,
          fallSpeed: 0.72,
          spreadX: 82,
          spreadZ: 72,
          minY: 1,
          maxY: 36,
          turbulence: 0.2,
          windScale: 0.95,
          floatStrength: 0.38,
          verticalDirection: 'float',
        },
        {
          kind: 'mist',
          variant: 'lilac-crystal-mist',
          color: theme.fogColor,
          count: 260,
          opacity: 0.38,
          size: 0.25,
          fallSpeed: 0.2,
          spreadX: 82,
          spreadZ: 72,
          minY: 0.6,
          maxY: 16,
          turbulence: 0.16,
          windScale: 0.75,
          floatStrength: 0.22,
          verticalDirection: 'float',
        },
      ],
      [
        {
          kind: 'snow',
          variant: 'falling-glass-shards',
          color: theme.structures.glass,
          count: 380,
          opacity: 0.74,
          size: 0.1,
          fallSpeed: 3.2,
          spreadX: 84,
          spreadZ: 74,
          minY: 1.2,
          maxY: 42,
          turbulence: 0.12,
          windScale: 1.2,
        },
        {
          kind: 'glimmer',
          variant: 'pink-caustic-flecks',
          color: theme.structures.accent,
          count: 300,
          opacity: 0.72,
          size: 0.09,
          fallSpeed: 0.55,
          spreadX: 78,
          spreadZ: 68,
          minY: 1,
          maxY: 28,
          turbulence: 0.22,
          windScale: 0.85,
          floatStrength: 0.3,
          verticalDirection: 'rise',
        },
      ],
      [
        {
          kind: 'mist',
          variant: 'dense-prism-ground-mist',
          color: theme.fogColor,
          count: 390,
          opacity: 0.42,
          size: 0.28,
          fallSpeed: 0.18,
          spreadX: 84,
          spreadZ: 74,
          minY: 0.5,
          maxY: 15,
          turbulence: 0.18,
          windScale: 0.85,
          floatStrength: 0.24,
          verticalDirection: 'float',
        },
        {
          kind: 'glimmer',
          variant: 'floating-crystal-dust',
          color: '#f6d1ff',
          count: 270,
          opacity: 0.66,
          size: 0.11,
          fallSpeed: 0.34,
          spreadX: 80,
          spreadZ: 70,
          minY: 1,
          maxY: 30,
          turbulence: 0.2,
          windScale: 0.8,
          floatStrength: 0.35,
          verticalDirection: 'float',
        },
      ],
    ]);
  }

  return pickProfileStack(seed, 0x7e2da17, [
    [
      {
        kind: 'rain',
        variant: 'warm-monsoon-drizzle',
        color: '#bdeaff',
        count: 320,
        opacity: 0.5,
        size: 0.1,
        fallSpeed: 7.8,
        spreadX: 86,
        spreadZ: 76,
        minY: 1.5,
        maxY: 44,
        streakLength: 2.35,
        windScale: 1.05,
      },
      {
        kind: 'mist',
        variant: 'rain-cooled-ground-mist',
        color: theme.fogColor,
        count: 220,
        opacity: 0.32,
        size: 0.25,
        fallSpeed: 0.16,
        spreadX: 80,
        spreadZ: 70,
        minY: 0.5,
        maxY: 12,
        turbulence: 0.14,
        windScale: 0.8,
        floatStrength: 0.2,
        verticalDirection: 'float',
      },
    ],
    [
      {
        kind: 'glimmer',
        variant: 'sunlit-pollen-cloud',
        color: theme.structures.accent,
        count: 420,
        opacity: 0.6,
        size: 0.12,
        fallSpeed: 0.34,
        spreadX: 82,
        spreadZ: 72,
        minY: 0.8,
        maxY: 22,
        turbulence: 0.2,
        windScale: 0.75,
        floatStrength: 0.32,
        verticalDirection: 'float',
      },
      {
        kind: 'mist',
        variant: 'soft-green-morning-mist',
        color: theme.fogColor,
        count: 260,
        opacity: 0.28,
        size: 0.27,
        fallSpeed: 0.14,
        spreadX: 80,
        spreadZ: 70,
        minY: 0.5,
        maxY: 13,
        turbulence: 0.16,
        windScale: 0.65,
        floatStrength: 0.22,
        verticalDirection: 'float',
      },
    ],
    [
      {
        kind: 'mist',
        variant: 'dense-mesa-ground-mist',
        color: theme.fogColor,
        count: 380,
        opacity: 0.36,
        size: 0.3,
        fallSpeed: 0.13,
        spreadX: 84,
        spreadZ: 74,
        minY: 0.4,
        maxY: 14,
        turbulence: 0.18,
        windScale: 0.7,
        floatStrength: 0.24,
        verticalDirection: 'float',
      },
      {
        kind: 'glimmer',
        variant: 'canopy-fireflies',
        color: '#fff39a',
        count: 230,
        opacity: 0.58,
        size: 0.1,
        fallSpeed: 0.18,
        spreadX: 76,
        spreadZ: 66,
        minY: 1.5,
        maxY: 18,
        turbulence: 0.22,
        windScale: 0.5,
        floatStrength: 0.42,
        verticalDirection: 'float',
      },
    ],
  ]);
}

function scaleAtmosphereProfile(
  profile: AtmosphereProfile,
  config: EnvironmentQualityConfig,
  maxCount: number
): AtmosphereProfile | null {
  if (config.particleDensity <= 0 || maxCount <= 0) return null;

  const minCount = config.maxParticles <= 50 ? 0 : profile.kind === 'mist' || profile.kind === 'sand' ? 24 : 18;
  const count = Math.min(maxCount, Math.max(minCount, Math.round(profile.count * config.particleDensity)));
  const opacityScale = config.particleDensity < 1 ? 0.85 + config.particleDensity * 0.15 : 1;
  const devilCount =
    profile.devilCount && config.dustDevilDensity > 0
      ? Math.max(1, Math.round(profile.devilCount * config.dustDevilDensity))
      : undefined;

  return {
    ...profile,
    count,
    opacity: Math.min(0.92, profile.opacity * opacityScale),
    devilCount,
  };
}

function scaleAtmosphereProfiles(
  profiles: AtmosphereProfile[],
  config: EnvironmentQualityConfig
): AtmosphereProfile[] {
  let remainingParticles = Math.max(0, config.maxParticles);
  const scaledProfiles: AtmosphereProfile[] = [];

  for (const profile of profiles) {
    const scaled = scaleAtmosphereProfile(profile, config, remainingParticles);
    if (!scaled || scaled.count <= 0) continue;
    scaledProfiles.push(scaled);
    remainingParticles -= scaled.count;
    if (remainingParticles <= 0) break;
  }

  return scaledProfiles;
}

function createPointParticleSet(profile: AtmosphereProfile, seed: number): PointParticleSet {
  const positions = new Float32Array(profile.count * 3);
  const speeds = new Float32Array(profile.count);
  const sinPhase = new Float32Array(profile.count);
  const cosPhase = new Float32Array(profile.count);
  const sinVerticalPhase = new Float32Array(profile.count);
  const cosVerticalPhase = new Float32Array(profile.count);
  const yRange = profile.maxY - profile.minY;

  for (let i = 0; i < profile.count; i++) {
    const phase = seededValue(seed, i * 17 + 0x55) * Math.PI * 2;
    const verticalPhase = phase * 1.37;

    positions[i * 3] = (seededValue(seed, i * 17 + 0x11) - 0.5) * profile.spreadX;
    positions[i * 3 + 1] = profile.minY + seededValue(seed, i * 17 + 0x22) * yRange;
    positions[i * 3 + 2] = (seededValue(seed, i * 17 + 0x33) - 0.5) * profile.spreadZ;
    speeds[i] = profile.fallSpeed * (0.72 + seededValue(seed, i * 17 + 0x44) * 0.7);
    sinPhase[i] = Math.sin(phase);
    cosPhase[i] = Math.cos(phase);
    sinVerticalPhase[i] = Math.sin(verticalPhase);
    cosVerticalPhase[i] = Math.cos(verticalPhase);
  }

  const geometry = new THREE.BufferGeometry();
  const positionAttribute = new THREE.BufferAttribute(positions, 3);
  positionAttribute.setUsage(THREE.StreamDrawUsage);
  geometry.setAttribute('position', positionAttribute);
  geometry.computeBoundingSphere();

  return { geometry, speeds, sinPhase, cosPhase, sinVerticalPhase, cosVerticalPhase };
}

function createRainStreakSet(profile: AtmosphereProfile, seed: number): RainStreakSet {
  const positions = new Float32Array(profile.count * 2 * 3);
  const speeds = new Float32Array(profile.count);
  const sinPhase = new Float32Array(profile.count);
  const cosPhase = new Float32Array(profile.count);
  const yRange = profile.maxY - profile.minY;
  const streakLength = profile.streakLength ?? 2;

  for (let i = 0; i < profile.count; i++) {
    const phase = seededValue(seed, i * 23 + 0x85) * Math.PI * 2;
    const x = (seededValue(seed, i * 23 + 0x81) - 0.5) * profile.spreadX;
    const y = profile.minY + seededValue(seed, i * 23 + 0x82) * yRange;
    const z = (seededValue(seed, i * 23 + 0x83) - 0.5) * profile.spreadZ;
    const index = i * 6;

    positions[index] = x;
    positions[index + 1] = y;
    positions[index + 2] = z;
    positions[index + 3] = x - profile.windX * 0.08;
    positions[index + 4] = y - streakLength;
    positions[index + 5] = z - profile.windZ * 0.08;
    speeds[i] = profile.fallSpeed * (0.85 + seededValue(seed, i * 23 + 0x84) * 0.45);
    sinPhase[i] = Math.sin(phase);
    cosPhase[i] = Math.cos(phase);
  }

  const geometry = new THREE.BufferGeometry();
  const positionAttribute = new THREE.BufferAttribute(positions, 3);
  positionAttribute.setUsage(THREE.StreamDrawUsage);
  geometry.setAttribute('position', positionAttribute);
  geometry.computeBoundingSphere();

  return { geometry, speeds, sinPhase, cosPhase };
}

function createDustDevils(profile: AtmosphereProfile, seed: number): DustDevilConfig[] {
  const count = profile.devilCount ?? 0;
  const devils: DustDevilConfig[] = [];

  for (let i = 0; i < count; i++) {
    devils.push({
      x: (seededValue(seed, i * 31 + 0xda) - 0.5) * profile.spreadX * 0.62,
      z: (seededValue(seed, i * 31 + 0xdb) - 0.5) * profile.spreadZ * 0.62,
      radius: 1.05 + seededValue(seed, i * 31 + 0xdc) * 1.25,
      height: 7 + seededValue(seed, i * 31 + 0xdd) * 5,
      phase: seededValue(seed, i * 31 + 0xde) * Math.PI * 2,
      speed: 0.7 + seededValue(seed, i * 31 + 0xdf) * 0.75,
    });
  }

  return devils;
}

function getSkyUniforms(theme: VoxelMapTheme) {
  const darken = theme.id === 'basalt' || theme.id === 'volcanic' ? 0.44 : theme.id === 'crystal' ? 0.2 : theme.id === 'golden' ? 0.02 : 0.08;
  const warmHorizon = theme.id === 'golden' ? 0.28 : theme.id === 'desert' || theme.id === 'volcanic' || theme.id === 'sakura' ? 0.18 : 0.06;

  return {
    topColor: { value: createThemeColor(theme.skyColor, '#07111f', darken) },
    horizonColor: { value: createThemeColor(theme.fogColor, '#fff7e5', warmHorizon) },
    hazeColor: { value: createThemeColor(theme.structures.accent, theme.fogColor, 0.68) },
    fireTopColor: { value: new THREE.Color('#2a0c0d') },
    fireHorizonColor: { value: new THREE.Color('#ff5c1c') },
    emberColor: { value: new THREE.Color('#ffd36a') },
    smokeColor: { value: new THREE.Color('#17090b') },
    phantomTopColor: { value: new THREE.Color('#02000a') },
    phantomHorizonColor: { value: new THREE.Color('#120024') },
    phantomPurpleColor: { value: new THREE.Color('#5b21b6') },
    phantomStarColor: { value: new THREE.Color('#f8f7ff') },
    sunDirection: { value: SUN_DIRECTION.clone() },
    fireIntensity: { value: 0 },
    phantomIntensity: { value: 0 },
    time: { value: 0 },
  };
}

function FallingPoints({ profile, seed }: { profile: AtmosphereProfile; seed: number }) {
  const particleSet = useMemo(() => createPointParticleSet(profile, seed), [profile, seed]);
  const motion = useMemo(() => {
    const verticalDirection = profile.verticalDirection ?? 'fall';
    const slowAir = profile.kind === 'mist' || profile.kind === 'sand';
    const turbulence =
      profile.turbulence ??
      (profile.kind === 'glimmer' ? 0.16 : profile.kind === 'mist' ? 0.13 : profile.kind === 'sand' ? 0.18 : 0.1);
    const windFactor = profile.kind === 'sand' ? 1 : slowAir ? 0.88 : profile.kind === 'ash' ? 0.5 : 0.38;

    return {
      halfX: profile.spreadX * 0.5,
      halfZ: profile.spreadZ * 0.5,
      yRange: profile.maxY - profile.minY,
      xWaveSpeed: slowAir ? 0.45 : 0.8,
      zWaveSpeed: 0.55,
      verticalWaveSpeed: 0.7,
      verticalDirection,
      turbulence,
      windX: profile.windX * windFactor,
      windZ: profile.windZ * windFactor,
      zTurbulence: turbulence * 0.72,
      floatStrength: profile.floatStrength ?? (verticalDirection === 'float' ? 0.16 : 0.04),
    };
  }, [profile]);
  const material = useMemo(
    () =>
      new THREE.PointsMaterial({
        color: profile.color,
        size: profile.size,
        transparent: true,
        opacity: profile.opacity,
        depthWrite: false,
        fog: true,
        blending: profile.kind === 'glimmer' ? THREE.AdditiveBlending : THREE.NormalBlending,
      }),
    [profile]
  );

  useFrame(({ clock }, delta) => {
    const step = getAtmosphereStep(delta);
    if (step <= 0) return;

    const positionAttribute = particleSet.geometry.getAttribute('position') as THREE.BufferAttribute;
    const positions = positionAttribute.array as Float32Array;
    const elapsed = clock.elapsedTime;
    const sinX = Math.sin(elapsed * motion.xWaveSpeed);
    const cosX = Math.cos(elapsed * motion.xWaveSpeed);
    const sinZ = Math.sin(elapsed * motion.zWaveSpeed);
    const cosZ = Math.cos(elapsed * motion.zWaveSpeed);
    const sinY = Math.sin(elapsed * motion.verticalWaveSpeed);
    const cosY = Math.cos(elapsed * motion.verticalWaveSpeed);

    for (let i = 0; i < profile.count; i++) {
      const index = i * 3;
      const wobble = sinX * particleSet.cosPhase[i] + cosX * particleSet.sinPhase[i];
      const zWobble = cosZ * particleSet.cosPhase[i] - sinZ * particleSet.sinPhase[i];
      const verticalWobble =
        (sinY * particleSet.cosVerticalPhase[i] + cosY * particleSet.sinVerticalPhase[i]) *
        motion.floatStrength *
        step;
      positions[index] += (motion.windX + wobble * motion.turbulence) * step;
      positions[index + 2] += (motion.windZ + zWobble * motion.zTurbulence) * step;

      if (motion.verticalDirection === 'rise') {
        positions[index + 1] += particleSet.speeds[i] * step + verticalWobble;
      } else if (motion.verticalDirection === 'float') {
        positions[index + 1] += verticalWobble - particleSet.speeds[i] * 0.14 * step;
      } else {
        positions[index + 1] -= particleSet.speeds[i] * step - verticalWobble;
      }

      if (positions[index + 1] < profile.minY) positions[index + 1] += motion.yRange;
      if (positions[index + 1] > profile.maxY) positions[index + 1] -= motion.yRange;
      if (positions[index] > motion.halfX) positions[index] -= profile.spreadX;
      if (positions[index] < -motion.halfX) positions[index] += profile.spreadX;
      if (positions[index + 2] > motion.halfZ) positions[index + 2] -= profile.spreadZ;
      if (positions[index + 2] < -motion.halfZ) positions[index + 2] += profile.spreadZ;
    }

    positionAttribute.needsUpdate = true;
  });

  useEffect(
    () => () => {
      particleSet.geometry.dispose();
      material.dispose();
    },
    [material, particleSet]
  );

  return (
    <points matrixAutoUpdate={false} renderOrder={-60}>
      <primitive object={particleSet.geometry} attach="geometry" />
      <primitive object={material} attach="material" />
    </points>
  );
}

function RainStreaks({ profile, seed }: { profile: AtmosphereProfile; seed: number }) {
  const streakSet = useMemo(() => createRainStreakSet(profile, seed), [profile, seed]);
  const motion = useMemo(
    () => ({
      halfX: profile.spreadX * 0.5,
      halfZ: profile.spreadZ * 0.5,
      yRange: profile.maxY - profile.minY,
      windX: profile.windX * 0.18,
      windZ: profile.windZ * 0.18,
    }),
    [profile]
  );
  const material = useMemo(
    () =>
      new THREE.LineBasicMaterial({
        color: profile.color,
        transparent: true,
        opacity: profile.opacity,
        depthWrite: false,
        fog: true,
      }),
    [profile]
  );

  useFrame(({ clock }, delta) => {
    const step = getAtmosphereStep(delta);
    if (step <= 0) return;

    const positionAttribute = streakSet.geometry.getAttribute('position') as THREE.BufferAttribute;
    const positions = positionAttribute.array as Float32Array;
    const elapsed = clock.elapsedTime;
    const sinDrift = Math.sin(elapsed * 0.65);
    const cosDrift = Math.cos(elapsed * 0.65);

    for (let i = 0; i < profile.count; i++) {
      const index = i * 6;
      const drift = (sinDrift * streakSet.cosPhase[i] + cosDrift * streakSet.sinPhase[i]) * 0.05;
      const moveX = (motion.windX + drift) * step;
      const moveY = streakSet.speeds[i] * step;
      const moveZ = (motion.windZ - drift) * step;

      positions[index] += moveX;
      positions[index + 1] -= moveY;
      positions[index + 2] += moveZ;
      positions[index + 3] += moveX;
      positions[index + 4] -= moveY;
      positions[index + 5] += moveZ;

      if (positions[index + 4] < profile.minY) {
        positions[index + 1] += motion.yRange;
        positions[index + 4] += motion.yRange;
      }

      if (positions[index] > motion.halfX) positions[index] -= profile.spreadX;
      if (positions[index] < -motion.halfX) positions[index] += profile.spreadX;
      if (positions[index + 2] > motion.halfZ) positions[index + 2] -= profile.spreadZ;
      if (positions[index + 2] < -motion.halfZ) positions[index + 2] += profile.spreadZ;
      if (positions[index + 3] > motion.halfX) positions[index + 3] -= profile.spreadX;
      if (positions[index + 3] < -motion.halfX) positions[index + 3] += profile.spreadX;
      if (positions[index + 5] > motion.halfZ) positions[index + 5] -= profile.spreadZ;
      if (positions[index + 5] < -motion.halfZ) positions[index + 5] += profile.spreadZ;
    }

    positionAttribute.needsUpdate = true;
  });

  useEffect(
    () => () => {
      streakSet.geometry.dispose();
      material.dispose();
    },
    [material, streakSet]
  );

  return (
    <lineSegments matrixAutoUpdate={false} renderOrder={-55}>
      <primitive object={streakSet.geometry} attach="geometry" />
      <primitive object={material} attach="material" />
    </lineSegments>
  );
}

function DustDevil({
  config,
  geometry,
  ringGeometry,
  material,
  ringMaterial,
}: {
  config: DustDevilConfig;
  geometry: THREE.BufferGeometry;
  ringGeometry: THREE.BufferGeometry;
  material: THREE.Material;
  ringMaterial: THREE.Material;
}) {
  const groupRef = useRef<THREE.Group>(null);

  useFrame(({ clock }) => {
    const group = groupRef.current;
    if (!group) return;

    const elapsed = clock.elapsedTime;
    group.position.set(
      config.x + Math.sin(elapsed * 0.12 + config.phase) * 2.1,
      config.height * 0.45,
      config.z + Math.cos(elapsed * 0.1 + config.phase) * 1.8
    );
    group.rotation.y = elapsed * config.speed + config.phase;
    const pulse = 0.92 + Math.sin(elapsed * 1.4 + config.phase) * 0.08;
    group.scale.set(config.radius * pulse, config.height, config.radius * pulse);
  });

  return (
    <group ref={groupRef} renderOrder={-50}>
      <mesh geometry={geometry} material={material} />
      {[0.22, 0.42, 0.64, 0.82].map((height, index) => (
        <mesh
          key={height}
          geometry={ringGeometry}
          material={ringMaterial}
          position={[0, height - 0.48, 0]}
          rotation={[Math.PI / 2, 0, (index / 4) * Math.PI]}
          scale={[0.55 + height * 0.7, 0.55 + height * 0.7, 0.35]}
        />
      ))}
    </group>
  );
}

function SandDevils({ profile, seed }: { profile: AtmosphereProfile; seed: number }) {
  const devils = useMemo(() => createDustDevils(profile, seed), [profile, seed]);
  const resources = useMemo(() => {
    const material = new THREE.MeshBasicMaterial({
      color: profile.color,
      transparent: true,
      opacity: Math.min(0.34, profile.opacity * 0.46),
      depthWrite: false,
      fog: true,
      side: THREE.DoubleSide,
    });
    const ringMaterial = new THREE.MeshBasicMaterial({
      color: profile.color,
      transparent: true,
      opacity: Math.min(0.5, profile.opacity * 0.74),
      depthWrite: false,
      fog: true,
      side: THREE.DoubleSide,
    });

    return {
      geometry: new THREE.ConeGeometry(1, 1, 24, 1, true),
      ringGeometry: new THREE.TorusGeometry(0.55, 0.024, 6, 28),
      material,
      ringMaterial,
    };
  }, [profile]);

  useEffect(
    () => () => {
      resources.geometry.dispose();
      resources.ringGeometry.dispose();
      resources.material.dispose();
      resources.ringMaterial.dispose();
    },
    [resources]
  );

  if (devils.length === 0) return null;

  return (
    <group name={`sand-devils-${profile.variant}`}>
      {devils.map((devil, index) => (
        <DustDevil
          key={`${devil.x}:${devil.z}:${index}`}
          config={devil}
          geometry={resources.geometry}
          ringGeometry={resources.ringGeometry}
          material={resources.material}
          ringMaterial={resources.ringMaterial}
        />
      ))}
    </group>
  );
}

export function WorldAtmosphere({ theme, seed, config }: WorldAtmosphereProps) {
  const sunGroupRef = useRef<THREE.Group>(null);
  const sunMaterialRef = useRef<THREE.MeshBasicMaterial>(null);
  const sunInnerCoronaMaterialRef = useRef<THREE.MeshBasicMaterial>(null);
  const sunOuterCoronaMaterialRef = useRef<THREE.MeshBasicMaterial>(null);
  const atmosphereProfiles = useMemo(
    () => scaleAtmosphereProfiles(getAtmosphereProfiles(theme, seed), config),
    [config, theme, seed]
  );
  const skyMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: getSkyUniforms(theme),
        vertexShader: SKY_VERTEX_SHADER,
        fragmentShader: SKY_FRAGMENT_SHADER,
        side: THREE.BackSide,
        depthWrite: false,
        depthTest: false,
        fog: false,
      }),
    [theme]
  );

  const sunColor = useMemo(
    () => createThemeColor(theme.sunColor, '#ffffff', theme.id === 'basalt' ? 0.25 : 0.1),
    [theme]
  );

  useFrame(({ clock }) => {
    const fireIntensity = getBlazeGearstormSkyIntensity();
    const phantomIntensity = getPhantomVeilSkyIntensity();
    skyMaterial.uniforms.fireIntensity.value = fireIntensity;
    skyMaterial.uniforms.phantomIntensity.value = phantomIntensity;
    skyMaterial.uniforms.time.value = clock.elapsedTime;

    const pulse = 0.92 + Math.sin(clock.elapsedTime * 7.4) * 0.08;
    const sunVisibility = 1 - phantomIntensity;

    if (sunMaterialRef.current) {
      sunMaterialRef.current.color.copy(sunColor).lerp(BLAZE_SUN_CORE_COLOR, fireIntensity);
      sunMaterialRef.current.opacity = sunVisibility;
      sunMaterialRef.current.transparent = sunVisibility < 0.999;
    }

    if (sunInnerCoronaMaterialRef.current) {
      sunInnerCoronaMaterialRef.current.opacity = fireIntensity * (0.2 + pulse * 0.12) * sunVisibility;
    }

    if (sunOuterCoronaMaterialRef.current) {
      sunOuterCoronaMaterialRef.current.opacity = fireIntensity * (0.09 + pulse * 0.08) * sunVisibility;
    }

    if (sunGroupRef.current) {
      sunGroupRef.current.scale.setScalar(1 + fireIntensity * (0.05 + pulse * 0.04));
    }
  });

  useEffect(() => () => skyMaterial.dispose(), [skyMaterial]);

  return (
    <group name="world-atmosphere">
      <mesh frustumCulled={false} matrixAutoUpdate={false} renderOrder={-100}>
        <sphereGeometry args={[420, ...config.skySegments]} />
        <primitive object={skyMaterial} attach="material" />
      </mesh>
      <group ref={sunGroupRef} position={SUN_POSITION} frustumCulled={false}>
        <mesh frustumCulled={false} renderOrder={-92} scale={[3.45, 3.45, 3.45]}>
          <sphereGeometry args={[7.5, ...config.sunSegments]} />
          <meshBasicMaterial
            ref={sunOuterCoronaMaterialRef}
            color={BLAZE_SUN_OUTER_CORONA_COLOR}
            transparent
            opacity={0}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            toneMapped={false}
            fog={false}
          />
        </mesh>
        <mesh frustumCulled={false} renderOrder={-91} scale={[2.15, 2.15, 2.15]}>
          <sphereGeometry args={[7.5, ...config.sunSegments]} />
          <meshBasicMaterial
            ref={sunInnerCoronaMaterialRef}
            color={BLAZE_SUN_CORONA_COLOR}
            transparent
            opacity={0}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            toneMapped={false}
            fog={false}
          />
        </mesh>
        <mesh frustumCulled={false} renderOrder={-90}>
          <sphereGeometry args={[7.5, ...config.sunSegments]} />
          <meshBasicMaterial ref={sunMaterialRef} color={sunColor} transparent opacity={1} toneMapped={false} fog={false} />
        </mesh>
      </group>
      {atmosphereProfiles.map((profile, index) => {
        const profileSeed = seed ^ (0x5a7c0de + index * 0x27d4eb2d);
        return (
          <group key={`${profile.variant}-${index}`} name={`atmosphere-${profile.variant}`}>
            {profile.kind === 'rain' ? (
              <RainStreaks profile={profile} seed={profileSeed ^ 0x4d3c2b1a} />
            ) : (
              <FallingPoints profile={profile} seed={profileSeed} />
            )}
            {profile.devilCount ? <SandDevils profile={profile} seed={profileSeed ^ 0x5a9d1e5} /> : null}
          </group>
        );
      })}
    </group>
  );
}

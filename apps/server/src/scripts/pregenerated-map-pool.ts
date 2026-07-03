import {
  STANDARD_VOXEL_MAP_THEMES,
  VOXEL_MAP_SIZE_IDS,
  type MapProfileId,
  type PregeneratedMapVisibility,
  type VoxelMapSizeId,
  type VoxelMapTheme,
} from '@voxel-strike/shared';
import prisma from '../db';
import {
  pregeneratedMapCatalogService,
  type MapPoolTopUpOptions,
} from '../maps/pregeneratedMapCatalog';

const PROFILE_IDS = ['ctf_arena', 'tdm_arena', 'battle_royal_large'] as const satisfies readonly MapProfileId[];
const VISIBILITIES = ['public', 'matchmaking-only', 'admin-only'] as const satisfies readonly PregeneratedMapVisibility[];
const ARG_NAMES = new Set([
  'profile',
  'profileId',
  'size',
  'mapSize',
  'theme',
  'themeId',
  'visibility',
  'target',
  'max',
]);

function parseArgs(argv: string[]): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      throw new Error(`Unexpected argument: ${arg}`);
    }
    const [rawKey, inlineValue] = arg.slice(2).split('=', 2);
    if (!rawKey) throw new Error(`Invalid argument: ${arg}`);
    if (!ARG_NAMES.has(rawKey)) throw new Error(`Unknown argument: --${rawKey}`);
    const nextValue = argv[index + 1];
    const value = inlineValue ?? (nextValue && !nextValue.startsWith('--') ? nextValue : 'true');
    if (value === 'true') throw new Error(`--${rawKey} requires a value`);
    if (inlineValue == null && value === nextValue) index += 1;
    parsed[rawKey] = value;
  }
  return parsed;
}

function parseBoundedInteger(
  args: Record<string, string>,
  key: string,
  min: number,
  max: number
): number | undefined {
  const raw = args[key];
  if (raw == null) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`--${key} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function parseTopUpOptions(args: Record<string, string>): MapPoolTopUpOptions {
  const profileId = args.profile ?? args.profileId;
  const mapSize = args.size ?? args.mapSize;
  const themeId = args.theme ?? args.themeId;
  const visibility = args.visibility;

  if (profileId && !(PROFILE_IDS as readonly string[]).includes(profileId)) {
    throw new Error(`Unsupported --profile: ${profileId}`);
  }
  if (mapSize && !VOXEL_MAP_SIZE_IDS.includes(mapSize as VoxelMapSizeId)) {
    throw new Error(`Unsupported --size: ${mapSize}`);
  }
  if (themeId && !STANDARD_VOXEL_MAP_THEMES.some((theme) => theme.id === themeId)) {
    throw new Error(`Unsupported --theme: ${themeId}`);
  }
  if (visibility && !VISIBILITIES.includes(visibility as PregeneratedMapVisibility)) {
    throw new Error(`Unsupported --visibility: ${visibility}`);
  }

  return {
    profileId: profileId as MapProfileId | undefined,
    mapSize: mapSize as VoxelMapSizeId | undefined,
    themeId: themeId as VoxelMapTheme['id'] | undefined,
    visibility: visibility as PregeneratedMapVisibility | undefined,
    targetReadyCount: parseBoundedInteger(args, 'target', 1, 100),
    maxGenerated: parseBoundedInteger(args, 'max', 1, 250),
  };
}

async function main(): Promise<void> {
  const startedAt = Date.now();
  const args = parseArgs(process.argv.slice(2));
  const options = parseTopUpOptions(args);
  const result = await pregeneratedMapCatalogService.topUpPool(options);
  const overview = await pregeneratedMapCatalogService.getAdminOverview();
  console.log(JSON.stringify({
    ok: true,
    options,
    result,
    overview: {
      readyTotal: overview.readyTotal,
      requiredReadyTotal: overview.requiredReadyTotal,
      lowSliceCount: overview.lowSlices.length,
      lowSlices: overview.lowSlices,
      failedTotal: overview.failedTotal,
      artifactBytesTotal: overview.artifactBytesTotal,
    },
    durationMs: Date.now() - startedAt,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }, null, 2));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

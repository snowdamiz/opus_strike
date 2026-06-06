import { getDefaultProceduralVoxelMap } from './procedural/generator.js';
import { generateProceduralVoxelMap } from './procedural/generator.js';

const proceduralMap = getDefaultProceduralVoxelMap();

export function getProceduralCTFPositions(seed: number) {
  const map = generateProceduralVoxelMap(seed);

  return {
    teamABase: map.flagZones.red,
    teamBBase: map.flagZones.blue,
    spawnPoints: map.spawnPoints,
    flagZones: map.flagZones,
  } as const;
}

export const SCI_FI_CTF_POSITIONS = {
  teamABase: proceduralMap.flagZones.red,
  teamBBase: proceduralMap.flagZones.blue,
  spawnPoints: proceduralMap.spawnPoints,
  flagZones: proceduralMap.flagZones,
} as const;

export type SciFiCTFPositions = typeof SCI_FI_CTF_POSITIONS;

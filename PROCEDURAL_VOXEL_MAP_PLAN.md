# Procedural Voxel Map Plan

## Goal

Replace the imported `Tron.glb` map with deterministic, procedural, Minecraft-style voxel maps that are textured, performant, collider-friendly, and suitable for competitive CTF gameplay.

This plan only covers the implementation path. The current browser verification step should be left to the user per `AGENTS.md`.

## Current State

- `apps/client/src/components/game/VoxelWorld.tsx` renders `TronMap` from `apps/client/src/components/game/maps/tron`.
- `TronMap.tsx` loads `/maps/Tron.glb` with `useGLTF`, clones the scene, adjusts materials, and asks physics to create colliders from GLB metadata.
- `apps/client/src/hooks/usePhysics.ts` currently imports `createCollidersFromGLB` and exposes `loadMapColliders(scene)`.
- Shared gameplay positions live in `packages/shared/src/maps/sci-fi-ctf.ts`.
- Client-only map boundaries live in `apps/client/src/config/mapBoundaries.ts`.
- There is an older hand-authored procedural-ish `sci-fi-ctf` folder with useful route/base concepts, but it is not the active world.

## Design Principles

- Deterministic generation: the same map seed must produce the same voxel terrain, spawns, flags, boundaries, and colliders on every client and server process.
- Chunked world data: generate and render in fixed-size chunks so we never create one mesh or one collider per block.
- Meshed visible faces only: use greedy meshing to merge adjacent exposed faces with the same material.
- Atlas-first textures: use one voxel texture atlas and UV tile indices to avoid many materials or draw calls.
- Physics from compressed solids: produce Rapier cuboids from merged solid runs instead of triangle meshes or block-per-collider collision.
- Competitive readability: procedural terrain must still produce fair CTF lanes, mirrored or balanced bases, reliable spawns, flag sightlines, and movement-friendly routes.
- Server authority: gameplay-critical generated data should live in `@voxel-strike/shared` so server, physics, and clients agree.

## Proposed Architecture

### Shared Package

Add a procedural map module under `packages/shared/src/maps/procedural/`.

Recommended files:

- `types.ts`: shared `VoxelBlockId`, chunk, biome, seed, collider, spawn, flag, and map manifest types.
- `rng.ts`: small deterministic PRNG such as `mulberry32`, `xorshift32`, or `sfc32`.
- `noise.ts`: deterministic value noise / fractal noise helpers with no runtime dependency.
- `blocks.ts`: block definitions and gameplay flags such as `solid`, `walkable`, `grappleable`, `slippery`, `teamTint`.
- `generator.ts`: seed to map manifest plus chunk voxel data.
- `ctfLayout.ts`: competitive CTF layout pass for bases, lanes, central arena, spawn pads, and flag zones.
- `colliders.ts`: convert voxel solids to merged cuboid collider descriptors.
- `boundaries.ts`: generated boundary polygon and helpers, replacing the hardcoded Tron rectangle.
- `index.ts`: exports for client/server.

Core data shape:

```ts
export type VoxelBlockId =
  | 'air'
  | 'grass'
  | 'dirt'
  | 'stone'
  | 'metal'
  | 'glass'
  | 'neon_red'
  | 'neon_blue'
  | 'spawn_pad'
  | 'flag_pad'
  | 'barrier';

export interface VoxelMapManifest {
  id: string;
  seed: number;
  size: { x: number; y: number; z: number };
  chunkSize: { x: number; y: number; z: number };
  spawnPoints: { red: Vec3[]; blue: Vec3[] };
  flagZones: { red: Vec3; blue: Vec3 };
  boundary: { x: number; z: number }[];
  chunks: VoxelChunkCoord[];
}
```

## Generation Pipeline

### Phase 1: Base Terrain

Generate a bounded arena, not an infinite world, because the game is CTF and needs fairness.

- Arena target: start with roughly the existing footprint, about `100 x 80` world units.
- Voxel scale: `1` world unit per block for clean Minecraft-style collision and movement.
- Height range: keep most playable terrain between `0` and `8`, with occasional vertical cover and overhang-style structures.
- Use deterministic layered noise for terrain variation:
  - low-frequency height noise for broad changes;
  - medium-frequency mask for rock/metal patches;
  - authored CTF layout pass overrides terrain where competitive routes require stable surfaces.

### Phase 2: Competitive CTF Layout

After base terrain, stamp gameplay structures into the voxel grid:

- two team bases with mirrored spawn pads;
- flag platforms with clear capture zones;
- three lane families:
  - center lane: direct, readable, medium cover;
  - high lane: elevated bridge/perches for wall-run, grapple, and jetpack play;
  - low lane: tunnel or trench route for close-range combat;
- central contested zone with cover and movement tech surfaces;
- perimeter walls or natural cliffs that match generated boundary data.

This preserves the old `sci-fi-ctf` intent while removing imported map assets.

### Phase 3: Decoration Pass

Add visual richness without creating excessive geometry:

- grass/dirt/stone layers for Minecraft terrain;
- sci-fi metal and glass blocks for base structures;
- red/blue neon blocks for team landmarks;
- sparse vertical cover columns;
- simple repeated props made from voxels rather than GLB assets.

Decoration must be driven by the same seed and block data so it does not desync between clients.

## Rendering Strategy

### Chunk Meshing

Create `apps/client/src/components/game/procedural/` with:

- `VoxelMap.tsx`: R3F component that renders the generated map.
- `VoxelChunkMesh.tsx`: memoized chunk mesh component.
- `meshBuilder.ts`: greedy meshing and typed-array geometry builder.
- `textureAtlas.ts`: texture atlas loader and UV tile mapping.
- `materials.ts`: one or two shared `MeshStandardMaterial` instances.

Rendering algorithm:

1. Generate chunk voxel data from shared manifest.
2. For each chunk, identify exposed faces only.
3. Greedy-merge coplanar faces with the same block material.
4. Write positions, normals, UVs, colors, and indices into typed arrays.
5. Create one `BufferGeometry` per chunk.
6. Render all solid opaque terrain with one atlas material.

Avoid:

- one React component per block;
- one mesh per block;
- one material per block type;
- expensive GLB loading for the map;
- runtime geometry mutation every frame.

### Textures

Add a pixel-art atlas under `apps/client/public/textures/voxels/atlas.png`.

Use nearest-neighbor sampling:

```ts
texture.magFilter = THREE.NearestFilter;
texture.minFilter = THREE.NearestMipmapNearestFilter;
texture.wrapS = THREE.ClampToEdgeWrapping;
texture.wrapT = THREE.ClampToEdgeWrapping;
```

Initial atlas tiles:

- grass top;
- grass side;
- dirt;
- stone;
- metal;
- glass or dark sci-fi panel;
- red neon;
- blue neon;
- spawn pad;
- flag pad;
- barrier.

Use per-face tile selection so a grass block can have grass on top and dirt/grass-side on its sides.

### Lighting

Keep the existing scene lighting at first, but reduce shadow pressure:

- only larger terrain chunks receive shadows;
- avoid casting shadows from every chunk if FPS drops;
- consider baked-looking vertex color darkening for block sides instead of costly extra lights.

## Physics Strategy

Replace GLB collider loading with generated voxel colliders.

In `apps/client/src/hooks/usePhysics.ts`:

- remove the import of `createCollidersFromGLB`;
- add `loadProceduralMapColliders(manifestOrColliderSet)`;
- create fixed Rapier cuboids from merged voxel collider descriptors;
- track a map id/seed so colliders are not double-loaded.

Collider generation:

1. Mark solid blocks from generated voxel data.
2. Merge contiguous blocks into axis-aligned cuboids.
3. Prefer wide horizontal floor slabs and vertical wall slabs.
4. Keep interactive/movement surfaces simple and boxy.
5. Skip decorative non-solid blocks.

Suggested collider descriptor:

```ts
export interface VoxelCollider {
  center: Vec3;
  halfExtents: Vec3;
  material: 'default' | 'ice' | 'bounce' | 'barrier';
}
```

Optimization target:

- hundreds of colliders at most, not thousands;
- no trimesh colliders for terrain;
- no collider creation during the render loop;
- call `world.step()` and `world.updateSceneQueries()` after collider load, matching current behavior.

## Gameplay Integration

### Spawns And Flags

Replace `SCI_FI_CTF_POSITIONS` with either:

- a generated manifest export for the default seed; or
- a function such as `getProceduralCTFPositions(seed)`.

Server and client should both consume the shared generated positions.

Migration path:

1. Keep the current shape of `spawnPoints.red`, `spawnPoints.blue`, `flagZones.red`, and `flagZones.blue`.
2. Generate the same fields from the procedural map manifest.
3. Update `packages/shared/src/maps/index.ts` to export the new procedural map positions.
4. Update imports gradually so match logic does not care whether positions came from Tron or procedural generation.

### Boundaries

Move boundary generation into shared code.

Replace client-only `apps/client/src/config/mapBoundaries.ts` with a shared boundary polygon derived from the map manifest. Existing helpers like `isInsideBoundary`, `constrainToBoundary`, and `clampToBoundary` can be moved or mirrored from shared data.

### Movement And Abilities

Procedural maps must explicitly preserve:

- open floor for bunny hop and slide routes;
- vertical surfaces for wall-running;
- ledges for mantling;
- high anchor points for hookshot;
- clear airspace for jetpack;
- unobstructed spawn exits;
- validated teleport/blink destinations.

Add a `movementTags` or block metadata layer later if abilities need special surface behavior.

## Implementation Slices

### Slice 1: Shared Procedural Map Core

- Add shared procedural map types, seeded RNG, basic noise, and block definitions.
- Generate a fixed-size arena with deterministic chunks.
- Generate spawn/flag/boundary manifest for a default seed.
- Add shared unit tests for deterministic output if the repo has a test setup; otherwise add typecheck-only verification.

Acceptance:

- Same seed produces identical manifest and chunk data.
- Different seeds produce different decoration/terrain while preserving CTF layout constraints.

### Slice 2: Voxel Mesh Renderer

- Add client procedural map components.
- Implement greedy meshing for chunk geometry.
- Add or generate a simple texture atlas.
- Replace `TronMap` usage inside `VoxelWorld.tsx` with `VoxelMap`.
- Keep the invisible fallback floor temporarily.

Acceptance:

- Imported `/maps/Tron.glb` is no longer loaded by the active world.
- Terrain renders from generated voxel data.
- Geometry count is chunk-based, not block-based.

### Slice 3: Procedural Physics Colliders

- Add shared collider merging from voxel solids.
- Replace `loadMapColliders(scene)` with generated collider loading.
- Remove GLB collider dependency from `usePhysics.ts`.
- Ensure ground raycasts, teleport validation, wall checks, and ability checks still use Rapier queries.

Acceptance:

- Player collision comes from generated cuboids.
- No GLB scene is required for physics.
- Collider count stays within the chosen performance budget.

### Slice 4: Shared Gameplay Positions

- Generate CTF spawn and flag positions from the procedural manifest.
- Update server/client imports to consume generated positions.
- Move or share map boundary logic.
- Keep field names compatible with the existing game store and match manager.

Acceptance:

- Server spawns players on procedural spawn pads.
- Flags appear on procedural flag pads.
- Boundary clamping matches the generated arena.

### Slice 5: Remove Imported Map Assets From Active Path

- Delete or archive active imports from `apps/client/src/components/game/maps/tron`.
- Remove active references to `/maps/Tron.glb`.
- Leave asset deletion for a separate cleanup commit if desired, since large binary removals are harder to review.

Acceptance:

- `rg "TronMap|Tron.glb|loadMapColliders|createCollidersFromGLB"` shows no active runtime dependency.
- Build/typecheck passes.

### Slice 6: Quality And Performance Pass

- Add chunk-level memoization.
- Add frustum culling if needed.
- Add optional chunk LOD for far terrain:
  - full mesh near player;
  - simplified terrain shell or hidden detail far away.
- Tune shadows, lights, and material counts.
- Add debug stats for chunk count, face count, triangle count, collider count, and generation time.

Acceptance targets:

- Map generation under `100ms` for the default arena on a normal dev machine.
- Chunk mesh build under `5ms` average per chunk.
- Draw calls under `150` for the whole terrain scene.
- Terrain triangles under `150k` for the first version.
- Collider count under `500`.

## File-Level Migration Checklist

- `apps/client/src/components/game/VoxelWorld.tsx`
  - Replace `TronMap` with `VoxelMap`.
  - Keep or remove the fallback ground once generated colliders are trusted.

- `apps/client/src/components/game/maps/tron/TronMap.tsx`
  - Remove from active usage.
  - Later delete with GLB collider utilities if no longer needed.

- `apps/client/src/hooks/usePhysics.ts`
  - Remove GLB collider imports.
  - Add generated collider loading.

- `packages/shared/src/maps/sci-fi-ctf.ts`
  - Replace hardcoded Tron comments/positions with procedural manifest positions.

- `packages/shared/src/maps/index.ts`
  - Export the procedural map module.

- `apps/client/src/config/mapBoundaries.ts`
  - Move boundary data to shared procedural map output.

- `apps/client/public/maps/*`
  - Stop referencing these from runtime.
  - Delete only after confirming no other component imports them.

## Risks And Mitigations

- Risk: fully random maps create unfair CTF layouts.
  - Mitigation: generate a stable competitive layout first, then procedural terrain/decor around it.

- Risk: naive voxel rendering tanks FPS.
  - Mitigation: greedy meshing, chunk geometries, one atlas material, no per-block React components.

- Risk: too many physics colliders make movement stutter.
  - Mitigation: merge solids into cuboids, avoid trimesh colliders, cap decorative solids.

- Risk: server/client desync from procedural generation.
  - Mitigation: keep seed, RNG, generation, positions, and collider descriptors in `@voxel-strike/shared`.

- Risk: generated geometry breaks movement abilities.
  - Mitigation: bake required lane widths, wall-run panels, ledges, and hookshot anchors into the layout pass.

## Verification Plan

Do not test in the browser; leave that to the user.

Recommended non-browser checks:

- `pnpm --filter @voxel-strike/shared typecheck`
- `pnpm --filter @voxel-strike/client typecheck`
- `pnpm build:client`
- Add deterministic generation tests if a test runner is introduced.
- Add debug logs or dev-only counters for generated chunks, faces, triangles, and colliders.

## Recommended Default Seed

Use one named default map seed for production while the system matures:

```ts
export const DEFAULT_PROCEDURAL_MAP_SEED = 0x57564f58; // "WVOX"
```

Future versions can expose seeded map rotation, but the first implementation should prioritize one polished procedural CTF arena over many unpredictable ones.

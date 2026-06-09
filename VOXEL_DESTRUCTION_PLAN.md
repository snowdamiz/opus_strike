# Map Voxel Destruction Plan

## Reader And Goal

This plan is for an internal engineer adding live map destruction to the procedural Capture the Flag voxel map.

After reading this, they should be able to implement block destruction in vertical slices while preserving the current performance wins from sparse chunks, greedy meshes, batched rendering, and heightfield ground checks.

## Current Architecture Review

The procedural map is deterministic from a seed. The shared map generator creates a manifest containing theme data, world origin, voxel size, map size, chunk size, spawn points, flag zones, boundary polygon, a top-solid-row heightfield, sparse voxel chunks, merged collision cuboids, and generation stats.

Blocks are stored as numeric ids in `Uint8Array` chunk buffers. A block definition decides whether a block is solid, walkable, grappleable, slippery, team tinted, or collision-capable. Render solidity and collision solidity are not identical: decorative wood, leaves, and cactus render as solid voxels but are excluded from collision.

Chunks are sparse. Empty chunks are omitted from the manifest, and each present chunk stores its local size, block buffer, and solid block count. This matters for destruction: removing blocks should update existing sparse chunks without introducing a full dense map representation.

The heightfield is a `Uint16Array` storing `topSolidRows` per X/Z column. Client ground checks use this as a fast path before Rapier raycasts, and server movement also uses it before falling back to voxel scans. This is one of the most important optimizations to preserve.

Collider generation currently scans the voxel map and greedily merges collision-capable cells into cuboids. The resulting colliders are static for the whole manifest. On the client, procedural colliders are loaded into Rapier as fixed cuboids. That is good for static maps, but a destroyed block inside a merged cuboid would still collide unless affected collider regions can be rebuilt.

Client meshes are built with greedy face merging. The mesh builder creates cached block accessors and cached geometries keyed by manifest id and chunk or region id. The current map renderer batches renderable chunks into large regions spanning several chunks in X/Z. That keeps draw calls low, but live destruction needs finer invalidation so one rocket does not rebuild too much geometry every frame.

The server keeps its own manifest and chunk lookup. Server bot line of sight, bot collision, and procedural ground queries read voxel blocks directly. Any authoritative destruction system must update these lookups and clear stale line-of-sight cache entries.

Skill damage is currently centered on players or client-reported projectile impacts. Rockets already have a server message for impact positions, with deduplication and cooldown protection. Bombs, air strikes, and some targeting visuals are more client-local, so those need explicit server-side target messages before they can modify terrain authoritatively.

## Target State

The map should become a mutable runtime voxel world layered over the deterministic base manifest.

The base manifest still comes from the seed. Destruction applies as authoritative deltas during a match. A delta removes or changes a bounded set of voxel cells, updates derived runtime views, and broadcasts the compact change to clients.

Ordinary terrain and structure blocks should be susceptible to direct hits and splash damage from skills. Critical gameplay protection remains intact: boundary barriers, bottom safety blocks, spawn pads, flag pads, and protected spawn/flag clearance zones should be indestructible or effectively unbreakable.

The first implementation should support destruction only. It should not support placing new map blocks. That keeps chunk creation, collider growth, and network snapshots simpler.

## Design Principles

1. Keep the seed manifest immutable as the reset baseline.
2. Make the server authoritative for all block health and block removal.
3. Broadcast only deltas, not full chunk payloads, during gameplay.
4. Recompute only affected heightfield columns, render regions, and collider regions.
5. Coalesce repeated impacts into one dirty update per tick.
6. Put hard budgets on splash traversal, destroyed blocks per event, and rebuild work per frame.
7. Avoid structural simulation in the first pass. Floating remnants are acceptable until collapse becomes a deliberate feature.

## Runtime Data Model

Add a runtime world wrapper around the generated manifest.

Suggested concepts:

- `VoxelRuntimeWorld`: base manifest, mutable chunk lookup, chunk revisions, map revision, damaged block health, dirty columns, dirty chunks, dirty collider regions.
- `VoxelCellKey`: packed global cell index or explicit grid coordinate.
- `VoxelChunkKey`: packed chunk coordinate.
- `VoxelDelta`: revision, seed, removed cells, optional changed cells, dirty chunk ids, impact metadata for effects.
- `VoxelDamageProfile`: direct damage, splash damage, radius, falloff, max visited cells, max destroyed cells, affected block classes.

For runtime block health, do not allocate a full health array for the whole map. Store partial damage only for blocks that have been hit and not destroyed yet:

- Key: packed global cell index.
- Value: remaining block health or accumulated damage.
- Remove the key when the block is destroyed.

This keeps memory tied to combat activity rather than map size.

## Block Durability

Extend block definitions with destruction metadata.

Suggested fields:

- `destructible`: whether skill damage can affect this block.
- `durability`: base hit points.
- `splashMultiplier`: how strongly splash affects this material.
- `directMultiplier`: how strongly direct hits affect this material.
- `critical`: whether gameplay rules should protect the block.

Initial tuning:

| Block Type | Role | Durability |
| --- | --- | --- |
| Grass, dirt | soft terrain | low |
| Glass, leaves | fragile cover | very low |
| Wood, cactus | decorative/destructible | low |
| Stone | main terrain and cover | medium |
| Metal, neon | structure/cover | medium-high |
| Barrier, spawn pads, flag pads | critical gameplay | indestructible |

Protected zones should override material durability. A normal stone block inside spawn/flag clearance can remain protected even if stone elsewhere is destructible.

## Damage Flow

All skill paths that can affect terrain should resolve into the same server helper:

`applyVoxelDamage(sourcePlayer, center, profile, options)`

The helper should:

1. Validate the center is inside the active map and playable bounds.
2. Apply direct damage to an explicitly hit block if provided.
3. Apply splash damage within a bounded sphere.
4. Skip air, indestructible, protected, and non-matching block classes.
5. Update damaged-block health or remove blocks.
6. Record dirty columns, chunks, neighbor chunks, and collider regions.
7. Batch one outbound voxel delta for the current server tick.
8. Clear affected line-of-sight cache entries or clear the cache if selective invalidation is not ready.

### Direct Hits

Direct hits should use a voxel raycast or impact-normal lookup to identify the exact target block.

For hitscan and melee attacks, the server should raycast from the player eye or weapon origin along the look direction. If a player and a block are both hit, resolve whichever is closer, then apply any configured splash at that impact point.

For rockets, the client can continue reporting the impact point for responsiveness, but the server should validate it. A good first validation is to check distance from the owner, map bounds, rocket id ownership, and nearest solid cell around the reported point. A stronger version sends the previous projectile position or direction so the server can run a short voxel DDA through the impact segment.

For ground-targeted skills, the client should send the requested target position. The server should validate range, line of sight or ground visibility, and then snap the center to the nearest valid ground/collision surface.

### Splash Damage

Splash should iterate a grid-space AABB around the damage sphere:

1. Convert center and radius to grid min/max.
2. Visit only cells within the sphere by checking center-to-cell distance.
3. Skip air and protected cells before doing expensive work.
4. Use linear falloff for block damage.
5. Apply material multipliers.
6. Stop once profile budgets are reached.

Do not raycast from the explosion center to every candidate block in the first pass. That would be expensive at voxel scale. If needed later, add coarse occlusion by sampling only outward shell rays.

## Skill Profiles

Start with a small profile table keyed by damage type or ability id.

Suggested first pass:

| Skill | Direct | Splash | Notes |
| --- | ---: | ---: | --- |
| Blaze rocket | high | medium radius | Main proving path because impact reporting already exists. |
| Blaze bomb | very high | large radius | Needs authoritative target/impact message before terrain damage. |
| Blaze air strike | high per strike | medium radius per bomb | Treat as several capped explosions, not one huge sphere. |
| Blaze flamethrower | low repeated | narrow cone | Damage fragile blocks and exposed soft terrain only. |
| Rocket jump | low | small radius | Optional self-centered terrain chip; keep mobility safe. |
| Phantom void ray | high line damage | tiny splash | Good later use case for voxel DDA along a beam. |
| Hookshot heavy | medium direct | none or tiny | Lets hooks chip cover without carving craters. |

Use conservative values first. Destruction can become more dramatic after the rebuild and networking budgets are proven.

## Derived State Updates

### Chunk Blocks

When a block is destroyed:

1. Find the containing chunk from the runtime chunk lookup.
2. Set the local block id to air.
3. Decrement `solidBlockCount` if the old block was solid.
4. Increment the chunk revision.
5. Mark the chunk dirty for mesh rebuild.
6. If the destroyed block is on a chunk boundary, mark neighbor chunks dirty so newly exposed faces appear.

Because the first pass is destruction-only, missing chunks do not need to be created.

### Heightfield

Track dirty X/Z columns while applying damage.

For each dirty column:

1. Read the old top row.
2. If the removed block was below the old top, leave the heightfield unchanged.
3. If the removed block was at or above the old top, scan downward in that column until the next solid block.
4. Write the new top row.

This keeps the fast ground path intact and limits work to affected columns.

### Server Voxel Queries

Replace direct reads from the immutable manifest chunk lookup with reads through the runtime world. Bot line of sight, bot body checks, terrain ground queries, spawn placement, and ability validation should all use the same runtime accessor.

When terrain changes, either clear the whole line-of-sight cache or delete entries whose quantized segment intersects the dirty AABB. Clearing the whole cache is acceptable for the first slice because destruction events are much less frequent than bot LOS checks.

### Client Meshes

Change geometry cache keys to include region or chunk revisions. A dirty region should dispose its old geometry and rebuild from the mutable runtime accessor.

The current 4-by-4 chunk region batching is efficient for static maps but may be too coarse for frequent destruction. Use one of these approaches:

1. Start with smaller destructible regions, such as 2-by-2 chunks per Y layer.
2. Rebuild individual chunks for dirty areas while keeping static region meshes for untouched areas.
3. Keep current regions but throttle rebuilds aggressively as a temporary bridge.

The recommended path is 2-by-2 destructible regions. It keeps draw calls controlled while reducing worst-case rebuild cost.

Queue client rebuilds instead of rebuilding immediately inside the network message handler. Per frame, process a small number of dirty regions, prioritizing regions near the local player and camera.

### Client Colliders

The current collider load path creates fixed colliders for the whole manifest. Destruction needs collider regions.

Add a region-scoped collider builder:

- Build greedy cuboids only for one collider region.
- Store one fixed Rapier rigid body per collider region.
- On dirty region rebuild, remove that region body and recreate it.
- Keep unaffected region bodies untouched.

Use the same collision block rules as generation, including decorative non-colliding blocks.

Collider regions can be the same as render regions or slightly larger. A 2-by-2-by-1 chunk region is a good starting point. It bounds rebuild time and avoids global Rapier reloads.

After rebuilding a collider region, step/update Rapier scene queries once. Batch multiple dirty collider regions before the update when possible.

### World Dressing

Do not regenerate all dressing after every blast.

First pass:

- Remove or hide dressing instances inside the impact sphere.
- Leave distant dressing unchanged.
- Rebuild all dressing only when the map seed changes.

This prevents floating tufts or crystals near craters without turning dressing into a dynamic terrain system.

## Networking

Add explicit voxel messages to the shared network types.

Suggested messages:

- `voxelDelta`: sent after one or more destruction events in a tick.
- `voxelSnapshot`: sent to a joining or reconnecting client after the normal match snapshot.

Delta shape:

```ts
interface VoxelDeltaMessage {
  seed: number;
  revision: number;
  removed: number[];
  changed?: Array<{ index: number; block: number }>;
  impacts?: Array<{
    type: string;
    position: { x: number; y: number; z: number };
    radius: number;
  }>;
}
```

The first implementation can use packed global cell indices in JSON. If deltas become large, switch to chunk-local compression:

```ts
interface VoxelChunkDelta {
  chunk: { x: number; y: number; z: number };
  revision: number;
  removedLocalIndices: number[];
}
```

Clients should ignore deltas whose seed does not match their active map. They should apply deltas in revision order. If a revision gap appears, request or wait for a snapshot.

## Performance Guardrails

Initial hard budgets:

- Max visited cells per splash event: 8,000 to 12,000.
- Max destroyed blocks per event: 96 for rockets, 192 for bombs, lower for rapid-fire skills.
- Max dirty render regions rebuilt per frame: 1 near the player, optionally 2 if frame time is healthy.
- Max dirty collider regions rebuilt per frame: 1, with batching when several dirty regions are adjacent.
- Max voxel delta payload per server tick: cap and defer overflow to the next tick.
- Max partial-damage entries: cap by match budget; evict oldest low-damage entries if needed.

For a 0.25m voxel size, a 3.2m rocket splash has roughly a 13-cell radius. A naive sphere can visit around 9,000 cells before skips, so the budget is realistic for occasional rockets but not for continuous beams. Channeled skills should use lower rates, narrower sampling, or material filters.

Important optimizations:

- Convert world-space damage bounds to grid-space once per event.
- Skip air blocks before distance and durability work when possible.
- Coalesce multiple removed blocks into one dirty chunk set.
- Recompute each dirty heightfield column once per tick.
- Rebuild meshes and colliders asynchronously from network handling.
- Keep existing instanced/projectile rendering unchanged.

## Gameplay Safety

Critical areas must stay playable even after heavy damage.

Rules:

- Boundary shell and bottom barrier are indestructible.
- Spawn pads and flag pads are indestructible.
- Blocks inside spawn and flag clearance radii are protected.
- Do not allow destruction to lower a spawn or flag support column below the placement height during an active round.
- Do not allow a single explosion to remove enough terrain to create deep unavoidable pits near objectives.

The generator currently enforces spawn sightline occlusion during map creation. Destruction can weaken that guarantee. The first pass should protect spawn-adjacent blockers or protected spawn volumes. A later pass can add dynamic anti-sightline repair rules if fully destructible competitive maps become a design goal.

## Implementation Slices

### 1. Add Runtime Voxel World Utilities

Create shared runtime utilities for:

- Packing and unpacking global cell indices.
- Converting world coordinates to grid coordinates.
- Reading and mutating blocks by grid coordinate.
- Tracking chunk revisions.
- Recomputing dirty heightfield columns.
- Finding dirty neighbor chunks.
- Testing protected cells.

Keep this independent from React, Rapier, and Colyseus so both server and client can use it.

### 2. Add Durability Metadata

Extend block definitions with destructibility and durability fields. Add helper functions:

- `isDestructibleBlock`
- `getBlockDurability`
- `getBlockDamageMultiplier`
- `isProtectedVoxel`

Start with conservative durability and indestructible critical blocks.

### 3. Implement Server Voxel Damage

Add a server-side damage service around the runtime world.

It should apply direct and splash damage, collect deltas, update heightfield/chunk revisions, and broadcast batched `voxelDelta` messages after combat processing.

Update server map queries to read from the runtime world instead of a plain manifest chunk lookup.

### 4. Wire Blaze Rockets First

Attach block damage to the existing rocket impact handler.

This is the best first proving path because rockets already:

- Have client-side impact detection.
- Send a server impact message.
- Have deduplication.
- Apply player splash damage.
- Produce visible terrain impact effects.

Apply direct damage to the nearest solid voxel at the impact, then splash around the same center.

### 5. Add Client Delta Application

Add a client-side runtime world for the active manifest. When `voxelDelta` arrives:

- Validate seed and revision.
- Apply removed cells to chunk buffers.
- Update chunk and region revisions.
- Mark render and collider regions dirty.
- Hide dressing inside impact spheres.

The map component should render from the runtime world instead of directly from the immutable manifest.

### 6. Rework Mesh Cache Invalidation

Update mesh building so cache entries include region revisions and can be disposed per region. Add a dirty rebuild queue with a small per-frame budget.

Keep greedy meshing. The goal is not a new mesher; it is finer invalidation around the existing mesher.

### 7. Add Region Collider Rebuilds

Replace whole-map procedural collider reloads with region-scoped collider bodies. Load all regions initially, then rebuild only dirty regions after voxel deltas.

Keep the heightfield ground fast path for common ground checks. Rapier remains necessary for walls, ledges, projectile raycasts, and non-heightfield geometry.

### 8. Add Join-In-Progress Snapshots

When a client joins, send the base seed through the normal snapshot path and then send the current voxel destruction snapshot.

The snapshot should be compact. Initially, a list of removed global indices is acceptable. If the list grows too large, send chunk-local RLE.

### 9. Expand To Ground-Targeted Skills

Add authoritative target messages for bomb and air strike. The server should validate range and ground hit before applying player damage and voxel damage.

Once the server owns those impact centers, attach the same damage profiles used by rockets.

### 10. Expand To Hitscan, Melee, And Channeled Skills

Add voxel raycasts for direct attacks when no player is hit, or when terrain is closer than the player. Add low-rate terrain damage for flamethrower and beams with strict budgets.

Do this after rocket and bomb performance is measured.

### 11. Polish Visual Feedback

Add optional block-break effects driven by `voxelDelta.impacts`:

- Small debris particles colored by material.
- Dust puffs for stone/dirt.
- Spark bursts for metal/neon.
- Glass shards for glass.

Keep these effects instanced or pooled. They should never be required for gameplay correctness.

## Validation

Do not use browser testing for this repository unless the user asks for it.

Non-browser verification should include:

- Unit tests for grid conversion, cell packing, block mutation, protected cells, and heightfield recomputation.
- Unit tests for direct voxel ray hits and splash damage falloff.
- Tests that chunk revisions and dirty neighbor chunks are correct at chunk boundaries.
- Tests that deltas apply identically on server and client runtime worlds.
- A generator/destruction smoke script that applies deterministic rocket and bomb impacts across many seeds, then reports destroyed blocks, dirty chunks, dirty collider regions, heightfield updates, and elapsed time.
- Typecheck/build for shared, server, and client packages.

Suggested smoke success criteria:

- No protected block is removed.
- Heightfield top rows match a full rescan after random destruction.
- No chunk has a negative solid block count.
- Delta replay on a fresh manifest produces the same block layout.
- Per-impact runtime stays inside budget for common rocket and bomb profiles.

## Open Decisions

- Whether partial block damage should be visible before a block breaks.
- Whether unsupported structures should collapse later.
- Whether spawn sightline blockers should be protected or dynamically repaired.
- Whether mesh rebuilds need a Web Worker after initial profiling.
- Whether deltas should become binary or chunk-RLE before public multiplayer scale.

The recommended first implementation is deliberately conservative: server-authoritative block removal, rockets first, bounded splash, dirty heightfield columns, region mesh rebuilds, and region collider rebuilds. That gives real destruction without sacrificing the performance model the map code already has.

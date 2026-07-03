# Pregenerated Map Pool Plan

## Reader And Action

Reader: an implementation engineer adding a pregenerated map catalog to Slop Heroes.

Post-read action: replace match-time procedural map generation with a server-managed pool of ready maps, expose selectable pregenerated maps to players, and keep automatic Battle Royal launches fast by drawing from the same pool.

## Confirmed Current State

- Map identity is currently seed-driven. The match path carries seed, theme id, size, and profile id through lobby, game room state, metadata, client store, minimap, map warmup, streamer metadata, and match persistence.
- Shared procedural map generation already supports `small`, `medium`, and `large` sizes.
- Shared map profiles currently include Capture the Flag arena, Team Deathmatch arena, Battle Royal, tutorial, and dev-testing profiles.
- Capture the Flag and Team Deathmatch map vote currently creates three seed-based options, one for each map size.
- Battle Royal currently skips map vote and creates one launch selection automatically. Its size is selected from participant count.
- Battle Royal generation already supports small, medium, and large variants even though the profile id is named Battle Royal large.
- The client map vote preview currently generates full preview manifests in a web worker and caches them in memory.
- The game load path warms CPU map prep and geometry from the selected seed/profile/size.
- The server game room currently generates the authoritative map manifest during room creation. Battle Royal can use a worker, but it still blocks game-room readiness until the manifest is available.
- The server room map runtime uses the generated manifest for terrain lookup, collision, bot route graph, powerups, spawn placement, safe zone/drop logic, and metadata.
- Match persistence currently records seed and theme id, but not map size, map profile id, map artifact id, generator version, topology, or catalog metadata.

## Goals

- Keep a ready inventory of pregenerated maps for every playable map profile and every supported size.
- Include Battle Royal maps in the inventory for small, medium, and large matches.
- Let users select from pregenerated maps instead of waiting for new generation during every game.
- Let matchmaking and Battle Royal auto-start draw from the same pregenerated inventory without exposing slow generation to players.
- Preserve deterministic seed fallback during rollout so a missing artifact does not hard-fail all game starts.
- Store enough metadata to audit, replay, retire, and regenerate maps after generator changes.
- Remove match-start dependency on full procedural generation once the pool is proven.

## Non-Goals

- No browser testing. The user will handle browser validation.
- No worktrees or branches.
- No redesign of the procedural generator itself.
- No hand-authored maps in the first implementation. The first pool is generated from existing procedural seeds.
- No public map editor.

## Target Product Flow

Custom and quick-play arena lobbies should see pregenerated map cards during map selection. Each option should already have metadata, preview, tags, and a ready manifest artifact. Voting chooses a catalog map id, not an anonymous seed recipe.

Battle Royal matchmaking should select a ready Battle Royal map automatically from the pool. If the lobby later exposes Battle Royal map choice, the same catalog can provide visible choices, but the launch path should not require a vote.

Game rooms should load the selected artifact directly. Seed/profile/size/theme remain synced for existing client and server systems, but the artifact id becomes the stable primary identity.

## Map Pool Shape

Treat a pool entry as a generated artifact plus searchable catalog metadata.

Required dimensions:

- Arena profiles: Capture the Flag arena and Team Deathmatch arena.
- Battle Royal profile: Battle Royal maps for small, medium, and large sizes.
- Sizes: small, medium, and large for every profile.
- Themes: enough coverage across the currently selectable standard map themes to avoid repetitive votes.
- Topologies: enough coverage across arena topology ids for variety. Battle Royal topology is currently ring.
- Live-ops themes: event-biome maps should either be pregenerated into a separate tagged slice or excluded from strict ready-only launch until the event pool is filled.

Recommended initial stock, based on the seven standard themes currently used for normal selection:

| Profile | Size | Ready Count Per Theme | Minimum Total |
| --- | ---: | ---: | ---: |
| Capture the Flag arena | small | 3 | 21 |
| Capture the Flag arena | medium | 3 | 21 |
| Capture the Flag arena | large | 3 | 21 |
| Team Deathmatch arena | small | 3 | 21 |
| Team Deathmatch arena | medium | 3 | 21 |
| Team Deathmatch arena | large | 3 | 21 |
| Battle Royal | small | 2 | 14 |
| Battle Royal | medium | 2 | 14 |
| Battle Royal | large | 2 | 14 |

Adjust counts upward after measuring artifact size and generation throughput. Battle Royal artifacts are heavier, so keep a lower floor and replenish earlier. Special themes such as golden or event biomes should use their own tagged pool slices so they can be enabled or retired independently.

## Catalog Data Model

Add a durable map catalog instead of embedding the pool in process memory.

Recommended models:

- `PregeneratedMap`
  - Stable id.
  - Artifact id or storage key.
  - Generator version.
  - Seed.
  - Theme id.
  - Profile id.
  - Gameplay mode.
  - Map family id.
  - Map size.
  - Topology id.
  - Display name.
  - Preview tags.
  - Preview silhouette JSON.
  - Stats: solid block count, renderable chunk count, collider count, estimated triangles.
  - Diagnostics score and warning list.
  - Status: generating, ready, reserved, active, retired, failed.
  - Visibility: public, matchmaking-only, admin-only.
  - Last selected timestamp.
  - Selection count.
  - Failure count.
  - Created and updated timestamps.

- `PregeneratedMapArtifact`
  - Stable id.
  - Storage provider: database, local disk, object storage.
  - Storage key.
  - Byte size.
  - Compression codec.
  - Content hash.
  - Manifest schema version.
  - Created timestamp.

- `PregeneratedMapSelection`
  - Map id.
  - Lobby id.
  - Room id.
  - Match id when available.
  - Selection source: vote, matchmaking, battle-royal-auto, streamer-rotation, admin.
  - Selected by player id when applicable.
  - Selected timestamp.

Extend match persistence with optional map size, profile id, topology id, and pregenerated map id. Keep existing seed and theme fields for compatibility and historical queries.

## Artifact Format

The manifest contains typed arrays for chunks and heightfields, so do not store it as plain JSON without a typed-array revival strategy.

Use one of these formats:

- Preferred: compressed binary manifest bundle with a small JSON header and binary buffers for chunk blocks and heightfields.
- Acceptable first slice: JSON envelope where typed arrays are serialized as base64 buffers with explicit element type, length, and byte order.
- Avoid: plain JSON arrays for voxel data. Large maps will be too slow and too large.

Each artifact should include:

- Full authoritative manifest.
- Preview data already present on the manifest.
- Stats and diagnostics copied into catalog columns for querying.
- Content hash computed over the serialized manifest.
- Generator version and schema version.

## Generation Worker

Create a server-side map pool worker that can run as a script, admin-triggered job, or long-running background process.

Responsibilities:

- Discover pool deficits by profile, size, theme, topology, and visibility.
- Generate candidate maps using the existing procedural generator and preview functions.
- Reject candidates with diagnostics warnings that should not ship.
- Store the artifact.
- Insert or update catalog rows transactionally.
- Mark failed candidates with error details and seed so the same bad candidate is not retried forever.
- Retire old-version maps after replacement inventory is ready.

The generator should be idempotent by content hash and by map identity tuple. Running it twice should top up the pool, not duplicate ready maps.

## Selection Service

Add a map catalog service used by lobby map vote, Battle Royal auto-selection, streamer map rotation, and future admin tools.

Core APIs:

- `listSelectableMaps`: returns ready catalog summaries filtered by gameplay mode, profile, size, theme, topology, visibility, and participant count.
- `createMapVoteOptionsFromPool`: returns three or more ready map options without generating manifests.
- `selectMapForBattleRoyal`: picks one ready BR map based on participant-derived size, freshness, recent-use avoidance, and optional event theme.
- `reserveMapForLaunch`: marks a map as selected or reserved long enough for room creation.
- `loadMapManifest`: reads and deserializes the artifact, validates hash/version, and returns the manifest.
- `recordMapLaunchResult`: increments selection count or failure count and releases reservations.

Selection rules:

- Do not show two maps with the same seed in one vote.
- Prefer different sizes, themes, and topologies in visible votes.
- Avoid maps used recently in the same process or same region.
- Battle Royal should prefer the participant-size band but may step up or down one size if the exact band is temporarily empty.
- Ranked or wagered matches should only use ready, public, non-retired maps.
- Admin-only maps should never appear in public matchmaking.

## Lobby Integration

Replace seed generation in map vote with catalog lookup.

Arena flow:

1. Lobby starts map selection.
2. Selection service returns ready catalog summaries.
3. Lobby broadcasts vote options including map id, seed, theme, size, profile, topology, preview, stats, and tags.
4. Client renders previews from catalog data or fetches a pre-rendered thumbnail. It should not generate full preview manifests just to make voting possible.
5. Winning option carries map id into game-room creation.

Battle Royal flow:

1. Lobby computes participant count.
2. Selection service picks a ready BR map for the matching size band.
3. Lobby broadcasts map generation started as a compatibility/loading event, but the message should represent artifact loading rather than generation.
4. Lobby creates the game room with map id plus the existing seed/theme/size/profile fields.

## Game Room Integration

Add an optional pregenerated map id to game room creation options and synced metadata.

Room map runtime should resolve maps in this order during rollout:

1. If map id is present, load the artifact and validate that seed, theme, size, profile, generator version, and hash match catalog metadata.
2. If artifact load fails and fallback is enabled, generate from seed and record the fallback.
3. If fallback is disabled, fail room creation before players enter.

After rollout, disable seed-generation fallback for public matchmaking and keep it only for dev, tutorial, and emergency admin paths.

The loaded manifest should still feed the existing terrain lookup, collision world, bot route graph, powerups, spawn placement, minimap, safe zone, drop ship, and metadata systems.

## Client Integration

Extend map vote option types with map id, catalog tags, stats, and optional thumbnail URL.

Client changes:

- Display catalog options without blocking on worker-generated manifests.
- Use catalog preview data for lightweight map cards.
- Fetch the selected full manifest by map id during match loading, or receive it through the same manifest request path upgraded to accept map id.
- Seed the existing map prep cache from the fetched artifact.
- Keep seed/profile/size cache keys during rollout, then include map id once all paths can pass it.
- Show a clear fallback/loading state if a selected artifact has to be repaired or regenerated server-side.

Do not remove the current worker preview path until catalog previews and selected-artifact loading are stable.

## Admin And Ops

Add admin visibility before public rollout:

- Pool counts by profile, size, theme, topology, version, and status.
- Oldest ready map age and recent selection counts.
- Generation queue depth and failure list.
- Artifact byte size totals.
- Buttons to top up, retire, regenerate, and promote maps.
- Alert when any required pool slice is below its minimum.

Operational policy:

- Top up maps continuously in production or at deploy time.
- Generate replacement maps before retiring old generator-version maps.
- Keep at least one previous generator version available until in-flight rooms end.
- Never delete artifacts referenced by persisted matches unless replay/debug requirements explicitly allow it.

## Rollout Slices

### 1. Catalog Types And Serialization

- Add shared/server types for catalog summaries, artifact headers, and map ids.
- Implement manifest serialize/deserialize with typed-array preservation.
- Add unit tests for round-tripping arena and Battle Royal manifests.

Acceptance:

- A generated manifest can round-trip through the artifact format with matching seed, profile, size, stats, chunk buffers, heightfield buffers, and content hash.

### 2. Database And Storage

- Add catalog and artifact persistence.
- Add match fields for pregenerated map id, map size, profile id, and topology id.
- Add storage abstraction for local development and production object storage or database-backed blobs.

Acceptance:

- Catalog rows can be created, queried by profile/size/status, and linked from completed matches.

### 3. Pool Generator

- Build the top-up worker.
- Generate initial arena and Battle Royal inventory for every required size.
- Persist diagnostics and reject failed candidates.

Acceptance:

- A local command can fill the minimum pool for at least one profile and all sizes.
- Failed candidates are visible and do not block unrelated pool slices.

### 4. Selection Service

- Implement catalog listing, vote option creation, BR auto-selection, reservation, and launch result recording.
- Keep deterministic seed fallback behind an environment flag.

Acceptance:

- Arena map vote options come from ready catalog rows.
- Battle Royal launch selection returns a ready catalog map for small, medium, and large participant bands.

### 5. Game Room Artifact Loading

- Pass map id into game room creation.
- Load the manifest from artifact storage in room map runtime.
- Validate metadata before applying the manifest.
- Record fallback generation when enabled.

Acceptance:

- Game room creation with a ready map id does not call procedural generation.
- Existing gameplay systems receive the same manifest shape they expect today.

### 6. Client Vote And Loading

- Extend map vote payloads and client store types with map id and catalog preview fields.
- Render vote cards from catalog data.
- Fetch or receive selected manifest artifact during match loading.
- Seed existing warmup caches from the artifact.

Acceptance:

- Voting does not require client-side full map generation.
- Match loading uses the selected pregenerated manifest.

### 7. Admin Pool Controls

- Add admin pool status and manual top-up actions.
- Add health checks or logs for pool depletion and artifact load failures.

Acceptance:

- Operators can see which pool slices are low and trigger a refill without redeploying.

### 8. Remove Public Match-Time Generation

- Disable seed fallback for public matchmaking once artifact loading is stable.
- Keep generation only for pool workers, dev practice, tutorial, and explicit admin repair.
- Remove dead seed-vote paths after confirming no public flow uses them.

Acceptance:

- Public lobbies and Battle Royal matches launch from ready map ids only.
- Legacy public match-time generation code is removed rather than left unused.

## Testing And Verification

Do not use browser testing for this work.

Recommended automated coverage:

- Artifact round-trip tests for arena and Battle Royal manifests.
- Catalog query tests for every profile and size.
- Selection tests for size bands, recent-use avoidance, event themes, and empty-slice fallback.
- Lobby map vote tests proving options come from the pool.
- Battle Royal launch tests proving map id is passed through.
- Room map runtime tests proving artifact load is preferred over generation.
- Persistence tests proving completed matches retain pregenerated map id plus seed/theme compatibility fields.
- Failure tests for corrupt artifact hash, missing artifact, retired map, and depleted pool.

## Open Decisions

- Storage backend: local disk for development, database blob, object storage, or a hybrid.
- Initial pool size per theme and whether event-biome maps are generated continuously or only while events are active.
- Whether public map selection should show three maps as today or more than three now that preview generation is cheap.
- Whether map id should become part of the client map prep cache key immediately or after rollout.
- How long replay/debug requirements require old artifacts to be retained.

## Success Criteria

- Starting a normal arena match does not generate a new map on the client or server.
- Starting a Battle Royal match does not generate a new map on the critical path.
- Users can choose from pregenerated maps in map selection.
- Every playable profile has ready small, medium, and large maps.
- Operators can see and refill the pool before depletion affects matchmaking.
- Public seed-generation fallback is removed after the pool path is stable.

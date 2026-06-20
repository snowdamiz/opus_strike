# Server Stutter Reduction Plan

## Goal

Reduce player-visible server stutters during active matches by keeping `GameRoom.tick()` comfortably below the 50ms server tick interval, smoothing low-frequency work that currently aligns in bursts, and adding a benchmark that measures the full room tick path instead of only isolated helpers.

## Current Findings

- The server runs gameplay on a 20 Hz `setInterval` loop in `apps/server/src/rooms/GameRoom.ts`. One tick currently rebuilds the player spatial index, updates bots, runs phase/gameplay logic, runs movement/physics, updates objectives/effects, and broadcasts state streams in one synchronous callback.
- The existing `bench:room-load` script measures useful components, but not a composed `GameRoom.tick()` scenario. Current local baseline from `pnpm --filter @voxel-strike/server bench:room-load`:
  - `shared_movement_8_players` p99: 0.47ms
  - `bot_ai_24_bots_tactics_path_abilities` p99: 1.43ms
  - `replication_payload_48_players_stream_mix` p99: 0.18ms
  - This suggests the hitch is likely composition, burst alignment, or live I/O pressure, not one obviously slow helper.
- Replication is per-client and per-player. Transforms can run every playing tick, while vitals every 125ms, interest every 200ms, ping data when dirty, and match snapshots every drift sync. When those low-frequency streams align, one tick can do much more work than adjacent ticks.
- Bot updates already have thinking intervals inside `updateBotPlanningState`, but `GameRoom.updateBots()` still builds a full bot frame context every tick and `BotRuntimeRegistry.forEachScheduledFrameBot()` processes all urgent and deferred bots in the same frame. This can stack with replication and movement catch-up.
- Movement drain caps catch-up per player, but not per room. If several clients backlog at once, each player can spend extra catch-up commands in the same tick.

## Plan

### 1. Add full tick instrumentation

Implement a low-overhead `RoomTickProfiler` with fixed ring buffers, no per-tick logging, and named spans around:

- spatial index rebuild
- bot frame context and bot updates
- phase/gameplay update
- movement command drain and physics
- powerups/objectives/effects
- ping probe and ping broadcast
- replication frame context
- player state stream fan-out
- match snapshot broadcast

Expose p50/p95/p99 and max span samples through `RoomLoadSnapshot`/metadata beside the existing tick duration and event loop delay fields. Add overrun counters for ticks above 16ms, 33ms, and 50ms.

Acceptance:

- Metadata shows which subsystem caused the last p99 spike.
- Instrumentation overhead is measurable but negligible in the benchmark, target under 0.25ms p99 added cost.

### 2. Create a composed room tick benchmark

Extend `apps/server/src/scripts/performance-room-benchmark.ts` or add a sibling benchmark that exercises the full hot path with fake room clients:

- 8 active players, then 8 players plus 8/16 bots.
- queued movement commands with realistic jitter and occasional backlog.
- active combat flags/recent combat transform interest.
- mixed visibility states requiring line-of-sight checks.
- recurring vitals, interest, pings, and match snapshots.
- fake `send()` clients so serialization estimation and fan-out logic run without a browser or real WebSocket.

Acceptance:

- Baseline report includes `game_room_tick_8_players`, `game_room_tick_8_players_8_bots`, and `game_room_tick_burst_alignment`.
- The benchmark fails or clearly flags when p99 crosses a chosen budget, initially 20ms p99 for the composed tick and 50ms max.

### 3. Smooth low-frequency replication work

Stagger low-frequency stream work so vitals, interest, ping broadcast, and match snapshot drift sync do not all naturally align on the same tick.

Implementation shape:

- Give each room a deterministic stream phase offset from `roomId` or `mapSeed`.
- Keep transforms on the gameplay tick, but schedule vitals and interest on separate tick buckets.
- Keep `forceVitals`/`forceTransforms` immediate for joins, respawns, and full-sync events.
- Preserve existing visibility and per-recipient filtering behavior.

Acceptance:

- `playerTransformsV2` remains full-rate for high-relevance transforms.
- Vitals and interest delivery cadence remains within current gameplay tolerance.
- Burst benchmark p99 improves without increasing total bytes sent.

### 4. Add room-level movement catch-up budget

Keep the current per-player catch-up logic, but add a room-wide budget for extra movement substeps. Every alive player still gets the base movement budget, while catch-up substeps are distributed fairly across players over multiple ticks.

Implementation shape:

- Compute each player's base substeps and requested catch-up substeps.
- Apply a room-level extra catch-up cap per tick.
- Prioritize players with the oldest/highest backlog, but avoid starving any one player.
- Record skipped catch-up in movement metrics so tuning is visible.

Acceptance:

- Backlog recovery remains bounded.
- A mass packet burst cannot multiply catch-up work by every player in the room during the same tick.
- Existing movement parity and authority tests still pass.

### 5. Make bot work budgeted, not all-or-nothing

Keep urgent bots responsive, but process deferred bot planning under a per-tick quota. Bots that miss a planning slot continue using last input or a cheap steering update until their next budgeted planning tick.

Implementation shape:

- Replace `forEachScheduledFrameBot()` with a scheduler that runs all urgent bots plus `N` deferred bots per tick.
- Rotate deferred bot order for fairness.
- Reuse bot frame context data where possible and avoid sorting snapshots every tick unless roster membership changes.
- Keep `nextThinkAt` and `nextBlackboardAt` semantics in `bot-ai` intact.

Acceptance:

- Carrier/combat bots remain urgent and responsive.
- Full bot rooms spread AI planning cost across ticks.
- Bot benchmark and new full-room benchmark show flatter p99.

### 6. Reduce hot-path allocation pressure

After instrumentation identifies the dominant span, do scoped allocation cleanup in that area:

- Reuse bot frame context maps/sets and snapshot arrays.
- Reuse replication scratch arrays for `vitalsPlayers`, `interestPlayers`, `transformPlayers`, and `hiddenPlayerIds` where practical.
- Avoid rebuilding identical ping/vitals payload fragments for each recipient when the recipient view is identical.
- Keep changes small and remove any replaced legacy helper paths immediately.

Acceptance:

- No behavior change to wire payloads.
- Lower p99 and lower heap churn in the composed benchmark.

### 7. Verification

Run only non-browser verification:

- `pnpm --filter @voxel-strike/server bench:room-load`
- new composed room tick benchmark
- `pnpm --filter @voxel-strike/server test:replication-frame`
- `pnpm --filter @voxel-strike/server test:movement-authority`
- `pnpm --filter @voxel-strike/server test:movement-queue`
- `pnpm --filter @voxel-strike/server test:visibility-interest`
- `pnpm --filter @voxel-strike/server test:bot-ai`
- `pnpm --filter @voxel-strike/server test:network-quality`

## Recommended First Slice

Start with instrumentation plus the composed tick benchmark. The existing helper benchmarks are already fast, so changing physics or data structures first would be guessing. Once the composed benchmark exposes the worst span, implement the smallest smoothing change: likely stream staggering if the spike is replication-heavy, bot budget rotation if bot rooms spike, or room-level catch-up budgeting if movement backlogs spike.

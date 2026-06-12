# Opus Strike Performance Optimization Plan

## North Star

Increase client FPS, reduce stutter and frame hitches, and reduce server CPU/network/database load while preserving the server-authoritative movement, combat, objective, and anti-cheat model.

The server remains the source of truth for:

- Movement acceptance, command sequencing, collision revision, and correction.
- Ability use, cooldowns, damage, projectile/area effects, flags, scoring, and match phase.
- Anti-cheat risk scoring, ranked/wager integrity gates, and evidence needed for review.

The client may predict, interpolate, render, and derive display-only timers, but it must not become authoritative for state that affects gameplay or payouts.

## High-Impact Findings

### P0: Performance diagnostics are on hot paths

Files:

- `apps/client/src/components/game/PerfMonitor.tsx`
- `apps/client/src/utils/perfMarks.ts`
- `apps/client/src/components/game/GameCanvas.tsx`
- `apps/client/src/contexts/gameMessageHandlers.ts`
- `apps/server/src/perf/tickMetrics.ts`
- `apps/server/src/rooms/GameRoom.ts`

Current cost:

- Client network handlers call `recordNetworkMessage`, which can stringify live gameplay packets.
- Frame/effect/physics systems push samples, prune arrays, sort percentile windows, and maintain a debug snapshot even when the player only needs gameplay.
- `r3f-perf` is pulled into the client for the full diagnostics panel.
- Server tick metrics wrap many game-loop sections and can log summaries. `DEBUG_PERF_BYTES` can stringify broadcast payloads.
- `requestPerfSnapshot` exposes a debug snapshot path that also includes movement telemetry and recent authority events.

Plan:

- Remove all performance logging and diagnostics surfaces.
- Delete the full debug/perf panel.
- Keep only a lightweight FPS counter when `showFPS` is enabled.
- Keep gameplay-critical anti-cheat events and normal error/warn logging. Do not remove ranked/wager integrity evidence.

### P0: Full transform broadcasts are rebuilt every active server tick

Files:

- `apps/server/src/rooms/GameRoom.ts`
- `apps/client/src/contexts/gameMessageHandlers.ts`
- `apps/client/src/store/visualStore.ts`

Current behavior:

- Server runs at `TICK_RATE = 20`.
- Movement substeps remain 60 Hz through buffered client commands and server processing.
- Each active transform broadcast builds a full packed transform list for all alive/spawning players.
- Client remote interpolation is already delayed and capped, which is good.

Plan:

- Preserve 20 Hz server simulation and 60 Hz command authority.
- Add quantized transform signatures per player.
- Broadcast only changed transforms by default.
- Force full transform payloads on join, respawn, teleport/unstuck, phase changes, movement epoch changes, net-id assignment, and periodic low-rate resync.
- Keep `selfMovementAuthority` direct-to-client acks/corrections independent from remote transform throttling.

### P0: Ability/cooldown vitals are likely dirtier than they need to be

Files:

- `apps/server/src/rooms/GameRoom.ts`
- `apps/client/src/contexts/gameMessageHandlers.ts`

Current behavior:

- `playerVitals` is delta gated, but `buildPlayerVitals` materializes ability state and cooldown fields.
- Cooldown remaining values naturally change over time, so vitals can become dirty even when no semantic event occurred.

Plan:

- Switch ability vitals from `cooldownRemaining` to event-derived fields such as `cooldownUntil`, `activatedAt`, `charges`, and `isActive`.
- Let clients derive display countdowns locally from `serverTime`.
- Send forced vitals on join/respawn/hero swap/ability use/death and periodic low-rate reconciliation.
- Keep server-side cooldown validation authoritative.

### P0: Anti-cheat persistence can turn repeated noisy events into database load

Files:

- `apps/server/src/rooms/GameRoom.ts`
- `apps/server/src/anticheat/runtime.ts`
- `apps/server/src/anticheat/service.ts`

Current behavior:

- `recordSecurityEvent` immediately records authority events into the anti-cheat runtime.
- `AntiCheatRoomRuntime.record` updates risk in memory and asynchronously persists every signal through Prisma.
- Duplicate commands, queue overflows, malformed packets, and rate-limit drops can repeat quickly.

Plan:

- Keep immediate in-memory risk scoring for serious/deterministic signals.
- Aggregate repeated low/medium noisy events by `playerId:type:reason` into counted windows.
- Persist one summarized signal per window with `count`, first/last sequence, max severity, and representative position.
- Persist high/critical events immediately.
- Preserve ranked/wager integrity gates by applying aggregate score deltas before match finalization.

### P1: Hot-path allocations create avoidable GC pressure

Files:

- `apps/server/src/rooms/GameRoom.ts`
- `apps/server/src/rooms/PlayerSpatialIndex.ts`
- `apps/client/src/components/game/OtherPlayers.tsx`
- `apps/client/src/hooks/usePhysics.ts`

Examples:

- Server creates Sets/arrays for transform/vitals/pings and effect updates on recurring ticks.
- Movement queue duplicate checks use linear scans and occasional sort.
- Client remote-player LOD creates new Sets on cadence.
- Physics wrappers create timing samples and many small objects around visual queries.

Plan:

- Reuse scratch arrays/Sets where possible.
- Replace filter-based update loops with in-place compaction for high-frequency gameplay arrays.
- Replace movement command queue with a bounded ring buffer or monotonic append queue plus recent-seq tracking.
- Centralize remote transform sampling and LOD decisions where it reduces per-player `useFrame` work.
- Remove perf timing around physics queries.

## Implementation Plan

## Phase 1: Remove performance logging and the debug panel

Goal:

- No runtime performance logging.
- No full debug/perf panel.
- FPS counter remains available when enabled.

Client tasks:

1. Replace `PerfMonitor.tsx` with a minimal `FpsCounter` component.
   - Remove `PerfHeadless`, `usePerf`, `PerfDisplay`, renderer stats, network stats, startup stats, system stats, and position diagnostics.
   - Keep a tiny `requestAnimationFrame` FPS sampler that updates 4 times per second.
   - Render only when `settings.showFPS === 'fps'`.

2. Update settings.
   - Change `FpsDisplayMode` from `'off' | 'fps' | 'full'` to `'off' | 'fps'`.
   - Migrate saved `true` and `'full'` to `'fps'`.
   - Remove the "Full" option from `SettingsModal`.
   - Update copy from "counter or diagnostics panel" to just FPS counter.

3. Remove debug mode.
   - Delete `debugMode`, `setDebugMode`, and `toggleDebugMode` from `gameStore`.
   - Remove `debugMode` reads in `GameCanvas` and perf overlay wiring.

4. Delete client perf marks.
   - Remove `apps/client/src/utils/perfMarks.ts` or reduce it to temporary no-op shims only while migrating.
   - Remove all imports/calls to `recordNetworkMessage`, `recordSystemTime`, `recordStartupStageTime`, `recordFrameSample`, `registerFrameSystem`, `recordSpawnMarker`, `recordVoxelMeshBuild`, `recordVoxelWorldRegions`, `setActiveLightCount`, `setAtmosphereParticleCount`, `setWorldDressingInstanceCount`, `setFullRemoteBodyCount`, and `setTemporaryColliderCountProvider`.
   - Delete `combatStressScenario` perf snapshot plumbing or convert it to a dev-only scenario without perf logging.

5. Keep adaptive quality without diagnostics.
   - Replace `getClientPerfSnapshot().frame.frameMsP95` in `AdaptiveQualityController` with a private rolling frame-time sampler inside the controller.
   - The sampler should only exist when `adaptiveQuality` is enabled.
   - Do not expose a snapshot API or log output.

6. Remove package/style remnants.
   - Remove `r3f-perf` from `apps/client/package.json`.
   - Remove `#r3f-perf-panel` CSS overrides from `apps/client/src/styles/index.css`.
   - Run install/update lockfile if the repo lockfile changes.

Server tasks:

1. Delete `apps/server/src/perf/tickMetrics.ts`.
2. Remove `TickMetrics` import, `this.metrics`, `metrics.time`, `startTick`, `endTick`, `broadcastWithMetrics`, and `sendWithMetrics`.
3. Replace metric wrappers with direct calls.
4. Remove `requestPerfSnapshot` handler and `perfSnapshot` rate limit.
5. Remove `buildPerfSnapshot` and `buildMovementTelemetry` if no non-debug caller remains.
6. Remove `loggers.perf` namespace if unused after cleanup.
7. Remove debug `console.log` / `loggers.*.debug` calls from gameplay/lobby hot paths. Keep warning/error logs for real failures and keep anti-cheat evidence.

Verification:

- `rg "r3f-perf|PerfHeadless|usePerf|perfMarks|TickMetrics|requestPerfSnapshot|DEBUG_PERF|showFPS.*full|debugMode" apps packages`
- `pnpm --filter @voxel-strike/client typecheck`
- `pnpm --filter @voxel-strike/server typecheck`
- No browser testing in this pass.

## Phase 2: Make authoritative networking cheaper

Goal:

- Reduce server broadcast construction, outbound bytes, and client handler work without weakening authority.

Tasks:

1. Transform delta stream.
   - Store last sent packed transform signature per player.
   - Signature should use the already quantized tuple: netId, position, velocity, yaw, pitch, movementBits, wallRunSide, movementEpoch.
   - Broadcast changed packed transforms only.
   - Include `full: true` or a stream epoch when sending full snapshots so clients can reset missing remote histories intentionally.
   - Force full transforms for new clients and after net-id changes.

2. Add heartbeat resync.
   - Send unchanged alive-player transforms at a low rate such as 2-4 Hz to protect interpolation from packet loss.
   - Keep full-rate sends for players that moved, changed look direction, changed movement bits, changed movement epoch, are carrying a flag, are recently damaged, or are actively using visible abilities.

3. Keep local authority acknowledgements separate.
   - Continue direct `selfMovementAuthority` messages for processed movement commands and corrections.
   - Do not rely on public transform broadcasts to clear local pending commands.

4. Reduce vitals dirtiness.
   - Send ability cooldown timestamps and event fields instead of ever-changing remaining time.
   - Add per-player vitals signatures based on semantic fields, not derived display countdowns.
   - Force vitals on join, hero select, spawn, death, damage/heal, ability use, flag state change, and periodic reconciliation.

5. Reduce match snapshot churn.
   - Let clients derive round countdown from `phaseEndTime` and `serverTime`.
   - Send match snapshots on phase/score/flag changes and lower-rate drift sync.
   - Avoid broadcasting snapshots solely because `roundTimeRemaining` changed.

6. Optional later slice: relevance bands.
   - Keep full-rate remote transforms for nearby, visible, combat-relevant, objective-relevant, and recently interacted players.
   - Send lower-rate far transforms.
   - Do not hide information that the current game design expects the client to know.

Verification:

- Add server unit/harness coverage for transform delta full snapshot, forced resync, new joiner state, respawn, teleport/unstuck, death, and net-id removal.
- Add client handler tests for partial transform payloads preserving existing histories and full payloads removing stale histories.
- Run `pnpm --filter @voxel-strike/server test:authority`.
- Run `pnpm --filter @voxel-strike/server test:movement-parity`.

## Phase 3: Reduce server CPU and database load

Goal:

- Keep authoritative simulation intact while reducing GC, repeated database work, and per-tick loops.

Tasks:

1. Aggregate noisy anti-cheat signals.
   - Add per-room aggregation buckets for duplicate commands, duplicate queued commands, command rate limits, queue overflows, malformed low-confidence network events, and repeated movement barriers.
   - Flush every 1-5 seconds and on room dispose/match end.
   - Apply in-memory risk score as events happen or at flush, but guarantee flushed aggregate is included before integrity gate evaluation.
   - Persist high/critical events immediately.

2. Add bounded anti-cheat persistence queue.
   - Let `AntiCheatEvidenceStore` consume a queue with concurrency 1-2 and backpressure.
   - Coalesce low/medium repeated signals before Prisma.
   - Keep failures visible through error logs, but do not allow persistence lag to block game ticks.

3. Optimize movement command queues.
   - Replace `pendingCommands.some` duplicate detection with recent sequence tracking.
   - Avoid sorting when packets arrive in expected monotonic order.
   - Consider a bounded ring buffer for `pendingCommands` to avoid `shift` and `splice`.
   - Preserve sequence validation, stale grace, queue overflow correction, and movement epoch behavior.

4. Compact high-frequency arrays in place.
   - Replace recurring `.filter` allocations in void zones, pending area damage, gearstorms, hookshot traps, and similar gameplay arrays with write-index compaction.
   - Reuse scratch Sets such as active Blaze players per tick.
   - Replace `Array.from(map)` in tick-adjacent paths when direct iteration is enough.

5. Tighten bot CPU scheduling.
   - Keep flag carriers and combat-engaged bots updated first.
   - Spread non-critical bot thinking over multiple ticks.
   - Maintain server-owned movement command enqueueing so bots stay authoritative.

6. Keep spatial queries authoritative.
   - Retain `PlayerSpatialIndex`.
   - Add query counters in tests/bench harnesses only, not runtime logging.
   - Use query radius/cone candidates for AoE and flamethrower paths as now.

Verification:

- `pnpm --filter @voxel-strike/server test:authority`
- `pnpm --filter @voxel-strike/server test:anticheat`
- `pnpm --filter @voxel-strike/server test:spatial-index`
- `pnpm --filter @voxel-strike/server test:distributed-runtime`

## Phase 4: Reduce client frame hitches

Goal:

- Lower render-loop CPU and GC, especially around combat/effects and map warmup.

Tasks:

1. Remove all perf sample overhead from render systems.
   - After Phase 1, effect managers should not measure their own frame time.
   - Physics query wrappers should not record durations or dropped counts.

2. Centralize remote transform sampling.
   - Keep `visualStore` as the non-reactive source for high-frequency transforms.
   - Consider one `RemotePlayerFrameSystem` that samples remote transform histories into scratch structs and updates registered remote group refs.
   - Keep per-player React state for semantic visual changes only, such as LOD tier or veil visibility.

3. Reduce remote LOD allocations.
   - Reuse candidate arrays and ID sets.
   - Track allowed full-body IDs with a stable signature to avoid new Set state unless membership actually changed.
   - Keep flag carriers full body regardless of distance.

4. Keep visual physics query budget, remove metrics.
   - Keep visual-only query drops when over budget.
   - Prefer procedural heightfield checks before Rapier.
   - Cache ground/normal samples by coarse cell for visual effects where exactness is not gameplay-critical.

5. Tune effect budgets for stutter, not screenshots.
   - Review balanced/cinematic defaults for dynamic lights, atmosphere particles, active particles, trails, and remote full bodies.
   - Bias the default preset toward competitive stability.
   - Keep high-cost decorative work off during startup ramp and intense combat.

6. Keep worker-backed voxel warmup, reduce main-thread spikes.
   - Remove timing calls from mesh/materialization paths.
   - Keep progressive reveal.
   - Consider smaller per-frame region reveal on balanced if map reveal still hitches.
   - Keep colliders batched; tune batch size by frame budget, not raw collider count.

Verification:

- `pnpm --filter @voxel-strike/client typecheck`
- `pnpm --filter @voxel-strike/client test:visual-store`
- Static scan for removed perf calls.
- Browser FPS validation is left to the user per project instruction.

## Phase 5: Build and bundle cleanup

Goal:

- Ensure diagnostic code is gone from production bundles and dependencies.

Tasks:

1. Remove `r3f-perf` and related CSS.
2. Remove dead perf/debug modules after all imports are gone.
3. Confirm Vite build does not include debug panel chunks.
4. Keep only the FPS counter chunk/component.
5. Avoid committing generated `dist` churn unless the project expects built artifacts.

Verification:

- `pnpm --filter @voxel-strike/client build`
- `pnpm --filter @voxel-strike/server build`
- `rg "Performance Monitor|diagnostics panel|r3f-perf|perfSnapshot|tick summary|DEBUG_PERF" apps packages`

## Priority Order

1. Remove perf logging/debug panel and keep FPS-only counter.
2. Replace adaptive quality dependency on `perfMarks` with private frame sampler.
3. Remove server `TickMetrics` and `requestPerfSnapshot`.
4. Add transform delta stream plus forced full resync cases.
5. Convert vitals cooldowns to timestamp/event-derived values.
6. Aggregate noisy anti-cheat signals and queue persistence.
7. Optimize movement command queue allocations.
8. Compact high-frequency server arrays in place.
9. Centralize remote transform sampling and reduce client LOD allocations.
10. Tune default visual/effect budgets after code cleanup.

## Regression Guardrails

- Do not lower server movement authority to improve FPS.
- Do not re-enable client transform proposals.
- Do not skip collision revision checks.
- Do not remove movement parity tests or anti-cheat replay tests.
- Do not make cooldowns, damage, flags, score, match phase, or payout/ranked decisions client-authoritative.
- Do not hide high/critical anti-cheat evidence behind aggregation.
- Do not browser-test in the agent pass; leave manual browser validation to the user.

## Definition of Done

- Static scan shows no performance diagnostics except the FPS counter.
- Settings only expose Off/FPS for `showFPS`.
- Server has no tick perf logger, no perf snapshot message, and no debug perf endpoint.
- Transform/vitals/match broadcasts are smaller under idle and normal gameplay while preserving corrections and resync.
- Anti-cheat low/medium spam is aggregated, high/critical events persist immediately, and match integrity gates remain authoritative.
- Typecheck/build and authority/anti-cheat/movement parity tests pass.

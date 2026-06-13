# Game Optimization Log

This document tracks optimization passes made to the game from June 13, 2026 onward.
It is meant for future engineers, including future us, who need to understand what was
changed, why it was changed, how it was verified, and what remains worth investigating.

## Audience And Use

Audience: internal engineers working on gameplay feel, multiplayer networking, rendering,
or server performance.

Post-read action: use this log to continue an optimization pass without losing prior
evidence, repeating failed fixes, or changing tick/network behavior blindly.

## How To Add A Pass

Append each new pass using this shape:

```md
## Pass NNN - Short Name

Date:
Owner:
Status:

### Problem

What player-visible problem was being solved?

### Evidence

What observations, traces, profiles, benchmarks, diagnostics, or user reports drove the
change?

### Changes

What changed at the system level? Prefer module names and behavior descriptions over
line numbers.

### Verification

List commands, manual checks, benchmark numbers, or trace snapshots. Include failed
checks too.

### Result

What is expected to improve? What is confirmed versus inferred?

### Follow-Ups

What should the next optimization pass investigate?
```

## Current Baselines And Constraints

- The authoritative server tick rate is 20 Hz.
- Client movement simulation produces 60 Hz movement substeps.
- The server movement drain processes 3 movement substeps per 20 Hz tick.
- The server movement command rate limit is 90 movement commands per second.
- Tick rate was intentionally not raised during this pass.
- Browser testing is left to the user per repo instructions.

## Pass 001 - Local Server-Mode Movement Stutter

Date: June 13, 2026

Status: Implemented and verified by automated checks. User feel validation is still
needed in-game.

### Problem

Local server-mode gameplay had random micro-stutters, even when the server and client
were running on the same machine in development. Practice mode with the same map seed
did not show the same issue, which pointed toward server/client communication,
prediction, or server-mode-only accounting work rather than map generation or raw
movement simulation.

### Evidence

- User report: server-mode local gameplay stuttered, while practice mode with the same
  map seed felt smooth.
- A previous prediction/drain experiment made the issue feel the same or worse:
  normal authority messages were collapsed and applied through full reconciliation, and
  the server drained partial movement input immediately instead of waiting for its warm
  input buffer.
- The movement simulation benchmark remained very cheap:

  | Benchmark | Average | P99 |
  | --- | ---: | ---: |
  | Movement queue burst, 8 players | 0.126 ms | 0.214 ms |
  | Shared movement, 8 players | 0.192 ms | 0.477 ms |
  | Spatial rebuild and queries | 0.013 ms | 0.053 ms |
  | Anti-cheat priority queue noise | 0.203 ms | 0.376 ms |

- The benchmark above does not exercise the real custom message accounting path used
  for authority, transform, vitals, ping, and snapshot messages.
- Server custom message accounting was serializing every custom message payload with
  JSON stringify just to estimate bytes. That work happens in server mode and not in
  practice mode.
- Client movement command flushing could emit several websocket packets in one render
  frame after a local frame hitch. For example, 8 pending movement commands could be
  sent as multiple smaller packets instead of one bounded packet. Practice mode does
  not pay that websocket cost.
- Server anti-cheat settings used during the reported stutter session:

  ```bash
  ANTICHEAT_ENABLED=true
  ANTICHEAT_MODE=observe
  ANTICHEAT_MOVEMENT_AUTHORITY_MODE=shadow
  ANTICHEAT_MOVEMENT_PARITY_GATE_REQUIRED=true
  ANTICHEAT_MOVEMENT_DRIFT_SAMPLE_RATE=0.05
  ANTICHEAT_ALLOW_CLIENT_TRANSFORM_PROPOSALS=true
  ANTICHEAT_PAYOUT_HOLDS_ENABLED=false
  ```

- These settings mean server anti-cheat was enabled in observe mode, with movement
  authority configured for shadow checks at a 5% drift sample rate and payout holds
  disabled.
- During this pass, no runtime reads of `ANTICHEAT_ALLOW_CLIENT_TRANSFORM_PROPOSALS`
  were found in the repo. It was present in the environment but likely had no effect.
- During this pass, movement shadow simulation config and implementation were present,
  but no call site for the shadow simulation recorder was found. Treat shadow-mode
  overhead as unconfirmed until a trace or call-site audit proves otherwise.
- The anti-cheat settings above are server-side settings. They do not answer whether
  the client dev movement trace recorder was enabled; that recorder is controlled by
  `VITE_ANTICHEAT_MOVEMENT_TRACE_RECORDER`,
  `VITE_ANTICHEAT_MOVEMENT_TRACE_SAMPLE_RATE`, and
  `VITE_ANTICHEAT_MOVEMENT_TRACE_MAX_FRAMES`.
- Raising server tick rate was rejected for this pass. A 60 Hz server tick change would
  still require coordinated cadence updates so client flush age, max packet size, server
  drain target, and movement command rate limits change together.

### Changes

- Restored lightweight self-authority handling:
  - Normal authority acknowledgements trim prediction history and update authority-owned
    movement resources.
  - Full reconciliation is reserved for authority barriers, epoch changes, missing
    state, or similar correction paths.
  - This removes the failed full-replay behavior from normal ack traffic.
- Restored the server movement input warm buffer:
  - The drain waits for the target pending command buffer before normal processing.
  - Authority barriers can still drain immediately so correction messages are not
    delayed behind the warmup rule.
  - This removes the failed partial-drain behavior that made local feel no better or
    worse.
- Smoothed client movement command flushing:
  - A render-frame catchup now sends one movement packet containing up to the protocol
    maximum number of commands.
  - The client no longer loops and emits multiple small websocket packets during the
    same frame.
  - Movement substep simulation remains 60 Hz, and the server tick rate remains 20 Hz.
- Removed JSON stringify from hot custom-message accounting:
  - High-frequency custom messages now use type-specific byte estimates.
  - Unknown message types still have a bounded fallback estimator.
  - The old stringify estimator was removed rather than kept as legacy code.
- Added a focused server metrics test:
  - Transform payload estimates grow with player count.
  - Cyclic diagnostic payloads do not crash the fallback estimator.

### Verification

Automated checks run:

```bash
pnpm --filter @voxel-strike/server test:message-metrics
pnpm --filter @voxel-strike/server test:movement-queue
pnpm --filter @voxel-strike/server typecheck
pnpm --filter @voxel-strike/client typecheck
pnpm --filter @voxel-strike/server bench:room-load
git diff --check
```

Results:

- Message metrics test passed.
- Movement queue test passed.
- Server TypeScript check passed.
- Client TypeScript check passed.
- Whitespace diff check passed.
- Room-load benchmark stayed in the same low range as the pre-change run.

Ad hoc accounting comparison:

| Operation | Iterations | Time |
| --- | ---: | ---: |
| JSON stringify byte accounting | 100,000 | 54.365 ms |
| Type-specific transform estimate | 100,000 | 1.807 ms |

The transform accounting loop was about 30.08x faster in this isolated check.

### Result

Confirmed:

- The failed authority reconciliation and partial-drain experiment was removed.
- The client no longer emits multiple movement packets in one frame during command
  catchup.
- Server custom-message accounting no longer materializes JSON strings for the hot
  realtime message types.
- Focused tests and typechecks pass.

Inferred:

- Server-mode micro-stutters should be reduced if they were caused by local websocket
  packet bursts or server-side allocation/CPU jitter from custom message accounting.
- In-game feel still needs user validation because the issue is subjective and
  intermittent.

### Follow-Ups

- Capture a short server-mode diagnostics session if stutter remains:
  - movement packet sizes and send intervals
  - authority ack intervals
  - authority acks applied per frame
  - position and velocity error samples
  - server event loop delay percentiles
- Completed in Pass 002: add a benchmark that includes custom message accounting and
  send tracking.
- Investigate whole-store client subscriptions that may rerender UI on unrelated
  network state changes.
- Confirm client development anti-cheat movement tracing settings for the stutter
  session. The server anti-cheat settings were captured above, but the client trace
  recorder uses separate `VITE_ANTICHEAT_MOVEMENT_TRACE_*` variables.
- Audit server movement shadow simulation wiring. Shadow mode was configured for the
  session, but this pass did not find a live call site for the recorder.
- Revisit tick rate only as a coordinated network-cadence change. Raising tick rate
  alone risks crossing movement command rate limits.

## Pass 002 - Authority Drain Diagnostics And Stream Benchmark

Date: June 13, 2026

Status: Implemented and verified by automated checks. In-game feel validation is still
needed in a local server-backed custom match.

### Problem

Server-backed local gameplay can still feel stuttery compared with practice mode. After
Pass 001, the remaining server/client-only path most likely to explain intermittent feel
issues is self-authority traffic: the client receives, queues, drains, and applies
server authority acknowledgements that practice mode bypasses.

### Evidence

- Server transform broadcasts intentionally skip the recipient's own transform during
  normal transform streaming, so local-player stutter is less likely to be caused by
  repeated self transform payloads.
- `matchSnapshot` already has signature suppression and drift-sync throttling, so it is
  not broadcasting unchanged snapshots every 20 Hz tick.
- Normal `selfMovementAuthority` messages use the lightweight acknowledgement path in
  the prediction controller. Full reconciliation remains reserved for barriers,
  epoch changes, missing state, or correction paths.
- The client self-authority queue still sorted every drained authority batch even
  though normal websocket delivery should already be ordered.
- The optimization log's old 35 movement-packet rate-limit baseline was stale. The live
  code now uses `MOVEMENT_MAX_COMMANDS_PER_SECOND = 90`, and the client sends movement
  commands in packets of up to 8 commands.

New room-load benchmark result for the stream path that Pass 001 called out as missing:

| Benchmark | Average | P99 |
| --- | ---: | ---: |
| Custom message tracking, 8-client stream mix | 0.011 ms | 0.061 ms |

### Changes

- Removed the unconditional per-frame sort from the client self-authority drain:
  - Authority messages now stay in arrival order for the normal ordered case.
  - The queue tracks whether an out-of-order authority was enqueued and sorts only then.
  - The old unconditional sort behavior was removed rather than kept as a legacy path.
- Expanded dev movement diagnostics exposed at `window.__voxelMovementDiagnostics`:
  - pending self-authority messages before each drain
  - authority drain duration samples
  - number of authority drain frames
  - stale/skipped authority messages drained without application
- Added a room-load benchmark case that exercises tracked custom-message accounting for
  a mixed server stream: self authority, player transforms, vitals, interest, pings, and
  match snapshots.
- Corrected the log baseline from the stale 35 movement-packet limit to the current
  90 movement-command-per-second limit.

### Verification

Automated checks run:

```bash
pnpm --filter @voxel-strike/client typecheck
pnpm --filter @voxel-strike/server typecheck
pnpm --filter @voxel-strike/server bench:room-load
pnpm --filter @voxel-strike/server test:message-metrics
git diff --check
```

Results:

- Client TypeScript check passed.
- Server TypeScript check passed.
- Room-load benchmark passed and now includes
  `custom_message_tracking_8_clients_stream_mix`.
- Message metrics test passed.
- Whitespace diff check passed.

Benchmark snapshot:

| Benchmark | Average | P50 | P95 | P99 |
| --- | ---: | ---: | ---: | ---: |
| Movement queue, 8 players burst | 0.157 ms | 0.122 ms | 0.287 ms | 0.676 ms |
| Shared movement, 8 players | 0.205 ms | 0.192 ms | 0.438 ms | 0.565 ms |
| Spatial rebuild and queries | 0.014 ms | 0.011 ms | 0.020 ms | 0.105 ms |
| Bot AI, 8 bots tactics/path/abilities | 0.242 ms | 0.114 ms | 0.494 ms | 1.492 ms |
| Anti-cheat priority queue noise | 0.249 ms | 0.191 ms | 0.497 ms | 0.765 ms |
| Custom message tracking, 8-client stream mix | 0.011 ms | 0.007 ms | 0.027 ms | 0.061 ms |

### Result

Confirmed:

- Normal ordered self-authority drains no longer pay a sort.
- The client can now report whether authority messages are piling up before a frame
  drains them, how long the drain took, and how many were skipped as stale.
- Custom-message accounting is now covered by the existing room-load benchmark command.
- The isolated custom-message tracking benchmark is too cheap to explain visible
  local stutter by itself after the Pass 001 accounting changes.

Inferred:

- If local server-mode stutter remains, it is more likely to correlate with authority
  burst timing, correction/replay behavior, React-visible store updates, or event-loop
  stalls outside custom-message byte accounting.

### Follow-Ups

- During a stuttery local custom match, capture
  `window.__voxelMovementDiagnostics.snapshot()` and compare:
  - `authorityPendingBeforeDrain`
  - `authorityDrainDurationsMs`
  - `authorityAcksAppliedPerFrame`
  - `positionErrors`
  - `velocityErrors`
  - `visualCorrectionMagnitudes`
- If authority queue depth spikes line up with stutter, inspect websocket receive
  batching and server event-loop delay around those moments.
- If authority depth stays flat but corrections spike, compare client/server movement
  state for the same seed and hero ability path.
- If movement diagnostics look clean, revisit React-visible store updates from vitals,
  player interest, pings, or ability event messages.

## Pass 003 - Movement Snapshot Triage And Frame Timing Diagnostics

Date: June 13, 2026

Status: Implemented and verified by automated checks. User feel validation is still
needed in a local server-backed custom match.

### Problem

After Pass 002, the user captured a server-mode movement diagnostics snapshot while the
same-seed custom match still felt stuttery. The snapshot needed to answer whether the
remaining stutter correlated with authority backlog, correction/replay, transform churn,
or another frame-level hitch that the current diagnostics could not see.

### Evidence

Captured diagnostic summary:

| Signal | Value |
| --- | ---: |
| Commands generated | 2037 |
| Commands sent | 2036 |
| Movement packets sent | 655 |
| Commands per packet average | 3.042 |
| Commands per packet p99 | 4 |
| Authority acks received | 668 |
| Authority acks applied | 667 |
| Authority pending before drain p99 | 1 |
| Authority acks applied per frame p99 | 1 |
| Authority drain duration p99 | 0.100 ms |
| Authority ack interval average | 50.755 ms |
| Authority ack interval p99 | 52.5 ms |
| Position error p99 | ~0 m |
| Velocity error p99 | 0 m/s |
| Replayed commands p99 | 0 |
| Visual correction magnitude p99 | 0 |
| Transform messages received | 4 |
| Self-only transform messages | 3 |
| Remote transform snapshots added | 0 |
| Local reactive updates | 8 vitals, 1 transform, 2 self-authority |

Interpretation:

- Authority traffic was steady at the expected 20 Hz cadence.
- There was no authority backlog: each drain frame had exactly one pending authority
  message in the retained samples.
- There was no movement correction/replay pressure: position error was effectively
  floating-point noise, velocity error was zero, and replayed commands were zero.
- Transform churn was not present in the captured window: no remote transform snapshots
  were added, and most transform messages were self-only bootstrap-style messages.
- Existing movement diagnostics could not yet show whether the stutter corresponded to
  raw render-frame delta spikes or movement-substep catchup frames.

### Changes

- Added frame-level movement diagnostics to `window.__voxelMovementDiagnostics`:
  - `framesObserved`
  - `frameDeltaMs`
  - `movementFrameDeltaMs`
  - `movementSubstepsPerFrame`
  - `movementAccumulatorBeforeStepMs`
  - `movementAccumulatorAfterStepMs`
  - `movementHitchFrames`
  - `movementCatchupFrames`
- Recorded those samples from the local movement loop after movement substeps are
  generated and before movement packets are flushed.

### Verification

Automated checks run:

```bash
pnpm --filter @voxel-strike/client typecheck
git diff --check
```

Results:

- Client TypeScript check passed.
- Whitespace diff check passed.

### Result

Confirmed from the captured snapshot:

- Self-authority backlog and correction/replay are unlikely to be the source of the
  reported local server-mode stutter.
- The previous custom-message accounting benchmark and this snapshot together point away
  from message byte accounting and normal authority application as primary causes.

Inferred:

- If stutter remains, the next captured snapshot should focus on whether server mode
  introduces raw frame hitches or movement catchup frames that practice mode does not.
- If frame delta and catchup samples stay clean, the remaining likely areas are
  non-movement render work, ability/effect frame loops that are active only in custom
  matches, or server-mode UI/store subscribers outside the movement authority path.

### Follow-Ups

- Capture another `window.__voxelMovementDiagnostics.snapshot()` during a visible
  stutter and compare:
  - `frameDeltaMs`
  - `movementSubstepsPerFrame`
  - `movementAccumulatorBeforeStepMs`
  - `movementCatchupFrames`
  - `movementHitchFrames`
- If frame hitches appear without movement catchup, inspect heavy render/effect loops
  active in server mode.
- If movement catchup appears without authority corrections, inspect main-thread stalls
  before the local movement loop rather than prediction reconciliation.

## Pass 004 - Local Visual Interpolation For Fixed-Step Jitter

Date: June 13, 2026

Status: Implemented and verified by automated checks. User feel validation is still
needed in a local server-backed custom match.

### Problem

After Pass 003, a new movement diagnostics snapshot showed real frame pacing jitter
during the stuttery server-backed custom match. Authority, transform, and correction
paths still looked clean, but the local movement loop was sometimes doing uneven
fixed-step presentation: long frames produced extra movement substeps and short frames
produced zero movement substeps.

### Evidence

Captured diagnostic summary:

| Signal | Value |
| --- | ---: |
| Frames observed | 1506 |
| Frame delta average | 16.668 ms |
| Frame delta p95 | 26.100 ms |
| Frame delta p99 | 33.200 ms |
| Frame delta max | 39.800 ms |
| Movement hitch frames | 20 |
| Movement substeps per frame average | 1.000 |
| Movement substeps per frame p95 | 2 |
| Movement substeps per frame max | 2 |
| Movement accumulator before step p99 | 42.567 ms |
| Movement accumulator after step p99 | 14.500 ms |
| Commands per packet p99 | 4 |
| Authority pending before drain p99 | 1 |
| Authority drain duration p99 | 0.100 ms |
| Position error p99 | 0 m |
| Velocity error p99 | 0 m/s |
| Replayed commands p99 | 0 |
| Visual correction magnitude p99 | 0 |
| Remote transform snapshots added | 0 |

Interpretation:

- The stutter sample contains actual render-frame jitter: several retained frame deltas
  were in the 30-40 ms range.
- Movement prediction was not correcting or replaying commands during the sample.
- Authority still drained one ack at a time with near-zero drain cost.
- The visible unevenness is consistent with fixed-step presentation jitter: a long
  frame renders multiple simulation steps at once, then a short frame can render no new
  movement step.

### Changes

- Added local visual interpolation between the previous and current fixed movement
  step for the player camera/body visual path.
- Kept authoritative prediction, command generation, ability checks, and server acks on
  the existing fixed-step predicted state.
- Preserved the existing visual correction offset from authority smoothing on top of
  the interpolated base position.
- Added snap guards so teleports, respawns, and large corrections do not smear across
  frames.
- Reset interpolation state whenever the movement command buffer is reset.
- Changed `movementCatchupFrames` to count any frame that renders more than one local
  movement substep, because the captured jitter pattern was 2-substep frames rather
  than larger catchup bursts.

### Verification

Automated checks run:

```bash
pnpm --filter @voxel-strike/client typecheck
git diff --check
```

Results:

- Client TypeScript check passed.
- Whitespace diff check passed.

### Result

Expected:

- Local camera/body movement should look smoother when a server-backed match has
  occasional 30-40 ms render frames followed by short frames.
- The change should not affect movement authority, packet cadence, command sequence
  generation, hit checks, or ability logic, because only the rendered local visual
  position is interpolated.

Unconfirmed:

- In-game feel still needs user validation in the same local server-backed custom match.

### Follow-Ups

- Capture another `window.__voxelMovementDiagnostics.snapshot()` after this pass and
  compare:
  - `frameDeltaMs`
  - `movementSubstepsPerFrame`
  - `movementCatchupFrames`
  - `movementHitchFrames`
  - authority/correction fields to confirm they remain clean
- If the frame hitches remain visible despite interpolation, inspect render/effect frame
  loops active during custom matches, because the movement authority path has stayed
  clean across multiple captures.

## Pass 005 - Mitigation Check Against Practice Baseline

Date: June 13, 2026

Status: Analysis logged. No code changes in this pass.

### Problem

After Pass 004's local visual interpolation mitigation, user feel improved enough to
continue comparison, but server-backed custom matches still did not feel as smooth as
practice mode on the same map seed. The next agent needs the server-vs-practice
baseline comparison so they do not re-investigate authority correction as the primary
cause.

### Evidence

Two user-provided `window.__voxelMovementDiagnostics.snapshot()` captures were compared:

- Server-backed custom match after Pass 004 mitigation.
- Practice-mode baseline.

| Signal | Server After Mitigation | Practice Baseline |
| --- | ---: | ---: |
| Frames observed | 2412 | 1503 |
| Frame delta average | 16.666 ms | 16.667 ms |
| Frame delta p95 | 26.700 ms | 17.600 ms |
| Frame delta p99 | 33.000 ms | 17.600 ms |
| Frame delta max | 38.500 ms | 17.600 ms |
| Movement hitch frames | 39 (1.62%) | 7 (0.47%) |
| Movement catchup frames | 385 (15.96%) | 16 (1.06%) |
| Movement substeps per frame p99 | 2 | 1 |
| Movement accumulator before step p99 | 35.533 ms | 25.667 ms |
| Movement accumulator after step p99 | 13.400 ms | 9.000 ms |
| Commands per packet p99 | 4 | 3 |
| Commands per packet max | 7 | 3 |
| Authority pending before drain p99 | 1 | n/a |
| Authority drain duration p99 | 0.100 ms | n/a |
| Position error p99 | ~0 m | n/a |
| Velocity error p99 | 0 m/s | n/a |
| Replayed commands p99 | 0 | n/a |
| Visual correction magnitude p99 | 0 | n/a |
| Remote transform snapshots added | 0 | 0 |
| Local reactive updates | 8 vitals, 1 transform, 2 self-authority | 0 |

Interpretation:

- The Pass 004 mitigation is still the correct kind of fix for fixed-step presentation
  jitter: it smooths local camera/body visuals when movement substeps bunch or skip.
- The diagnostics do not prove subjective smoothness directly, but they explain why the
  user can still feel a difference: server mode continues to have significantly worse
  frame pacing than practice mode.
- Authority correction remains clean after the mitigation. Server mode still has no
  meaningful position error, velocity error, replayed commands, or visual correction
  magnitude.
- The remaining gap is frame pacing and movement catchup frequency, not prediction
  reconciliation.
- Practice mode's retained frame sample stayed tightly around one 60 Hz frame
  (`p99 = 17.6 ms`, max `17.6 ms`). Server mode retained several 30-40 ms frames.

### Changes

- Documentation only.
- No source changes were made in this pass.

### Verification

Not run for this documentation-only update beyond the comparison script used to compute
the table above.

### Result

Confirmed:

- Server mode after the mitigation still has more frame hitches and movement catchup
  than practice mode.
- The mitigation does not remove the underlying frame hitch root cause.
- The next root-cause pass should focus on server-mode-only client work that can create
  30-40 ms frames.

### Follow-Ups

- Add or use a frame-work profiler that can separate per-frame time spent in:
  - movement/player controller
  - remote/player render loops
  - ability/effect managers
  - UI/store subscribers
  - network message handlers
- Prioritize server-mode-only systems because practice mode has stable frame pacing on
  the same map seed.
- Keep treating authority correction as ruled out unless a future snapshot shows nonzero
  position error, replayed commands, or visual correction magnitude.
- If adding more diagnostics, capture per-frame long-task labels or per-system timing
  around frames where `frameDeltaMs >= 30`.

## Pass 006 - Hitch-Frame Work Attribution And Batched Vitals

Date: June 13, 2026

Status: Implemented and verified by automated checks. User feel validation and a new
diagnostics capture are still needed in a local server-backed custom match.

### Problem

Pass 005 showed that server-backed custom matches still had worse frame pacing than the
same-seed practice baseline, but the diagnostics only showed that hitches happened. They
did not identify which server-mode client work ran around those hitch frames.

### Evidence

- Authority backlog, reconciliation, replay, transform churn, and custom-message byte
  accounting remained clean across prior captures.
- Server mode still had 26-33 ms p95/p99 frame deltas while practice mode stayed close
  to one 60 Hz frame.
- The remaining likely causes were server-mode-only client work: network message
  handlers, React-visible store publishes, minimap/UI overlays, or R3F frame systems.
- Code inspection found one concrete inefficiency in that path: one `playerVitals`
  packet could publish the Zustand store once per changed player through repeated
  `updatePlayer` calls.

### Changes

- Added hitch-frame work attribution to `window.__voxelMovementDiagnostics.snapshot()`:
  - `frameWorkSamples` records recent named work samples.
  - `hitchFrameWork` records work aggregated around frames where `frameDeltaMs >= 33.3`.
- Instrumented coarse server-mode/client-frame work labels:
  - `frame.r3fCallbacks`
  - `frame.playerController`
  - `frame.gameplayCleanup`
  - `frame.dynamicLights`
  - `ui.minimapOverlay`
  - `network.<messageType>` for gameplay stream, combat, ping, phase, and lifecycle
    messages.
- Batched the `playerVitals` handler:
  - A vitals packet now builds one next `players` map, one `localPlayer`, optional pings
    cleanup, and one `tick/serverTime` update.
  - Visual-store updates and removal cleanup still run explicitly after the store
    publish.
  - The old per-player store publish path was removed rather than kept as a legacy
    fallback.

### Verification

Automated checks run:

```bash
pnpm --filter @voxel-strike/client typecheck
pnpm --filter @voxel-strike/client test:visual-store
git diff --check
```

Results:

- Client TypeScript check passed.
- Visual store, projectile slice performance, and game performance utility tests passed.
- Whitespace diff check passed.

Browser/gameplay testing was not run per repo instructions.

### Result

Expected:

- Server-mode vitals bursts should cause less React/Zustand subscriber churn, especially
  in bot-filled or high-player custom matches.
- The next stutter capture can identify whether hitch intervals line up with network
  handlers, the player controller, minimap overlay, R3F callbacks, or uninstrumented
  render/GPU/browser work.

Unconfirmed:

- In-game feel still needs user validation.
- A fresh `window.__voxelMovementDiagnostics.snapshot()` is needed to compare
  `hitchFrameWork` against the previous server/practice frame pacing gap.

### Follow-Ups

- During a visible server-mode stutter, capture
  `window.__voxelMovementDiagnostics.snapshot()` and inspect:
  - `hitchFrameWork`
  - `frameWorkSamples`
  - `frameDeltaMs`
  - `movementSubstepsPerFrame`
  - `movementCatchupFrames`
- If `hitchFrameWork.totalMeasuredMs` is high, drill into the largest labels.
- If `frame.r3fCallbacks` is high but named child labels are low, instrument the active
  effect or remote-player managers next.
- If measured work is low while frame deltas remain high, investigate WebGL render/GPU
  stalls, browser long tasks outside the app, or compositor work.

## Pass 007 - Suppress Expiry-Only Player Interest Churn

Date: June 13, 2026

Status: Implemented and verified by automated checks. User feel validation and a new
server-mode diagnostics capture are still needed.

### Problem

After Pass 006, a fresh server-mode capture still showed substantially more hitch and
movement catchup frames than practice mode. The new hitch-frame attribution did not show
large measured JavaScript work during those hitches, but it exposed a recurring
server-mode-only message pattern.

### Evidence

Fresh user-provided captures:

| Signal | Server | Practice |
| --- | ---: | ---: |
| Frames observed | 1794 | 2058 |
| Retained frame delta p95 | 25.3 ms | 17.6 ms |
| Retained frame delta p99 | 33.8 ms | 19.6 ms |
| Retained frame delta max | 37.9 ms | 25.7 ms |
| Movement hitch frames | 19 | 3 |
| Movement catchup frames | 254 | 13 |
| Movement substeps per retained frame p99 | 2 | 1 |
| Commands per packet p99 | 4 | 3 |
| Authority pending before drain p99 | 1 | n/a |
| Authority drain duration p99 | 0.1 ms | n/a |
| Position error p99 | 0 m | n/a |
| Velocity error p99 | 0 m/s | n/a |
| Replayed commands p99 | 0 | n/a |
| Visual correction magnitude p99 | 0 | n/a |

Hitch attribution from the server capture:

- `network.playerInterest` appeared in 15 of 19 hitch intervals.
- Total measured work during server hitches was still tiny: p95 was about 1.3 ms.
- Individual `network.playerInterest` samples were about 0.1-0.2 ms, so the handler
  cost itself was not large enough to explain the full 30-40 ms frames.
- The retained server frame sequence showed long frames followed by very short frames
  on an approximately 200 ms cadence.

Code audit of that cadence:

- `PLAYER_INTEREST_INTERVAL_MS` is 200 ms.
- Visible interest TTL defaults to 150 ms.
- `getPlayerInterestSignature` included `expiresAt`.
- Stable visible/team/self interest could therefore produce a changed signature every
  interest broadcast solely because the expiration timestamp refreshed.
- The client only uses `playerInterest.players[].state`; it does not consume
  `expiresAt`, `reason`, or `lastKnownPosition` for gameplay/render state.

### Changes

- Added `playerInterestSnapshot` helpers:
  - `buildPlayerInterestSnapshot` shapes the server payload.
  - `getPlayerInterestSignature` creates a stable signature from state, reason, and
    last-known position.
- Removed `expiresAt` from the player-interest payload sent by the game room.
- Removed `expiresAt` from the player-interest signature so expiry-only refreshes no
  longer trigger broadcasts.
- Removed the old private `GameRoom.getPlayerInterestSignature` implementation rather
  than leaving a legacy duplicate path.
- Added focused coverage that:
  - expiry-only interest refreshes keep the same signature
  - state changes still change the signature
  - last-known position changes still change the signature
  - built player-interest snapshots omit `expiresAt`

### Verification

Automated checks run:

```bash
pnpm --filter @voxel-strike/server test:visibility-interest
pnpm --filter @voxel-strike/server typecheck
pnpm --filter @voxel-strike/client typecheck
git diff --check
```

Results:

- Visibility interest management tests passed, including the new stable-signature
  assertions.
- Server TypeScript check passed.
- Client TypeScript check passed.
- Whitespace diff check passed.

Browser/gameplay testing was not run per repo instructions.

### Result

Expected:

- Stable server-mode matches should stop receiving periodic `playerInterest` payloads
  every ~200 ms when only interest expiry timestamps refresh.
- The next server capture should show much lower `network.playerInterest` presence in
  `hitchFrameWork`.

Unconfirmed:

- Whether removing the 200 ms player-interest churn fully closes the server-vs-practice
  frame pacing gap still needs user validation.
- If hitches remain while `network.playerInterest` disappears, the next target is likely
  render/GPU/compositor work or another uninstrumented periodic system.

### Follow-Ups

- Capture another server-mode `window.__voxelMovementDiagnostics.snapshot()` after this
  pass and compare:
  - `hitchFrameWork`
  - `frameDeltaMs`
  - `movementCatchupFrames`
  - `transformMessagesReceived`
  - `localReactiveUpdates`
- If `network.playerInterest` is gone but hitches persist, inspect unmeasured render
  work around the remaining hitch cadence.

## Pass 008 - Player Interest Churn Fix Validation

Date: June 13, 2026

Status: Analysis logged. No code changes in this pass.

### Problem

After Pass 007 removed expiry-only `playerInterest` churn, new server and practice
captures were needed to confirm whether the server-only 200 ms hitch cadence disappeared
and whether the server-mode frame pacing gap remained significant.

### Evidence

Fresh user-provided captures:

| Signal | Server After Pass 007 | Practice Baseline |
| --- | ---: | ---: |
| Frames observed | 1658 | 1719 |
| Retained frame delta average | 16.668 ms | 16.661 ms |
| Retained frame delta p95 | 17.6 ms | 17.6 ms |
| Retained frame delta p99 | 17.7 ms | 18.6 ms |
| Retained frame delta max | 17.8 ms | 19.9 ms |
| Movement hitch frames | 3 (0.18%) | 2 (0.12%) |
| Movement catchup frames | 26 (1.57%) | 8 (0.47%) |
| Movement substeps per retained frame p99 | 1 | 1 |
| Movement substeps per retained frame max | 1 | 1 |
| Commands per packet p99 | 3 | 3 |
| Commands per packet max | 8 | 3 |
| Authority pending before drain p99 | 1 | n/a |
| Authority drain duration p99 | 0.1 ms | n/a |
| Authority ack interval p99 | 62.8 ms | n/a |
| Position error p99 | 0 m | n/a |
| Velocity error p99 | 0 m/s | n/a |
| Replayed commands p99 | 0 | n/a |
| Visual correction magnitude p99 | 0 | n/a |
| Transform messages received | 4 | 0 |
| Self-only transform messages | 3 | 0 |
| Remote transform snapshots added | 0 | 0 |
| Local reactive updates | 8 vitals, 1 transform, 2 self-authority | 0 |

Hitch-frame attribution:

- `network.playerInterest` no longer appeared in server `hitchFrameWork`.
- Server hitch attribution contained only tiny measured work:
  - `frame.r3fCallbacks`: 0.6 ms total across 2 hitch intervals
  - `ui.minimapOverlay`: 0.3 ms total across 2 hitch intervals
  - `frame.playerController`: 0.2 ms total across 1 hitch interval
  - `frame.dynamicLights`: 0.1 ms total across 1 hitch interval
- Server retained frame timing is now essentially clean: p99 is 17.7 ms and retained max
  is 17.8 ms.
- Both server and practice still captured a small number of isolated large hitch events
  outside the retained 120-frame `frameDeltaMs` sample. These had almost no measured app
  work, which points away from gameplay/network code.
- Server had one long authority ack interval sample at 382 ms and one 8-command packet,
  consistent with an isolated stall rather than steady authority backlog. Authority
  queue depth, correction, replay, and visual correction remained clean.

### Changes

- Documentation only.
- No source changes were made in this pass.

### Verification

Not run for this documentation-only update beyond the comparison script used to compute
the table above.

### Result

Confirmed:

- Pass 007 removed the recurring `network.playerInterest` hitch attribution.
- Server retained frame pacing is now close to, and in the retained p99 sample slightly
  cleaner than, the practice baseline.
- Authority correction remains ruled out for the latest server capture: no backlog,
  no replay, no position error, no velocity error, and no visual correction.

Inferred:

- The remaining isolated hitches are more likely browser, OS, devtools, GC, compositor,
  or GPU/render stalls than app-level gameplay/network work.
- The small remaining server/practice catchup difference may not be player-visible after
  the Pass 007 fix, but that still needs user feel validation.

### Follow-Ups

- Do an in-game feel check before adding more instrumentation.
- If server mode still feels worse during a specific window, capture another
  `window.__voxelMovementDiagnostics.snapshot()` during that exact window.
- If future captures still show isolated large stalls with tiny measured app work,
  add browser long-task or render-stall diagnostics rather than continuing to chase
  authority, prediction, or `playerInterest`.

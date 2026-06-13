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
- The server movement command rate limit is 35 movement packets per second.
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
- Raising server tick rate was rejected for this pass. At 60 Hz, the client flush age
  would likely push movement packets toward 60 packets per second, above the existing
  35 packets per second server movement packet limit, causing drops unless several
  related limits and cadence rules changed together.

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
- Add a benchmark that includes custom message accounting and send tracking, because
  the existing room-load benchmark does not cover that path.
- Investigate whole-store client subscriptions that may rerender UI on unrelated
  network state changes.
- Confirm client development anti-cheat movement tracing settings for the stutter
  session. The server anti-cheat settings were captured above, but the client trace
  recorder uses separate `VITE_ANTICHEAT_MOVEMENT_TRACE_*` variables.
- Audit server movement shadow simulation wiring. Shadow mode was configured for the
  session, but this pass did not find a live call site for the recorder.
- Revisit tick rate only as a coordinated network-cadence change. Raising tick rate
  alone risks crossing movement packet rate limits.

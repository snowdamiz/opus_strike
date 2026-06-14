# Optimization Follow-Up Plan

Created: 2026-06-14

This plan covers the larger performance follow-ups intentionally left out of the first optimization pass because they touch broader architecture or require careful runtime validation.

## Goals

- Reduce initial JavaScript parse/eval cost before active play.
- Keep game-only systems out of menu, lobby, admin, and pre-match paths until needed.
- Remove known per-frame combat visual scans.
- Reduce repeated matchmaking/lobby HTTP and matchmaker query load.

## Constraints

- Do not use worktrees or branches unless explicitly requested.
- Do not browser-test in this repo; leave that to the user.
- Remove confirmed legacy code instead of keeping compatibility shims.
- Keep each slice independently reviewable and verified with typechecks or focused tests.

## Slice 1: Vendor Chunk Splitting

Problem:
The current client Vite chunking has a broad catch-all vendor chunk. Startup routes can end up fetching and parsing unrelated `node_modules` code, including Three/R3F/Drei, Colyseus, wallet helpers, and voice dependencies.

Plan:
1. Inspect `apps/client/vite.config.ts` and current build output.
2. Replace the catch-all vendor bucket with targeted chunks:
   - `react-vendor`
   - `r3f-three-vendor`
   - `network-vendor`
   - `wallet-vendor`
   - `voice-vendor`
   - `physics-vendor`
3. Keep small/unclassified packages with their importing route where possible instead of forcing a mega-chunk.
4. Run `pnpm --filter @voxel-strike/client build` and compare generated chunk sizes.

Success criteria:
- Initial app chunk no longer pulls the 3D/gameplay/network/wallet stacks unnecessarily.
- Build still succeeds without circular chunk warnings or runtime import errors.

## Slice 2: Lazy-Load Phase Screens And Game Handlers

Problem:
Top-level app/provider imports pull screens and systems that are only needed after specific game phases. This includes phase screens with WebGL previews and game message handlers that pull gameplay, Three, and prediction code into startup.

Plan:
1. Lazy-load phase screens from `apps/client/src/App.tsx`, starting with:
   - `MapVoteScreen`
   - `HeroSelect`
   - any preview canvas dependency that only belongs to those screens
2. Add a lightweight suspense/loading path that matches existing UI style.
3. Split `NetworkContext` so lobby/admin connection behavior stays lightweight.
4. Dynamically import game message handlers and prediction modules only when a game room is joined.
5. Add focused tests or module-boundary checks where practical, then run client typecheck/build.

Success criteria:
- Menu/lobby/admin paths do not eagerly evaluate game-only handlers or 3D preview modules.
- Joining a game still wires all message handlers before gameplay messages are processed.

## Slice 3: Void Ray Combat Visual Cache Reuse

Problem:
`phantom/voidRay.tsx` scans the full player map per active ray frame. Dire Ball already uses the combat visual frame cache, so Void Ray is the outlier.

Plan:
1. Inspect the existing combat visual cache used by Dire Ball.
2. Rework Void Ray hit visualization to query cached/bucketed enemy player candidates keyed by the frame clock.
3. Reuse scratch arrays and avoid per-frame allocations in the ray collision path.
4. Preserve current visual behavior for local and remote player positions.
5. Verify with client typecheck and a focused test if an existing combat visual test harness can cover it.

Success criteria:
- Void Ray no longer performs `players` full-map scans per active ray frame.
- Multiple active rays share frame cache work instead of each rebuilding collision candidates.

## Slice 4: Lobby And Matchmaking Fanout Cleanup

Problem:
Queue/lobby status can fan out into repeated HTTP polling and per-client matchmaker queries. This is not direct movement replication, but it can create server event-loop and I/O pressure during queue spikes.

Plan:
1. Audit current client usage of queue status and lobby streams.
2. Replace per-client matchmaking queue polling with a shared server-side aggregate cache or push over the existing Colyseus channel.
3. Confirm whether `/lobbies/stream` has any external consumers.
4. If it is legacy, remove the SSE endpoint and associated polling.
5. If it is still needed, replace per-SSE-client polling with one shared cache/fanout loop.
6. Add server tests for queue/lobby status behavior and run server typecheck.

Success criteria:
- Queue status work scales with room/mode changes, not with `clients * rooms / interval`.
- Unused legacy lobby stream code is removed, or active stream code uses shared fanout.

## Suggested Order

1. Void Ray combat visual cache reuse.
2. Vendor chunk splitting.
3. Lazy-load phase screens and game handlers.
4. Lobby and matchmaking fanout cleanup.

The first item most directly affects active in-game smoothness. The next two improve startup and phase transitions. The final item is server scalability work that matters most during high concurrency.

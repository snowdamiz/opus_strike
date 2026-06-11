# Colyseus Cross-Process Presence Implementation Plan

Reader: the next engineer making the server safe to run on more than one process or machine.

Post-read action: implement and verify a distributed Colyseus deployment where players can enter lobbies from different server instances, transition into game rooms, and continue gameplay without relying on process-local matchmaking state.

## Outcome

Multiple server instances should be able to run at the same time. A client may start on any healthy instance, discover or join a lobby created on another instance, receive the game-room transition, and connect to the machine that owns the authoritative game room.

The authoritative gameplay model should not change. Each lobby room and game room still belongs to exactly one Colyseus process. We are not syncing live game state between machines. We are making room discovery, seat reservation, lobby metadata, and cross-process side effects visible to every server instance.

## Current State

The server currently creates a single Colyseus server with the default in-memory presence and driver. That is correct for one process, but it means room discovery and IPC are local to the process.

Lobby listing and matchmaking already go through Colyseus matchmaker queries, and lobby rooms already publish metadata for browsing and queue status. That structure should work with a shared driver once the server is configured for one.

The lobby room creates game rooms server-side, then sends clients the target game-room id and a signed entry ticket. That transition depends on Colyseus being able to reserve seats and route clients to the process that owns the game room.

The server also has process-local assumptions outside Colyseus:

- Wager payment status updates are emitted through an in-process event emitter.
- Wager retry and reconciliation jobs start on every server process.
- Deployment currently exposes one Fly service hostname, which is not automatically the same thing as a stable address for the specific process that owns a room.

## Core Decisions

Use Redis-backed Colyseus `Presence` and `Driver` for distributed mode.

- `Presence` handles inter-process communication and seat reservation calls.
- `Driver` stores and queries room data used by the matchmaker.
- Both must point at the same Redis deployment from every server instance.

Keep local in-memory presence and driver for simple development unless distributed mode is explicitly enabled.

Pin Redis packages to the Colyseus 0.15 line already used by the server. The latest compatible packages observed for this line are:

- `@colyseus/redis-presence@^0.15.6`
- `@colyseus/redis-driver@^0.15.6`

Use the 0.15 constructor style for Redis URLs:

```ts
new RedisPresence(redisUrl)
new RedisDriver(redisUrl)
```

Do not make Postgres the Colyseus driver for this step. Postgres already persists business state, but Redis is the documented path for Colyseus 0.15 scaling and also gives us pub/sub for cross-process lobby side effects.

## Target Architecture

All server instances share:

- one Redis deployment for Colyseus presence, Colyseus driver, and lightweight cross-process pub/sub
- one Postgres database for durable user, match, wager, and ranking state
- one Solana treasury and RPC configuration for wager flows

Each server instance owns:

- the rooms created on that process
- the WebSocket connections attached to those rooms
- its own HTTP listener and health endpoint
- no exclusive global state unless it has a distributed lock

Colyseus room state remains process-owned. Durable domain state remains database-owned. Cross-process notifications are hints that cause the room owner to refresh from the database, not the source of truth.

## Implementation Slices

### 1. Add Distributed Colyseus Runtime Config

Add a small server configuration module that reads:

- `COLYSEUS_DISTRIBUTED`: enables shared presence/driver when set to `1`
- `COLYSEUS_REDIS_URL` or `REDIS_URL`: Redis connection string
- `COLYSEUS_ROUTING_STRATEGY`: `direct` locally, `fly_replay` for Fly multi-machine production
- `COLYSEUS_PUBLIC_ADDRESS`: public Colyseus hostname; use the generic Fly app hostname when `fly_replay` owns Machine routing
- `COLYSEUS_REQUIRE_PUBLIC_ADDRESS`: fail-fast guard for production distributed mode
- Fly routing knobs: `FLY_APP_NAME`, `FLY_MACHINE_ID`, `FLY_REGION`, plus optional registry TTL, heartbeat, replay timeout, and replay fallback envs

The server bootstrap should create Colyseus options like this:

- always configure the existing WebSocket transport
- when distributed mode is off, use the default local presence and driver
- when distributed mode is on, add `RedisPresence`, `RedisDriver`, and `publicAddress`
- fail fast in production distributed mode if Redis is missing
- fail fast in production distributed mode if the deployment strategy requires `publicAddress` and it is missing

Keep room definitions, filters, sorting, and realtime listing in the same shape. The important change is that matchmaker data is now shared across instances.

### 2. Add Local Redis for Distributed Development

Add a Redis service to the local compose stack. Keep Postgres as-is.

Add local scripts or documented commands for two server processes:

```sh
COLYSEUS_DISTRIBUTED=1 COLYSEUS_REDIS_URL=redis://localhost:6379 PORT=2567 COLYSEUS_PUBLIC_ADDRESS=localhost:2567 pnpm dev:server
COLYSEUS_DISTRIBUTED=1 COLYSEUS_REDIS_URL=redis://localhost:6379 PORT=2568 COLYSEUS_PUBLIC_ADDRESS=localhost:2568 pnpm dev:server
```

Use this as the first proving ground before Fly or any hosted multi-machine rollout.

### 3. Replace Process-Local Wager Notifications

The current wager service emits `paymentStatusChanged` in-process. In distributed mode, an HTTP wager request can land on a different server than the lobby room, so that event can miss the room that needs to update.

Add a small wager event bus:

- local mode can keep the current event emitter behavior
- distributed mode publishes status changes through `matchMaker.presence`, using a lobby-specific channel such as `wager:lobby:<lobbyId>`
- lobby rooms subscribe to their own wager channel on create
- lobby rooms unsubscribe on dispose
- event payloads include enough identifiers for the room to refresh from the database
- duplicate events are allowed; the database remains the source of truth

After a payment event arrives, the lobby owner should refresh wager state and player payment statuses, then update lobby metadata and broadcast the existing payment/lobby messages.

Add a safety refresh while a wagered lobby is waiting or matchmaking. Pub/sub is best-effort; a periodic refresh keeps the lobby correct if a publish is missed during deploys, Redis reconnects, or room disposal races.

### 4. Make Background Jobs Multi-Instance Safe

The wager background jobs currently start in every server process. With multiple machines, that creates duplicate polling and retry loops.

Implement one of these before enabling multi-machine production:

- Preferred for this codebase: Redis owner-checked lock with TTL and heartbeat extension around each background pass.
- Acceptable alternative: one dedicated worker process, with web server processes not starting background jobs.

The lock must:

- use `SET NX` semantics or equivalent
- include an owner token
- release only when the owner token matches
- expire if the process dies
- extend while a pass is still active

Do not rely only on a global worker lock for money movement. Also review individual payment, refund, and settlement transitions so concurrent manual retries, room-triggered settlements, and worker retries cannot send duplicate transfers. Use database status guards, row-level locking, unique signatures, and idempotent status transitions around external Solana calls.

### 5. Make Deployment Routing Explicit

Colyseus 0.15 scaling assumes clients can connect to the process that owns the room. A generic load-balanced hostname is not enough unless the platform routes the matchmake and WebSocket upgrade back to the owner process.

For Fly, this is a required deployment decision:

- Fly's default proxy balances traffic across Machines by load and closeness.
- The current single server hostname can send a new connection to any Machine.
- Before scaling Machines, prove how `COLYSEUS_PUBLIC_ADDRESS` maps to the actual room-owning Machine.

Chosen production approach:

1. Use Fly managed Upstash Redis for Colyseus presence, driver, event bus, worker locks, and the process route registry.
2. Keep `COLYSEUS_PUBLIC_ADDRESS` as the generic Fly hostname (`opus-strike-server.fly.dev`) so clients use the normal app URL.
3. Store `Colyseus processId -> FLY_MACHINE_ID` in Redis with a heartbeat and TTL.
4. Wrap the Node HTTP WebSocket upgrade listener. If the URL targets a non-local Colyseus process, return `fly-replay: instance=<machine id>;timeout=5s;fallback=force_self` before the WebSocket upgrade reaches Colyseus.
5. If Fly falls back with `fly-replay-failed`, return a first-class 503 instead of replaying again.

Rejected alternatives:

1. Per-instance public addresses: each server instance has a stable public hostname/address and publishes it through `publicAddress`.
2. Separate routing gateway: unnecessary because the server can replay the upgrade before Colyseus consumes it.
3. Colyseus proxy: reserve for a future hosting platform where Fly replay is unavailable.

The first production rollout should stay in one region until routing, reconnect, and failure behavior are proven. Multi-region matchmaking is a later step because room ownership and player latency become product decisions, not just infrastructure changes.

### 6. Add Health and Observability

Extend server health output with distributed runtime details:

- process id
- configured public address
- distributed mode enabled/disabled
- Redis connectivity
- Colyseus room count visible from the local process
- matchmaker query health

Add structured logs for:

- Redis connection failures
- Colyseus graceful shutdown start/finish
- wager pub/sub publish and subscribe failures
- background worker lock acquisition, renewal, and release
- room creation and game-start transitions with lobby id, game room id, match mode, and process id

Expose enough information to answer two operational questions quickly:

- Which process owns this room?
- Why did a client fail to join the room it was assigned to?

### 7. Improve Graceful Shutdown

Make shutdown async and deterministic:

- stop accepting new HTTP/WebSocket work
- stop wager background jobs or release worker lock
- call and await Colyseus graceful shutdown
- close the HTTP server
- avoid running the shutdown sequence twice for repeated signals

During rolling deploys, active rooms should either drain naturally or disconnect clients cleanly. Ranked and wagered lobbies must keep the existing refund/no-contest behavior for failures before or during game start.

### 8. Verification Plan

Do not use browser testing for this plan. Use Node-based harnesses and HTTP/WebSocket clients.

Minimum local verification:

1. Start Redis and Postgres.
2. Start server A on one port and server B on another port with distributed mode enabled.
3. From a script, connect client 1 through server A and client 2 through server B.
4. Verify both clients can join the same quick-play queue when filters match.
5. Verify lobby listing and queue-status endpoints return the same room metadata from both servers.
6. Fill the queue, trigger map vote/start, and verify both clients can join the created game room.
7. Send gameplay input from both clients for several ticks and verify the authoritative room continues broadcasting state.
8. For ranked/wagered flow, force or simulate payment status updates through an HTTP route on the non-owner process and verify the lobby owner updates state.
9. Kill the non-owner process and verify the owner room continues.
10. Kill the owner process and verify clients disconnect cleanly, stale rooms disappear from the shared driver, and any pre-game wager/refund behavior is correct.

Automated checks should include:

- server typecheck
- targeted matchmaking route tests
- a cross-process Colyseus harness using two server ports and shared Redis
- wager event-bus tests for local mode and distributed mode
- background worker lock tests with two simulated workers

### 9. Rollout Plan

Stage 1: local-only distributed mode.

- Add Redis dependencies and server config.
- Add local Redis compose service.
- Prove two local server processes can share lobbies and transition into game rooms.

Stage 2: cross-process side effects.

- Move wager payment updates to the event bus.
- Add lobby refresh fallback.
- Add worker lock or dedicated worker mode.
- Verify ranked and wager paths from a non-owner process.

Stage 3: staging deployment.

- Provision Fly managed Upstash Redis.
- Enable distributed mode for two server instances.
- Enable `COLYSEUS_ROUTING_STRATEGY=fly_replay` and verify process route registration in `/health`.
- Run the Node harness against staging.
- Keep one region.

Stage 4: production rollout.

- Deploy with one instance in distributed mode first.
- Scale to two instances after health checks and harness pass.
- Watch room creation, join errors, Redis reconnects, wager events, and worker lock metrics.
- Keep a fast rollback: scale back to one instance and disable distributed mode if routing or Redis behavior is unstable.

## Risks and Open Decisions

Routing is the largest deployment risk. Redis presence and driver solve shared Colyseus coordination, but clients still need to reach the room owner for WebSocket traffic.

Redis is now part of the realtime critical path. If Redis is down, distributed matchmaking should fail closed rather than silently creating split-brain room discovery.

Wager events must be resilient to duplicate and missed messages. Treat pub/sub as a wake-up signal and the database as truth.

Background workers must be idempotent at the operation level. A global lock reduces duplicate work, but payment/refund/settlement operations still need their own guards.

Room metadata freshness matters more after distribution. Any code path that changes lobby status, player counts, wager status, rank band, or lock state must update Colyseus metadata.

## Done Criteria

Cross-process presence is complete when:

- two server instances use shared Redis presence and driver
- matchmaker room queries are consistent from both instances
- clients entering through different instances can land in the same lobby
- lobby-to-game transition works when the game room owner is not the client's initial HTTP entrypoint
- payment status changes made through a non-owner process update the owner lobby
- only one background worker pass runs at a time, or a dedicated worker owns the jobs
- duplicate payment/refund/settlement attempts remain idempotent
- graceful shutdown removes rooms from shared discovery and does not strand wagered lobbies
- staging proves Fly replay routing to the room-owning process before production is scaled above one machine

## Sources Checked

- [Colyseus Presence](https://docs.colyseus.io/server/presence)
- [Colyseus Driver](https://docs.colyseus.io/server/driver)
- [Colyseus 0.15 Scalability](https://0-15-x.docs.colyseus.io/scalability/)
- [Colyseus 0.15 Migration Notes](https://0-15-x.docs.colyseus.io/migrating/0.15/)
- [Fly Load Balancing](https://fly.io/docs/reference/load-balancing/)
- [Fly Dynamic Request Routing](https://fly.io/docs/networking/dynamic-request-routing/)

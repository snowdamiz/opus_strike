# True Fly Autoscaler Implementation Plan

Reader: the next engineer implementing production autoscaling for the game server on Fly.io.

Post-read action: ship an autoscaler that automatically creates and removes Fly Machines for the server app without manual pre-provisioning, while preserving Colyseus room ownership and avoiding disruption to active matches.

## Outcome

The server should keep a small warm baseline, add capacity when demand grows, and remove excess capacity when demand falls. Operators should no longer have to run manual scale commands before a traffic spike.

The first production version should:

- keep at least two running server Machines in the primary region
- create additional Machines automatically when player demand exceeds planned per-Machine capacity
- create new Machines in a stopped state so Fly Proxy can start them quickly when connection load needs them
- destroy only excess stopped Machines after demand drops
- never destroy or stop a Machine that is currently running active rooms
- preserve the existing Redis-backed Colyseus driver, presence, and Fly Replay room routing model
- expose clear metrics and logs so scaling decisions are explainable after the fact

## Why Current Autoscaling Is Not Enough

The server Fly service now has autostop/autostart enabled. That lets Fly Proxy start and stop existing Machines based on service load. It does not create new Machines. The total capacity ceiling is still the number of Machines already attached to the app.

Fly's metrics-based autoscaler is the platform-supported path for changing the created Machine count. It can create and delete Machines based on Prometheus or Temporal metrics. The right model for this game server is a two-layer scaler:

1. Fly Proxy autostart/autostop manages running state for already-created Machines.
2. A Fly autoscaler app manages created Machine count so the pool grows and shrinks automatically.

## Current Server Constraints

The server already has the important multi-Machine pieces:

- distributed Colyseus presence and driver through Redis
- Fly Replay routing for WebSocket upgrades to the room-owning Machine
- health output that reports local room count, local CCU, Redis health, and Fly Replay registration
- room ownership kept process-local, which is correct for authoritative gameplay

The server does not yet expose Prometheus-formatted autoscaling metrics. The health endpoint is JSON and useful for humans, but the Fly autoscaler needs a stable metric source.

## Target Architecture

Use a dedicated Fly app named something like `opus-strike-server-autoscaler`. It runs the official `flyio/fly-autoscaler` image.

The autoscaler queries Fly Prometheus and computes the desired number of created Machines for `opus-strike-server`. It should use a created-machine-count rule, not only a started-machine-count rule, because the requirement is to add and remove Machines without manual pre-provisioning.

The target server app keeps:

- `auto_stop_machines = "stop"`
- `auto_start_machines = true`
- `min_machines_running = 2`
- connection soft/hard limits tuned for WebSocket load

The autoscaler app owns:

- API permission to create and destroy Machines for the target server app
- read permission to query Fly Prometheus
- the scaling expression and reconciliation interval
- its own logs and Prometheus metrics

## Scaling Policy

Start conservative. The first policy should optimize reliability over cost.

Suggested initial constants:

| Setting | Initial value | Reason |
| --- | ---: | --- |
| Minimum created Machines | 2 | Matches current warm baseline. |
| Minimum running Machines | 2 | Avoid cold starts for the primary game service. |
| Maximum created Machines | 6 | Enough headroom for launch testing without surprise spend. |
| Reliable players per Machine | 48 | Leaves CPU and network headroom below the estimated 64-player upper comfort band. |
| Spare stopped Machines | 1 | Keeps a ready-to-start buffer above current demand. |
| Reconcile interval | 15s | Fly autoscaler default; tune only after observing behavior. |

Demand should count every active player and queued/lobby participant. Bots also consume CPU and should count as one participant until load testing proves a better weight.

The created-Machine target should be:

```text
needed_for_players = ceil(demand_players / 48)
desired_created = min(max(max(needed_for_players + 1, running_machines), 2), 6)
```

The important guard is `max(..., running_machines)`. It prevents the autoscaler from reducing created Machine count below the number of currently running Machines. That forces scale-down to happen in two safe steps:

1. Fly Proxy stops idle Machines after traffic falls.
2. The autoscaler later destroys excess stopped Machines.

That sequencing avoids deleting a Machine that still owns active Colyseus rooms.

## Metric Plan

Add a Prometheus metrics endpoint to the server. Keep it free of secrets and user-identifying data.

Required gauges:

- `opus_strike_colyseus_local_ccu`
- `opus_strike_colyseus_local_room_count`
- `opus_strike_lobby_participants`
- `opus_strike_visible_lobby_count`
- `opus_strike_fly_replay_registered`
- `opus_strike_redis_up`

Useful follow-up gauges:

- active game room count
- active lobby room count
- active match count by mode
- local event loop lag
- heap used bytes
- process uptime seconds

Configure Fly metrics scraping for the server app so Fly Prometheus can query the endpoint. Then configure the autoscaler with two Prometheus collectors:

```text
demand_players =
  sum(opus_strike_colyseus_local_ccu{app="opus-strike-server"})
  + sum(opus_strike_lobby_participants{app="opus-strike-server"})

running_machines =
  count(fly_instance_up{app="opus-strike-server"})
```

If Fly's label names differ in the live Prometheus explorer, adjust the queries during staging. Do not bake unverified labels into production.

## Autoscaler Configuration Plan

Add a repository-managed Fly config for the autoscaler app. Pin the image version instead of floating on latest. Use the newest stable `flyio/fly-autoscaler` image available at implementation time, with at least the version that supports `FAS_INITIAL_MACHINE_STATE`.

The autoscaler app should use Fly config for app deployment plus an autoscaler configuration that can express multiple metric collectors. The logical configuration should be:

```toml
app = "opus-strike-server-autoscaler"

[build]
  image = "flyio/fly-autoscaler:<pinned-version>"

[env]
  FAS_APP_NAME = "opus-strike-server"

[metrics]
  port = 9090
  path = "/metrics"
```

```yaml
created-machine-count: "min(max(max(ceil(demand_players / 48) + 1, running_machines), 2), 6)"
initial-machine-state: "stopped"
interval: "15s"

metric-collectors:
  - type: "prometheus"
    metric-name: "demand_players"
    address: "https://api.fly.io/prometheus/<org-slug>"
    query: "sum(opus_strike_colyseus_local_ccu{app='opus-strike-server'}) + sum(opus_strike_lobby_participants{app='opus-strike-server'})"

  - type: "prometheus"
    metric-name: "running_machines"
    address: "https://api.fly.io/prometheus/<org-slug>"
    query: "count(fly_instance_up{app='opus-strike-server'})"
```

Verify the exact config-file key names against the pinned autoscaler image before implementation. If the official image cannot support multiple Prometheus collectors and `initial-machine-state` in the same configuration mode, do not ship a weaker single-metric version. Either use a supported config-file mode or write a tiny custom reconciler around the Fly Machines API.

Required secrets:

- `FAS_API_TOKEN`: deploy token scoped to `opus-strike-server`
- `FAS_PROMETHEUS_TOKEN`: read-only token for Fly Prometheus

Do not commit tokens. Do not reuse a personal all-app token.

## Implementation Slices

### 1. Add Server Metrics

Implement a Prometheus endpoint on the server process.

Acceptance criteria:

- metrics endpoint returns valid Prometheus text format
- metrics include local CCU, local room count, lobby participant count, Redis health, and Fly Replay registration state
- metrics endpoint does not expose tokens, session ids, wallet addresses, auth ids, or player names
- server tests cover metric formatting and representative values

### 2. Wire Fly Metrics Scraping

Update server Fly configuration so Fly can scrape the metrics endpoint.

Acceptance criteria:

- deployed server metrics appear in Fly Prometheus
- labels can distinguish app, Machine, region, and process where available
- production scraping does not require a public secret-bearing endpoint

### 3. Add Autoscaler App Config

Add the autoscaler Fly app configuration and document the required secrets.

Acceptance criteria:

- config pins the autoscaler image
- config uses created-Machine scaling
- config creates Machines in stopped state
- config includes the running-Machine safety guard
- config starts with max created Machines capped at 6

### 4. Create a Staging Rollout

Deploy the autoscaler against a staging or low-risk target first.

Acceptance criteria:

- autoscaler starts as a single Machine
- autoscaler logs each reconciliation decision
- a simulated demand increase creates a stopped server Machine
- Fly Proxy can start the new Machine when connection load requires it
- simulated demand decrease eventually removes excess stopped Machines

### 5. Add Scale-Down Protection Tests

Prove the autoscaler cannot remove active capacity.

Acceptance criteria:

- a running Machine with active rooms is not destroyed by the autoscaler
- created Machine count never falls below running Machine count
- idle running Machines stop before any excess created Machines are destroyed
- stale Colyseus process routes expire after Machine shutdown
- clients connected to an owner room are not redirected to a different room owner

### 6. Production Rollout

Roll out with conservative caps.

Recommended first production settings:

- minimum created: 2
- minimum running: 2
- maximum created: 3
- players per Machine: 48
- spare stopped Machines: 1

After one real traffic window, raise maximum created Machines to 6 if metrics look stable.

## Verification Plan

Do not use browser testing for this plan.

Use scripts, HTTP clients, WebSocket clients, and Fly read-only commands.

Minimum verification:

1. Start local server metrics and assert Prometheus output.
2. Deploy server metrics to staging.
3. Query Fly Prometheus and confirm `demand_players` and `running_machines` return single numeric values.
4. Deploy the autoscaler with max created Machines set to 3.
5. Simulate enough WebSocket clients to push demand above one Machine's policy capacity.
6. Confirm a new stopped Machine is created.
7. Confirm Fly Proxy can start that Machine when load crosses service soft limits.
8. Stop simulated clients and wait for idle Machines to stop.
9. Confirm excess stopped Machines are destroyed while the warm baseline remains.
10. Repeat while a game room is active and confirm the owner Machine is not removed.

Operational verification:

```sh
fly logs -a opus-strike-server-autoscaler
fly machine list -a opus-strike-server
fly status -a opus-strike-server
fly config show -a opus-strike-server
```

## Observability And Alerts

Add dashboards or saved queries for:

- created Machines by state
- running Machines
- active players
- lobby participants
- rooms per Machine
- autoscaler desired created count
- autoscaler reconcile errors
- Fly API rate-limit or auth failures
- Redis health and Fly Replay registration health

Alert when:

- autoscaler has not reconciled recently
- autoscaler API calls fail repeatedly
- demand exceeds current capacity for more than two reconcile intervals
- maximum created Machines is reached
- any Machine has rooms but is missing from the Fly Replay process registry

## Rollback Plan

Fast rollback should disable only the autoscaler app, not the game server.

Options:

1. Stop or suspend the autoscaler app.
2. Change the autoscaler expression to hold created count at 2.
3. Remove autoscaler API permissions.
4. Manually restore target server scale with `fly scale count 2 -a opus-strike-server`.

Keep server autostop/autostart enabled during rollback. It is still useful for the Machines that remain created.

## Open Questions

- What is the Fly organization slug for the Prometheus URL?
- Should the first production cap be 3 or 6 created Machines?
- Do we want a dedicated staging server app, or should production launch with a temporary max of 3?
- Should metrics be exposed on the existing HTTP service or a separate metrics-only process/port?
- Should demand include lobby browser SSE connections, or only players who are in lobbies/games?

## References

- [Fly autoscaling reference](https://fly.io/docs/reference/autoscaling/)
- [Fly metrics-based autoscaling](https://fly.io/docs/launch/autoscale-by-metric/)
- [Fly autoscale Machines blueprint](https://fly.io/docs/blueprints/autoscale-machines/)
- [Fly scale Machine count docs](https://fly.io/docs/launch/scale-count/)

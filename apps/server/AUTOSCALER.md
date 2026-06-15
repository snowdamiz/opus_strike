# Server Autoscaler Runbook

This server uses two scaling layers on Fly.io:

- Fly Proxy autostop/autostart keeps at least one server Machine running and starts existing stopped Machines when connection load needs them.
- `opus-strike-server-autoscaler` runs `flyio/fly-autoscaler:0.3.1` and changes the number of created server Machines.

## Repository Files

- `fly.toml` exposes `/metrics` for Fly Prometheus scraping.
- `fly.autoscaler.toml` deploys the dedicated autoscaler app.
- `fly-autoscaler.yml` defines the created-Machine policy and Prometheus collectors.

## Policy

The autoscaler uses:

```text
max(running_machines, min(max(max(ceil(demand_players / dynamic_players_per_machine) + 1, running_machines + overloaded_machines), 2), 5))
```

`demand_players` is the sum of `opus_strike_colyseus_local_ccu` across server Machines. Local CCU is additive; `opus_strike_lobby_participants` is deliberately not used for autoscaling because it comes from global matchmaker query results and would be duplicated when summed across Machines.

`dynamic_players_per_machine` is the average live server capacity estimate exported by each server process from tick cost, CPU, event-loop delay, and memory pressure. `overloaded_machines` counts Machines whose capacity pressure is above 1 so the fleet can add capacity before raw player demand crosses the projected per-Machine capacity.

That policy keeps a two-Machine created floor, one spare stopped Machine above demand, and a demand-driven cap of five created Machines. `fly.toml` keeps one of those Machines running; the other floor Machine starts stopped and ready. The `running_machines` guard wins over the cap so an already-running Machine is not destroyed during scale-down.

New Machines are created in the `stopped` state. Fly Proxy starts them later when the server service crosses its connection limits.

With Fly Replay routing enabled, `COLYSEUS_ROOM_CREATE_STRATEGY=local` keeps each matchmaking request and the room it creates on the same Machine. This avoids a burst path where HTTP matchmaking lands on one Machine, creates the room on another Colyseus process, and then replays the websocket back across Machines.

## Required Secrets

Create scoped tokens; do not use a personal all-app token.

```sh
fly apps create opus-strike-server-autoscaler --org personal
fly tokens create deploy -a opus-strike-server
fly tokens create readonly personal
fly secrets set -a opus-strike-server-autoscaler --stage \
  FAS_API_TOKEN="FlyV1 ..." \
  FAS_PROMETHEUS_TOKEN="FlyV1 ..."
```

`FAS_PROMETHEUS_ADDRESS` is configured in `fly.autoscaler.toml` as `https://api.fly.io/prometheus/personal`.

## Deploy

Deploy server metrics first, then the autoscaler:

```sh
cd apps/server
fly deploy -a opus-strike-server -c fly.toml
fly deploy -a opus-strike-server-autoscaler -c fly.autoscaler.toml --ha=false
```

The autoscaler must run as a single Machine. Do not deploy it with HA enabled unless the reconciler is redesigned for leader election.

## Non-Browser Verification

Local repository checks:

```sh
pnpm --filter @voxel-strike/server test:autoscaler
pnpm --filter @voxel-strike/server test:distributed-runtime
pnpm --filter @voxel-strike/server typecheck
pnpm --filter @voxel-strike/server build
fly config show --local -c fly.toml --toml
fly config show --local -c fly.autoscaler.toml --toml
```

The autoscaler test covers Prometheus formatting, representative metric values, no user-identifying metric output, the created-Machine guard, and the two-step scale-down sequence. The distributed runtime test covers Fly Replay owner routing, stale owner rejection, and Redis TTL expiry for process routes.

Local HTTP verifier against a running dev server:

```sh
AUTOSCALER_SERVER_URL=http://127.0.0.1:2579 \
  pnpm --filter @voxel-strike/server verify:autoscaler-live \
  --skip-prometheus \
  --skip-fly-status
```

Optional pinned-image config smoke:

```sh
docker run --rm --platform linux/amd64 \
  -v "$PWD/fly-autoscaler.yml:/etc/fly-autoscaler.yml:ro" \
  -e FAS_API_TOKEN=dummy \
  -e FAS_PROMETHEUS_TOKEN=dummy \
  -e FAS_PROMETHEUS_ADDRESS=http://127.0.0.1:1 \
  flyio/fly-autoscaler:0.3.1 eval --config /etc/fly-autoscaler.yml
```

This should fail only when the image tries to query the dummy Prometheus URL, after the YAML keys and `initial-machine-state` value have parsed successfully. On Apple Silicon, `--platform linux/amd64` is required because this image tag does not publish an arm64 manifest.

Live Fly checks after deploy:

```sh
curl -fsS https://opus-strike-server.fly.dev/metrics
pnpm --filter @voxel-strike/server verify:autoscaler-live --skip-autoscaler-status
fly logs -a opus-strike-server-autoscaler
fly machine list -a opus-strike-server
fly status -a opus-strike-server
fly config show -a opus-strike-server
```

Once the autoscaler app exists, drop `--skip-autoscaler-status` so the verifier also confirms the autoscaler is a single Machine.

Confirm these before raising production caps:

- `demand_players` and `running_machines` return one numeric value each in Fly Prometheus.
- `demand_players` tracks Colyseus local CCU; lobby participant metrics remain observability/readiness only.
- A simulated demand increase creates a stopped `opus-strike-server` Machine.
- Fly Proxy starts the stopped Machine after connection load crosses service limits.
- Demand decrease first leaves running Machines alone, then destroys only excess stopped Machines.
- Fly Replay routes continue to point clients to the owning Colyseus process.

For the first real traffic window, keep the demand cap at `3`. After metrics look stable, change the cap in `fly-autoscaler.yml` from `3` to `6`, deploy, and observe another full traffic window.

To create enough lobby demand for the staging check:

```sh
AUTOSCALER_SERVER_URL=wss://opus-strike-server.fly.dev \
  AUTOSCALER_DEMAND_CLIENTS=49 \
  AUTOSCALER_DEMAND_HOLD_MS=180000 \
  pnpm --filter @voxel-strike/server simulate:autoscaler-demand
```

Production disables guest play by default. Use `AUTOSCALER_AUTH_TOKEN` for a real test account token, or explicitly set `ALLOW_GUEST_PLAY=true` for a guest-play rollout test. The simulator creates one lobby per connection, holds those sockets for the requested interval, and leaves the rooms on exit.

## Rollback

Rollback should disable only the autoscaler app:

```sh
fly scale count 0 -a opus-strike-server-autoscaler
fly scale count 1 -a opus-strike-server
```

Keep `auto_stop_machines = "stop"`, `auto_start_machines = true`, and `min_machines_running = 1` on the server app.

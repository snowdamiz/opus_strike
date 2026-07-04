# Server Action Replay Recording Plan

## Reader And Action

Reader: an implementation engineer adding an admin-only gameplay recording pipeline to Slop Heroes.

Post-read action: implement a pipeline that runs a special bot match on production infrastructure, records enough authoritative match data to replay it later, and renders a smooth MP4 with the game world, camera, HUD, and gameplay UI without requiring the local laptop to play and record at the same time.

## Short Answer

Yes, this should work and should allow smoother recordings.

The key is to separate playing from recording. Let the production server run the bot match and write a recording artifact. Then render that artifact offline, frame by frame, on a machine that can take as long as it needs. If the renderer takes five minutes to produce one minute of video, the final MP4 can still be perfectly smooth because video time is based on exported frame order, not wall-clock render speed.

Do not make the first version depend only on map seed plus bot actions. In the current codebase, that is too fragile because server and client behavior still depends on wall-clock time, runtime scheduling, and random visual effects. The reliable first version should record the authoritative observer stream plus a bot action log. The observer stream becomes the source of truth for rendering; the action log becomes useful for debugging, future deterministic replay, and highlight search.

## Confirmed Current State

- The game server already runs Colyseus game rooms with a fixed 50 ms tick interval.
- Game rooms already accept direct creation options for bot assignments, map identity, match mode, gameplay mode, match perspective, streamer-managed bot games, endless matches, and zero required human players.
- Streamer Mode already has admin-gated server routes, signed hidden observer tickets, observer seats, streamer-managed bot games, bot deathmatch, fixed aerial camera mode, and periodic map rotation.
- Streamer bot deathmatch already creates a Team Deathmatch room with hard bots, streamer-specific bot profiles, third-person perspective, fixed aerial camera mode, and endless match behavior.
- The room already broadcasts the data needed to hydrate a late-joining observer: match snapshots, player vitals, player transform streams, player interest, powerup state, phase changes, and gameplay events.
- Hidden streamer observers are not inserted into the normal player roster and can only send a small allowlist of observer messages.
- The client already has message handlers that hydrate the game store from server messages, a game canvas, a streamer camera director, map warmup, and streamer map-transition handling.
- The client currently suppresses the normal player HUD while Streamer Mode is active. A recording playback mode must deliberately render HUD from a selected recording perspective.
- Map identity already flows through seed, theme id, size, profile id, pregenerated map id, and artifact id.
- There is movement command infrastructure and anti-cheat trace replay, but there is no full recording artifact, replay player, or MP4 exporter.

## Goals

- Produce smooth MP4 gameplay captures without requiring OBS to run during live play.
- Reuse existing streamer-managed bot games instead of creating fake human clients.
- Capture a recording on production or production-like infrastructure where the game can run without local laptop pressure.
- Render the actual game client UI and world so the final video includes HUD, score, timers, cooldowns, kill feed, minimap, and other overlays.
- Make the first implementation reliable even if full deterministic simulation replay is not ready.
- Preserve enough inputs and checkpoints to make deterministic replay possible later.

## Non-Goals

- No browser validation by the implementation agent. Manual browser review stays with the user.
- No worktrees or branches unless explicitly requested.
- No rewrite of the game simulation.
- No OBS integration.
- No public user-facing recording tools in the first slice.
- No ranked, wagered, or real-player capture in the first slice. Start with admin-only bot recordings.

## Recommended Architecture

Use a two-layer recording:

1. Authoritative observer stream: exact server messages that a hidden observer would need to render the match.
2. Server action log: bot inputs, accepted movement commands, high-level ability/attack events, and deterministic metadata.

The MP4 renderer should use the observer stream for the first working version. That means the replay does not have to perfectly recompute gameplay from the original actions; it only has to apply the same state/event messages the live client already understands.

The server action log should still be captured from day one because it makes recordings inspectable and gives a path toward smaller deterministic replays later.

## Pipeline

1. Admin requests a recording job.
2. Server creates or selects a streamer-managed bot deathmatch room with recording enabled.
3. Game room attaches a virtual recording observer.
4. Recorder writes initial snapshots, match stream messages, bot actions, map identity, room options, build id, and recording settings.
5. Room runs until the requested duration, a max event count, or an explicit stop.
6. Recording artifact is finalized and stored.
7. Offline renderer loads the artifact in a recording playback client.
8. Renderer advances a virtual clock at fixed FPS, captures one image per video frame, and pipes frames to FFmpeg.
9. FFmpeg writes the MP4 and stores or returns the result.

## Recording Artifact

Use a directory or object-storage prefix with explicit files. Keep the format append-friendly while the match is live.

Recommended files:

- `manifest.json`: recording version, game build id, server build id, room id, match id, created time, requested duration, FPS, viewport, device pixel ratio, camera mode, HUD mode, map identity, game mode, match perspective, bot assignments, and artifact references.
- `events.ndjson`: ordered observer stream messages. Each row should include recording time, server time, tick, message type, and payload.
- `actions.ndjson`: ordered server action records. Each row should include tick, server time, player id, action kind, input buttons, look yaw, look pitch, selected ability slot, combat target if known, bot intent if available, and compression metadata.
- `checkpoints.ndjson`: periodic full snapshots for seeking, drift detection, and recovery from truncated event logs.
- `summary.json`: duration, message counts, player list, winner, notable events, output MP4 ids, and finalization status.

The event stream should capture at least these message families:

- Match state: `matchSnapshot`, `phaseChange`, `roundEnd`, `gameEnd`, `matchCancelled`.
- Player state: `playerVitals`, `playerTransformsV2`, `playerInterest`, `playerJoined`, `playerLeft`.
- World state: `powerupState`, `powerupCollected`, `voidZoneCreated`, `voidZoneExpired`, flag events, safe-zone and Battle Royal drop state as carried by match snapshots.
- Combat events: `abilityUsed`, `playerDamaged`, `playerKilled`, downed/revive events, shield events, primary magazine state, flamethrower state, and batched player events.

Do not record ping probes, heartbeats, auth tickets, session cookies, CSRF tokens, voice tokens, or player report payloads.

## Server Recording Capture

Add a recording runtime owned by the game room. It should behave like a virtual hidden observer rather than a real websocket client.

Responsibilities:

- Capture the same current snapshots sent to a streamer observer at recording start.
- Capture global broadcasts once.
- Capture per-observer player state streams from a full-visibility recording perspective.
- Record bot-generated `PlayerInput` after the bot brain creates it and before gameplay systems consume it.
- Record high-level combat and objective events from the existing broadcast paths.
- Flush writes outside hot gameplay work where possible.
- Stop and finalize cleanly on duration, room disposal, fatal room error, or admin stop.

Prefer a virtual observer because it avoids websocket jitter, browser connection failures, and observer seat limits. It also lets the recorder run even when nobody is watching live.

## Server Actions

For bot-only recordings, the important action is the server-generated bot input for each simulated bot. Record it as intervals when possible:

- Movement buttons.
- Look yaw and pitch.
- Primary fire and secondary fire.
- Ability slots.
- Ultimate.
- Crouch, jump, sprint, and other movement flags.
- Tick range for repeated input.
- Bot intent, target id, and route target as optional debug fields.

For future human or mixed recordings, record accepted movement command packets after validation, not raw inbound packets before rejection.

Action logs alone are not enough for the first renderer because current gameplay depends on wall-clock time, runtime scheduling, random choices, async map loading, delayed ability releases, and client-side visual randomness. They become enough only after the simulation and renderer have injectable clocks and seeded RNG.

## Playback Client

Add a recording playback mode to the client rather than trying to replay through the live network provider.

Recommended shape:

- Add a small message bus interface with `onMessage` and `emit`.
- Adapt the existing Colyseus room listener setup to the message bus.
- Add a recording adapter that reads `events.ndjson` and emits the same message types at the correct virtual time.
- Add a recording app phase so the normal game canvas can mount without joining a room.
- Disable gameplay input, matchmaking, reconnect persistence, voice, reports, and server pings in recording mode.
- Load map warmup from the recording manifest before starting playback.
- Drive the existing streamer camera director or a selected fixed camera from recording settings.

This is a scoped refactor: the goal is to reuse existing message handlers, not duplicate the whole network hydration path.

## HUD And UI

The current app hides HUD while Streamer Mode is active. Recording mode should be separate from Streamer Mode.

HUD requirements:

- Render HUD during recording playback when requested.
- Pick a HUD subject player from the recording manifest or camera target.
- Let HUD selectors resolve against the HUD subject instead of assuming the local websocket player.
- Keep spectator/director camera independent from HUD subject when needed.
- Support at least three HUD modes: hidden, selected-player HUD, and cinematic observer HUD.

The first slice should use selected-player HUD because it reuses the existing HUD with minimal changes. A later cinematic observer HUD can show team score, timer, kill feed, minimap, and camera target without pretending to be a player.

## Offline MP4 Renderer

Use a Node script that launches the recording playback client at a fixed viewport and exports frames.

Recommended flow:

1. Start or serve the built client.
2. Open a recording playback URL with recording id, viewport, FPS, HUD mode, and quality settings.
3. Wait for map warmup and first recording checkpoint.
4. For each video frame, tell the page to seek or step to the exact recording timestamp.
5. Wait for the render loop to settle.
6. Capture the full viewport as an image.
7. Pipe images into FFmpeg.
8. Write H.264 MP4 with `yuv420p` pixel format for broad compatibility.

The renderer can run slower than realtime. That is the point. On a weak local computer the export might take a while, but the video will not have gameplay lag. For faster turnaround, run the render worker on a stronger cloud machine instead of the game server.

Do not render MP4s on the same production machines serving active matches. Use a worker queue or separate machine class so recording export cannot cause player-facing lag.

## Admin API

Add admin-only recording endpoints. Reuse the same authorization posture as Streamer Mode.

Suggested endpoints:

- `POST /recordings/bot-match`: create a bot recording job.
- `GET /recordings`: list recent jobs and artifacts.
- `GET /recordings/:id`: fetch manifest and status.
- `POST /recordings/:id/stop`: stop capture early.
- `POST /recordings/:id/render`: enqueue MP4 rendering.
- `GET /recordings/:id/download`: download the finished MP4 or return a signed storage URL.

All mutation endpoints should be admin-only, no-store, rate-limited, and protected against CSRF when cookie-authenticated.

## Storage And Retention

Start with local filesystem storage for development and object storage for production.

Retention policy:

- Keep raw event/action artifacts for a short window, such as 7 to 14 days.
- Keep finalized MP4s longer, such as 30 to 90 days.
- Allow explicit admin deletion.
- Store no auth tokens or private user session data.
- Redact player identifiers if real-player recording is ever added.

## Implementation Slices

1. Recording artifact types and writers
   - Define manifest, event row, action row, checkpoint row, and summary types.
   - Add append-only NDJSON writer with finalization and failure states.
   - Add unit tests for serialization and truncation recovery.

2. Virtual recording observer
   - Add recording options to game room creation.
   - Attach a recording runtime to streamer-managed bot rooms.
   - Record initial snapshots and the observer-visible server stream.
   - Record bot action rows from generated bot inputs.

3. Admin bot recording route
   - Add admin-only create/status/stop endpoints.
   - Reuse streamer bot assignment generation and capacity admission.
   - Add duration limits and cleanup.

4. Playback message bus
   - Extract the client game-room message listener setup behind a small message bus.
   - Add a recording adapter that feeds recorded events into existing handlers.
   - Add recording app phase and map warmup from manifest.

5. Recording HUD mode
   - Add HUD subject selection.
   - Render selected-player HUD in recording playback.
   - Keep input disabled.

6. Renderer CLI
   - Add a script that opens the playback client, steps a virtual recording clock, captures frames, and runs FFmpeg.
   - Support resolution, FPS, duration, HUD mode, and output path.

7. Hardening
   - Add job queue, object storage, retention cleanup, render worker isolation, and artifact checksums.
   - Add deterministic replay improvements only after the observer-stream MVP is producing useful video.

## Verification Plan

Use code-level and script-level verification first. Leave visual browser validation to the user.

- Unit test artifact writers and readers.
- Unit test recorder redaction so auth, tickets, voice tokens, and pings are not stored.
- Integration-test a short bot recording and assert it includes manifest, initial snapshots, transforms, vitals, events, actions, and summary.
- Unit test playback reducer behavior by applying a small event fixture to the client store.
- Renderer smoke-test can generate a tiny frame sequence and assert FFmpeg produces a valid MP4, but visual acceptance should be manual.
- Compare checkpoint hashes between capture and playback state to detect drift.

## Deterministic Replay Later

After the MVP works, reduce artifact size by making replay deterministic.

Needed changes:

- Inject server simulation clock instead of reading wall-clock time directly.
- Inject seeded RNG for room setup, bot AI, combat jitter, map rotation, and any random runtime choices.
- Make delayed ability releases tick-based rather than timeout-based where possible.
- Record initial RNG seeds and deterministic room options.
- Add a headless server replay runner that consumes action logs and emits checkpoint hashes.
- Add client recording clock hooks for HUD, effects, visual interpolation, and React Three Fiber time.
- Seed or record client visual randomness for repeatable particles.

The target deterministic format can eventually be map identity plus initial room options plus action intervals plus periodic checkpoints. Until then, keep the authoritative observer stream.

## Risks

- If only actions are recorded, replays will drift because current code uses wall-clock time and random values in several gameplay and rendering paths.
- If rendering runs on production game machines, exports can harm live matches.
- If recording mode reuses Streamer Mode directly, the HUD will stay hidden.
- If playback duplicates network handlers instead of refactoring them, it will fall out of sync with live gameplay messages.
- If full-resolution screenshots are written to disk before encoding, exports can use a lot of storage. Prefer piping to FFmpeg after the first version is debugged.

## Open Questions

- Should the first MP4 include game audio, or is silent video acceptable?
- What default output should be used: 1080p60, 1080p30, or 1440p60?
- Should HUD follow the current camera target, a fixed bot, or a manually selected hero?
- Where should production artifacts live: local volume, S3-compatible storage, or another object store?
- Should render jobs run on demand only, or automatically after every recording finishes?

## Recommendation

Build the observer-stream MVP first. It should produce smooth videos soonest because it reuses the current server authority and client rendering path without requiring a perfect deterministic simulation. Capture server actions alongside it from the beginning, then graduate to input-only deterministic replay once clocks and randomness are injectable.

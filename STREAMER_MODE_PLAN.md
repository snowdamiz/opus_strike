# Streamer Mode Plan

## Reader And Goal

Reader: an implementation engineer adding admin-only Streamer Mode to Slop Heroes.

Post-read action: implement a settings toggle named Streamer Mode that is visible only to game admins, joins eligible live games as a hidden cinematic observer, and maintains a fallback random bot game while no real-player game is live.

## Confirmed Current State

- Settings are stored client-side in a persisted Zustand settings store and edited through the existing settings dialog.
- The normal authenticated user session does not currently expose admin status. Admin access is enforced server-side by the existing admin wallet gate and admin API middleware.
- Custom lobbies support one regular observer slot. That observer becomes a normal room player with role `observer`, appears in room state, consumes lobby/game capacity, and is visible to clients.
- Game rooms already understand combat players versus observers. Observers are excluded from match ledger participation and many gameplay transitions.
- Game room population metadata currently counts every non-bot room player as a human. It does not distinguish combat humans, regular observers, and future hidden streamer observers.
- Quick play supports Capture the Flag, Team Deathmatch, and Battle Royal. Custom lobbies support Capture the Flag and Team Deathmatch.
- Server-side bots already come from lobby/game assignments and can run full gameplay without client-side bot control.
- Game rooms can be created with bot assignments and `requiredHumanPlayers` set to zero, but the room tick loop is started from a client join path.
- The client already has free-flight observer movement, first-person and third-person camera placement helpers, and a Battle Royal teammate spectator camera.
- The app currently has a normal match loading screen, match summary screen, and app phases for menu, matchmaking, lobby, map vote, match loading, and in-game. There is no dedicated streamer loading phase.

## Product Behavior

- Add a setting toggle labeled `Streamer Mode` in the settings dialog.
- Show the toggle only after the server confirms the current session belongs to a game admin.
- Treat the client-side setting as a preference only. Every streamer join, bot-game creation, and room selection decision must be server-authorized.
- When the toggle turns on, Streamer Mode starts immediately and keeps running until the toggle is turned off, the admin signs out, or the server rejects the admin session.
- If at least one eligible real-player game is live, join one as a hidden streamer observer.
- If no eligible real-player game is live, keep one random streamer-managed bot game available and observe it.
- Use a special hidden observer seat in addition to the existing regular observer slot. It must not consume combat capacity, the regular observer slot, rewards, wagers, ranked eligibility, matchmaking counts, or visible roster space.
- Switch games through a dedicated streamer loading state. A game ending, becoming unavailable, or being superseded by a better real-player game should not dump the admin back to the menu.
- Leave browser/UI validation to manual user testing. Automated verification should use unit tests, integration scripts, typecheck, and build.

## Definitions

Eligible real-player game:

- A `game_room` that is not marked as streamer-managed.
- Has at least one connected combat human.
- Is in a live or imminently live phase: hero select, countdown, deployment, playing, or round end.
- Is not cancelled, disposed, full only because of combat/regular seats, or already ended.

Streamer-managed bot game:

- A direct game room created by the streamer orchestration service.
- Marked in room metadata as streamer-managed.
- Uses random gameplay mode, map seed, map theme, match perspective, and bot assignments.
- Uses `requiredHumanPlayers: 0`.
- Exists only while at least one admin has Streamer Mode enabled or while an enabled admin is switching into it.

Hidden streamer observer:

- A Colyseus client connected to a game room with a signed streamer observer ticket.
- Not inserted into the room `players` schema.
- Not announced with player join/leave messages.
- Receives snapshots, transform streams, vitals, match state, map state, and game-end messages.
- Cannot send combat movement, ability, chat, voice, report, ready, team, or dev gameplay commands through the normal player paths.

## Architecture

### Admin Gate

Extract the existing admin wallet check into a small reusable server helper so auth routes, admin routes, and streamer routes all answer the same question.

Recommended shape:

- Add an `isGameAdmin` boolean to the authenticated session response, or add a small no-store admin-status endpoint.
- Keep the source of truth server-side using the configured admin wallet.
- Do not rely on client wallet address comparisons for authorization.
- When a non-admin has an old saved setting with Streamer Mode enabled, sanitize it back to false and never start the streamer controller.

### Settings UI

Add `streamerModeEnabled` to client settings with default `false`.

In the settings dialog:

- Add `Streamer Mode` under Gameplay or Account. Gameplay is preferable because it changes the play experience, but render it only when the server confirms admin status.
- Save the toggle like other settings.
- On enable, call the streamer controller.
- On disable, disconnect the streamer observer and return to menu or the previous non-streaming state.
- If the admin signs out, immediately disable the controller and clear the toggle in memory.

Small scoped refactor:

- Confirm the current `observerFlightSpeed` value typo is not persisted as user settings.
- Rename the value from `hight` to `high` and remove the compatibility alias if no persisted storage depends on it.

### Streamer Server API

Add a streamer route group with admin-only endpoints:

- `GET /streamer/status`: returns whether Streamer Mode is allowed, current observed room if any, and whether a fallback bot game exists.
- `POST /streamer/next`: selects an eligible real-player game or creates/returns a fallback bot game, then returns a signed streamer observer ticket and room connection target.
- `POST /streamer/stop`: releases any server-side streamer session bookkeeping for this admin.

The route group should:

- Use the same cookie auth and admin wallet authorization as the admin API.
- Apply no-store caching.
- Rate-limit by admin user id.
- Avoid CSRF only for read-only endpoints; require CSRF or an equivalent signed short-lived action token for mutations if the route is cookie-authenticated.
- Never reveal hidden observer tickets to non-admins.

### Room Metadata

Extend game-room metadata with explicit counts and flags:

- `combatHumanCount`
- `regularObserverCount`
- `streamerObserverCount`
- `streamerManagedBotGame`
- `streamerManagedByUserId` if useful for cleanup, preferably not exposed to non-admin clients
- `phase`
- `gameplayMode`
- `matchPerspective`
- `mapSeed`
- `mapThemeId`
- `mapSize`
- `mapProfileId`

Update population counting so existing human and participant metrics remain compatible, but streamer selection can reliably exclude observers and fallback games.

### Hidden Observer Join

Add a signed streamer observer ticket separate from normal game-entry tickets.

Ticket claims should include:

- Version.
- Admin user id.
- Game room id.
- Issued and expiry timestamps.
- Nonce.
- Purpose: streamer observer.

Game-room auth should accept this ticket before the normal lobby entry-ticket path:

- Verify the ticket signature, expiry, room id, nonce, and admin user.
- Bypass direct game-room join rejection only for valid streamer observer tickets.
- Do not call normal entry-ticket consumption or reconnect participant logic.

Game-room join should branch for streamer observers:

- Store the client in a dedicated streamer observer registry.
- Do not create a `Player`.
- Do not call match participant registration, voice registration, movement authority setup, player join broadcast, duplicate combat-session cleanup, or reconnect ticket persistence.
- Send the same current world snapshots that a late-joining observer needs.
- Start the tick loop if needed.
- Run phase transition checks so bot-only fallback rooms can begin.
- Increase `maxClients` by the configured streamer observer slot count while keeping capacity cost unchanged.

Message handlers should early-return for streamer observers unless the message is explicitly allowed. Initially the only allowed client-to-server message should be ping response or a dedicated streamer heartbeat.

### Real-Game Selection

Selection should run server-side from live `game_room` metadata.

Priority:

1. Prefer games in active gameplay phases over hero select.
2. Prefer real-player games over fallback bot games.
3. Prefer higher combat human count.
4. Prefer the current room if it is still eligible to avoid unnecessary switching.
5. Spread repeated selections across rooms with lightweight jitter so multiple admins do not always watch the same match.

The client should poll or receive a heartbeat interval from the streamer API. A 2-5 second cadence is enough; game-end and room-leave events can trigger immediate refresh.

### Fallback Bot Games

Add a streamer bot-game orchestrator on the server.

Responsibilities:

- Query for existing eligible real-player games.
- Query for an existing streamer-managed bot game.
- Create one if no real-player game exists and no usable bot game exists.
- Randomize gameplay mode across Capture the Flag, Team Deathmatch, and Battle Royal.
- Build bot assignments from mode rules, with team-balanced bot ids, names, difficulties, heroes, skins, and profiles.
- Use capacity admission before creating the fallback room.
- Mark fallback rooms in metadata.
- Dispose or mark fallback rooms as draining after real-player games become available and no streamer observer remains in the fallback room.
- When a fallback bot game reaches game end, create a new random fallback before returning the next ticket.

Use direct game-room creation rather than fake lobby creation. That avoids artificial player tickets, fake lobby hosts, and extra lobby lifecycle code.

### Client Streamer Controller

Add a streamer controller owned near the network provider or in a focused hook mounted by the app shell.

State should include:

- Enabled or disabled.
- Admin allowed or denied.
- Current observed room id.
- Whether the current room is real-player or fallback bot.
- Loading state and reason.
- Last switch time.
- Last error.

When enabled:

1. Request the next streamer target from the server.
2. Join the room with the returned streamer observer ticket.
3. Set app phase to `streamer_loading`.
4. Seed the game store with a local-only hidden observer identity so game rendering can mount without a schema player.
5. Reuse match map warmup and module preload paths.
6. Set app phase to `in_game` once the streamer scene is ready.
7. Start the cinematic camera director.

When the current game ends:

1. Set app phase to `streamer_loading`.
2. Keep the previous canvas mounted until the new target is ready if feasible.
3. Request the next target.
4. Join the new room.
5. Crossfade or hard cut only after world warmup reaches interactive readiness.

Do not save streamer observer sessions into the normal running-game reconnect storage.

### Cinematic Camera Director

Create a dedicated streamer camera director component instead of extending normal local player control.

Inputs:

- Current players from the game store.
- Map metadata.
- Game phase.
- Gameplay mode.
- Flags, safe zone, drop state, combat activity, and player vitals where available.

Shot types:

- First-person player view: camera at target eye height, following target yaw/pitch; hide or fade the target model locally so the camera is not inside geometry.
- Third-person player chase: reuse the third-person camera placement helper with collision.
- Combat orbit: track a cluster of nearby opposing players and orbit from a readable angle.
- Objective shot: focus on flags, dropped flags, carriers, capture areas, Battle Royal drop/safe-zone moments, or powerups.
- Aerial flyover: interpolate between high points over active areas and look at action clusters.
- Establishing shot: wide camera over the map during loading, hero select, countdown, or after a game ends.

Director rules:

- Randomize shot duration, target, and shot type, but avoid back-to-back identical shots.
- Prefer alive or downed real players when observing real-player games.
- Include bots in fallback games.
- Avoid spectating hidden streamer observers, regular observers, dead players unless no better target exists, and players with missing transforms.
- Smooth camera position and look-at transitions.
- Recover instantly when a target disappears.
- Keep HUD minimal and never show admin-only controls or sensitive data in the stream.

### Loading State

Add a new app phase for streamer loading.

The streamer loading screen should be distinct from the normal match loading screen:

- Eyebrow: `Streamer Mode`
- Title examples: `FINDING LIVE GAME`, `SPINNING UP BOT MATCH`, `SWITCHING FEED`
- Stages: target selection, room ticket, world generation, camera warmup.
- It should not show match summary or normal player reconnect controls.

## Implementation Slices

1. Admin visibility and setting persistence
   - Add admin status to the authenticated client.
   - Add `streamerModeEnabled` to sanitized settings.
   - Render the toggle only for game admins.
   - Disable and clear Streamer Mode on admin loss or sign-out.

2. Streamer metadata and counting
   - Add combat-human, regular-observer, and streamer-observer counts.
   - Mark streamer-managed bot rooms.
   - Add focused tests for population counts and metadata snapshots.

3. Streamer observer ticket and hidden join path
   - Add signed streamer observer ticket helpers.
   - Add game-room auth/join branching.
   - Add the streamer observer registry.
   - Block normal gameplay, chat, voice, and report handlers for streamer observers.
   - Add room tests proving hidden observers are invisible and do not affect capacity, readiness, rewards, or reconnect.

4. Server target selection and fallback bot game orchestration
   - Add streamer routes.
   - Select real-player game targets from metadata.
   - Create direct fallback bot rooms when needed.
   - Dispose/drain stale fallback rooms.
   - Add tests for real-game preference, fallback creation, ended-room replacement, capacity failure, and non-admin rejection.

5. Client streamer controller
   - Add streamer state and lifecycle around the network provider.
   - Join rooms with streamer observer tickets.
   - Add `streamer_loading`.
   - Avoid normal running-game reconnect storage.
   - Add non-browser tests for controller state transitions where practical.

6. Cinematic camera director
   - Build the shot planner.
   - Implement first-person, third-person, aerial, combat orbit, objective, and establishing shots.
   - Hide the target model for first-person shots.
   - Add deterministic unit tests for shot selection and target fallback.

7. Cleanup and scoped refactors
   - Remove any duplicated observer logic that becomes obsolete.
   - Confirm and clean the observer flight-speed typo if it is not persisted.
   - Keep regular lobby observer behavior unchanged.

## Verification Plan

Automated:

```bash
pnpm typecheck
pnpm build
pnpm --filter @voxel-strike/server test:room-population
pnpm --filter @voxel-strike/server test:room-metadata-snapshot
pnpm --filter @voxel-strike/server test:room-join
pnpm --filter @voxel-strike/server test:match-start
pnpm --filter @voxel-strike/server test:lobby-game-start
pnpm --filter @voxel-strike/server test:bot-runtime
pnpm --filter @voxel-strike/server test:bot-ai
pnpm --filter @voxel-strike/client test:movement
pnpm --filter @voxel-strike/client test:visual-store
```

Add new focused scripts:

- Streamer ticket signing and replay rejection.
- Admin-only streamer API authorization.
- Hidden observer join invisibility.
- Streamer observer extra seat capacity.
- Real-player room selection.
- Fallback bot room creation and replacement after game end.
- Streamer controller state transitions.
- Camera director target and shot selection.

Manual browser pass, left to the user:

- Toggle appears only for the admin account.
- Non-admin accounts never see or can activate Streamer Mode.
- Streamer joins a real live game when one exists.
- Streamer falls back to a random bot game when no real game exists.
- Switching between ended games and new/fallback games shows the streamer loading state.
- First-person, third-person, aerial, objective, and combat-orbit shots feel cinematic and do not expose admin UI.

## Edge Cases

- Admin turns Streamer Mode on while already in a player match: either block with a clear settings-row status or leave the player match first; do not run a player session and streamer observer session in the same client state.
- The current real-player game ends while a fallback bot game is being created: prefer the newest eligible real-player game if one appears before the fallback join completes.
- A streamer-managed Battle Royal room is too expensive for current capacity: fall back to Capture the Flag or Team Deathmatch and report the capacity reason in streamer status.
- Multiple admins enable Streamer Mode: allow multiple hidden observers only up to the configured special seat count per room, then spread them across eligible rooms or create a fallback.
- Admin auth expires mid-stream: disconnect the hidden observer, clear streamer state, and hide the toggle on the next settings render.
- Normal observer slots stay unchanged and still work for custom lobbies.

## Non-Goals

- No public spectator mode.
- No recording, clipping, transcoding, or external streaming integration.
- No browser automation tests.
- No changes to ranked eligibility, wager settlement, rewards, or match stats except explicitly excluding hidden streamer observers.
- No fake users or fake lobbies for fallback bot games.

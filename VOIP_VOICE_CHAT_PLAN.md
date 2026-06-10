# VOIP Voice Chat Plan

## Reader And Goal

This plan is for an internal engineer adding player voice chat to Opus Strike.

After reading this, they should be able to implement secure team voice in vertical slices without pushing audio through the game-state WebSocket or coupling media transport to the server tick loop.

## Recommendation

Use WebRTC for browser voice and run voice through an SFU, with LiveKit as the recommended first implementation.

For this project, the practical industry-standard shape is:

- Browser microphone capture and playback through WebRTC.
- Opus audio codec, using the browser/WebRTC stack instead of custom encoding.
- An SFU for multi-party rooms, so each player publishes one audio stream and subscribes to the streams they are allowed to hear.
- STUN/TURN support for NAT and firewall traversal.
- Short-lived backend-issued voice tokens, scoped to a lobby or match/team voice room.
- Colyseus remains the game authority and lifecycle coordinator; it does not carry voice packets.

LiveKit is the best first choice because it provides the SFU server, JavaScript client SDK, Node server SDK for token generation, room management APIs, reconnect handling, and self-hosted or managed deployment paths. Mediasoup is a valid alternative if the team wants a lower-level SFU and is willing to own more signaling, room management, operational work, and client media plumbing.

Do not build raw VOIP over Colyseus/WebSocket. That would recreate codec, jitter buffer, packet loss, echo cancellation, NAT traversal, encryption, and device permission problems that WebRTC already solves.

Do not start with full peer-to-peer mesh voice. It can work for very small groups, but it scales poorly, complicates NAT traversal, can expose peer network details, and gives the game server less control over who can hear whom.

## Current Architecture Review

Opus Strike already has a clean split between a React/Vite browser client and a TypeScript Colyseus server. The server owns lobbies, teams, map voting, match creation, game entry tickets, player lifecycle, and authoritative gameplay state. That is the right place to authorize voice access.

The lobby already creates a game room from player assignments and gives each human player a short-lived entry ticket. Voice should follow the same pattern: clients request a voice token only after the server has verified their current lobby or match membership.

The game already has team assignment, duplicate-session handling, kicks, lobby leave, game leave, and server-side chat. Voice lifecycle should attach to those existing events:

- When a player joins a lobby, they may receive a lobby voice token if lobby voice is enabled.
- When a match starts, each player receives a token for only their team's match voice room.
- When a player leaves, is kicked, or is replaced by a duplicate session, the server removes or disconnects their voice participant.
- When a match ends, the client disconnects from the team voice room and may optionally join a post-match or lobby room later.

The client already has an audio settings tab, local sound effects, music volume, and a shared Web Audio context. Voice should become a separate audio category with its own input/output controls instead of being mixed into SFX or music.

## Target User Experience

MVP voice is team-only match voice.

Players can:

- Join team voice when they enter a match.
- Mute and unmute their microphone.
- Use push-to-talk.
- See who is speaking.
- Mute specific teammates locally.
- Deafen all voice locally.
- Control voice output volume separately from SFX and music.
- Recover gracefully if microphone permission is denied.

Players should never hear the enemy team during a live match. Enforce that at the voice room/token layer, not only in the UI.

Lobby-wide voice and post-match all-team voice are useful later, but team voice should land first because it is the core gameplay need and has the clearest security boundary.

## Voice Room Model

Use separate LiveKit rooms for security boundaries.

Suggested room names:

- `opus:<env>:lobby:<lobbyId>` for optional lobby voice.
- `opus:<env>:match:<gameRoomId>:red` for red team match voice.
- `opus:<env>:match:<gameRoomId>:blue` for blue team match voice.

Separate team rooms are intentionally simple: a client cannot subscribe to enemy voice if it never receives a token for the enemy voice room.

Participant identity should be stable within the current game identity model:

- Authenticated users: use server user id.
- Guests: use the server-assigned guest identity or session identity.
- Participant metadata: display name, Colyseus session id, team, lobby id, game room id, and whether the participant is a human player.

Bots should not join voice rooms.

## Server Integration

Add voice configuration to the server environment:

- `LIVEKIT_URL`: server-side LiveKit API URL.
- `LIVEKIT_WS_URL`: client-facing LiveKit WebSocket URL.
- `LIVEKIT_API_KEY`: server-side API key.
- `LIVEKIT_API_SECRET`: server-side signing secret.
- `VOICE_ENABLED`: feature flag.
- `VOICE_TOKEN_TTL_SECONDS`: short TTL, initially 5 to 10 minutes.

Add the LiveKit server SDK to the server package.

Add a voice service module responsible for:

- Creating scoped LiveKit access tokens.
- Verifying the requesting player is currently in the lobby or game room.
- Naming voice rooms consistently.
- Setting publish/subscribe permissions.
- Restricting publish sources to microphone where supported.
- Optionally creating rooms ahead of time with max participant limits and empty-room cleanup.
- Removing participants from voice rooms when game lifecycle events require it.

Expose token issuance through one of these approaches:

1. A Colyseus message such as `requestVoiceToken`, handled by the active lobby or game room.
2. An Express endpoint such as `POST /voice/token`, which validates the player's auth/session and active room membership.

Prefer the Colyseus message for the MVP because the room already knows current membership, team, lobby status, and match status. Use Express later if token refresh needs a cleaner HTTP flow.

Token grants for the MVP:

- `roomJoin: true`
- `room: <voice room name>`
- `canSubscribe: true`
- `canPublish: true`
- `canPublishData: false`
- microphone-only publishing where the SDK grant supports source restrictions

Do not allow clients to choose arbitrary voice room names. The server derives the room name from current room state.

## Client Integration

Add the LiveKit client SDK to the client package. Use the lower-level client SDK rather than prebuilt conferencing UI components so the game keeps full control of HUD, input, and styling.

Add a `VoiceProvider` or `useVoiceClient` hook that owns:

- LiveKit room connection.
- Token request and refresh.
- Local microphone track creation.
- Push-to-talk state.
- Mute/deafen state.
- Remote participant audio playback.
- Speaking indicators.
- Per-player mute list.
- Device lists and selected input/output devices.
- Cleanup on lobby leave, match leave, duplicate session, or disconnect.

Connect voice from the existing network lifecycle:

- On lobby join: optionally request a lobby token if lobby voice is enabled.
- On `gameStarting` or after game room join: disconnect lobby voice and join the assigned team voice room.
- On game leave: disconnect team voice.
- On duplicate session or kick: disconnect voice immediately.

Microphone permission should be requested from a user gesture, not page load. A good first flow is:

1. Player joins match.
2. HUD shows voice as available but muted.
3. Player presses the mic button or push-to-talk key.
4. Client requests microphone permission, publishes the microphone track, and updates local state.

## Settings And Controls

Extend the settings store with voice settings:

- `voiceEnabled`
- `voiceVolume`
- `micVolume`
- `voiceInputDeviceId`
- `voiceOutputDeviceId`
- `pushToTalkEnabled`
- `pushToTalkKey`
- `noiseSuppressionEnabled`
- `echoCancellationEnabled`
- `autoGainControlEnabled`
- `voiceActivationThreshold` if voice activation is added later

Add these settings to the existing Audio tab.

Default recommendation:

- Voice enabled: true.
- Microphone starts muted until the player explicitly unmutes or uses push-to-talk.
- Push-to-talk enabled by default for competitive play.
- Echo cancellation, noise suppression, and auto gain control enabled by default.
- Voice volume separate from SFX/music, still affected by master volume.

## HUD And UX

Add compact in-game voice UI:

- Local mic button with muted, live, connecting, permission denied, and disconnected states.
- Team voice roster indicators near the scoreboard or team list.
- Speaking rings or bars for active speakers.
- Local mute/deafen controls in the in-game menu.
- Per-player mute controls on scoreboard rows.
- A non-blocking permission error message if the browser denies microphone access.

Avoid modal prompts during combat. Voice should fail soft: the player can still play if the media server is down or mic permission is denied.

## Audio Mixing

Voice should be mixed separately from game SFX and music.

The implementation can start with SDK-provided remote audio elements, then apply a voice gain layer. If the SDK exposes raw media streams cleanly enough, route remote audio through the existing Web Audio context so master volume and voice volume are applied consistently.

Initial playback should be non-positional team radio voice. Do not add proximity or spatial voice in the MVP; it creates design questions about enemy eavesdropping, spectator states, and team-only fairness.

Later, proximity voice can be added as a separate mode using server-authorized room membership or selective subscription rules, but it should not weaken team-channel isolation.

## Lifecycle Rules

Lobby:

- Voice is optional in the first release.
- If enabled, all human lobby participants can join the lobby voice room.
- Team changes in lobby do not affect lobby voice.

Match:

- On match join, the server grants exactly one team room token.
- If the player's team changes, disconnect from the old team voice room and request a new token for the new team.
- Dead players remain in team voice for the MVP.
- Spectators should be subscribe-only or disabled until spectator rules exist.

Leave/kick/duplicate:

- Client disconnects voice immediately.
- Server attempts to remove the participant from the LiveKit room.
- Duplicate-session handling should remove the old voice participant before or during the old Colyseus session cleanup.

Reconnect:

- Client requests a fresh token after reconnecting to the lobby or game room.
- Do not reuse old tokens from local storage.

## Security And Privacy

Hard rules:

- Never expose LiveKit API secrets to the browser.
- Issue tokens only from the backend.
- Scope every token to one derived room.
- Use short token TTLs.
- Use WSS/HTTPS in production.
- Use separate team rooms for match voice.
- Do not record voice by default.
- Do not silently publish microphone audio.
- Show clear local mic state.
- Remove voice participants when gameplay session ownership changes.

Abuse controls for MVP:

- Local per-player mute.
- Local deafen.
- Host kick keeps removing a player from gameplay and voice.
- Server logs token issuance and voice lifecycle events without logging audio.

Future moderation:

- Block/mute persistence per account.
- Report flow that includes participant ids and timestamps.
- Optional rolling voice clips only if the product explicitly accepts the privacy, consent, storage, and legal obligations.

## Deployment

For local development, add a LiveKit service to the development environment or document how to run one beside the existing server. The client should also work with voice disabled when LiveKit is not configured.

For production, either:

- Use LiveKit Cloud for fastest launch and lower operational burden.
- Self-host LiveKit near the game server region.

If self-hosting, plan for:

- A public domain for LiveKit.
- TLS for the LiveKit endpoint.
- TURN/TLS for restrictive networks.
- UDP media port exposure.
- Monitoring for packet loss, RTT, participant counts, room counts, and server CPU/network usage.
- Regional placement near the game server to avoid making comms feel detached from match latency.

## Performance Targets

Initial limits:

- 4v4 team voice only.
- One published microphone track per player.
- Subscribe only to teammates during match.
- Keep audio bitrate conservative and rely on Opus/WebRTC behavior.
- Enable discontinuous transmission or SDK-equivalent silence optimization when available.

Operational metrics:

- Voice connection success rate.
- Microphone permission denied rate.
- Time from game join to voice connected.
- Participant reconnect count.
- Average RTT, jitter, packet loss, and concealed audio samples if exposed by the SDK.
- Media server outbound bandwidth per room.

Voice work should never block the game simulation. If voice fails, gameplay continues.

## Implementation Phases

### Phase 1: Voice Infrastructure Spike

Goal: prove token issuance and local connection without game UX polish.

Work:

- Add LiveKit server/client dependencies.
- Add server voice configuration and feature flag.
- Add a minimal voice service for room naming and token creation.
- Add a room-scoped `requestVoiceToken` message.
- Add a client voice hook that can connect, disconnect, mute, and publish mic audio.
- Keep the feature hidden behind `VOICE_ENABLED`.

Acceptance criteria:

- A player in a game room can request a token only for their own team voice room.
- A player cannot request the enemy room.
- Missing LiveKit config disables voice without crashing.
- No LiveKit secret is present in client bundles or client env.

### Phase 2: Match Team Voice MVP

Goal: make teammates able to talk during a match.

Work:

- Connect voice automatically after successful game room join, but keep mic muted until user action.
- Disconnect from voice on match leave, room leave, kick, and duplicate-session events.
- Add push-to-talk and mic mute state.
- Subscribe to remote teammate microphone tracks.
- Add local and remote participant state to a voice store.

Acceptance criteria:

- Red players only connect to red team voice.
- Blue players only connect to blue team voice.
- Leaving or being kicked disconnects voice.
- Push-to-talk publishes while held and mutes when released.
- Gameplay remains usable when LiveKit is down.

### Phase 3: Settings And HUD

Goal: make voice controllable and understandable.

Work:

- Add voice settings to the Audio tab.
- Add voice keybind support.
- Add HUD mic state and speaking indicators.
- Add scoreboard per-player mute.
- Add deafen and voice volume controls.
- Handle microphone permission denial gracefully.

Acceptance criteria:

- Players can change voice volume independently from SFX and music.
- Players can mute specific teammates.
- The HUD clearly shows local mic state.
- Permission denial does not trap the player in a modal or broken state.

### Phase 4: Lifecycle Hardening

Goal: align voice lifecycle with game authority.

Work:

- Remove LiveKit participants on server-side leave, kick, duplicate session, and room disposal.
- Add token TTL and refresh behavior.
- Add server logs for token issuance and participant cleanup.
- Add LiveKit webhook handling if needed for reconciliation.
- Ensure team changes disconnect/reconnect to the correct team room.

Acceptance criteria:

- Old duplicate sessions cannot keep speaking after replacement.
- Kicked players cannot keep speaking in the room.
- Expired tokens cannot be used to join new sessions.
- Team changes cannot leave a player in both team rooms.

### Phase 5: Observability And Quality

Goal: make VOIP operable in real matches.

Work:

- Surface voice connection state in debug logs.
- Add metrics for connection failures, reconnects, packet loss, and voice room participant counts.
- Tune audio constraints for echo cancellation, noise suppression, and auto gain control.
- Add a diagnostics command or debug panel entry for voice state.
- Document deployment ports and env requirements.

Acceptance criteria:

- Operators can tell whether voice failures are permission, token, network, or media-server problems.
- The client exposes enough state to debug "I cannot hear teammate" without guessing.
- Voice failures do not produce noisy game server errors.

## Testing And Verification

Do not rely on browser playtesting for agent verification. Browser playtesting remains the user's lane.

Automated checks:

- Server unit tests for voice room naming.
- Server unit tests for token authorization by lobby/match/team.
- Server tests that enemy-team token requests are rejected.
- Server tests that kicked or duplicate sessions trigger participant removal calls.
- Client unit tests for push-to-talk state transitions.
- Client unit tests for mute/deafen and per-player mute behavior.
- Typecheck both client and server packages.

Manual user playtest checklist:

- Two players on same team can hear each other.
- Enemy teams cannot hear each other.
- Push-to-talk behaves correctly under pointer lock.
- Mute/deafen persists through match transitions.
- Permission denial is recoverable from settings.
- Voice disconnects on leave, kick, and duplicate-tab replacement.

## Later Enhancements

- Lobby voice.
- Post-match all-team voice.
- Party voice that persists across lobbies.
- Proximity voice as a separate, explicitly designed mode.
- Spectator voice rules.
- Voice activity detection instead of push-to-talk.
- Account-level mute/block persistence.
- Moderation reports with opt-in evidence policy.
- Mobile/native client support if the project expands beyond browser.

## References

- [W3C WebRTC specification](https://www.w3.org/TR/webrtc/)
- [WebRTC project overview](https://webrtc.org/)
- [IETF RFC 7874: WebRTC Audio Codec and Processing Requirements](https://datatracker.ietf.org/doc/html/rfc7874)
- [IETF RFC 8656: Traversal Using Relays around NAT](https://datatracker.ietf.org/doc/html/rfc8656)
- [IETF RFC 8827: WebRTC Security Architecture](https://datatracker.ietf.org/doc/html/rfc8827)
- [LiveKit: Connecting to rooms](https://docs.livekit.io/intro/basics/connect/)
- [LiveKit: Tokens and grants](https://docs.livekit.io/frontends/reference/tokens-grants/)
- [LiveKit JS Server SDK](https://docs.livekit.io/reference/server-sdk-js/)
- [LiveKit self-hosting on virtual machines](https://docs.livekit.io/transport/self-hosting/vm/)
- [mediasoup SFU overview](https://mediasoup.org/documentation/overview/)

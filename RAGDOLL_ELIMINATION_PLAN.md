# Ragdoll Elimination Plan

## Reader And Goal

This plan is for adding visible elimination feedback to Opus Strike. Today eliminated heroes disappear because `OtherPlayers` filters dead players during active phases, and the local camera keeps a normal standing pose after the player state flips away from `alive`.

After this work, eliminations should produce:

- A short-lived third-person ragdoll for any eliminated hero.
- A first-person local death effect where the camera drops toward the floor and rolls onto its side.
- Clean respawn/removal behavior with no legacy dead-player rendering path left behind.

## Recommendation

Implement ragdolls as a client-side visual effect, not as authoritative gameplay physics.

Use the existing `playerKilled` message as the primary trigger, then use `playerVitals` and `respawnTime` as lifecycle cleanup signals. Store death visuals in `visualStore` so per-frame ragdoll motion does not force React re-renders. Render ragdolls through a dedicated manager mounted beside `OtherPlayers` in `GameCanvas`.

For the first pass, use a deterministic lightweight rigid-part ragdoll driven by the existing procedural voxel body rig. Full Rapier ragdoll bodies and joints can be a later upgrade if collision-rich corpses become necessary.

## Current Architecture Notes

- `apps/server/src/rooms/GameRoom.ts` broadcasts `playerKilled` with `victimId`, `killerId`, `assistIds`, and victim `position`.
- `apps/client/src/contexts/gameMessageHandlers.ts` currently uses `playerKilled` only for the kill feed.
- `apps/client/src/components/game/OtherPlayers.tsx` hides `player.state === 'dead'` during `playing` and `countdown`, which causes the visual pop-out.
- `apps/client/src/components/game/HeroVoxelBody.tsx` is already a named bone hierarchy: hips, torso, head, arms, forearms, legs, knees, shins, and aura.
- `apps/client/src/components/game/PlayerController.tsx` exits early when the local player is not `alive`, pins the camera to the player visual position, and resets viewmodel/action state.
- `apps/client/src/hooks/player/useCamera.ts` owns yaw, pitch, crouch offset, slide roll, and FOV transitions.

## Phase 1: Capture Death Events

Add a small death visual event layer to `visualStore`.

New data shape:

```ts
interface DeathVisualSnapshot {
  id: string;
  playerId: string;
  heroId: HeroId | null;
  team: Team;
  isBot: boolean;
  name: string;
  position: Vec3;
  velocity: Vec3;
  lookYaw: number;
  lookPitch: number;
  movement: PlayerMovementState;
  killerId: string | null;
  sourceDirection: Vec3 | null;
  startedAtMs: number;
  expiresAtMs: number;
  local: boolean;
}
```

Work items:

- Add `deathVisuals: Map<string, DeathVisualSnapshot>` to `visualStore`.
- Add helper functions such as `addDeathVisual`, `removeDeathVisual`, `clearExpiredDeathVisuals`, and `clearDeathVisualsForPlayer`.
- In the `playerKilled` handler, snapshot the victim from `gameStore.players`, `localPlayer`, and `visualStore.playerPositions/playerRotations`.
- Derive a rough impulse direction from killer-to-victim positions when the killer exists; otherwise fall back to victim velocity or backward from victim yaw.
- Remove death visuals when the player disconnects, respawns, changes hero, or the visual expires.

Acceptance criteria:

- A kill event creates exactly one visual snapshot per victim per death.
- The snapshot preserves the last visible transform instead of waiting for dead-state vitals.
- Repeated vitals for the same dead player do not spawn duplicate ragdolls.
- Removed/disconnected players also clear their death visuals.

## Phase 2: Render Remote Ragdolls

Create `apps/client/src/components/game/RagdollManager.tsx`.

The manager should:

- Subscribe to a low-frequency version/counter from `visualStore` only when death visuals are added or removed.
- Render `RagdollBody` entries for active death visuals.
- Mount in `GameCanvas` near `OtherPlayers`, before transient effect managers.
- Keep `OtherPlayers` filtering dead players; the ragdoll manager becomes the only dead-body render path.

`RagdollBody` should render a new ragdoll mode of `HeroVoxelBody`, or a sibling renderer that reuses `HERO_BODY_MANIFESTS`, `HERO_BONE_PIVOTS`, `groupRiggedParts`, shared geometries, and hero materials.

Recommended first-pass motion:

- Treat hips as the root body.
- Convert the death snapshot into root velocity, angular velocity, and per-bone offsets.
- Simulate each bone with cheap verlet/semi-implicit motion, gravity, damping, and floor collision.
- Approximate constraints by keeping child bones near their pivot distances from parent bones.
- Seed limb angular velocities from movement state and impact direction so sliding, airborne, and knockback deaths feel different.
- Fade opacity during the last 20-25% of lifetime, then delete.

Acceptance criteria:

- Dead remote heroes collapse instead of disappearing.
- The corpse does not stay upright in a default idle pose.
- Limbs remain connected enough to read as one hero.
- Ragdolls settle on the ground and expire cleanly.
- No dead-player legacy branch remains in `OtherPlayers`.

## Phase 3: Add First-Person Death Camera

Add a local death camera state that starts when the local player transitions from `alive` to `dead` or when `playerKilled.victimId` matches the local player id.

Camera behavior:

- For the first 120-180 ms, preserve current yaw/pitch so the hit feels immediate.
- Over 650-900 ms, lower the eye from standing height to about `0.28-0.45m` above the floor.
- Roll the camera toward either left or right side by about `75-95deg`.
- Pitch slightly down during the fall, then settle with a small bounce.
- Add a short FOV pulse and camera shake at death start.
- Freeze normal look input during the hard fall, then allow very limited yaw-only spectator look if desired while dead.
- Restore camera roll, FOV, pitch constraints, and crouch/slide offsets immediately on respawn.

Implementation options:

- Add `startDeathCamera`, `updateDeathCamera`, and `resetDeathCamera` to `useCamera`.
- Or keep `useCamera` generic and place `deathCameraRef` in `PlayerController`, using `cameraControl.refs` for base yaw/pitch.

Recommended approach:

- Put the interpolation helpers in `useCamera` because camera roll, FOV, and crouch offsets already live there.
- Trigger the local death camera from `PlayerController` when `localPlayer.state !== 'alive'`, but only if the previous state was `alive`.
- Use `visualStore.playerPositions` for the start position so predicted local movement does not snap to stale server position at death.

Acceptance criteria:

- Local elimination clearly feels first person: the camera falls and ends sideways near the floor.
- Respawn never inherits death roll, FOV, shake, or reduced eye height.
- The viewmodel remains hidden while dead through the existing `HeroViewmodel` state gate.
- The death camera works whether the local player is killed by another player, self damage, fall damage, or a bot.

## Phase 4: Improve Kill Event Context

The existing `playerKilled` event is enough to start the feature, but richer impact direction will improve ragdolls.

Optional protocol extension:

```ts
interface PlayerDeathEvent {
  victimId: string;
  killerId: string | null;
  assistIds: string[];
  abilityId?: string;
  position: Vec3;
  velocity?: Vec3;
  sourcePosition?: Vec3 | null;
  sourceDirection?: Vec3 | null;
  damageType?: string;
  occurredAt?: number;
}
```

Work items:

- Track the last damaging `sourcePosition`, `damageType`, and approximate direction in server damage history.
- Include optional fields in `packages/shared/src/types/network.ts`.
- Broadcast the richer event from `GameRoom.handlePlayerDeath`.
- Keep the client fallback path so older/incomplete messages still ragdoll.

Acceptance criteria:

- Directional kills push the torso away from the source.
- Explosive or vertical deaths can launch upward.
- Missing optional fields do not break the client.

## Phase 5: Quality And Performance Controls

Ragdolls should be visually noticeable but cheap.

Controls:

- Cap active ragdolls, for example 8 high quality and 16 total.
- Prefer the newest deaths when over budget.
- Simulate at render frame rate with clamped delta.
- Stop simulating settled bodies after they sleep for a short duration.
- Respect existing visual quality settings with a reduced lifetime or simplified limbs on low presets.
- Avoid dynamic shadows for low-quality ragdolls; keep cast shadows only on medium/high if budget allows.

Acceptance criteria:

- A multi-kill does not tank frame time.
- Expired ragdolls dispose materials/geometries correctly.
- Existing hero body materials/geometries remain shared where possible.

## Phase 6: Verification Plan

Do not use browser testing for this task; leave visual browser verification to the user.

Run code-level checks:

- `pnpm --filter @voxel-strike/client typecheck`
- `pnpm --filter @voxel-strike/client test:visual-store`
- `pnpm --filter @voxel-strike/client test:model-system`

Manual checks for the user:

- Kill a remote player while standing still.
- Kill a remote player while they are sprinting, sliding, jumping, and jetpacking.
- Get killed locally and confirm the camera falls sideways.
- Respawn and confirm the camera/viewmodel return to normal.
- Trigger multiple quick kills and confirm old ragdolls expire.
- Confirm dead players no longer disappear instantly and no duplicate body is rendered.

## Implementation Order

1. Add death visual state and helpers in `visualStore`.
2. Trigger death visual snapshots from `playerKilled`.
3. Add `RagdollManager` with a lightweight procedural ragdoll renderer.
4. Mount `RagdollManager` in `GameCanvas`.
5. Add local death camera state to `useCamera` and `PlayerController`.
6. Add cleanup on respawn, player removal, and match/lobby transitions.
7. Add focused tests for visual store lifecycle and death snapshot deduping.
8. Optionally extend the server/shared death event with richer impact context.

## Risks

The main risk is making the first pass too physically ambitious. A procedural ragdoll can deliver the player-facing effect without solving full jointed physics, terrain contact, or server reconciliation.

Another risk is duplicate rendering around the dead-state transition. Keep `OtherPlayers` responsible only for live/player-preview bodies and make `RagdollManager` the only corpse renderer.

A final risk is camera state leakage after respawn. Treat death camera reset as part of the same non-alive-to-alive transition that resets movement, viewmodel, and action locks.

## Final Decision

Build a visual-only ragdoll system first: snapshot the victim at `playerKilled`, render a temporary procedural voxel ragdoll, and drive a local first-person death camera that falls over sideways. Extend protocol impact data only after the basic experience is working.

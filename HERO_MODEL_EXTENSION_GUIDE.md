# Hero Model Extension Guide

Use this guide when adding or changing a procedural hero body, first-person viewmodel, or gameplay launch socket.

## Body Manifest

Hero body data lives in `apps/client/src/model-system/heroBodyManifests.ts`.

For each hero, update the matching `HeroBodyManifest` entry:

- `parts`: neutral voxel body geometry.
- `teamAccentParts`: team-colored overlays and glow strips.
- `remoteSocketMarkers`: world sockets registered on the third-person body.
- `materialPalette`: all material tokens used by body and accent parts.
- `idleProfile` and `attackDurationSeconds`: body pose timings consumed by the pose layer.

Keep generic rendering out of the manifest. If a new part needs custom animation, add a `limb` override or extend the pose layer instead of special-casing the renderer.

## Rig And Pose Layers

Rig vocabulary and part grouping live in `apps/client/src/model-system/heroRig.ts`.

Body animation math lives in `apps/client/src/model-system/heroBodyPose.ts`.

When adding a body shape:

- Prefer an existing `HeroBoneName`.
- Add a new bone only if no existing pivot can express the motion.
- Keep pose functions pure over inputs and mutable `THREE.Group` refs.
- Add tests in `apps/client/src/model-system/heroModelSystem.test.ts` for new classification or pose behavior.

## Ability Sockets

The shared semantic catalog lives in `packages/shared/src/model/abilitySocketCatalog.ts`.

Every ability that launches from a hand, weapon, orb, or staff must have a catalog entry with:

- `abilityId`
- `heroId`
- `socketRole`
- `sideMode`
- socket names
- fallback offset

Client gameplay, observed remote effects, hookshot owner offsets, and server fallback validation should call the semantic resolver instead of hard-coding socket names.

Client visual origins use `apps/client/src/model-system/abilitySocketResolver.ts`.
Server fallback origins use `resolveAbilitySocket` from `@voxel-strike/shared`.

## Viewmodel Runtime And Kit

Held states and timed pose events live in `apps/client/src/viewmodel/viewmodelPoseRuntime.ts`.

Pose helpers should accept an optional runtime and default to `defaultViewmodelPoseRuntime` for the current local player. Reset the runtime on hero swap, death, pointer unlock, disabled controller state, and unmount.

Reusable viewmodel registration helpers live in `apps/client/src/viewmodel/viewmodelKit.ts`:

- `useRegisteredViewmodelSocket` registers live object sockets.
- `registerViewmodelPoseSamplers` registers one or more sampled sockets.
- `viewmodelPoseDraftFromMatrix` converts composed socket matrices into registry drafts.

Keep hero-specific weapon geometry in `HeroViewmodel.tsx`, but colocate socket declarations with the object or sampler that owns the socket.

## Verification

Use non-browser checks for this system:

- `pnpm --filter @voxel-strike/shared test:model-sockets`
- `pnpm --filter @voxel-strike/client test:model-system`
- `pnpm --filter @voxel-strike/client typecheck`
- `pnpm --filter @voxel-strike/server typecheck`

Manual visual review remains a user/browser step.

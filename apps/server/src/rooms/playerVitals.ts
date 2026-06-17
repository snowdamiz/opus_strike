import type { PlayerVitalsSnapshot } from '@voxel-strike/shared';

export function getDefaultPublicMovementVitals(): PlayerVitalsSnapshot['movement'] {
  return {
    isGrounded: true,
    isSprinting: false,
    isCrouching: false,
    isSliding: false,
    slideTimeRemaining: 0,
    isWallRunning: false,
    wallRunSide: null,
    isGrappling: false,
    grapplePoint: null,
    isJetpacking: false,
    jetpackFuel: 0,
    isGliding: false,
  };
}

function haveMovementVitalsChanged(
  previous: PlayerVitalsSnapshot['movement'],
  next: PlayerVitalsSnapshot['movement']
): boolean {
  return (
    previous.isGrounded !== next.isGrounded ||
    previous.isSprinting !== next.isSprinting ||
    previous.isCrouching !== next.isCrouching ||
    previous.isSliding !== next.isSliding ||
    previous.slideTimeRemaining !== next.slideTimeRemaining ||
    previous.isWallRunning !== next.isWallRunning ||
    previous.wallRunSide !== next.wallRunSide ||
    previous.isGrappling !== next.isGrappling ||
    previous.isJetpacking !== next.isJetpacking ||
    previous.jetpackFuel !== next.jetpackFuel ||
    previous.isGliding !== next.isGliding
  );
}

function haveAbilityVitalsChanged(
  previous: PlayerVitalsSnapshot['abilities'],
  next: PlayerVitalsSnapshot['abilities']
): boolean {
  const previousKeys = Object.keys(previous);
  const nextKeys = Object.keys(next);
  if (previousKeys.length !== nextKeys.length) return true;

  for (const abilityId of nextKeys) {
    const previousAbility = previous[abilityId];
    const nextAbility = next[abilityId];
    if (!previousAbility || !nextAbility) return true;
    if (
      previousAbility.abilityId !== nextAbility.abilityId ||
      previousAbility.cooldownUntil !== nextAbility.cooldownUntil ||
      previousAbility.charges !== nextAbility.charges ||
      previousAbility.isActive !== nextAbility.isActive ||
      previousAbility.activatedAt !== nextAbility.activatedAt
    ) {
      return true;
    }
  }

  return false;
}

function haveStatVitalsChanged(
  previous: PlayerVitalsSnapshot['stats'],
  next: PlayerVitalsSnapshot['stats']
): boolean {
  return (
    previous.kills !== next.kills ||
    previous.deaths !== next.deaths ||
    previous.assists !== next.assists ||
    previous.flagCaptures !== next.flagCaptures ||
    previous.flagReturns !== next.flagReturns
  );
}

export function haveVitalsChanged(
  previous: PlayerVitalsSnapshot | undefined,
  next: PlayerVitalsSnapshot
): boolean {
  if (!previous) return true;

  return (
    previous.name !== next.name ||
    previous.netId !== next.netId ||
    previous.team !== next.team ||
    previous.heroId !== next.heroId ||
    previous.state !== next.state ||
    previous.isReady !== next.isReady ||
    previous.isBot !== next.isBot ||
    previous.botDifficulty !== next.botDifficulty ||
    previous.botProfileId !== next.botProfileId ||
    previous.visibility !== next.visibility ||
    previous.health !== next.health ||
    previous.maxHealth !== next.maxHealth ||
    Math.round(previous.ultimateCharge) !== Math.round(next.ultimateCharge) ||
    previous.onFireUntil !== next.onFireUntil ||
    previous.powerupBoostUntil !== next.powerupBoostUntil ||
    previous.hasFlag !== next.hasFlag ||
    (next.state !== 'alive' && haveMovementVitalsChanged(previous.movement, next.movement)) ||
    haveAbilityVitalsChanged(previous.abilities, next.abilities) ||
    haveStatVitalsChanged(previous.stats, next.stats) ||
    previous.respawnTime !== next.respawnTime ||
    previous.spawnProtectionUntil !== next.spawnProtectionUntil
  );
}

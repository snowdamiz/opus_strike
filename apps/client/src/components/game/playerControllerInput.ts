import type {
  HeroId,
  InputState,
  PlayerMovementState,
} from '@voxel-strike/shared';

export type CastActionFields = Pick<InputState, 'primaryFire' | 'secondaryFire' | 'ability1' | 'ability2' | 'ultimate'>;
export type ExclusiveHoldInput = Pick<InputState, 'primaryFire' | 'secondaryFire' | 'ability1' | 'ability2'>;
export type ServerCombatInput = CastActionFields;
export type CommandScheduleReason = 'combat_edge' | 'movement_barrier' | 'crouch_edge';

export interface CommandSchedule {
  forceSubstep: boolean;
  flushExistingBeforeSample: boolean;
  forcePacketFlush: boolean;
}

export const EMPTY_EXCLUSIVE_HOLD_INPUT: ExclusiveHoldInput = {
  primaryFire: false,
  secondaryFire: false,
  ability1: false,
  ability2: false,
};

export const EMPTY_SERVER_COMBAT_INPUT: ServerCombatInput = {
  primaryFire: false,
  secondaryFire: false,
  ability1: false,
  ability2: false,
  ultimate: false,
};

export function withCastActionFields(input: InputState, actions: Partial<CastActionFields> = {}): InputState {
  const primaryFire = actions.primaryFire ?? false;
  const secondaryFire = actions.secondaryFire ?? false;
  const ability1 = actions.ability1 ?? false;
  const ability2 = actions.ability2 ?? false;
  const ultimate = actions.ultimate ?? false;

  if (
    input.primaryFire === primaryFire &&
    input.secondaryFire === secondaryFire &&
    input.ability1 === ability1 &&
    input.ability2 === ability2 &&
    input.ultimate === ultimate
  ) {
    return input;
  }

  return {
    ...input,
    primaryFire,
    secondaryFire,
    ability1,
    ability2,
    ultimate,
  };
}

export function getExclusiveHeroInput(
  heroId: HeroId,
  input: InputState,
  isActionLocked: boolean,
  isBombTargeting: boolean,
  continuingHoldInput: Partial<CastActionFields> | null = null,
  lockedAllowedInput: Partial<CastActionFields> | null = null,
  isPhoenixDiveTargeting = false
): InputState {
  if (isActionLocked) {
    return withCastActionFields(input, lockedAllowedInput ?? {});
  }

  if (isBombTargeting) {
    return withCastActionFields(input, { secondaryFire: input.secondaryFire });
  }

  if (isPhoenixDiveTargeting) {
    return withCastActionFields(input, { ultimate: input.ultimate });
  }

  if (continuingHoldInput) {
    return withCastActionFields(input, continuingHoldInput);
  }

  if (input.primaryFire) {
    return withCastActionFields(input, { primaryFire: true });
  }

  if (input.secondaryFire) {
    return withCastActionFields(input, { secondaryFire: true });
  }

  if (input.ability1) {
    return withCastActionFields(input, { ability1: true });
  }

  if (input.ability2) {
    return withCastActionFields(input, { ability2: true });
  }

  if (input.ultimate) {
    return withCastActionFields(input, { ultimate: true });
  }

  return withCastActionFields(input);
}

export function getContinuingHeroHoldInput(
  heroId: HeroId,
  input: InputState,
  previousInput: ExclusiveHoldInput
): Partial<CastActionFields> | null {
  if (previousInput.primaryFire && input.primaryFire) {
    return { primaryFire: true };
  }

  if (previousInput.secondaryFire && input.secondaryFire) {
    return { secondaryFire: true };
  }

  if (heroId === 'blaze' && previousInput.ability1 && input.ability1) {
    return { ability1: true };
  }

  if (heroId === 'blaze' && previousInput.ability2 && input.ability2) {
    return { ability2: true };
  }

  return null;
}

export function getExclusiveHoldInput(input: InputState): ExclusiveHoldInput {
  return {
    primaryFire: input.primaryFire,
    secondaryFire: input.secondaryFire,
    ability1: input.ability1,
    ability2: input.ability2,
  };
}

export function shouldForceImmediateCombatCommand(
  current: ServerCombatInput,
  previous: ServerCombatInput
): boolean {
  return (
    current.primaryFire !== previous.primaryFire ||
    current.secondaryFire !== previous.secondaryFire ||
    current.ability1 !== previous.ability1 ||
    current.ability2 !== previous.ability2 ||
    current.ultimate !== previous.ultimate
  );
}

export function addCommandScheduleReason(
  reasons: CommandScheduleReason[],
  reason: CommandScheduleReason
): void {
  if (!reasons.includes(reason)) {
    reasons.push(reason);
  }
}

export function resolveCommandSchedule(reasons: CommandScheduleReason[]): CommandSchedule {
  const forceCommand = reasons.length > 0;
  return {
    forceSubstep: forceCommand,
    flushExistingBeforeSample: reasons.includes('movement_barrier'),
    forcePacketFlush: forceCommand,
  };
}

export function deriveServerCombatInput(input: {
  frameInput: InputState;
  primaryFireForServer: boolean;
  ability2ForServer: boolean;
}): ServerCombatInput {
  return {
    primaryFire: input.primaryFireForServer,
    secondaryFire: input.frameInput.secondaryFire,
    ability1: input.frameInput.ability1,
    ability2: input.ability2ForServer,
    ultimate: input.frameInput.ultimate,
  };
}

export function deriveDownedServerCombatInput(frameInput: InputState): ServerCombatInput {
  return {
    ...EMPTY_SERVER_COMBAT_INPUT,
    primaryFire: frameInput.primaryFire,
  };
}

export function movementClassForTrace(input: {
  heroId: HeroId;
  movement: PlayerMovementState;
  inputState: InputState;
  flagCarrier: boolean;
}): string {
  if (input.movement.isSliding) return 'slide';
  if (input.heroId === 'blaze' && input.inputState.ability2) return 'rocket_jump';
  if (input.heroId === 'phantom' && input.inputState.ability1) return 'blink';
  if (input.heroId === 'hookshot' && (input.inputState.ability1 || input.movement.isGrappling)) return 'grapple';
  if (input.heroId === 'hookshot' && input.inputState.ultimate) return 'ground_hooks';
  if (input.heroId === 'chronos' && input.inputState.ability1) {
    return input.inputState.secondaryFire ? 'chronos_lifeline_self' : 'chronos_lifeline_allies';
  }
  if (input.flagCarrier) return 'flag_route';
  return 'baseline';
}

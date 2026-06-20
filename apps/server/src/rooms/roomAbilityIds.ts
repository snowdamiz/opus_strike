export class RoomAbilityIdGenerator {
  private sharedCastCounter = 0;
  private blazeRocketCounter = 0;
  private blazeBombCounter = 0;
  private blazeGearstormCounter = 0;
  private hookshotGroundHooksCounter = 0;
  private voidZoneCounter = 0;

  nextSharedCastId(playerId: string, abilityId: string): string {
    return `${abilityId}_${playerId}_${this.sharedCastCounter++}`;
  }

  nextBlazeRocketCastId(playerId: string): string {
    return this.formatBlazeCastId(playerId, 'blaze_rocket', this.blazeRocketCounter++);
  }

  nextBlazeBombCastId(playerId: string): string {
    return this.formatBlazeCastId(playerId, 'blaze_bomb', this.blazeBombCounter++);
  }

  nextBlazeGearstormId(playerId: string): string {
    return `blaze_gearstorm_${playerId}_${this.blazeGearstormCounter++}`;
  }

  nextHookshotGroundHooksCastId(playerId: string): string {
    return `ground_hooks_${playerId}_${this.hookshotGroundHooksCounter++}`;
  }

  nextVoidZoneId(): string {
    return `void_${this.voidZoneCounter++}`;
  }

  private formatBlazeCastId(playerId: string, abilityId: string, counter: number): string {
    return `${abilityId}_${playerId}_${counter}`;
  }
}

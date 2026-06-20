export type LaunchSide = -1 | 1;

export class AlternatingLaunchSideTracker {
  private readonly previousSideByPlayer = new Map<string, LaunchSide>();

  clear(playerId: string): boolean {
    return this.previousSideByPlayer.delete(playerId);
  }

  next(playerId: string): LaunchSide {
    const previous = this.previousSideByPlayer.get(playerId) ?? -1;
    const next = previous === 1 ? -1 : 1;
    this.previousSideByPlayer.set(playerId, next);
    return next;
  }

  getPrevious(playerId: string): LaunchSide | undefined {
    return this.previousSideByPlayer.get(playerId);
  }
}

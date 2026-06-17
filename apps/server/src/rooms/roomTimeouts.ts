type RoomTimeout = ReturnType<typeof setTimeout>;

export class RoomTimeoutRegistry {
  private readonly scheduledTimeouts = new Set<RoomTimeout>();

  get size(): number {
    return this.scheduledTimeouts.size;
  }

  schedule(callback: () => void, delayMs: number): void {
    let timeout: RoomTimeout;
    timeout = setTimeout(() => {
      this.scheduledTimeouts.delete(timeout);
      callback();
    }, delayMs);
    this.scheduledTimeouts.add(timeout);
    timeout.unref?.();
  }

  clear(): void {
    for (const timeout of this.scheduledTimeouts) {
      clearTimeout(timeout);
    }
    this.scheduledTimeouts.clear();
  }
}

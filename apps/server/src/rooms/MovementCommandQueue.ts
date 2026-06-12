import { compareMovementSeq, isMovementSeqAfter, type MovementCommand } from '@voxel-strike/shared';

export class MovementCommandQueue implements Iterable<MovementCommand> {
  private buffer: Array<MovementCommand | undefined>;
  private head = 0;
  private count = 0;
  private readonly queuedSeqs = new Set<number>();

  constructor(initialCapacity = 128) {
    const capacity = Math.max(8, initialCapacity);
    this.buffer = new Array<MovementCommand | undefined>(capacity);
  }

  get length(): number {
    return this.count;
  }

  hasSeq(seq: number): boolean {
    return this.queuedSeqs.has(seq);
  }

  clear(): void {
    if (this.count > 0) {
      for (let index = 0; index < this.count; index++) {
        this.buffer[this.physicalIndex(index)] = undefined;
      }
    }
    this.head = 0;
    this.count = 0;
    this.queuedSeqs.clear();
  }

  replace(commands: readonly MovementCommand[]): void {
    this.clear();
    for (const command of commands) {
      this.push(command);
    }
  }

  push(command: MovementCommand): void {
    if (this.queuedSeqs.has(command.seq)) return;

    const tail = this.peekLast();
    if (!tail || isMovementSeqAfter(command.seq, tail.seq)) {
      this.append(command);
      return;
    }

    this.insertOrdered(command);
  }

  pop(): MovementCommand | null {
    if (this.count === 0) return null;

    const command = this.buffer[this.head] ?? null;
    this.buffer[this.head] = undefined;
    this.head = (this.head + 1) % this.buffer.length;
    this.count--;
    if (command) this.queuedSeqs.delete(command.seq);
    if (this.count === 0) this.head = 0;
    return command;
  }

  dropOldest(count: number): MovementCommand[] {
    const removed: MovementCommand[] = [];
    for (let index = 0; index < count; index++) {
      const command = this.pop();
      if (!command) break;
      removed.push(command);
    }
    return removed;
  }

  peekLast(): MovementCommand | null {
    if (this.count === 0) return null;
    return this.buffer[this.physicalIndex(this.count - 1)] ?? null;
  }

  toArray(): MovementCommand[] {
    const commands: MovementCommand[] = [];
    for (const command of this) commands.push(command);
    return commands;
  }

  [Symbol.iterator](): Iterator<MovementCommand> {
    let index = 0;
    return {
      next: (): IteratorResult<MovementCommand> => {
        if (index >= this.count) return { done: true, value: undefined };
        const command = this.buffer[this.physicalIndex(index++)];
        if (!command) return { done: true, value: undefined };
        return { done: false, value: command };
      },
    };
  }

  private append(command: MovementCommand): void {
    this.ensureCapacity(this.count + 1);
    this.buffer[this.physicalIndex(this.count)] = command;
    this.count++;
    this.queuedSeqs.add(command.seq);
  }

  private insertOrdered(command: MovementCommand): void {
    this.ensureCapacity(this.count + 1);

    let insertIndex = this.count;
    while (insertIndex > 0) {
      const previous = this.buffer[this.physicalIndex(insertIndex - 1)];
      if (!previous || compareMovementSeq(command.seq, previous.seq) >= 0) break;
      insertIndex--;
    }

    for (let index = this.count; index > insertIndex; index--) {
      this.buffer[this.physicalIndex(index)] = this.buffer[this.physicalIndex(index - 1)];
    }
    this.buffer[this.physicalIndex(insertIndex)] = command;
    this.count++;
    this.queuedSeqs.add(command.seq);
  }

  private ensureCapacity(required: number): void {
    if (required <= this.buffer.length) return;

    const nextCapacity = Math.max(required, this.buffer.length * 2);
    const nextBuffer = new Array<MovementCommand | undefined>(nextCapacity);
    for (let index = 0; index < this.count; index++) {
      nextBuffer[index] = this.buffer[this.physicalIndex(index)];
    }
    this.buffer = nextBuffer;
    this.head = 0;
  }

  private physicalIndex(logicalIndex: number): number {
    return (this.head + logicalIndex) % this.buffer.length;
  }
}

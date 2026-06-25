import {
  PlayerSpatialIndex,
  type PlayerSpatialQueryOptions,
} from './PlayerSpatialIndex';
import type { Player } from './schema/Player';

export class PlayerSpatialQueries {
  private readonly scratch: Player[] = [];

  constructor(
    private readonly index: PlayerSpatialIndex,
    private readonly ensureFresh: () => void = () => {}
  ) {}

  queryRadius(
    center: { x: number; z: number },
    radius: number,
    options: PlayerSpatialQueryOptions = {}
  ): Player[] {
    this.ensureFresh();
    return this.index.queryRadius(center, radius, this.scratch, options);
  }

  queryConeCandidates(
    origin: { x: number; z: number },
    range: number,
    options: PlayerSpatialQueryOptions = {}
  ): Player[] {
    this.ensureFresh();
    return this.index.queryConeCandidates(origin, range, this.scratch, options);
  }
}

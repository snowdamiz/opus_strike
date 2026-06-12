export class FrameTimeHistogram {
  private readonly bins: Uint16Array;
  private totalSamples = 0;

  constructor(
    private readonly binSizeMs = 1,
    private readonly maxTrackedMs = 80
  ) {
    const binCount = Math.ceil(maxTrackedMs / binSizeMs) + 1;
    this.bins = new Uint16Array(binCount);
  }

  record(frameMs: number): void {
    if (!Number.isFinite(frameMs) || frameMs < 0) return;

    const unclampedBin = Math.floor(frameMs / this.binSizeMs);
    const bin = Math.max(0, Math.min(this.bins.length - 1, unclampedBin));
    this.bins[bin]++;
    this.totalSamples++;
  }

  percentile(percentile: number): number {
    if (this.totalSamples === 0) return 0;

    const target = Math.max(1, Math.ceil(this.totalSamples * Math.max(0, Math.min(1, percentile))));
    let cumulative = 0;
    for (let index = 0; index < this.bins.length; index++) {
      cumulative += this.bins[index];
      if (cumulative >= target) {
        return index === this.bins.length - 1
          ? this.maxTrackedMs
          : index * this.binSizeMs;
      }
    }
    return this.maxTrackedMs;
  }

  reset(): void {
    this.bins.fill(0);
    this.totalSamples = 0;
  }

  get sampleCount(): number {
    return this.totalSamples;
  }
}

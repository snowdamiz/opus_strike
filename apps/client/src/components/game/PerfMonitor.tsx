import { Perf } from 'r3f-perf';

/**
 * Performance monitoring component using r3f-perf
 *
 * Displays real-time metrics for React Three Fiber rendering:
 * - FPS (frames per second)
 * - GPU time
 * - Triangle count
 * - Geometry count
 * - Texture count
 * - Shader count
 *
 * Position: top-left corner of canvas
 * Charts: enabled with detailed metrics (not minimal mode)
 */
export function PerfMonitor() {
  return (
    <Perf
      position="top-left"
      minimal={false}
    />
  );
}

export default PerfMonitor;

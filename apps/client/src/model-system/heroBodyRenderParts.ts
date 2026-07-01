import type { MaterialKind, VoxelPart } from './heroBodyTypes';

type Axis = 0 | 1 | 2;

interface PartBounds {
  min: [number, number, number];
  max: [number, number, number];
  half: [number, number, number];
}

interface AttachmentShift {
  axis: Axis;
  amount: number;
  score: number;
}

const AXES: readonly Axis[] = [0, 1, 2];
const AUTO_SURFACE_ATTACHMENT_MATERIALS = new Set<MaterialKind>([
  'accent',
  'edge',
  'eye',
  'glass',
  'glow',
  'metal',
]);
const SURFACE_ATTACHMENT_HOST_MATERIALS = new Set<MaterialKind>([
  'accent',
  'armor',
  'dark',
  'edge',
  'metal',
  'skin',
  'void',
]);
const SURFACE_ATTACHMENT_MAX_GAP = 0.42;
const SURFACE_ATTACHMENT_EMBED_DEPTH = 0.004;
const SURFACE_ATTACHMENT_MIN_OVERLAP = 0.006;

// Authored part positions are rest-pose centers. This pass closes one-axis gaps
// against same-bone host geometry while leaving explicit floating parts untouched.
function isNearlyZero(value: number): boolean {
  return Math.abs(value) < 0.000001;
}

function getRotatedHalfExtents(
  scale: [number, number, number],
  rotation?: [number, number, number]
): [number, number, number] {
  const localHalf: [number, number, number] = [
    scale[0] / 2,
    scale[1] / 2,
    scale[2] / 2,
  ];

  if (!rotation || rotation.every(isNearlyZero)) return localHalf;

  const [x, y, z] = rotation;
  const a = Math.cos(x);
  const b = Math.sin(x);
  const c = Math.cos(y);
  const d = Math.sin(y);
  const e = Math.cos(z);
  const f = Math.sin(z);
  const ae = a * e;
  const af = a * f;
  const be = b * e;
  const bf = b * f;

  const rotationRows = [
    [c * e, -c * f, d],
    [af + be * d, ae - bf * d, -b * c],
    [bf - ae * d, be + af * d, a * c],
  ] as const;

  return [
    Math.abs(rotationRows[0][0]) * localHalf[0] +
      Math.abs(rotationRows[0][1]) * localHalf[1] +
      Math.abs(rotationRows[0][2]) * localHalf[2],
    Math.abs(rotationRows[1][0]) * localHalf[0] +
      Math.abs(rotationRows[1][1]) * localHalf[1] +
      Math.abs(rotationRows[1][2]) * localHalf[2],
    Math.abs(rotationRows[2][0]) * localHalf[0] +
      Math.abs(rotationRows[2][1]) * localHalf[1] +
      Math.abs(rotationRows[2][2]) * localHalf[2],
  ];
}

function getPartBounds(part: VoxelPart): PartBounds {
  const half = getRotatedHalfExtents(part.scale, part.rotation);
  const [x, y, z] = part.position;

  return {
    min: [x - half[0], y - half[1], z - half[2]],
    max: [x + half[0], y + half[1], z + half[2]],
    half,
  };
}

function getAxisOverlap(left: PartBounds, right: PartBounds, axis: Axis): number {
  return Math.min(left.max[axis], right.max[axis]) - Math.max(left.min[axis], right.min[axis]);
}

function doBoundsTouchOrOverlap(left: PartBounds, right: PartBounds): boolean {
  return AXES.every((axis) => getAxisOverlap(left, right, axis) >= -SURFACE_ATTACHMENT_EMBED_DEPTH);
}

function shouldResolveSurfaceAttachment(part: VoxelPart): boolean {
  if (part.generated || part.attachmentMode === 'floating') return false;
  if (part.bone === 'aura' || part.material === 'mist') return false;
  if (part.attachmentMode === 'surface') return true;
  return AUTO_SURFACE_ATTACHMENT_MATERIALS.has(part.material);
}

function canHostSurfaceAttachment(part: VoxelPart, candidate: VoxelPart): boolean {
  if (part.id === candidate.id) return false;
  if (part.generated || part.attachmentMode === 'floating') return false;
  if (part.bone !== candidate.bone) return false;
  if (part.material === 'mist' || part.transparent) return false;
  return SURFACE_ATTACHMENT_HOST_MATERIALS.has(part.material);
}

function getSurfaceAttachmentShift(candidate: VoxelPart, host: VoxelPart): AttachmentShift | null {
  const candidateBounds = getPartBounds(candidate);
  const hostBounds = getPartBounds(host);
  const separatedAxes: Array<{ axis: Axis; direction: -1 | 1; gap: number }> = [];

  for (const axis of AXES) {
    if (candidateBounds.max[axis] < hostBounds.min[axis]) {
      separatedAxes.push({
        axis,
        direction: 1,
        gap: hostBounds.min[axis] - candidateBounds.max[axis],
      });
    } else if (hostBounds.max[axis] < candidateBounds.min[axis]) {
      separatedAxes.push({
        axis,
        direction: -1,
        gap: candidateBounds.min[axis] - hostBounds.max[axis],
      });
    }
  }

  if (separatedAxes.length !== 1) return null;

  const [separation] = separatedAxes;
  if (separation.gap > SURFACE_ATTACHMENT_MAX_GAP) return null;

  for (const axis of AXES) {
    if (axis === separation.axis) continue;
    const overlap = getAxisOverlap(candidateBounds, hostBounds, axis);
    const requiredOverlap = Math.max(
      SURFACE_ATTACHMENT_MIN_OVERLAP,
      Math.min(candidateBounds.half[axis], hostBounds.half[axis]) * 0.12
    );
    if (overlap < requiredOverlap) return null;
  }

  return {
    axis: separation.axis,
    amount: separation.direction * (separation.gap + SURFACE_ATTACHMENT_EMBED_DEPTH),
    score: separation.gap,
  };
}

function resolveSurfaceAttachedPart<TPart extends VoxelPart>(
  part: TPart,
  hostParts: readonly VoxelPart[]
): TPart {
  if (!shouldResolveSurfaceAttachment(part)) return part;

  let bestShift: AttachmentShift | null = null;
  const partBounds = getPartBounds(part);

  for (const hostPart of hostParts) {
    if (!canHostSurfaceAttachment(hostPart, part)) continue;
    if (doBoundsTouchOrOverlap(partBounds, getPartBounds(hostPart))) return part;
    const shift = getSurfaceAttachmentShift(part, hostPart);
    if (!shift || (bestShift && shift.score >= bestShift.score)) continue;
    bestShift = shift;
  }

  if (!bestShift) return part;

  const position: [number, number, number] = [...part.position];
  position[bestShift.axis] += bestShift.amount;
  return {
    ...part,
    position,
  };
}

export function getHeroBodyRenderParts<TPart extends VoxelPart>(
  parts: readonly TPart[],
  hostParts: readonly VoxelPart[] = parts
): TPart[] {
  return parts.map((part) => resolveSurfaceAttachedPart(part, hostParts));
}

import {
  HERO_MODEL_DOCUMENT_SCHEMA_VERSION,
  type HeroModelDocumentV1,
  type ModelBoneName,
  type ModelMaterialDescriptor,
  type ModelPartKind,
  type ModelPartDescriptor,
  type ModelSocketDescriptor,
  type ModelTransformTuple,
  type ViewmodelPoseChannelDescriptor,
} from '../types/modelSystem.js';

export interface HeroModelDocumentValidationResult {
  ok: boolean;
  errors: string[];
}

const MODEL_BONE_NAMES = new Set<ModelBoneName>([
  'aura',
  'hips',
  'torso',
  'head',
  'leftLeg',
  'rightLeg',
  'leftKnee',
  'rightKnee',
  'leftShin',
  'rightShin',
  'leftArm',
  'rightArm',
  'leftForearm',
  'rightForearm',
]);
const MODEL_PART_TARGETS = new Set<string>(['root', ...MODEL_BONE_NAMES]);

const MODEL_PART_KINDS = new Set<ModelPartKind>([
  'box',
  'sphere',
  'cylinder',
  'cone',
]);

const VIEWMODEL_CHANNEL_KINDS = new Set<ViewmodelPoseChannelDescriptor['kind']>([
  'held',
  'charge',
  'fire',
  'cast',
  'slam',
  'targeting',
  'movement',
]);

const VIEWMODEL_CHANNEL_DRIVERS = new Set<NonNullable<ViewmodelPoseChannelDescriptor['driver']>>([
  'poseRuntime',
  'componentRef',
  'visualStore',
  'derived',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function validateTransformTuple(
  value: unknown,
  path: string,
  errors: string[],
  required = true
): value is ModelTransformTuple {
  if (value === undefined && !required) return false;
  if (!Array.isArray(value) || value.length !== 3) {
    errors.push(`${path} must be a [number, number, number] tuple`);
    return false;
  }

  value.forEach((entry, index) => {
    if (!isFiniteNumber(entry)) {
      errors.push(`${path}[${index}] must be a finite number`);
    }
  });
  return true;
}

function validateUniqueId(
  id: unknown,
  path: string,
  seen: Set<string>,
  errors: string[]
): id is string {
  if (!isNonEmptyString(id)) {
    errors.push(`${path}.id must be a non-empty string`);
    return false;
  }

  if (seen.has(id)) {
    errors.push(`${path}.id "${id}" must be unique`);
    return false;
  }

  seen.add(id);
  return true;
}

function validateSocketOffset(
  value: unknown,
  path: string,
  errors: string[]
): void {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return;
  }

  for (const key of ['handHeight', 'forwardOffset', 'sideOffset'] as const) {
    if (!isFiniteNumber(value[key])) {
      errors.push(`${path}.${key} must be a finite number`);
    }
  }
}

function validatePart(
  value: unknown,
  path: string,
  seenIds: Set<string>,
  errors: string[]
): value is ModelPartDescriptor {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return false;
  }

  validateUniqueId(value.id, path, seenIds, errors);
  if (value.kind !== undefined && !MODEL_PART_KINDS.has(value.kind as ModelPartKind)) {
    errors.push(`${path}.kind must be a known part kind when provided`);
  }
  if (!isNonEmptyString(value.material)) {
    errors.push(`${path}.material must be a non-empty material token`);
  }
  if (!isNonEmptyString(value.bone) || !MODEL_PART_TARGETS.has(value.bone)) {
    errors.push(`${path}.bone must be root or a known model bone`);
  }
  validateTransformTuple(value.position, `${path}.position`, errors);
  validateTransformTuple(value.scale, `${path}.scale`, errors);
  validateTransformTuple(value.rotation, `${path}.rotation`, errors, false);
  for (const key of ['emissive', 'transparent', 'generated'] as const) {
    if (value[key] !== undefined && typeof value[key] !== 'boolean') {
      errors.push(`${path}.${key} must be a boolean when provided`);
    }
  }

  return true;
}

function validateSocket(
  value: unknown,
  path: string,
  seenIds: Set<string>,
  errors: string[]
): value is ModelSocketDescriptor {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return false;
  }

  validateUniqueId(value.id, path, seenIds, errors);
  if (!isNonEmptyString(value.role)) {
    errors.push(`${path}.role must be a non-empty socket role`);
  }
  if (!isNonEmptyString(value.name)) {
    errors.push(`${path}.name must be a non-empty string`);
  }
  if (value.side !== undefined && value.side !== -1 && value.side !== 1) {
    errors.push(`${path}.side must be -1 or 1 when provided`);
  }
  if (
    value.ownerScope !== 'localViewmodel' &&
    value.ownerScope !== 'remoteBody' &&
    value.ownerScope !== 'preview'
  ) {
    errors.push(`${path}.ownerScope must be localViewmodel, remoteBody, or preview`);
  }
  if (value.bone !== undefined && !MODEL_BONE_NAMES.has(value.bone as ModelBoneName)) {
    errors.push(`${path}.bone must be a known model bone when provided`);
  }
  validateTransformTuple(value.position, `${path}.position`, errors, false);
  validateTransformTuple(value.rotation, `${path}.rotation`, errors, false);

  const fallbackOffset = value.fallbackOffset;
  validateSocketOffset(fallbackOffset, `${path}.fallbackOffset`, errors);

  return true;
}

function validateMaterial(
  value: unknown,
  path: string,
  seenTokens: Set<string>,
  errors: string[]
): value is ModelMaterialDescriptor {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return false;
  }

  if (!isNonEmptyString(value.token)) {
    errors.push(`${path}.token must be a non-empty material token`);
  } else if (seenTokens.has(value.token)) {
    errors.push(`${path}.token "${value.token}" must be unique`);
  } else {
    seenTokens.add(value.token);
  }

  if (!isNonEmptyString(value.color)) {
    errors.push(`${path}.color must be a non-empty color string`);
  }

  for (const key of ['emissiveIntensity', 'roughness', 'metalness', 'opacity'] as const) {
    if (value[key] !== undefined && !isFiniteNumber(value[key])) {
      errors.push(`${path}.${key} must be a finite number when provided`);
    }
  }

  for (const key of ['transparent', 'toneMapped', 'depthWrite'] as const) {
    if (value[key] !== undefined && typeof value[key] !== 'boolean') {
      errors.push(`${path}.${key} must be a boolean when provided`);
    }
  }

  return true;
}

function validatePoseChannel(
  value: unknown,
  path: string,
  seenIds: Set<string>,
  errors: string[]
): value is ViewmodelPoseChannelDescriptor {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return false;
  }

  validateUniqueId(value.id, path, seenIds, errors);
  if (
    !isNonEmptyString(value.kind) ||
    !VIEWMODEL_CHANNEL_KINDS.has(value.kind as ViewmodelPoseChannelDescriptor['kind'])
  ) {
    errors.push(`${path}.kind must be a known viewmodel channel kind`);
  }
  if (
    value.driver !== undefined &&
    (!isNonEmptyString(value.driver) ||
      !VIEWMODEL_CHANNEL_DRIVERS.has(value.driver as NonNullable<ViewmodelPoseChannelDescriptor['driver']>))
  ) {
    errors.push(`${path}.driver must be a known viewmodel channel driver when provided`);
  }

  return true;
}

function validatePartArray(
  value: unknown,
  path: string,
  errors: string[],
  requireEntries: boolean
): void {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return;
  }
  if (requireEntries && value.length === 0) {
    errors.push(`${path} must not be empty`);
  }

  const seenIds = new Set<string>();
  value.forEach((part, index) => validatePart(part, `${path}[${index}]`, seenIds, errors));
}

function validateSocketArray(
  value: unknown,
  path: string,
  errors: string[],
  requireEntries: boolean
): void {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return;
  }
  if (requireEntries && value.length === 0) {
    errors.push(`${path} must not be empty`);
  }

  const seenIds = new Set<string>();
  value.forEach((socket, index) => validateSocket(socket, `${path}[${index}]`, seenIds, errors));
}

function validateMaterialArray(
  value: unknown,
  path: string,
  errors: string[],
  requireEntries: boolean
): void {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return;
  }
  if (requireEntries && value.length === 0) {
    errors.push(`${path} must not be empty`);
  }

  const seenTokens = new Set<string>();
  value.forEach((material, index) => validateMaterial(material, `${path}[${index}]`, seenTokens, errors));
}

function validatePoseChannelArray(value: unknown, path: string, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return;
  }

  const seenIds = new Set<string>();
  value.forEach((channel, index) => validatePoseChannel(channel, `${path}[${index}]`, seenIds, errors));
}

function validateDefaultFallbackSockets(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push('defaultFallbackSockets must be an object');
    return;
  }

  for (const [role, offset] of Object.entries(value)) {
    if (!isNonEmptyString(role)) {
      errors.push('defaultFallbackSockets roles must be non-empty strings');
      continue;
    }

    validateSocketOffset(offset, `defaultFallbackSockets.${role}`, errors);
  }
}

function validateIdleProfile(value: unknown, path: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return;
  }

  for (
    const key of [
      'cycleSpeed',
      'breathingAmplitude',
      'swayAmplitude',
      'twistAmplitude',
      'auraPulse',
      'phase',
    ] as const
  ) {
    if (!isFiniteNumber(value[key])) {
      errors.push(`${path}.${key} must be a finite number`);
    }
  }
}

export function validateHeroModelDocument(
  value: unknown
): HeroModelDocumentValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return { ok: false, errors: ['document must be an object'] };
  }

  if (value.schemaVersion !== HERO_MODEL_DOCUMENT_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${HERO_MODEL_DOCUMENT_SCHEMA_VERSION}`);
  }
  if (!isNonEmptyString(value.heroId)) {
    errors.push('heroId must be a non-empty string');
  }

  const palette = value.materialPalette;
  if (!isRecord(palette)) {
    errors.push('materialPalette must be an object');
  } else {
    for (const [token, color] of Object.entries(palette)) {
      if (!isNonEmptyString(token)) {
        errors.push('materialPalette tokens must be non-empty strings');
      }
      if (!isNonEmptyString(color)) {
        errors.push(`materialPalette.${token} must be a non-empty color string`);
      }
    }
  }

  const fullBody = value.fullBody;
  if (!isRecord(fullBody)) {
    errors.push('fullBody must be an object');
  } else {
    if (!isFiniteNumber(fullBody.baseHeight) || fullBody.baseHeight <= 0) {
      errors.push('fullBody.baseHeight must be a positive finite number');
    }
    const bounds = fullBody.bounds;
    if (!isRecord(bounds)) {
      errors.push('fullBody.bounds must be an object');
    } else {
      for (const key of ['height', 'width', 'depth'] as const) {
        if (!isFiniteNumber(bounds[key]) || bounds[key] <= 0) {
          errors.push(`fullBody.bounds.${key} must be a positive finite number`);
        }
      }
    }
    validatePartArray(fullBody.parts, 'fullBody.parts', errors, true);
    validatePartArray(fullBody.teamAccentParts, 'fullBody.teamAccentParts', errors, true);
    validateSocketArray(fullBody.sockets, 'fullBody.sockets', errors, false);
    validateIdleProfile(fullBody.idleProfile, 'fullBody.idleProfile', errors);
    if (!isFiniteNumber(fullBody.attackDurationSeconds) || fullBody.attackDurationSeconds <= 0) {
      errors.push('fullBody.attackDurationSeconds must be a positive finite number');
    }
  }

  if (value.viewmodel !== undefined) {
    const viewmodel = value.viewmodel;
    if (!isRecord(viewmodel)) {
      errors.push('viewmodel must be an object when provided');
    } else {
      validateTransformTuple(viewmodel.rootOffset, 'viewmodel.rootOffset', errors);
      if (viewmodel.fov !== undefined && (!isFiniteNumber(viewmodel.fov) || viewmodel.fov <= 0)) {
        errors.push('viewmodel.fov must be a positive finite number when provided');
      }
      validatePartArray(viewmodel.parts, 'viewmodel.parts', errors, true);
      validateSocketArray(viewmodel.sockets, 'viewmodel.sockets', errors, false);
      validatePoseChannelArray(viewmodel.poseChannels, 'viewmodel.poseChannels', errors);
      validateMaterialArray(viewmodel.materials, 'viewmodel.materials', errors, true);
    }
  }

  validateDefaultFallbackSockets(value.defaultFallbackSockets, errors);

  return { ok: errors.length === 0, errors };
}

export function assertHeroModelDocument(
  value: unknown
): asserts value is HeroModelDocumentV1 {
  const result = validateHeroModelDocument(value);
  if (!result.ok) {
    throw new Error(`Invalid hero model document:\n${result.errors.join('\n')}`);
  }
}

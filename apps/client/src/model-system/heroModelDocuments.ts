import {
  BLAZE_ROCKET_STAFF_SOCKET,
  CHRONOS_PRIMARY_ORB_SOCKET,
  HERO_DEFINITIONS,
  HERO_MODEL_DOCUMENT_SCHEMA_VERSION,
  HOOKSHOT_CHAIN_SOCKET,
  PHANTOM_DIRE_BALL_SOCKET,
  PHANTOM_VOID_RAY_SOCKET,
  type HeroId,
  type HeroSkinId,
  type HeroModelDocumentV1,
  type ModelMaterialDescriptor,
  type ModelPartDescriptor,
  type ModelSocketDescriptor,
  type ViewmodelModelDocument,
} from '@voxel-strike/shared';
import {
  ABYSSAL_CORSAIR_COLORS,
  ASHEN_VANGUARD_COLORS,
  ASTRAL_EXECUTIONER_COLORS,
  HERO_SKIN_BODY_MANIFESTS,
  ECLIPSE_SERAPH_COLORS,
  EPOCH_REGENT_COLORS,
  ETERNITY_SOVEREIGN_COLORS,
  INFERNO_ARCHON_COLORS,
  IRON_LEVIATHAN_COLORS,
  KRAKEN_SOVEREIGN_COLORS,
  MERIDIAN_ORACLE_COLORS,
  NIGHTGLASS_WRAITH_COLORS,
  PARADOX_SENTINEL_COLORS,
  SOLAR_FORGE_COLORS,
  STARFALL_PHOENIX_COLORS,
  TIDEBREAKER_COLORS,
  VOID_MONARCH_COLORS,
} from './heroBodyManifests';
import { HERO_BODY_BOT_MARKER_PART } from './heroBodyGeneratedParts';
import { getHeroBodyRenderParts } from './heroBodyRenderParts';
import type { HeroBodyManifest, RemoteBodySocketMarker, VoxelPart } from './heroBodyTypes';
import { getSocketMetadata } from './modelSocketMetadata';
import { VIEWMODEL_MODEL_DOCUMENTS } from '../viewmodel/viewmodelManifests';

type DocumentPartSource = VoxelPart | typeof HERO_BODY_BOT_MARKER_PART;

function toModelPartDescriptor(part: DocumentPartSource): ModelPartDescriptor {
  return {
    id: part.id,
    kind: part.kind,
    material: part.material,
    bone: part.bone,
    position: part.position,
    scale: part.scale,
    rotation: part.rotation,
    emissive: part.emissive,
    transparent: part.transparent,
    generated: part.generated,
  };
}

function toModelSocketDescriptor(marker: RemoteBodySocketMarker): ModelSocketDescriptor {
  const metadata = getSocketMetadata(marker.socketName);

  return {
    id: marker.id,
    role: metadata.role,
    name: marker.socketName,
    side: metadata.side,
    ownerScope: 'remoteBody',
    bone: marker.bone,
    position: marker.position,
    rotation: marker.rotation,
    fallbackOffset: metadata.fallbackOffset,
  };
}

function defaultFallbackSocketsForHero(heroId: HeroId): HeroModelDocumentV1['defaultFallbackSockets'] {
  switch (heroId) {
    case 'phantom':
      return {
        primaryPalm: PHANTOM_DIRE_BALL_SOCKET,
        voidRayOrb: PHANTOM_VOID_RAY_SOCKET,
      };
    case 'hookshot':
      return { hookTip: HOOKSHOT_CHAIN_SOCKET };
    case 'blaze':
      return { staffTip: BLAZE_ROCKET_STAFF_SOCKET };
    case 'chronos':
      return { chronosPrimaryOrb: CHRONOS_PRIMARY_ORB_SOCKET };
  }
}

const VOID_MONARCH_VIEWMODEL_PARTS: readonly ModelPartDescriptor[] = [
  { id: 'phantom.void-monarch.viewmodel.left.knuckleCap', material: 'metal', bone: 'leftForearm', position: [-0.19, -0.255, -0.38], scale: [0.07, 0.018, 0.032] },
  { id: 'phantom.void-monarch.viewmodel.right.knuckleCap', material: 'metal', bone: 'rightForearm', position: [0.19, -0.255, -0.38], scale: [0.07, 0.018, 0.032] },
  { id: 'phantom.void-monarch.viewmodel.left.wristTrim', material: 'accent', bone: 'leftForearm', position: [-0.24, -0.052, -0.25], scale: [0.08, 0.018, 0.018], emissive: true },
  { id: 'phantom.void-monarch.viewmodel.right.wristTrim', material: 'accent', bone: 'rightForearm', position: [0.24, -0.052, -0.25], scale: [0.08, 0.018, 0.018], emissive: true },
  { id: 'phantom.void-monarch.viewmodel.voidRayOrb.crystalShell', material: 'glass', bone: 'root', kind: 'sphere', position: [0, -0.12, -0.72], scale: [0.14, 0.14, 0.14], transparent: true },
];

const TIDEBREAKER_VIEWMODEL_PARTS: readonly ModelPartDescriptor[] = [
  { id: 'hookshot.tidebreaker.viewmodel.left.brassClamp', material: 'metal', bone: 'leftForearm', position: [-0.2, -0.055, -0.31], scale: [0.1, 0.018, 0.034] },
  { id: 'hookshot.tidebreaker.viewmodel.right.brassClamp', material: 'metal', bone: 'rightForearm', position: [0.2, -0.055, -0.31], scale: [0.1, 0.018, 0.034] },
  { id: 'hookshot.tidebreaker.viewmodel.left.anchorCore', material: 'accent', bone: 'leftForearm', position: [-0.2, -0.1, -0.48], scale: [0.052, 0.052, 0.026], emissive: true },
  { id: 'hookshot.tidebreaker.viewmodel.right.anchorCore', material: 'accent', bone: 'rightForearm', position: [0.2, -0.1, -0.48], scale: [0.052, 0.052, 0.026], emissive: true },
  { id: 'hookshot.tidebreaker.viewmodel.left.hookBarbA', material: 'glow', bone: 'leftForearm', position: [-0.25, -0.1, -0.93], scale: [0.028, 0.038, 0.13], rotation: [0, 0.36, 0], emissive: true },
  { id: 'hookshot.tidebreaker.viewmodel.left.hookBarbB', material: 'glow', bone: 'leftForearm', position: [-0.15, -0.1, -0.93], scale: [0.028, 0.038, 0.13], rotation: [0, -0.36, 0], emissive: true },
  { id: 'hookshot.tidebreaker.viewmodel.right.hookBarbA', material: 'glow', bone: 'rightForearm', position: [0.15, -0.1, -0.93], scale: [0.028, 0.038, 0.13], rotation: [0, 0.36, 0], emissive: true },
  { id: 'hookshot.tidebreaker.viewmodel.right.hookBarbB', material: 'glow', bone: 'rightForearm', position: [0.25, -0.1, -0.93], scale: [0.028, 0.038, 0.13], rotation: [0, -0.36, 0], emissive: true },
];

const SOLAR_FORGE_VIEWMODEL_PARTS: readonly ModelPartDescriptor[] = [
  { id: 'blaze.solar-forge.viewmodel.left.ventTrim', material: 'metal', bone: 'leftForearm', position: [-0.24, -0.052, -0.25], scale: [0.08, 0.018, 0.018] },
  { id: 'blaze.solar-forge.viewmodel.right.ventTrim', material: 'metal', bone: 'rightForearm', position: [0.24, -0.052, -0.25], scale: [0.08, 0.018, 0.018] },
  { id: 'blaze.solar-forge.viewmodel.left.emberVent', material: 'glow', bone: 'leftForearm', position: [-0.24, -0.115, -0.36], scale: [0.042, 0.026, 0.024], emissive: true },
  { id: 'blaze.solar-forge.viewmodel.right.emberVent', material: 'glow', bone: 'rightForearm', position: [0.24, -0.115, -0.36], scale: [0.042, 0.026, 0.024], emissive: true },
  { id: 'blaze.solar-forge.viewmodel.staff.solarRing', material: 'accent', bone: 'rightForearm', kind: 'cylinder', position: [0.32, -0.07, -0.91], scale: [0.11, 0.016, 0.11], emissive: true },
  { id: 'blaze.solar-forge.viewmodel.staff.goldCap', material: 'metal', bone: 'rightForearm', kind: 'cylinder', position: [0.32, -0.07, -0.82], scale: [0.064, 0.018, 0.064] },
  { id: 'blaze.solar-forge.viewmodel.staff.whiteCore', material: 'glow', bone: 'rightForearm', kind: 'sphere', position: [0.32, -0.07, -0.99], scale: [0.062, 0.062, 0.062], emissive: true, transparent: true },
];

const EPOCH_REGENT_VIEWMODEL_PARTS: readonly ModelPartDescriptor[] = [
  { id: 'chronos.epoch-regent.viewmodel.left.wristTrim', material: 'metal', bone: 'leftForearm', position: [-0.24, -0.052, -0.25], scale: [0.08, 0.018, 0.018] },
  { id: 'chronos.epoch-regent.viewmodel.right.wristTrim', material: 'metal', bone: 'rightForearm', position: [0.24, -0.052, -0.25], scale: [0.08, 0.018, 0.018] },
  { id: 'chronos.epoch-regent.viewmodel.left.paradoxRune', material: 'accent', bone: 'leftForearm', position: [-0.24, -0.105, -0.35], scale: [0.034, 0.034, 0.018], emissive: true },
  { id: 'chronos.epoch-regent.viewmodel.right.paradoxRune', material: 'accent', bone: 'rightForearm', position: [0.24, -0.105, -0.35], scale: [0.034, 0.034, 0.018], emissive: true },
  { id: 'chronos.epoch-regent.viewmodel.pyramid.innerGlass', material: 'glass', bone: 'root', kind: 'cone', position: [0, -0.12, -0.66], scale: [0.105, 0.245, 0.105], rotation: [0, 0, Math.PI / 4], transparent: true },
  { id: 'chronos.epoch-regent.viewmodel.primaryOrb.crown', material: 'metal', bone: 'root', kind: 'cylinder', position: [0, -0.12, -0.78], scale: [0.105, 0.014, 0.105] },
  { id: 'chronos.epoch-regent.viewmodel.aegis.regentTop', material: 'glow', bone: 'root', position: [0, 0.2, -0.7], scale: [0.62, 0.016, 0.02], emissive: true, transparent: true },
  { id: 'chronos.epoch-regent.viewmodel.aegis.regentBottom', material: 'glow', bone: 'root', position: [0, -0.2, -0.7], scale: [0.62, 0.016, 0.02], emissive: true, transparent: true },
];

const NIGHTGLASS_WRAITH_VIEWMODEL_PARTS: readonly ModelPartDescriptor[] = [
  { id: 'phantom.nightglass-wraith.viewmodel.left.glassBrace', material: 'glass', bone: 'leftForearm', position: [-0.24, -0.08, -0.34], scale: [0.08, 0.026, 0.04], transparent: true },
  { id: 'phantom.nightglass-wraith.viewmodel.right.glassBrace', material: 'glass', bone: 'rightForearm', position: [0.24, -0.08, -0.34], scale: [0.08, 0.026, 0.04], transparent: true },
  { id: 'phantom.nightglass-wraith.viewmodel.left.wraithRune', material: 'glow', bone: 'leftForearm', position: [-0.24, -0.13, -0.43], scale: [0.036, 0.036, 0.018], emissive: true },
  { id: 'phantom.nightglass-wraith.viewmodel.right.wraithRune', material: 'glow', bone: 'rightForearm', position: [0.24, -0.13, -0.43], scale: [0.036, 0.036, 0.018], emissive: true },
  { id: 'phantom.nightglass-wraith.viewmodel.voidRayOrb.smokedShell', material: 'glass', bone: 'root', kind: 'sphere', position: [0, -0.12, -0.73], scale: [0.13, 0.13, 0.13], transparent: true },
];

const ASTRAL_EXECUTIONER_VIEWMODEL_PARTS: readonly ModelPartDescriptor[] = [
  { id: 'phantom.astral-executioner.viewmodel.left.executionerBlade', material: 'edge', bone: 'leftForearm', position: [-0.3, -0.11, -0.62], scale: [0.03, 0.05, 0.18], rotation: [0, 0.28, 0], emissive: true },
  { id: 'phantom.astral-executioner.viewmodel.right.executionerBlade', material: 'edge', bone: 'rightForearm', position: [0.3, -0.11, -0.62], scale: [0.03, 0.05, 0.18], rotation: [0, -0.28, 0], emissive: true },
  { id: 'phantom.astral-executioner.viewmodel.left.starClamp', material: 'metal', bone: 'leftForearm', position: [-0.23, -0.055, -0.32], scale: [0.09, 0.018, 0.034] },
  { id: 'phantom.astral-executioner.viewmodel.right.starClamp', material: 'metal', bone: 'rightForearm', position: [0.23, -0.055, -0.32], scale: [0.09, 0.018, 0.034] },
  { id: 'phantom.astral-executioner.viewmodel.orb.astralHalo', material: 'glow', bone: 'root', kind: 'cylinder', position: [0, -0.12, -0.78], scale: [0.18, 0.012, 0.18], rotation: [Math.PI / 2, 0, 0], emissive: true, transparent: true },
  { id: 'phantom.astral-executioner.viewmodel.orb.innerStar', material: 'glass', bone: 'root', kind: 'sphere', position: [0, -0.12, -0.72], scale: [0.09, 0.09, 0.09], emissive: true, transparent: true },
];

const ECLIPSE_SERAPH_VIEWMODEL_PARTS: readonly ModelPartDescriptor[] = [
  { id: 'phantom.eclipse-seraph.viewmodel.left.goldBrace', material: 'metal', bone: 'leftForearm', position: [-0.24, -0.052, -0.3], scale: [0.1, 0.018, 0.036], emissive: true },
  { id: 'phantom.eclipse-seraph.viewmodel.right.goldBrace', material: 'metal', bone: 'rightForearm', position: [0.24, -0.052, -0.3], scale: [0.1, 0.018, 0.036], emissive: true },
  { id: 'phantom.eclipse-seraph.viewmodel.left.seraphWing', material: 'glow', bone: 'leftForearm', position: [-0.33, -0.12, -0.56], scale: [0.034, 0.12, 0.2], rotation: [0, 0.32, 0], emissive: true, transparent: true },
  { id: 'phantom.eclipse-seraph.viewmodel.right.seraphWing', material: 'glow', bone: 'rightForearm', position: [0.33, -0.12, -0.56], scale: [0.034, 0.12, 0.2], rotation: [0, -0.32, 0], emissive: true, transparent: true },
  { id: 'phantom.eclipse-seraph.viewmodel.orb.outerHalo', material: 'glow', bone: 'root', kind: 'cylinder', position: [0, -0.12, -0.8], scale: [0.2, 0.012, 0.2], rotation: [Math.PI / 2, 0, 0], emissive: true, transparent: true },
  { id: 'phantom.eclipse-seraph.viewmodel.orb.crownRing', material: 'metal', bone: 'root', kind: 'cylinder', position: [0, -0.12, -0.76], scale: [0.14, 0.014, 0.14], rotation: [Math.PI / 2, 0, 0], emissive: true },
  { id: 'phantom.eclipse-seraph.viewmodel.orb.prismCore', material: 'glass', bone: 'root', kind: 'sphere', position: [0, -0.12, -0.72], scale: [0.105, 0.105, 0.105], emissive: true, transparent: true },
];

const IRON_LEVIATHAN_VIEWMODEL_PARTS: readonly ModelPartDescriptor[] = [
  { id: 'hookshot.iron-leviathan.viewmodel.left.ironClamp', material: 'metal', bone: 'leftForearm', position: [-0.2, -0.055, -0.31], scale: [0.11, 0.02, 0.036] },
  { id: 'hookshot.iron-leviathan.viewmodel.right.ironClamp', material: 'metal', bone: 'rightForearm', position: [0.2, -0.055, -0.31], scale: [0.11, 0.02, 0.036] },
  { id: 'hookshot.iron-leviathan.viewmodel.left.keelCore', material: 'accent', bone: 'leftForearm', position: [-0.2, -0.11, -0.48], scale: [0.046, 0.06, 0.026], emissive: true },
  { id: 'hookshot.iron-leviathan.viewmodel.right.keelCore', material: 'accent', bone: 'rightForearm', position: [0.2, -0.11, -0.48], scale: [0.046, 0.06, 0.026], emissive: true },
  { id: 'hookshot.iron-leviathan.viewmodel.left.heavyHook', material: 'glow', bone: 'leftForearm', position: [-0.2, -0.1, -0.94], scale: [0.04, 0.048, 0.16], emissive: true },
  { id: 'hookshot.iron-leviathan.viewmodel.right.heavyHook', material: 'glow', bone: 'rightForearm', position: [0.2, -0.1, -0.94], scale: [0.04, 0.048, 0.16], emissive: true },
];

const ABYSSAL_CORSAIR_VIEWMODEL_PARTS: readonly ModelPartDescriptor[] = [
  { id: 'hookshot.abyssal-corsair.viewmodel.left.lanternCore', material: 'glass', bone: 'leftForearm', kind: 'sphere', position: [-0.2, -0.12, -0.5], scale: [0.062, 0.062, 0.062], emissive: true, transparent: true },
  { id: 'hookshot.abyssal-corsair.viewmodel.right.lanternCore', material: 'glass', bone: 'rightForearm', kind: 'sphere', position: [0.2, -0.12, -0.5], scale: [0.062, 0.062, 0.062], emissive: true, transparent: true },
  { id: 'hookshot.abyssal-corsair.viewmodel.left.corsairFin', material: 'edge', bone: 'leftForearm', position: [-0.28, -0.1, -0.88], scale: [0.032, 0.046, 0.16], rotation: [0, 0.46, 0], emissive: true },
  { id: 'hookshot.abyssal-corsair.viewmodel.left.corsairHook', material: 'glow', bone: 'leftForearm', position: [-0.12, -0.1, -0.9], scale: [0.034, 0.044, 0.14], rotation: [0, -0.46, 0], emissive: true },
  { id: 'hookshot.abyssal-corsair.viewmodel.right.corsairHook', material: 'glow', bone: 'rightForearm', position: [0.12, -0.1, -0.9], scale: [0.034, 0.044, 0.14], rotation: [0, 0.46, 0], emissive: true },
  { id: 'hookshot.abyssal-corsair.viewmodel.right.corsairFin', material: 'edge', bone: 'rightForearm', position: [0.28, -0.1, -0.88], scale: [0.032, 0.046, 0.16], rotation: [0, -0.46, 0], emissive: true },
];

const KRAKEN_SOVEREIGN_VIEWMODEL_PARTS: readonly ModelPartDescriptor[] = [
  { id: 'hookshot.kraken-sovereign.viewmodel.left.crownClamp', material: 'metal', bone: 'leftForearm', position: [-0.2, -0.055, -0.31], scale: [0.12, 0.02, 0.038], emissive: true },
  { id: 'hookshot.kraken-sovereign.viewmodel.right.crownClamp', material: 'metal', bone: 'rightForearm', position: [0.2, -0.055, -0.31], scale: [0.12, 0.02, 0.038], emissive: true },
  { id: 'hookshot.kraken-sovereign.viewmodel.left.anchorHalo', material: 'glow', bone: 'leftForearm', kind: 'cylinder', position: [-0.2, -0.1, -0.7], scale: [0.16, 0.012, 0.16], rotation: [Math.PI / 2, 0, 0], emissive: true, transparent: true },
  { id: 'hookshot.kraken-sovereign.viewmodel.right.anchorHalo', material: 'glow', bone: 'rightForearm', kind: 'cylinder', position: [0.2, -0.1, -0.7], scale: [0.16, 0.012, 0.16], rotation: [Math.PI / 2, 0, 0], emissive: true, transparent: true },
  { id: 'hookshot.kraken-sovereign.viewmodel.left.royalBarbA', material: 'glow', bone: 'leftForearm', position: [-0.3, -0.1, -0.96], scale: [0.04, 0.05, 0.18], rotation: [0, 0.5, 0], emissive: true },
  { id: 'hookshot.kraken-sovereign.viewmodel.left.royalBarbB', material: 'glow', bone: 'leftForearm', position: [-0.1, -0.1, -0.96], scale: [0.04, 0.05, 0.18], rotation: [0, -0.5, 0], emissive: true },
  { id: 'hookshot.kraken-sovereign.viewmodel.right.royalBarbA', material: 'glow', bone: 'rightForearm', position: [0.1, -0.1, -0.96], scale: [0.04, 0.05, 0.18], rotation: [0, 0.5, 0], emissive: true },
  { id: 'hookshot.kraken-sovereign.viewmodel.right.royalBarbB', material: 'glow', bone: 'rightForearm', position: [0.3, -0.1, -0.96], scale: [0.04, 0.05, 0.18], rotation: [0, -0.5, 0], emissive: true },
];

const ASHEN_VANGUARD_VIEWMODEL_PARTS: readonly ModelPartDescriptor[] = [
  { id: 'blaze.ashen-vanguard.viewmodel.left.ashPlate', material: 'metal', bone: 'leftForearm', position: [-0.24, -0.052, -0.25], scale: [0.09, 0.02, 0.022] },
  { id: 'blaze.ashen-vanguard.viewmodel.right.ashPlate', material: 'metal', bone: 'rightForearm', position: [0.24, -0.052, -0.25], scale: [0.09, 0.02, 0.022] },
  { id: 'blaze.ashen-vanguard.viewmodel.left.emberSlot', material: 'glow', bone: 'leftForearm', position: [-0.24, -0.115, -0.36], scale: [0.04, 0.03, 0.024], emissive: true },
  { id: 'blaze.ashen-vanguard.viewmodel.right.emberSlot', material: 'glow', bone: 'rightForearm', position: [0.24, -0.115, -0.36], scale: [0.04, 0.03, 0.024], emissive: true },
  { id: 'blaze.ashen-vanguard.viewmodel.staff.ironBand', material: 'metal', bone: 'rightForearm', kind: 'cylinder', position: [0.32, -0.07, -0.84], scale: [0.072, 0.02, 0.072] },
  { id: 'blaze.ashen-vanguard.viewmodel.staff.emberCore', material: 'glow', bone: 'rightForearm', kind: 'sphere', position: [0.32, -0.07, -0.98], scale: [0.058, 0.058, 0.058], emissive: true, transparent: true },
];

const INFERNO_ARCHON_VIEWMODEL_PARTS: readonly ModelPartDescriptor[] = [
  { id: 'blaze.inferno-archon.viewmodel.left.archonWing', material: 'glow', bone: 'leftForearm', position: [-0.32, -0.11, -0.52], scale: [0.034, 0.12, 0.18], rotation: [0, 0.26, 0], emissive: true, transparent: true },
  { id: 'blaze.inferno-archon.viewmodel.right.archonWing', material: 'glow', bone: 'rightForearm', position: [0.32, -0.11, -0.52], scale: [0.034, 0.12, 0.18], rotation: [0, -0.26, 0], emissive: true, transparent: true },
  { id: 'blaze.inferno-archon.viewmodel.left.goldBrace', material: 'metal', bone: 'leftForearm', position: [-0.24, -0.052, -0.27], scale: [0.1, 0.018, 0.024], emissive: true },
  { id: 'blaze.inferno-archon.viewmodel.right.goldBrace', material: 'metal', bone: 'rightForearm', position: [0.24, -0.052, -0.27], scale: [0.1, 0.018, 0.024], emissive: true },
  { id: 'blaze.inferno-archon.viewmodel.staff.archonRing', material: 'accent', bone: 'rightForearm', kind: 'cylinder', position: [0.32, -0.07, -0.92], scale: [0.13, 0.014, 0.13], emissive: true },
  { id: 'blaze.inferno-archon.viewmodel.staff.plasmaCore', material: 'glow', bone: 'rightForearm', kind: 'sphere', position: [0.32, -0.07, -1], scale: [0.066, 0.066, 0.066], emissive: true, transparent: true },
];

const STARFALL_PHOENIX_VIEWMODEL_PARTS: readonly ModelPartDescriptor[] = [
  { id: 'blaze.starfall-phoenix.viewmodel.left.phoenixFeatherA', material: 'glow', bone: 'leftForearm', position: [-0.34, -0.1, -0.5], scale: [0.034, 0.14, 0.2], rotation: [0, 0.32, 0], emissive: true, transparent: true },
  { id: 'blaze.starfall-phoenix.viewmodel.left.phoenixFeatherB', material: 'accent', bone: 'leftForearm', position: [-0.25, -0.15, -0.58], scale: [0.028, 0.1, 0.17], rotation: [0, 0.12, 0], emissive: true, transparent: true },
  { id: 'blaze.starfall-phoenix.viewmodel.right.phoenixFeatherA', material: 'glow', bone: 'rightForearm', position: [0.34, -0.1, -0.5], scale: [0.034, 0.14, 0.2], rotation: [0, -0.32, 0], emissive: true, transparent: true },
  { id: 'blaze.starfall-phoenix.viewmodel.right.phoenixFeatherB', material: 'accent', bone: 'rightForearm', position: [0.25, -0.15, -0.58], scale: [0.028, 0.1, 0.17], rotation: [0, -0.12, 0], emissive: true, transparent: true },
  { id: 'blaze.starfall-phoenix.viewmodel.staff.sunHalo', material: 'glow', bone: 'rightForearm', kind: 'cylinder', position: [0.32, -0.07, -0.93], scale: [0.16, 0.012, 0.16], emissive: true, transparent: true },
  { id: 'blaze.starfall-phoenix.viewmodel.staff.starCore', material: 'glass', bone: 'rightForearm', kind: 'sphere', position: [0.32, -0.07, -1.02], scale: [0.08, 0.08, 0.08], emissive: true, transparent: true },
  { id: 'blaze.starfall-phoenix.viewmodel.staff.crownSpark', material: 'metal', bone: 'rightForearm', kind: 'cone', position: [0.32, -0.07, -1.11], scale: [0.055, 0.11, 0.055], emissive: true },
];

const PARADOX_SENTINEL_VIEWMODEL_PARTS: readonly ModelPartDescriptor[] = [
  { id: 'chronos.paradox-sentinel.viewmodel.left.dialTrim', material: 'metal', bone: 'leftForearm', position: [-0.24, -0.052, -0.25], scale: [0.09, 0.018, 0.02] },
  { id: 'chronos.paradox-sentinel.viewmodel.right.dialTrim', material: 'metal', bone: 'rightForearm', position: [0.24, -0.052, -0.25], scale: [0.09, 0.018, 0.02] },
  { id: 'chronos.paradox-sentinel.viewmodel.left.clockFace', material: 'glow', bone: 'leftForearm', kind: 'cylinder', position: [-0.24, -0.105, -0.35], scale: [0.056, 0.012, 0.056], rotation: [Math.PI / 2, 0, 0], emissive: true },
  { id: 'chronos.paradox-sentinel.viewmodel.right.clockFace', material: 'glow', bone: 'rightForearm', kind: 'cylinder', position: [0.24, -0.105, -0.35], scale: [0.056, 0.012, 0.056], rotation: [Math.PI / 2, 0, 0], emissive: true },
  { id: 'chronos.paradox-sentinel.viewmodel.primaryOrb.sentinelBand', material: 'metal', bone: 'root', kind: 'cylinder', position: [0, -0.12, -0.78], scale: [0.11, 0.014, 0.11] },
  { id: 'chronos.paradox-sentinel.viewmodel.aegis.sentinelTop', material: 'glow', bone: 'root', position: [0, 0.2, -0.7], scale: [0.58, 0.016, 0.02], emissive: true, transparent: true },
];

const MERIDIAN_ORACLE_VIEWMODEL_PARTS: readonly ModelPartDescriptor[] = [
  { id: 'chronos.meridian-oracle.viewmodel.left.oracleRune', material: 'accent', bone: 'leftForearm', position: [-0.24, -0.105, -0.35], scale: [0.038, 0.038, 0.018], emissive: true },
  { id: 'chronos.meridian-oracle.viewmodel.right.oracleRune', material: 'accent', bone: 'rightForearm', position: [0.24, -0.105, -0.35], scale: [0.038, 0.038, 0.018], emissive: true },
  { id: 'chronos.meridian-oracle.viewmodel.left.prismBrace', material: 'glass', bone: 'leftForearm', position: [-0.24, -0.052, -0.27], scale: [0.09, 0.018, 0.022], transparent: true },
  { id: 'chronos.meridian-oracle.viewmodel.right.prismBrace', material: 'glass', bone: 'rightForearm', position: [0.24, -0.052, -0.27], scale: [0.09, 0.018, 0.022], transparent: true },
  { id: 'chronos.meridian-oracle.viewmodel.primaryOrb.meridianRing', material: 'glow', bone: 'root', kind: 'cylinder', position: [0, -0.12, -0.78], scale: [0.16, 0.012, 0.16], rotation: [Math.PI / 2, 0, 0], emissive: true, transparent: true },
  { id: 'chronos.meridian-oracle.viewmodel.primaryOrb.prismCore', material: 'glass', bone: 'root', kind: 'sphere', position: [0, -0.12, -0.72], scale: [0.08, 0.08, 0.08], emissive: true, transparent: true },
  { id: 'chronos.meridian-oracle.viewmodel.aegis.oracleCrossbar', material: 'accent', bone: 'root', position: [0, 0, -0.7], scale: [0.68, 0.014, 0.018], emissive: true, transparent: true },
];

const ETERNITY_SOVEREIGN_VIEWMODEL_PARTS: readonly ModelPartDescriptor[] = [
  { id: 'chronos.eternity-sovereign.viewmodel.left.crownTrim', material: 'metal', bone: 'leftForearm', position: [-0.24, -0.052, -0.25], scale: [0.1, 0.018, 0.024], emissive: true },
  { id: 'chronos.eternity-sovereign.viewmodel.right.crownTrim', material: 'metal', bone: 'rightForearm', position: [0.24, -0.052, -0.25], scale: [0.1, 0.018, 0.024], emissive: true },
  { id: 'chronos.eternity-sovereign.viewmodel.left.eternalDial', material: 'glow', bone: 'leftForearm', kind: 'cylinder', position: [-0.24, -0.105, -0.35], scale: [0.07, 0.012, 0.07], rotation: [Math.PI / 2, 0, 0], emissive: true, transparent: true },
  { id: 'chronos.eternity-sovereign.viewmodel.right.eternalDial', material: 'glow', bone: 'rightForearm', kind: 'cylinder', position: [0.24, -0.105, -0.35], scale: [0.07, 0.012, 0.07], rotation: [Math.PI / 2, 0, 0], emissive: true, transparent: true },
  { id: 'chronos.eternity-sovereign.viewmodel.primaryOrb.outerCrown', material: 'metal', bone: 'root', kind: 'cylinder', position: [0, -0.12, -0.8], scale: [0.17, 0.014, 0.17], rotation: [Math.PI / 2, 0, 0], emissive: true },
  { id: 'chronos.eternity-sovereign.viewmodel.primaryOrb.eternityHalo', material: 'glow', bone: 'root', kind: 'cylinder', position: [0, -0.12, -0.84], scale: [0.22, 0.012, 0.22], rotation: [Math.PI / 2, 0, 0], emissive: true, transparent: true },
  { id: 'chronos.eternity-sovereign.viewmodel.primaryOrb.whiteCore', material: 'glass', bone: 'root', kind: 'sphere', position: [0, -0.12, -0.72], scale: [0.09, 0.09, 0.09], emissive: true, transparent: true },
  { id: 'chronos.eternity-sovereign.viewmodel.aegis.sovereignTop', material: 'glow', bone: 'root', position: [0, 0.23, -0.7], scale: [0.72, 0.016, 0.02], emissive: true, transparent: true },
  { id: 'chronos.eternity-sovereign.viewmodel.aegis.sovereignBottom', material: 'glow', bone: 'root', position: [0, -0.23, -0.7], scale: [0.72, 0.016, 0.02], emissive: true, transparent: true },
];

function createSkinViewmodelDocument(
  heroId: HeroId,
  colorOverrides: Partial<Record<string, string>>,
  extraParts: readonly ModelPartDescriptor[],
  options: {
    glowIntensity?: number;
    glassIntensity?: number;
    accentIntensity?: number;
  } = {}
): ViewmodelModelDocument {
  const base = VIEWMODEL_MODEL_DOCUMENTS[heroId];

  return {
    ...base,
    materials: base.materials.map((material): ModelMaterialDescriptor => ({
      ...material,
      color: colorOverrides[material.token] ?? material.color,
      emissiveIntensity: material.token === 'glow'
        ? options.glowIntensity ?? 0.9
        : material.token === 'glass'
          ? options.glassIntensity ?? 0.38
          : material.token === 'accent' && options.accentIntensity !== undefined
            ? options.accentIntensity
            : material.emissiveIntensity,
    })),
    parts: [
      ...base.parts,
      ...extraParts,
    ],
  };
}

const VIEWMODEL_DOCUMENTS_BY_SKIN: Record<HeroSkinId, ViewmodelModelDocument> = {
  'phantom.default': VIEWMODEL_MODEL_DOCUMENTS.phantom,
  'hookshot.default': VIEWMODEL_MODEL_DOCUMENTS.hookshot,
  'blaze.default': VIEWMODEL_MODEL_DOCUMENTS.blaze,
  'chronos.default': VIEWMODEL_MODEL_DOCUMENTS.chronos,
  'phantom.void-monarch': createSkinViewmodelDocument('phantom', VOID_MONARCH_COLORS, VOID_MONARCH_VIEWMODEL_PARTS),
  'phantom.nightglass-wraith': createSkinViewmodelDocument('phantom', NIGHTGLASS_WRAITH_COLORS, NIGHTGLASS_WRAITH_VIEWMODEL_PARTS, {
    accentIntensity: 0.5,
    glassIntensity: 0.42,
    glowIntensity: 0.92,
  }),
  'phantom.astral-executioner': createSkinViewmodelDocument('phantom', ASTRAL_EXECUTIONER_COLORS, ASTRAL_EXECUTIONER_VIEWMODEL_PARTS, {
    accentIntensity: 0.62,
    glassIntensity: 0.48,
    glowIntensity: 1.05,
  }),
  'phantom.eclipse-seraph': createSkinViewmodelDocument('phantom', ECLIPSE_SERAPH_COLORS, ECLIPSE_SERAPH_VIEWMODEL_PARTS, {
    accentIntensity: 0.72,
    glassIntensity: 0.52,
    glowIntensity: 1.18,
  }),
  'hookshot.tidebreaker': createSkinViewmodelDocument('hookshot', TIDEBREAKER_COLORS, TIDEBREAKER_VIEWMODEL_PARTS, {
    accentIntensity: 0.48,
    glassIntensity: 0.34,
    glowIntensity: 0.82,
  }),
  'hookshot.iron-leviathan': createSkinViewmodelDocument('hookshot', IRON_LEVIATHAN_COLORS, IRON_LEVIATHAN_VIEWMODEL_PARTS, {
    accentIntensity: 0.5,
    glassIntensity: 0.36,
    glowIntensity: 0.86,
  }),
  'hookshot.abyssal-corsair': createSkinViewmodelDocument('hookshot', ABYSSAL_CORSAIR_COLORS, ABYSSAL_CORSAIR_VIEWMODEL_PARTS, {
    accentIntensity: 0.62,
    glassIntensity: 0.48,
    glowIntensity: 1.02,
  }),
  'hookshot.kraken-sovereign': createSkinViewmodelDocument('hookshot', KRAKEN_SOVEREIGN_COLORS, KRAKEN_SOVEREIGN_VIEWMODEL_PARTS, {
    accentIntensity: 0.72,
    glassIntensity: 0.52,
    glowIntensity: 1.16,
  }),
  'blaze.solar-forge': createSkinViewmodelDocument('blaze', SOLAR_FORGE_COLORS, SOLAR_FORGE_VIEWMODEL_PARTS, {
    accentIntensity: 0.5,
    glassIntensity: 0.42,
    glowIntensity: 1,
  }),
  'blaze.ashen-vanguard': createSkinViewmodelDocument('blaze', ASHEN_VANGUARD_COLORS, ASHEN_VANGUARD_VIEWMODEL_PARTS, {
    accentIntensity: 0.5,
    glassIntensity: 0.36,
    glowIntensity: 0.94,
  }),
  'blaze.inferno-archon': createSkinViewmodelDocument('blaze', INFERNO_ARCHON_COLORS, INFERNO_ARCHON_VIEWMODEL_PARTS, {
    accentIntensity: 0.66,
    glassIntensity: 0.5,
    glowIntensity: 1.1,
  }),
  'blaze.starfall-phoenix': createSkinViewmodelDocument('blaze', STARFALL_PHOENIX_COLORS, STARFALL_PHOENIX_VIEWMODEL_PARTS, {
    accentIntensity: 0.72,
    glassIntensity: 0.54,
    glowIntensity: 1.22,
  }),
  'chronos.epoch-regent': createSkinViewmodelDocument('chronos', EPOCH_REGENT_COLORS, EPOCH_REGENT_VIEWMODEL_PARTS, {
    accentIntensity: 0.46,
    glassIntensity: 0.4,
    glowIntensity: 0.88,
  }),
  'chronos.paradox-sentinel': createSkinViewmodelDocument('chronos', PARADOX_SENTINEL_COLORS, PARADOX_SENTINEL_VIEWMODEL_PARTS, {
    accentIntensity: 0.52,
    glassIntensity: 0.42,
    glowIntensity: 0.96,
  }),
  'chronos.meridian-oracle': createSkinViewmodelDocument('chronos', MERIDIAN_ORACLE_COLORS, MERIDIAN_ORACLE_VIEWMODEL_PARTS, {
    accentIntensity: 0.64,
    glassIntensity: 0.52,
    glowIntensity: 1.08,
  }),
  'chronos.eternity-sovereign': createSkinViewmodelDocument('chronos', ETERNITY_SOVEREIGN_COLORS, ETERNITY_SOVEREIGN_VIEWMODEL_PARTS, {
    accentIntensity: 0.74,
    glassIntensity: 0.56,
    glowIntensity: 1.22,
  }),
};

function createHeroModelDocument(skinId: HeroSkinId, manifest: HeroBodyManifest): HeroModelDocumentV1 {
  const stats = HERO_DEFINITIONS[manifest.heroId].stats;

  return {
    schemaVersion: HERO_MODEL_DOCUMENT_SCHEMA_VERSION,
    heroId: manifest.heroId,
    materialPalette: manifest.materialPalette,
    fullBody: {
      baseHeight: 1.8,
      bounds: {
        height: stats.size.height,
        width: stats.size.width,
        depth: stats.size.depth,
      },
      parts: [
        ...getHeroBodyRenderParts(manifest.parts),
        HERO_BODY_BOT_MARKER_PART,
      ].map(toModelPartDescriptor),
      teamAccentParts: manifest.teamAccentParts.map(toModelPartDescriptor),
      sockets: manifest.remoteSocketMarkers.map(toModelSocketDescriptor),
      idleProfile: manifest.idleProfile,
      attackDurationSeconds: manifest.attackDurationSeconds,
    },
    viewmodel: VIEWMODEL_DOCUMENTS_BY_SKIN[skinId],
    defaultFallbackSockets: defaultFallbackSocketsForHero(manifest.heroId),
  };
}

const heroSkinModelDocumentCache = new Map<HeroSkinId, HeroModelDocumentV1>();

export function getHeroSkinModelDocument(skinId: HeroSkinId): HeroModelDocumentV1 | undefined {
  const cached = heroSkinModelDocumentCache.get(skinId);
  if (cached) return cached;

  const manifest = HERO_SKIN_BODY_MANIFESTS[skinId];
  if (!manifest) return undefined;

  const document = createHeroModelDocument(skinId, manifest);
  heroSkinModelDocumentCache.set(skinId, document);
  return document;
}

export const HERO_SKIN_MODEL_DOCUMENTS: Record<HeroSkinId, HeroModelDocumentV1> = new Proxy(
  {} as Record<HeroSkinId, HeroModelDocumentV1>,
  {
    get(_target, property): HeroModelDocumentV1 | undefined {
      if (typeof property !== 'string' || !(property in HERO_SKIN_BODY_MANIFESTS)) return undefined;
      return getHeroSkinModelDocument(property as HeroSkinId);
    },
    has(_target, property): boolean {
      return typeof property === 'string' && property in HERO_SKIN_BODY_MANIFESTS;
    },
    ownKeys(): ArrayLike<string | symbol> {
      return Object.keys(HERO_SKIN_BODY_MANIFESTS);
    },
    getOwnPropertyDescriptor(_target, property): PropertyDescriptor | undefined {
      if (typeof property !== 'string' || !(property in HERO_SKIN_BODY_MANIFESTS)) return undefined;
      return {
        enumerable: true,
        configurable: true,
      };
    },
  }
);

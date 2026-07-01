import { memo } from 'react';
import * as THREE from 'three';
import type { HeroSkinId } from '@voxel-strike/shared';
import { SHARED_GEOMETRIES } from './effectResources';
import type { ViewmodelMaterialSet } from './heroViewmodelMaterials';

/**
 * Per-skin first-person overlay geometry.
 *
 * Each full-body hero skin already renders bespoke third-person geometry
 * (via HERO_SKIN_BODY_MANIFESTS). This module gives every non-default skin a
 * matching *first-person* silhouette: small decorative meshes layered onto the
 * hand-authored viewmodel rig so the local player sees their skin on their own
 * arms/weapon, not just a recolor.
 *
 * IMPORTANT — coordinate frames. Overlay parts are authored in the LOCAL frame
 * of the animated group they attach to, using the same conventions as the
 * existing hand-authored meshes in that group. This guarantees the overlay
 * follows the rig's animation (idle bob, recoil, reload, casts) and lines up by
 * construction — it does NOT reuse the data-model `*_VIEWMODEL_PARTS` (those are
 * authored in a different, unused coordinate frame).
 *
 * Attach points (mapped to a real group per hero at the injection site):
 *  - 'forearm': the always-visible animated forearm group. Front/wrist end sits
 *    near z ≈ -0.16, top surface near y ≈ +0.05, half-width x ≈ 0.03.
 *  - 'hand': the palm group (knuckles near z ≈ -0.072, back-of-hand top y ≈ +0.06).
 *  - 'weapon': the dominant-hand weapon prop group (staff/launcher/orb).
 *
 * Materials come from the per-skin ViewmodelMaterialSet, so authoring with a
 * material token automatically picks up that skin's palette (e.g. gold for
 * *.golden, cyan for obsidian-revenant, green for umbral-reaver).
 */

export type ViewmodelOverlayAttach = 'forearm' | 'hand' | 'weapon';
export type ViewmodelOverlayMaterial = keyof ViewmodelMaterialSet;
export type ViewmodelOverlayKind = 'box' | 'sphere' | 'cylinder' | 'cone';

export interface ViewmodelOverlayPart {
  attach: ViewmodelOverlayAttach;
  material: ViewmodelOverlayMaterial;
  /** Primitive shape. Defaults to 'box'. */
  kind?: ViewmodelOverlayKind;
  /** Position in the attach group's local frame (authored for the +1 side). */
  position: readonly [number, number, number];
  scale: readonly [number, number, number];
  rotation?: readonly [number, number, number];
  /**
   * When true (default), the part is mirrored across sides: position.x and
   * rotation.y/z flip with `side`, so a single authored entry produces a
   * symmetric pair across the left/right forearm or hand. Set false for
   * single-sided props (e.g. a right-hand-only weapon flourish).
   */
  mirror?: boolean;
}

function geometryForKind(kind: ViewmodelOverlayKind | undefined): THREE.BufferGeometry {
  switch (kind) {
    case 'sphere':
      return SHARED_GEOMETRIES.sphere12;
    case 'cylinder':
      return SHARED_GEOMETRIES.cylinder12;
    case 'cone':
      return SHARED_GEOMETRIES.cone8;
    case 'box':
    default:
      return SHARED_GEOMETRIES.box;
  }
}

const EMPTY_PARTS: readonly ViewmodelOverlayPart[] = Object.freeze([]);

// ---------------------------------------------------------------------------
// Phantom — void-bent gauntlets. Signature elements sit at the wrist/back of the
// forearm gauntlet; colors come from each skin's ViewmodelMaterialSet.
// ---------------------------------------------------------------------------

const PHANTOM_VOID_MONARCH_OVERLAY: readonly ViewmodelOverlayPart[] = [
  { attach: 'forearm', material: 'metal', position: [0, 0.006, -0.146], scale: [0.088, 0.078, 0.03] },
  { attach: 'forearm', material: 'metal', position: [0, 0.062, -0.185], scale: [0.02, 0.06, 0.03] },
  { attach: 'forearm', material: 'metal', position: [0.03, 0.05, -0.178], scale: [0.016, 0.046, 0.028] },
  { attach: 'forearm', material: 'metal', position: [-0.03, 0.05, -0.178], scale: [0.016, 0.046, 0.028] },
  { attach: 'forearm', material: 'glass', kind: 'sphere', position: [0, 0.03, -0.205], scale: [0.032, 0.032, 0.032] },
  { attach: 'forearm', material: 'accent', position: [0, 0.05, -0.12], scale: [0.06, 0.012, 0.024] },
  { attach: 'hand', material: 'metal', position: [0, 0.03, -0.082], scale: [0.07, 0.02, 0.03] },
];

const PHANTOM_NIGHTGLASS_WRAITH_OVERLAY: readonly ViewmodelOverlayPart[] = [
  { attach: 'forearm', material: 'glass', position: [0, 0.006, -0.146], scale: [0.086, 0.076, 0.03] },
  { attach: 'forearm', material: 'glass', position: [0.02, 0.06, -0.13], scale: [0.03, 0.05, 0.11], rotation: [0.4, 0, 0.24] },
  { attach: 'forearm', material: 'glass', position: [-0.02, 0.06, -0.13], scale: [0.03, 0.05, 0.11], rotation: [0.4, 0, -0.24] },
  { attach: 'forearm', material: 'glow', position: [0, 0.052, -0.18], scale: [0.03, 0.03, 0.014] },
  { attach: 'hand', material: 'glow', position: [0, 0.03, -0.02], scale: [0.03, 0.03, 0.014] },
];

const PHANTOM_ASTRAL_EXECUTIONER_OVERLAY: readonly ViewmodelOverlayPart[] = [
  { attach: 'forearm', material: 'metal', position: [0, 0.006, -0.146], scale: [0.086, 0.076, 0.03] },
  { attach: 'forearm', material: 'metal', position: [0, 0.055, -0.16], scale: [0.05, 0.02, 0.04] },
  { attach: 'forearm', material: 'accent', position: [0.03, 0.0, -0.28], scale: [0.02, 0.05, 0.2], rotation: [0, 0.25, 0] },
  { attach: 'forearm', material: 'glow', position: [0.03, 0.0, -0.4], scale: [0.014, 0.04, 0.12], rotation: [0, 0.25, 0] },
  { attach: 'forearm', material: 'glass', kind: 'sphere', position: [0, 0.036, -0.2], scale: [0.03, 0.03, 0.03] },
];

const PHANTOM_ECLIPSE_SERAPH_OVERLAY: readonly ViewmodelOverlayPart[] = [
  { attach: 'forearm', material: 'metal', position: [0, 0.006, -0.146], scale: [0.09, 0.08, 0.032] },
  { attach: 'forearm', material: 'metal', position: [0, 0.058, -0.12], scale: [0.07, 0.016, 0.06] },
  { attach: 'forearm', material: 'glow', position: [0.036, 0.02, -0.1], scale: [0.02, 0.12, 0.16], rotation: [0, 0.3, 0] },
  { attach: 'forearm', material: 'glass', kind: 'sphere', position: [0, 0.04, -0.2], scale: [0.03, 0.03, 0.03] },
  { attach: 'hand', material: 'glow', kind: 'cylinder', position: [0, 0.02, -0.03], scale: [0.12, 0.012, 0.12], rotation: [Math.PI / 2, 0, 0] },
];

const PHANTOM_UMBRAL_REAVER_OVERLAY: readonly ViewmodelOverlayPart[] = [
  { attach: 'forearm', material: 'metal', position: [0, 0.006, -0.146], scale: [0.086, 0.076, 0.03] },
  { attach: 'forearm', material: 'glow', position: [0.028, 0.02, -0.26], scale: [0.018, 0.05, 0.18], rotation: [0, 0.28, 0] },
  { attach: 'forearm', material: 'glow', position: [0, 0.052, -0.17], scale: [0.03, 0.03, 0.014] },
  { attach: 'forearm', material: 'metal', position: [0, 0.06, -0.1], scale: [0.04, 0.04, 0.05], rotation: [0.3, 0, 0] },
  { attach: 'hand', material: 'glow', position: [0, 0.03, -0.02], scale: [0.028, 0.028, 0.014] },
];

const PHANTOM_OBSIDIAN_REVENANT_OVERLAY: readonly ViewmodelOverlayPart[] = [
  { attach: 'forearm', material: 'glass', position: [0, 0.006, -0.146], scale: [0.088, 0.078, 0.03] },
  { attach: 'forearm', material: 'glass', position: [0, 0.05, -0.1], scale: [0.07, 0.03, 0.09] },
  { attach: 'forearm', material: 'glow', kind: 'sphere', position: [0, 0.04, -0.2], scale: [0.034, 0.034, 0.034] },
  { attach: 'forearm', material: 'glass', position: [0.03, 0.05, -0.14], scale: [0.02, 0.05, 0.06], rotation: [0.3, 0, 0.2] },
  { attach: 'hand', material: 'glow', kind: 'sphere', position: [0, 0.03, -0.02], scale: [0.03, 0.03, 0.03] },
];

const PHANTOM_GOLDEN_OVERLAY: readonly ViewmodelOverlayPart[] = [
  { attach: 'forearm', material: 'metal', position: [0, 0.006, -0.146], scale: [0.092, 0.082, 0.034] },
  { attach: 'forearm', material: 'metal', position: [0, 0.06, -0.09], scale: [0.06, 0.02, 0.14] },
  { attach: 'forearm', material: 'metal', position: [0, 0.066, -0.185], scale: [0.022, 0.06, 0.03] },
  { attach: 'forearm', material: 'metal', position: [0.03, 0.052, -0.178], scale: [0.016, 0.046, 0.028] },
  { attach: 'forearm', material: 'metal', position: [-0.03, 0.052, -0.178], scale: [0.016, 0.046, 0.028] },
  { attach: 'forearm', material: 'glow', kind: 'cylinder', position: [0, 0.03, -0.22], scale: [0.14, 0.012, 0.14], rotation: [Math.PI / 2, 0, 0] },
  { attach: 'hand', material: 'metal', position: [0, 0.03, -0.082], scale: [0.075, 0.022, 0.032] },
];

const SKIN_OVERLAY_PARTS: Partial<Record<HeroSkinId, readonly ViewmodelOverlayPart[]>> = {
  'phantom.void-monarch': PHANTOM_VOID_MONARCH_OVERLAY,
  'phantom.nightglass-wraith': PHANTOM_NIGHTGLASS_WRAITH_OVERLAY,
  'phantom.astral-executioner': PHANTOM_ASTRAL_EXECUTIONER_OVERLAY,
  'phantom.eclipse-seraph': PHANTOM_ECLIPSE_SERAPH_OVERLAY,
  'phantom.umbral-reaver': PHANTOM_UMBRAL_REAVER_OVERLAY,
  'phantom.obsidian-revenant': PHANTOM_OBSIDIAN_REVENANT_OVERLAY,
  'phantom.golden': PHANTOM_GOLDEN_OVERLAY,
};

export function hasViewmodelSkinOverlay(skinId: HeroSkinId | string | null | undefined): boolean {
  return Boolean(skinId && SKIN_OVERLAY_PARTS[skinId as HeroSkinId]);
}

function getOverlayParts(
  skinId: HeroSkinId | string | null | undefined,
  attach: ViewmodelOverlayAttach
): readonly ViewmodelOverlayPart[] {
  if (!skinId) return EMPTY_PARTS;
  const parts = SKIN_OVERLAY_PARTS[skinId as HeroSkinId];
  if (!parts) return EMPTY_PARTS;
  return parts.filter((part) => part.attach === attach);
}

export interface ViewmodelSkinOverlayProps {
  skinId?: HeroSkinId | string | null;
  side: -1 | 1;
  materials: ViewmodelMaterialSet;
  attach: ViewmodelOverlayAttach;
}

/**
 * Renders the active skin's overlay meshes for one attach point. Mount this as a
 * child of the corresponding animated group (forearm/palm/weapon). Renders
 * nothing for default skins or skins without an authored overlay.
 */
export const ViewmodelSkinOverlay = memo(function ViewmodelSkinOverlay({
  skinId,
  side,
  materials,
  attach,
}: ViewmodelSkinOverlayProps) {
  const parts = getOverlayParts(skinId, attach);
  if (parts.length === 0) return null;

  return (
    <>
      {parts.map((part, index) => {
        const mirror = part.mirror !== false;
        const sideSign = mirror ? side : 1;
        const position: [number, number, number] = [
          part.position[0] * sideSign,
          part.position[1],
          part.position[2],
        ];
        const rotation: [number, number, number] | undefined = part.rotation
          ? [part.rotation[0], part.rotation[1] * sideSign, part.rotation[2] * sideSign]
          : undefined;

        return (
          <mesh
            key={index}
            geometry={geometryForKind(part.kind)}
            material={materials[part.material]}
            position={position}
            scale={part.scale as [number, number, number]}
            rotation={rotation}
          />
        );
      })}
    </>
  );
});

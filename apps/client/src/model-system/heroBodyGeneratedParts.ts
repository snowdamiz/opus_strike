import type { HeroBoneName, MaterialKind, PartKind, VoxelPart } from './heroBodyTypes';

export interface HeroBodyGeneratedBonePart extends VoxelPart {
  generated: true;
}

export interface HeroBodyGeneratedRootPart {
  id: string;
  generated: true;
  kind?: PartKind;
  material: MaterialKind;
  bone: 'root';
  position: [number, number, number];
  scale: [number, number, number];
  rotation?: [number, number, number];
  emissive?: boolean;
  transparent?: boolean;
  fixedEmissiveIntensity?: number;
  materialColorSource?: 'team';
}

function generatedPart(
  id: string,
  bone: HeroBoneName,
  material: MaterialKind,
  position: [number, number, number],
  scale: [number, number, number]
): HeroBodyGeneratedBonePart {
  return {
    id,
    generated: true,
    kind: 'box',
    material,
    bone,
    position,
    scale,
  };
}

export const HERO_BODY_GENERATED_BONE_PARTS: readonly HeroBodyGeneratedBonePart[] = [
  generatedPart('generated.leftKnee.cap', 'leftKnee', 'edge', [0, 0.015, -0.185], [0.18, 0.08, 0.05]),
  generatedPart('generated.leftKnee.glow', 'leftKnee', 'accent', [0, 0.018, -0.222], [0.105, 0.028, 0.026]),
  generatedPart('generated.rightKnee.cap', 'rightKnee', 'edge', [0, 0.015, -0.185], [0.18, 0.08, 0.05]),
  generatedPart('generated.rightKnee.glow', 'rightKnee', 'accent', [0, 0.018, -0.222], [0.105, 0.028, 0.026]),
  generatedPart('generated.leftLeg.upperLink', 'leftLeg', 'dark', [0, -0.15, -0.018], [0.17, 0.3, 0.13]),
  generatedPart('generated.rightLeg.upperLink', 'rightLeg', 'dark', [0, -0.15, -0.018], [0.17, 0.3, 0.13]),
];

export const HERO_BODY_BOT_MARKER_PART: HeroBodyGeneratedRootPart = {
  id: 'generated.root.botMarker',
  generated: true,
  kind: 'box',
  material: 'accent',
  materialColorSource: 'team',
  fixedEmissiveIntensity: 0.75,
  bone: 'root',
  position: [0, 1.98, 0],
  scale: [0.14, 0.04, 0.14],
};

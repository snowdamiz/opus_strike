import type { MaterialKind, PartKind } from './heroBodyTypes';

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

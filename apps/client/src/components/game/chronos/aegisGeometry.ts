import * as THREE from 'three';

export const CHRONOS_AEGIS_PANEL_WIDTH = 6.4;
export const CHRONOS_AEGIS_PANEL_HEIGHT = 3.4;
export const CHRONOS_AEGIS_PANEL_BOW_DEPTH = 0.24;

export function createChronosAegisPanelGeometry(
  width = CHRONOS_AEGIS_PANEL_WIDTH,
  height = CHRONOS_AEGIS_PANEL_HEIGHT,
  bowDepth = CHRONOS_AEGIS_PANEL_BOW_DEPTH,
  bowDirection: -1 | 1 = -1,
  segmentsX = 10,
  segmentsY = 8
): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let yIndex = 0; yIndex <= segmentsY; yIndex++) {
    const v = yIndex / segmentsY;
    const y = (v - 0.5) * height;
    const ny = Math.abs(y / (height * 0.5));

    for (let xIndex = 0; xIndex <= segmentsX; xIndex++) {
      const u = xIndex / segmentsX;
      const x = (u - 0.5) * width;
      const nx = Math.abs(x / (width * 0.5));
      const edgeDistance = Math.max(nx, ny);
      const bow = bowDirection * bowDepth * Math.max(0, 1 - edgeDistance * edgeDistance);

      positions.push(x, y, bow);
      uvs.push(u, v);
    }
  }

  const rowStride = segmentsX + 1;
  for (let yIndex = 0; yIndex < segmentsY; yIndex++) {
    for (let xIndex = 0; xIndex < segmentsX; xIndex++) {
      const topLeft = yIndex * rowStride + xIndex;
      const topRight = topLeft + 1;
      const bottomLeft = topLeft + rowStride;
      const bottomRight = bottomLeft + 1;

      indices.push(topLeft, bottomLeft, topRight, topRight, bottomLeft, bottomRight);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

import type * as THREE from 'three';

type PatchedContextLossRenderer = THREE.WebGLRenderer & {
  __voxelExpectedContextLossPatched?: boolean;
};

export function suppressExpectedContextLossLog(renderer: THREE.WebGLRenderer): void {
  const patchedRenderer = renderer as PatchedContextLossRenderer;
  if (patchedRenderer.__voxelExpectedContextLossPatched) return;

  const originalForceContextLoss = renderer.forceContextLoss.bind(renderer);
  patchedRenderer.__voxelExpectedContextLossPatched = true;

  renderer.forceContextLoss = () => {
    const canvas = renderer.domElement;
    let cleanupTimer = 0;

    const stopExpectedContextLoss = (event: Event) => {
      window.clearTimeout(cleanupTimer);
      event.preventDefault();
      event.stopImmediatePropagation();
      canvas.removeEventListener('webglcontextlost', stopExpectedContextLoss, true);
    };

    canvas.addEventListener('webglcontextlost', stopExpectedContextLoss, {
      capture: true,
      once: true,
    });
    cleanupTimer = window.setTimeout(() => {
      canvas.removeEventListener('webglcontextlost', stopExpectedContextLoss, true);
    }, 1000);

    originalForceContextLoss();
  };
}

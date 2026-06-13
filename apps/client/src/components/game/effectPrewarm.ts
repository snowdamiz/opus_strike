import * as THREE from 'three';
import { initializeEffectResources } from './effectResources';
import { prewarmBlazeMaterials } from './blaze/materials';
import { prewarmRocketResources } from './blaze/rockets';
import { prewarmDireBallResources } from './phantom/direBall';
import { getRiftMaterial, getShadowArrivalMaterial, getTrailMaterial } from './phantom/materials';
import { prewarmVoidRayResources } from './phantom/voidRay';
import { prewarmVoidZoneResources } from './phantom/voidZone';
import { prewarmTerrainImpactResources } from './TerrainImpactEffects';

export async function prewarmPhantomEffects(renderer?: THREE.WebGLRenderer): Promise<void> {
  initializeEffectResources();
  getRiftMaterial();
  getTrailMaterial();
  getShadowArrivalMaterial();
  prewarmDireBallResources(renderer);
  prewarmTerrainImpactResources(renderer);
  prewarmVoidRayResources(renderer);
  prewarmVoidZoneResources(renderer);
}

export async function prewarmBlazeEffects(renderer?: THREE.WebGLRenderer): Promise<void> {
  initializeEffectResources();
  prewarmBlazeMaterials();
  prewarmRocketResources(renderer);
}

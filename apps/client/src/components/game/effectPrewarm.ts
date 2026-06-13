import { initializeEffectResources } from './effectResources';
import { prewarmBlazeMaterials } from './blaze/materials';
import { prewarmRocketResources } from './blaze/rockets';
import { prewarmDireBallResources } from './phantom/direBall';
import { getRiftMaterial, getShadowArrivalMaterial, getTrailMaterial } from './phantom/materials';
import { prewarmVoidRayResources } from './phantom/voidRay';
import { prewarmVoidZoneResources } from './phantom/voidZone';

export async function prewarmPhantomEffects(): Promise<void> {
  initializeEffectResources();
  getRiftMaterial();
  getTrailMaterial();
  getShadowArrivalMaterial();
  prewarmDireBallResources();
  prewarmVoidRayResources();
  prewarmVoidZoneResources();
}

export async function prewarmBlazeEffects(): Promise<void> {
  initializeEffectResources();
  prewarmBlazeMaterials();
  prewarmRocketResources();
}

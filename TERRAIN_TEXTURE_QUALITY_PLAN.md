# Terrain Texture Quality Plan

## Reader And Goal

This plan is for an engineer improving terrain visuals after texture shimmer was observed during camera rotation.

After reading this, the engineer should be able to implement higher-quality terrain textures without reintroducing shimmer-prone PBR surface response.

## Recommendation

Use a high-quality stylized diffuse terrain pipeline, not PBR terrain.

Terrain should keep the texture-array architecture and render through a diffuse material path. Visual richness should come from authored or procedural albedo detail, baked color shading, emissive accents, and low-frequency world variation. Avoid view-dependent surface response on terrain: no bump maps, normal maps, roughness maps, metalness maps, or environment reflections.

This keeps terrain stable while the camera rotates because the visible detail is mostly color detail filtered by mipmaps, not lighting or specular detail that changes with view angle.

## Why Not PBR Terrain

PBR makes sense for hero models, weapons, props, crystals, metal trims, and effects. It is a poor fit for repeated voxel terrain tiles because it amplifies:

- Sub-pixel bump and normal variation.
- Roughness and metalness contrast.
- Environment reflection changes.
- Shadow and lighting aliasing on large repeated faces.
- High-frequency procedural speckles.

Those are exactly the ingredients that make textures sparkle or crawl when the camera moves, even if the player is standing still.

## Target Visual Style

The target is “diffuse deluxe” terrain:

- Rich albedo tiles with cracks, wear, grain, panels, bevel-like edges, and baked occlusion.
- Emissive-only accents for lava, pads, neon, and team-colored surfaces.
- Soft macro color variation across world space to reduce obvious repetition.
- Diffuse lighting only: Lambert, toon, or a custom non-PBR terrain shader.
- Mip-safe detail shapes: readable clusters and strokes, not one-pixel glitter.

High quality should mean more intentional color composition and better authored tile art, not more PBR maps.

## Architecture

Keep one terrain material and one greedy terrain mesh path.

Use texture arrays:

- One color texture array for albedo.
- One emissive texture array for glow accents.
- Optional future diffuse mask arrays only if they do not introduce view-dependent lighting.

Do not split terrain into many per-block materials unless texture arrays become impossible. Texture arrays preserve batching, keep draw calls stable, and prevent atlas bleeding.

Use shader-side enhancement carefully:

- Sample the texture array with mip-safe gradients or conservative mip bias.
- Add low-frequency world-space tint or biome variation.
- Add optional color ramps for toon-style diffuse response.
- Do not add specular, reflection, bump, normal, roughness, or metalness response to terrain.

## Texture Authoring Rules

The texture generator or artist pass should follow these rules:

- Avoid single-pixel speckles, dense hairlines, checker noise, and high-contrast tiny dots.
- Prefer larger clusters, soft cracks, broad grain, and 2-4 pixel minimum stroke widths.
- Bake fake depth into color with soft highlights and shadows.
- Keep contrast lower on naturally repeated ground tiles.
- Use strong detail sparingly on landmark blocks such as pads, lava, glass, neon, and barriers.
- Preview each tile at small sizes before accepting it; if it flickers when reduced, it is too sharp.

## Implementation Phases

### Phase 1: Lock The Stable Terrain Renderer

Keep the terrain material diffuse-only. Keep texture arrays. Keep terrain reflection and surface-response maps removed.

Acceptance criteria:

- Terrain compiles with one material path for low, medium, and high quality.
- High quality does not switch terrain back to PBR.
- Texture arrays remain the only terrain texture storage model.

### Phase 2: Improve Tile Art In Color

Refactor the procedural tile painter so high quality gets better albedo detail without uploading unused utility maps.

Work items:

- Remove unused bump, roughness, metalness, and AO canvas generation.
- Rewrite helper functions around color and emissive outputs only.
- Replace tiny speckles with mip-safe clusters and broad surface features.
- Bake soft edge shading and fake bevels into albedo.
- Add stronger identity details for special blocks.

Acceptance criteria:

- High quality looks richer than medium while using only color and emissive arrays.
- Distant terrain remains visually calm.
- No removed utility-map generation remains as legacy code.

### Phase 3: Add Macro Variation

Add subtle world-space variation in the terrain shader to reduce repetition on large greedy faces.

Recommended approach:

- Use world position and block layer to compute a low-frequency tint.
- Keep amplitude small.
- Use smooth noise or hash blended across broad cells.
- Apply it to albedo only.

Acceptance criteria:

- Large surfaces do not look tiled from a distance.
- Variation does not shimmer during camera rotation.
- The effect is deterministic and does not animate.

### Phase 4: Optional Diffuse Lighting Upgrade

If Lambert is too plain, replace it with a small custom diffuse terrain shader.

Allowed features:

- Hemisphere light approximation.
- Directional diffuse light.
- Toon/ramp quantization.
- Baked color AO from the tile art.
- Emissive accents.

Disallowed features:

- Specular highlights.
- Environment reflections.
- Normal or bump perturbation.
- Roughness or metalness maps.

Acceptance criteria:

- Lighting improves shape readability.
- Camera rotation does not create sparkle.
- Performance remains comparable to the current terrain material.

## Verification Plan

Do not rely on screenshots alone. The visual pass must include movement and camera rotation.

Test scenes:

- A large flat natural surface.
- A mixed structure with metal, glass, pads, neon, and barrier blocks.
- Distant terrain at high resolution scale.
- High shadow and reflection settings, even though terrain should not reflect.

Checks:

- Stand still and rotate the camera slowly.
- Strafe across repeated ground.
- Look at shallow/grazing angles.
- Compare medium and high material quality.
- Toggle shadows off if shimmer remains to separate shadow shimmer from texture shimmer.

Success criteria:

- No obvious texture crawl while standing still and rotating.
- High quality is richer than medium without becoming noisy.
- Terrain remains performant with the same batching strategy.
- Build and typecheck pass.

## Risks

The main risk is overcorrecting into blurry terrain. If that happens, improve tile readability with larger color shapes rather than reintroducing PBR maps.

Another risk is confusing shadow shimmer for texture shimmer. If the diffuse terrain path still shimmers, isolate shadows next before changing texture code again.

## Final Decision

The recommended path is texture-array diffuse terrain with baked color detail and optional macro tinting. Keep PBR for non-terrain assets where view-dependent materials are valuable and easier to control.

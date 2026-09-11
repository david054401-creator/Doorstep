/**
 * 2D FEATURE ENGINE
 *
 * Intent to structured film to verified frames.
 *
 * The five laws this codebase is built to keep:
 *   1. Structure first, pixels last.
 *   2. Nothing advances without passing a gate that can see.
 *   3. Repair, never retry.
 *   4. Taste is code.
 *   5. The human is the director, not the animator.
 */

// --- Core ------------------------------------------------------------------
export * from './core/math.ts';
export * from './core/color.ts';
export * from './core/ids.ts';
export * from './core/rng.ts';
export * from './core/result.ts';
export * from './core/log.ts';
export * from './core/units.ts';

// --- The Film Graph --------------------------------------------------------
export type * from './graph/types.ts';
export { VIEW_NAMES, VISEMES } from './graph/types.ts';
export * from './graph/store.ts';

// --- Geometry and raster ---------------------------------------------------
export * from './geom/polygon.ts';
export * from './geom/silhouette.ts';
export * from './raster/buffer.ts';
export * from './raster/rasterize.ts';
export * from './raster/png.ts';
export * from './raster/filters.ts';

// --- Rigging ---------------------------------------------------------------
export * from './rig/skeleton.ts';
export * from './rig/skin.ts';
export * from './rig/ik.ts';
export * from './rig/spring.ts';
export * from './rig/templates.ts';
export * from './rig/rig.ts';
export * from './rig/autorig.ts';
export * from './rig/battery.ts';
export * from './rig/validators.ts';
export * from './rig/repair.ts';

// --- Character construction ------------------------------------------------
export * from './character/construct.ts';

// --- Render ----------------------------------------------------------------
// The Film Graph's `Scene` is a story scene: a location and the shots that
// play there. The renderer's `Scene` is one drawable frame. Both names are
// right inside their own module, so the public surface disambiguates
// instead of renaming either one.
export type {
  DrawStroke,
  DrawShape,
  DrawImage,
  DrawLayer,
  Scene as DrawScene,
} from './render/scene.ts';
export { emptyScene, sortedLayers, sortedShapes, shapesOf } from './render/scene.ts';
export * from './render/renderer.ts';
export * from './render/camera.ts';

// --- Timing ----------------------------------------------------------------
export * from './timing/easing.ts';
export * from './timing/curves.ts';
export * from './timing/chart.ts';
export * from './timing/templates.ts';

// --- Story -----------------------------------------------------------------
export * from './story/fountain.ts';
export * from './story/script-to-shots.ts';
export * from './story/validators.ts';

// --- Animation -------------------------------------------------------------
export * from './animation/pose-library.ts';
export * from './animation/lipsync.ts';
export * from './animation/idle.ts';
export * from './animation/secondary.ts';
export * from './animation/blocking.ts';
export * from './animation/evaluate.ts';

// --- The Director's Brain --------------------------------------------------
export * from './director/principles.ts';
export * from './director/grammar.ts';
export * from './director/repair-table.ts';
export * from './director/notes.ts';
export * from './director/repair.ts';

// --- Validators ------------------------------------------------------------
export * from './validators/color.ts';
export * from './validators/comp.ts';
export * from './validators/identity.ts';
export * from './validators/substrate.ts';
export * from './validators/invariants.ts';

// --- Audio -----------------------------------------------------------------
export * from './audio/wav.ts';
export * from './audio/loudness.ts';
export * from './audio/cue-sheet.ts';
export * from './audio/validators.ts';

// --- Critics ---------------------------------------------------------------
export type * from './critics/types.ts';
export { emptyRegistry, canGate } from './critics/types.ts';
export * from './critics/tier1/metrics.ts';
export * from './critics/vlm/rubrics.ts';
export * from './critics/vlm/client.ts';
export * from './critics/vlm/ensemble.ts';
export * from './critics/calibration.ts';

// --- Orchestration ---------------------------------------------------------
export * from './orchestrator/dag.ts';
export * from './orchestrator/cache.ts';
export * from './orchestrator/budget.ts';
export * from './orchestrator/runner.ts';
export * from './orchestrator/pipeline.ts';

// --- Providers -------------------------------------------------------------
export type * from './providers/types.ts';
export { notConfigured, withStyle } from './providers/types.ts';
export * from './providers/registry.ts';

// --- Delivery --------------------------------------------------------------
export * from './delivery/sequence.ts';
export * from './delivery/blender.ts';
export * from './delivery/studio.ts';

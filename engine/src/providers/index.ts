/**
 * The provider seam.
 *
 * Everything a generative model can be plugged into, and the contract
 * it has to meet. Import from `@doorstep/film-engine/providers` to
 * write one; the engine never imports yours, `film.config.json` names
 * it and the loader finds it.
 */

export * from './types.ts';
export * from './registry.ts';
export * from './config.ts';

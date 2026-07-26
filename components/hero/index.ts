/** Hero architecture — barrel export.
 *  `components/hero/index.ts` is the single entry point for any consumer.
 *  Future plan: import `HeroSlot` from here, drop into `app/page.tsx` or a
 *  dedicated `/landing` route. */

export { HeroSlot, type HeroSlotProps } from './HeroSlot';
export { HeroCanvas3D } from './HeroCanvas3D';
export { HeroReveal, type HeroRevealProps } from './HeroReveal';
export { HeroScene, type HeroSceneProps } from './HeroScene';
export { useHeroTokens, type HeroTokens } from './useHeroTokens';
export {
  buildEntrance,
  type EntranceTarget,
  type EntranceOptions,
} from './revealTarget';
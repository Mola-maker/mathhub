import './hero.css';
import { HeroReveal } from './HeroReveal';
import { HeroCanvas3D } from './HeroCanvas3D';
import type { EntranceTarget } from './revealTarget';

export type HeroSlotProps = {
  kicker?: string;
  title: string;
  subtitle?: string;
  ctaLabel?: string;
  ctaHref?: string;
  /** When true, render the placeholder R3F scene behind the text. */
  withCanvas?: boolean;
};

/** Server-renderable hero shell. The inner `<HeroReveal>` (client) handles
 *  DOM entrance animation; `<HeroCanvas3D>` (client, dynamic) handles WebGL.
 *  This component itself never reads `window`/`document`, so it can be used
 *  directly from a server component or a layout without 'use client'. */
export function HeroSlot({
  kicker = 'molamaker · math studio',
  title,
  subtitle,
  ctaLabel,
  ctaHref = '/',
  withCanvas = true,
}: HeroSlotProps) {
  const targets: EntranceTarget[] = [
    { selector: '.hero__kicker', variant: 'fade-up' },
    { selector: '.hero__title', variant: 'fade-up' },
    { selector: '.hero__subtitle', variant: 'fade' },
    { selector: '.hero__divider', variant: 'fade' },
    { selector: '.hero__cta', variant: 'fade-up' },
  ];

  return (
    <section className="hero" aria-label="Math Studio hero">
      {withCanvas ? (
        <div className="hero__canvas-wrap" aria-hidden="true">
          <HeroCanvas3D />
        </div>
      ) : null}
      <HeroReveal targets={targets}>
        <div className="hero__inner">
          {kicker ? <p className="hero__kicker">{kicker}</p> : null}
          <h1 className="hero__title">{title}</h1>
          {subtitle ? <p className="hero__subtitle">{subtitle}</p> : null}
          <span className="hero__divider" aria-hidden="true" />
          {ctaLabel ? (
            <a className="hero__cta" href={ctaHref}>
              {ctaLabel}
            </a>
          ) : null}
        </div>
      </HeroReveal>
    </section>
  );
}
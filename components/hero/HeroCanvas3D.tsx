'use client';

import dynamic from 'next/dynamic';
import { useHeroTokens } from './useHeroTokens';

const Client = dynamic(() => import('./HeroCanvas3DClient'), {
  ssr: false,
  loading: () => <HeroCanvas3DFallback />,
});

/** Client-side wrapper that lazy-loads the actual Canvas. Keeps
 *  `three` / `@react-three/fiber` / `@react-three/drei` out of the SSR
 *  bundle so they only ship when the user reaches the hero. */
export function HeroCanvas3D() {
  return <Client className="hero__canvas" />;
}

function HeroCanvas3DFallback() {
  const tokens = useHeroTokens();
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: 0,
        background: tokens.bg,
        opacity: 0.4,
      }}
    />
  );
}

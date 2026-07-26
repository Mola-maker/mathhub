'use client';

import { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { HeroScene } from './HeroScene';
import { useHeroTokens } from './useHeroTokens';

export type HeroCanvas3DClientProps = {
  /** Optional className forwarded to the wrapping div. */
  className?: string;
};

/** The actual Canvas — heavy module, only imported via HeroCanvas3D (dynamic). */
export default function HeroCanvas3DClient({ className }: HeroCanvas3DClientProps) {
  const tokens = useHeroTokens();

  return (
    <div className={className} style={{ position: 'absolute', inset: 0 }}>
      <Canvas
        // No SSR — we are client-only.
        dpr={[1, 2]}
        // Soft "no WebGL" fallback (e.g. WebGL disabled).
        fallback={
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: tokens.bg,
              opacity: 0.4,
            }}
          />
        }
        camera={{ position: [0, 0, 3], fov: 45 }}
        style={{ width: '100%', height: '100%' }}
      >
        <Suspense fallback={null}>
          <HeroScene tokens={tokens} />
        </Suspense>
      </Canvas>
    </div>
  );
}
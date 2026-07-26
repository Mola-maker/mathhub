'use client';

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type * as THREE from 'three';
import type { HeroTokens } from './useHeroTokens';

export type HeroSceneProps = {
  tokens: HeroTokens;
};

/** Placeholder R3F subtree. Exists to prove the 3D pipeline is wired —
 *  geometry / lighting / camera animation are intentionally minimal.
 *  Replace this with the real hero scene in a follow-up plan. */
export function HeroScene({ tokens }: HeroSceneProps) {
  const meshRef = useRef<THREE.Mesh | null>(null);

  useFrame((_, dt) => {
    const m = meshRef.current;
    if (m) m.rotation.y += dt * 0.3;
  });

  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[3, 4, 2]} intensity={0.9} />
      <mesh ref={meshRef} castShadow>
        <sphereGeometry args={[0.8, 32, 32]} />
        <meshStandardMaterial
          color={tokens.accent}
          roughness={0.35}
          metalness={0.1}
        />
      </mesh>
    </>
  );
}
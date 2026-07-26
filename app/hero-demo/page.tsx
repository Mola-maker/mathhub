import { HeroSlot } from '@/components/hero';

export const metadata = {
  title: 'Hero demo · Math Studio',
  description: 'Internal demo of the anime.js + R3F hero shell (not the real hero).',
};

export default function HeroDemoPage() {
  return (
    <main style={{ background: 'var(--bg)', minHeight: '100vh' }}>
      <HeroSlot
        kicker="molamaker · math studio"
        title="Where geometry meets a quiet mind."
        subtitle="This is an internal demo page. The hero shell wires up anime.js (DOM entrance) and React Three Fiber (3D placeholder) so a real hero can be designed against a working pipeline."
        ctaLabel="Open the studio →"
        ctaHref="/"
      />
    </main>
  );
}
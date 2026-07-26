import { MathStudio } from '@/components/math-studio';
import { TikzStudio } from '@/components/tikz-studio';

export default function MathHome() {
  return (
    <main className="math-shell">
      <MathStudio />
      <TikzStudio />
    </main>
  );
}

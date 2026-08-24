import './globals.css';
import 'katex/dist/katex.min.css';
import './studio.css';
import './tikz-studio.css';

export const metadata = {
  title: 'MathHub',
  description: 'A source-native geometry workspace with GeoGebra and TikZ studios.',
  // In development `/mathhub/:path*` is proxied to the standalone Vite
  // frontend. Referencing its generated favicon from the Next.js Studio would
  // therefore turn an optional dev dependency into a noisy 500. Production
  // serves the generated asset from `public/mathhub/` as usual.
  icons: process.env.NODE_ENV === 'production'
    ? { icon: '/mathhub/favicon.svg' }
    : undefined,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}

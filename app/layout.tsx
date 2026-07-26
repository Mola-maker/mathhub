import './globals.css';
import 'katex/dist/katex.min.css';
import './studio.css';
import './tikz-studio.css';

export const metadata = {
  title: 'Math & TikZ Studio · molamaker',
  description: 'Interactive GeoGebra and TikZ construction studios for competition geometry.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}

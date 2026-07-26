import './globals.css';
import 'katex/dist/katex.min.css';
import './studio.css';
import './tikz-studio.css';

export const metadata = {
  title: 'Math & TikZ Studio · molamaker',
  description: 'Interactive GeoGebra and TikZ construction studios for competition geometry.',
  icons: {
    icon: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 64 64%22%3E%3Crect width=%2264%22 height=%2264%22 rx=%2214%22 fill=%22%23fff7ec%22/%3E%3Cpath d=%22M12 46 28 15l9 20 7-13 8 24%22 fill=%22none%22 stroke=%22%23251f1a%22 stroke-width=%225%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22/%3E%3C/svg%3E',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}

import './globals.css';
import 'katex/dist/katex.min.css';
import './studio.css';

export const metadata = {
  title: 'Math Studio · molamaker',
  description: 'Math Studio for GeoGebra construction workflows.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

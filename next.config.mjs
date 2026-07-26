/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    const isProd = process.env.NODE_ENV === 'production';
    const ggbOrigin = (() => {
      try {
        const raw = process.env.NEXT_PUBLIC_GEOGEBRA_BASE_URL?.trim();
        if (raw && /^https?:\/\//i.test(raw)) return new URL(raw).origin;
      } catch {
        return '';
      }
      return '';
    })();
    const ggb = ggbOrigin ? ` ${ggbOrigin}` : '';
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              isProd
                ? `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' blob: https://cdn.geogebra.org https://www.geogebra.org${ggb}`
                : `script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: https://cdn.geogebra.org https://www.geogebra.org${ggb}`,
              `style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net${ggb}`,
              "img-src 'self' data: blob: https:",
              `font-src 'self' data: https:${ggb}`,
              `connect-src 'self' blob: data: https://*.supabase.co wss://*.supabase.co https://cdn.geogebra.org https://www.geogebra.org${ggb}`,
              `worker-src 'self' blob: https://cdn.geogebra.org https://www.geogebra.org${ggb}`,
              `frame-src 'self' blob: https://cdn.geogebra.org https://www.geogebra.org${ggb}`,
              "object-src 'none'",
              "base-uri 'self'"
            ].join('; ')
          },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' }
        ]
      }
    ];
  }
};

export default nextConfig;

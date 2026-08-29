import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig(({ mode }) => {
  const isGitHubPages = mode === 'github-pages'

  return {
    base: '/mathhub/',
    plugins: [react()],
    define: {
      'process.env.NEXT_PUBLIC_GEOGEBRA_BASE_URL': JSON.stringify(
        process.env.NEXT_PUBLIC_GEOGEBRA_BASE_URL ?? '',
      ),
    },
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('../', import.meta.url)),
      },
      dedupe: ['react', 'react-dom'],
    },
    build: {
      outDir: fileURLToPath(new URL('../public/mathhub', import.meta.url)),
      emptyOutDir: true,
      rollupOptions: isGitHubPages
        ? {
            input: {
              home: fileURLToPath(new URL('./index.html', import.meta.url)),
              math: fileURLToPath(new URL('./math/index.html', import.meta.url)),
              tikz: fileURLToPath(new URL('./tikz/index.html', import.meta.url)),
            },
          }
        : undefined,
    },
  }
})

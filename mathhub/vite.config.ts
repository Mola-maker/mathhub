import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig(({ mode }) => {
  const isGitHubPages = mode === 'github-pages'

  return {
    base: '/mathhub/',
    plugins: [react()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('../', import.meta.url)),
      },
    },
    build: {
      outDir: fileURLToPath(new URL('../public/mathhub', import.meta.url)),
      emptyOutDir: true,
      rollupOptions: isGitHubPages
        ? {
            input: {
              home: fileURLToPath(new URL('./index.html', import.meta.url)),
              tikz: fileURLToPath(new URL('./tikz/index.html', import.meta.url)),
            },
          }
        : undefined,
    },
  }
})

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  base: '/mathhub/',
  plugins: [react()],
  build: {
    outDir: fileURLToPath(new URL('../public/mathhub', import.meta.url)),
    emptyOutDir: true,
  },
})

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // GitHub Pages serves project sites under /<repo-name>/ — the deploy
  // workflow sets BASE_PATH accordingly; local dev stays at /.
  base: process.env.BASE_PATH || '/',
  build: { target: 'es2022', manifest: true },
  worker: { format: 'es' },
})

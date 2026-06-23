import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/** Static web preview for GitHub Pages — no Electron. */
export default defineConfig({
  base: '/DinoClaw/',
  plugins: [react()],
  define: {
    'import.meta.env.VITE_WEB_PREVIEW': JSON.stringify('true'),
  },
  build: {
    outDir: 'dist-pages',
    emptyOutDir: true,
  },
})

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const pagesDeploy = process.env.VITE_LINK_PAGES === 'true'

/** Dino Link PWA — connects to Nest gateway over LAN/tunnel. */
export default defineConfig({
  base: pagesDeploy ? '/DinoClaw/' : '/',
  plugins: [react()],
  build: {
    outDir: pagesDeploy ? 'dist-pages' : 'dist-link',
    emptyOutDir: !pagesDeploy,
    rollupOptions: {
      input: 'link.html',
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 8808,
  },
})

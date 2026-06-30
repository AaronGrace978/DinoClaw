import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron/simple'

export default defineConfig({
  server: {
    port: 5173,
    strictPort: true,
    host: '127.0.0.1',
  },
  optimizeDeps: {
    exclude: ['@huggingface/transformers'],
  },
  plugins: [
    react(),
    electron({
      main: {
        entry: 'electron/main.ts',
      },
      preload: {
        input: 'electron/preload.ts',
      },
      renderer: {},
    }),
  ],
})

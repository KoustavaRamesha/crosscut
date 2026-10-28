import { defineConfig } from 'vite'
export default defineConfig({ server: { port: 5178, strictPort: true }, build: { outDir: 'dist/client', chunkSizeWarningLimit: 800 } })

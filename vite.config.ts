import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const single = mode === 'singlefile'
  return {
    plugins: [react(), ...(single ? [viteSingleFile()] : [])],
    base: single ? './' : '/ARC_Rocketry/',
    build: single
      ? {
          outDir: 'dist-single',
          assetsInlineLimit: 100_000_000,
          chunkSizeWarningLimit: 100_000_000,
          cssCodeSplit: false,
          rollupOptions: { output: { inlineDynamicImports: true } },
        }
      : undefined,
  }
})

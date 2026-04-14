import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        external: ['node-pty', 'ws']
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    plugins: [tailwindcss()],
    publicDir: resolve('src/renderer/public'),
    resolve: {
      alias: {
        '@': resolve('src/renderer')
      }
    },
    optimizeDeps: {
      exclude: ['onnxruntime-web']
    }
  }
})

import { resolve } from 'path'
import { createReadStream, existsSync } from 'fs'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import tailwindcss from '@tailwindcss/vite'
import type { Plugin } from 'vite'

// Serve ONNX Runtime WASM files from node_modules.
// onnxruntime-web dynamically imports its .mjs worker file, which Vite's
// public dir blocks ("should not be imported from source code"). This plugin
// intercepts those requests and serves them directly from node_modules.
function serveOnnxWasm(): Plugin {
  return {
    name: 'serve-onnx-wasm',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url) return next()

        // Match ort-wasm-*.mjs or ort-wasm-*.wasm requests
        const match = req.url.match(/\/(ort-wasm[^?]+\.(mjs|wasm))/)
        if (!match) return next()

        const fileName = match[1]
        const filePath = resolve('node_modules/onnxruntime-web/dist', fileName)

        if (!existsSync(filePath)) return next()

        const contentType = fileName.endsWith('.mjs')
          ? 'application/javascript'
          : 'application/wasm'

        res.setHeader('Content-Type', contentType)
        res.setHeader('Access-Control-Allow-Origin', '*')
        createReadStream(filePath).pipe(res)
      })
    }
  }
}

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
    plugins: [tailwindcss(), serveOnnxWasm()],
    publicDir: resolve('src/renderer/public'),
    resolve: {
      alias: {
        '@': resolve('src/renderer')
      }
    }
  }
})

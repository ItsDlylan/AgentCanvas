// Copy VAD/ONNX runtime assets from node_modules to the renderer public dir
// so Vite can serve them as static files.
const { copyFileSync, mkdirSync, existsSync } = require('fs')
const { join } = require('path')

const dest = join(__dirname, '..', 'src', 'renderer', 'public', 'vad')
if (!existsSync(dest)) mkdirSync(dest, { recursive: true })

const assets = [
  ['@ricky0123/vad-web/dist/silero_vad_legacy.onnx', 'silero_vad_legacy.onnx'],
  ['@ricky0123/vad-web/dist/vad.worklet.bundle.min.js', 'vad.worklet.bundle.min.js'],
  ['onnxruntime-web/dist/ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.wasm'],
  ['onnxruntime-web/dist/ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.mjs']
]

for (const [src, name] of assets) {
  const srcPath = join(__dirname, '..', 'node_modules', src)
  if (existsSync(srcPath)) {
    copyFileSync(srcPath, join(dest, name))
  } else {
    console.warn(`[copy-vad-assets] Missing: ${src}`)
  }
}

console.log('[copy-vad-assets] VAD assets copied to src/renderer/public/vad/')

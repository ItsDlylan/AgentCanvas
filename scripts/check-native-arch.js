// Preflight: verify node-pty's native binary matches the host architecture.
// If it doesn't (e.g. installed under Rosetta, or with a stale npm_config_arch),
// auto-rerun electron-builder install-app-deps for the host arch so `npm run dev`
// doesn't crash with `posix_spawnp failed`.
const { readFileSync, existsSync } = require('fs')
const { execSync } = require('child_process')
const { join } = require('path')

const PTY_NODE = join(__dirname, '..', 'node_modules', 'node-pty', 'build', 'Release', 'pty.node')

// Mach-O CPU types we care about
const CPU_TYPE_X86_64 = 0x01000007
const CPU_TYPE_ARM64 = 0x0100000c

function readMachOArch(filePath) {
  // Read first 8 bytes; Mach-O header is magic(4) + cputype(4)
  const fd = readFileSync(filePath)
  if (fd.length < 8) return null
  const magic = fd.readUInt32LE(0)
  // 64-bit Mach-O: 0xfeedfacf (LE) or 0xcffaedfe (BE)
  // We only care about little-endian which is what macOS uses on x64/arm64
  if (magic !== 0xfeedfacf && magic !== 0xcffaedfe) return null
  const cpuType = magic === 0xfeedfacf ? fd.readUInt32LE(4) : fd.readUInt32BE(4)
  if (cpuType === CPU_TYPE_ARM64) return 'arm64'
  if (cpuType === CPU_TYPE_X86_64) return 'x64'
  return null
}

function main() {
  if (process.platform !== 'darwin') return // only macOS hits this footgun
  if (!existsSync(PTY_NODE)) {
    // Not installed yet — postinstall will handle it.
    return
  }
  const binaryArch = readMachOArch(PTY_NODE)
  const hostArch = process.arch
  if (binaryArch === hostArch) return // all good

  console.warn(
    `[check-native-arch] node-pty was built for ${binaryArch ?? 'unknown'} but host is ${hostArch}.`
  )
  console.warn('[check-native-arch] Rebuilding native deps for the host arch...')
  execSync(`npx electron-builder install-app-deps --arch=${hostArch}`, {
    stdio: 'inherit',
    cwd: join(__dirname, '..')
  })

  const after = readMachOArch(PTY_NODE)
  if (after !== hostArch) {
    console.error(
      `[check-native-arch] Rebuild did not produce a ${hostArch} binary (got ${after}). Aborting.`
    )
    process.exit(1)
  }
  console.warn('[check-native-arch] Rebuilt successfully.')
}

main()

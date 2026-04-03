/**
 * Launches Electron, spawns 2 terminals, waits, then runs a perf profile
 * while simulating pan events. Prints results and exits.
 */
const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')

let win

app.whenReady().then(async () => {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, '../out/preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  // Load the built renderer
  await win.loadFile(path.join(__dirname, '../out/renderer/index.html'))

  // Wait for React to mount
  await new Promise(r => setTimeout(r, 3000))

  console.log('\n=== BASELINE (no terminals) ===')
  await runProfile()

  // Click "+ Terminal" twice by executing in renderer
  await win.webContents.executeJavaScript(`
    document.querySelector('button')?.click();
  `)
  await new Promise(r => setTimeout(r, 2000))

  await win.webContents.executeJavaScript(`
    document.querySelector('button')?.click();
  `)
  await new Promise(r => setTimeout(r, 2000))

  console.log('\n=== WITH 2 TERMINALS ===')
  await runProfile()

  // Get detailed DOM info
  const domInfo = await win.webContents.executeJavaScript(`
    JSON.stringify({
      totalDOM: document.querySelectorAll('*').length,
      reactFlowNodes: document.querySelectorAll('.react-flow__node').length,
      canvases: document.querySelectorAll('canvas').length,
      xtermInstances: document.querySelectorAll('.xterm').length,
      webglContexts: (() => {
        let count = 0;
        document.querySelectorAll('canvas').forEach(c => {
          try { if (c.getContext('webgl2') || c.getContext('webgl')) count++; } catch {}
        });
        return count;
      })(),
      observers: window.__observers || 'unknown',
      reactFiberNodes: document.querySelectorAll('[class*="react-flow"]').length
    })
  `)
  console.log('\n=== DOM ANALYSIS ===')
  console.log(JSON.parse(domInfo))

  // Check what React components are re-rendering during pan
  const renderCheck = await win.webContents.executeJavaScript(`
    new Promise(resolve => {
      // Patch React to count renders
      const origCreateElement = React?.createElement;
      let renderCounts = {};

      // Monitor MutationObserver activity
      let mutationCount = 0;
      const mo = new MutationObserver(muts => { mutationCount += muts.length; });
      mo.observe(document.querySelector('.react-flow'), {
        childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'transform', 'class']
      });

      // Simulate pan for 2 seconds
      const pane = document.querySelector('.react-flow__pane');
      const rect = pane.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      let ticks = 0;

      function tick() {
        pane.dispatchEvent(new WheelEvent('wheel', {
          clientX: cx, clientY: cy,
          deltaX: 5, deltaY: 3,
          bubbles: true
        }));
        ticks++;
        if (ticks < 120) requestAnimationFrame(tick);
        else {
          mo.disconnect();
          resolve(JSON.stringify({
            panFrames: ticks,
            domMutations: mutationCount,
            mutationsPerFrame: (mutationCount / ticks).toFixed(1)
          }));
        }
      }
      requestAnimationFrame(tick);
    })
  `)
  console.log('\n=== PAN MUTATION ANALYSIS ===')
  console.log(JSON.parse(renderCheck))

  app.quit()
})

async function runProfile() {
  const result = await win.webContents.executeJavaScript(`
    new Promise(resolve => {
      const pane = document.querySelector('.react-flow__pane');
      const rect = pane.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const frames = [];
      let last = performance.now();
      let ticks = 0;

      function tick(ts) {
        frames.push(ts - last);
        last = ts;
        ticks++;

        pane.dispatchEvent(new WheelEvent('wheel', {
          clientX: cx, clientY: cy,
          deltaX: 3, deltaY: 2,
          bubbles: true
        }));

        if (ticks < 180) requestAnimationFrame(tick);
        else {
          const sorted = [...frames].sort((a,b) => a-b);
          const avg = frames.reduce((a,b) => a+b) / frames.length;
          const p95 = sorted[Math.floor(sorted.length * 0.95)];
          const p99 = sorted[Math.floor(sorted.length * 0.99)];
          const max = Math.max(...frames);
          const jank = frames.filter(f => f > 33).length;
          resolve(JSON.stringify({
            frames: frames.length,
            avgMs: avg.toFixed(1),
            p95Ms: p95.toFixed(1),
            p99Ms: p99.toFixed(1),
            maxMs: max.toFixed(1),
            jankFrames: jank,
            fps: (1000/avg).toFixed(0)
          }));
        }
      }
      requestAnimationFrame(tick);
    })
  `)
  console.log(JSON.parse(result))
}

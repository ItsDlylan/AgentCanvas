const { app, BrowserWindow } = require('electron')
const path = require('path')

let win

app.commandLine.appendSwitch('enable-logging')

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

  await win.loadFile(path.join(__dirname, '../out/renderer/index.html'))
  await new Promise(r => setTimeout(r, 2000))

  async function panTest(label) {
    const result = await win.webContents.executeJavaScript(`
      new Promise(resolve => {
        const pane = document.querySelector('.react-flow__pane');
        const rect = pane.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const frames = [];
        let last = performance.now();
        let ticks = 0;
        const iv = setInterval(() => {
          pane.dispatchEvent(new WheelEvent('wheel', {
            clientX: cx, clientY: cy,
            deltaX: 2 + Math.random() * 2,
            deltaY: 1 + Math.random() * 2,
            bubbles: true
          }));
        }, 8);
        function tick(ts) {
          frames.push(ts - last);
          last = ts;
          ticks++;
          if (ticks < 300) requestAnimationFrame(tick);
          else {
            clearInterval(iv);
            const avg = frames.reduce((a,b) => a+b) / frames.length;
            const sorted = [...frames].sort((a,b) => a-b);
            resolve(JSON.stringify({
              avgMs: avg.toFixed(1),
              p95Ms: sorted[Math.floor(sorted.length * 0.95)].toFixed(1),
              maxMs: Math.max(...frames).toFixed(1),
              jank33: frames.filter(f => f > 33).length,
              jank50: frames.filter(f => f > 50).length,
              fps: (1000/avg).toFixed(0)
            }));
          }
        }
        requestAnimationFrame(tick);
      })
    `)
    console.log(label, JSON.parse(result))
  }

  // Test with 0 terminals
  console.log('\n=== SCALING TEST ===')
  await panTest('0 terminals:')

  // Add terminals one at a time and test after each
  for (let i = 1; i <= 5; i++) {
    await win.webContents.executeJavaScript(`document.querySelector('button')?.click()`)
    await new Promise(r => setTimeout(r, 2000))
    await panTest(i + ' terminal(s):')
  }

  // Deep dive: what's happening per frame with 5 terminals
  console.log('\n=== FRAME BREAKDOWN (5 terminals) ===')
  const breakdown = await win.webContents.executeJavaScript(`
    new Promise(resolve => {
      const pane = document.querySelector('.react-flow__pane');
      const rect = pane.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;

      // Measure what's happening in each frame
      let samples = [];
      let ticks = 0;

      const iv = setInterval(() => {
        pane.dispatchEvent(new WheelEvent('wheel', {
          clientX: cx, clientY: cy, deltaX: 3, deltaY: 2, bubbles: true
        }));
      }, 8);

      function tick(ts) {
        const start = performance.now();

        // Force layout read to measure recalc
        const layoutStart = performance.now();
        const nodes = document.querySelectorAll('.react-flow__node');
        nodes.forEach(n => n.getBoundingClientRect());
        const layoutTime = performance.now() - layoutStart;

        // Count WebGL canvases that are visible
        const canvases = document.querySelectorAll('canvas');
        const visibleCanvases = Array.from(canvases).filter(c => {
          const r = c.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        }).length;

        samples.push({
          frameTime: performance.now() - start,
          layoutTime,
          visibleCanvases
        });

        ticks++;
        if (ticks < 60) requestAnimationFrame(tick);
        else {
          clearInterval(iv);
          const avgFrame = samples.reduce((a,b) => a + b.frameTime, 0) / samples.length;
          const avgLayout = samples.reduce((a,b) => a + b.layoutTime, 0) / samples.length;
          resolve(JSON.stringify({
            avgFrameWorkMs: avgFrame.toFixed(2),
            avgLayoutRecalcMs: avgLayout.toFixed(2),
            visibleCanvases: samples[0]?.visibleCanvases || 0,
            totalCanvases: document.querySelectorAll('canvas').length,
            domNodes: document.querySelectorAll('.react-flow__viewport *').length,
            nodesDomSize: Array.from(document.querySelectorAll('.react-flow__node')).map(n => ({
              children: n.querySelectorAll('*').length,
              rect: (() => { const r = n.getBoundingClientRect(); return r.width + 'x' + r.height; })()
            }))
          }));
        }
      }
      requestAnimationFrame(tick);
    })
  `)
  const bd = JSON.parse(breakdown)
  console.log('Frame work:', bd.avgFrameWorkMs + 'ms')
  console.log('Layout recalc:', bd.avgLayoutRecalcMs + 'ms')
  console.log('Visible canvases:', bd.visibleCanvases, '/ total:', bd.totalCanvases)
  console.log('DOM nodes in viewport:', bd.domNodes)
  console.log('Per-node DOM children:', bd.nodesDomSize)

  // Check if xterm canvases are being redrawn during pan
  console.log('\n=== XTERM CANVAS REDRAW CHECK ===')
  const canvasCheck = await win.webContents.executeJavaScript(`
    new Promise(resolve => {
      const pane = document.querySelector('.react-flow__pane');
      const rect = pane.getBoundingClientRect();
      const canvases = document.querySelectorAll('.xterm-screen canvas');

      // Monkey-patch WebGL drawArrays to count draw calls
      let drawCalls = 0;
      const originals = [];
      canvases.forEach(c => {
        const gl = c.getContext('webgl2') || c.getContext('webgl');
        if (gl) {
          const orig = gl.drawArrays.bind(gl);
          originals.push({ gl, orig });
          gl.drawArrays = function() {
            drawCalls++;
            return orig.apply(this, arguments);
          };
        }
      });

      // Pan for 2 seconds
      const iv = setInterval(() => {
        pane.dispatchEvent(new WheelEvent('wheel', {
          clientX: rect.left + rect.width/2,
          clientY: rect.top + rect.height/2,
          deltaX: 3, deltaY: 2, bubbles: true
        }));
      }, 8);

      setTimeout(() => {
        clearInterval(iv);
        // Restore originals
        originals.forEach(({gl, orig}) => { gl.drawArrays = orig; });
        resolve(JSON.stringify({
          webglDrawCalls: drawCalls,
          drawCallsPerSecond: Math.round(drawCalls / 2),
          canvasCount: canvases.length
        }));
      }, 2000);
    })
  `)
  console.log(JSON.parse(canvasCheck))

  app.quit()
})

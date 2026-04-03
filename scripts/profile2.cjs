const { app, BrowserWindow } = require('electron')
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

  await win.loadFile(path.join(__dirname, '../out/renderer/index.html'))
  await new Promise(r => setTimeout(r, 2000))

  // Spawn 3 terminals
  for (let i = 0; i < 3; i++) {
    await win.webContents.executeJavaScript(`document.querySelector('button')?.click()`)
    await new Promise(r => setTimeout(r, 2000))
  }

  console.log('\n=== LAYER & COMPOSITE ANALYSIS ===')

  const analysis = await win.webContents.executeJavaScript(`
    JSON.stringify({
      // Canvas element details
      canvases: Array.from(document.querySelectorAll('canvas')).map(c => ({
        width: c.width,
        height: c.height,
        className: c.className,
        parent: c.parentElement?.className?.slice(0, 50),
        hasWebGL: !!(c.getContext('webgl2') || c.getContext('webgl')),
        style: {
          willChange: getComputedStyle(c).willChange,
          transform: getComputedStyle(c).transform,
          contain: getComputedStyle(c).contain
        }
      })),

      // Check for expensive CSS on visible elements
      expensiveCSS: (() => {
        const results = [];
        document.querySelectorAll('*').forEach(el => {
          const s = getComputedStyle(el);
          if (s.backdropFilter && s.backdropFilter !== 'none')
            results.push({ el: el.className?.slice(0,40), prop: 'backdrop-filter', val: s.backdropFilter });
          if (s.filter && s.filter !== 'none')
            results.push({ el: el.className?.slice(0,40), prop: 'filter', val: s.filter });
          if (s.boxShadow && s.boxShadow !== 'none' && el.closest('.react-flow__node'))
            results.push({ el: el.className?.slice(0,40), prop: 'box-shadow', val: s.boxShadow.slice(0,60) });
          if (s.transition && s.transition !== 'all 0s ease 0s' && s.transition !== 'none' && el.closest('.react-flow__node'))
            results.push({ el: el.className?.slice(0,40), prop: 'transition', val: s.transition.slice(0,80) });
        });
        return results;
      })(),

      // React Flow internal transforms
      viewportTransform: getComputedStyle(document.querySelector('.react-flow__viewport')).transform,

      // Check for animation frames being scheduled
      animationCheck: (() => {
        const orig = window.requestAnimationFrame;
        let count = 0;
        window.requestAnimationFrame = function(cb) {
          count++;
          return orig.call(window, cb);
        };
        // Reset after 100ms
        setTimeout(() => { window.requestAnimationFrame = orig; }, 100);
        return 'monitoring for 100ms...';
      })()
    })
  `)

  const data = JSON.parse(analysis)
  console.log('\nCanvases:')
  data.canvases.forEach((c, i) => console.log(`  [${i}]`, c))
  console.log('\nExpensive CSS on nodes:')
  data.expensiveCSS.forEach(c => console.log(`  ${c.prop}: ${c.val} on .${c.el}`))
  console.log('\nViewport transform:', data.viewportTransform)

  // Wait for rAF count
  await new Promise(r => setTimeout(r, 200))

  const rafCount = await win.webContents.executeJavaScript(`
    new Promise(resolve => {
      let count = 0;
      const orig = window.requestAnimationFrame;
      window.requestAnimationFrame = function(cb) {
        count++;
        return orig.call(window, cb);
      };
      setTimeout(() => {
        window.requestAnimationFrame = orig;
        resolve(count);
      }, 1000);
    })
  `)
  console.log('\nrAF calls in 1 second (idle):', rafCount)

  // Now simulate real-world: continuous high-frequency wheel events like a trackpad
  console.log('\n=== TRACKPAD-STYLE PAN TEST (high frequency) ===')
  const panResult = await win.webContents.executeJavaScript(`
    new Promise(resolve => {
      const pane = document.querySelector('.react-flow__pane');
      const rect = pane.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;

      // Trackpad sends ~60-120 wheel events per second
      // Let's fire them at 8ms intervals (125Hz) like a real trackpad
      const frames = [];
      let last = performance.now();
      let wheelCount = 0;

      const wheelInterval = setInterval(() => {
        pane.dispatchEvent(new WheelEvent('wheel', {
          clientX: cx, clientY: cy,
          deltaX: 2 + Math.random() * 2,
          deltaY: 1 + Math.random() * 2,
          bubbles: true
        }));
        wheelCount++;
      }, 8);

      function tick(ts) {
        frames.push(ts - last);
        last = ts;
        if (frames.length < 300) requestAnimationFrame(tick);
        else {
          clearInterval(wheelInterval);
          const avg = frames.reduce((a,b) => a+b) / frames.length;
          const sorted = [...frames].sort((a,b) => a-b);
          const p95 = sorted[Math.floor(sorted.length * 0.95)];
          const max = Math.max(...frames);
          const jank = frames.filter(f => f > 33).length;
          const stutter = frames.filter(f => f > 50).length;
          resolve(JSON.stringify({
            wheelEvents: wheelCount,
            frames: frames.length,
            avgMs: avg.toFixed(1),
            p95Ms: p95.toFixed(1),
            maxMs: max.toFixed(1),
            jankFrames_33ms: jank,
            stutterFrames_50ms: stutter,
            fps: (1000/avg).toFixed(0)
          }));
        }
      }
      requestAnimationFrame(tick);
    })
  `)
  console.log(JSON.parse(panResult))

  app.quit()
})

/**
 * Performance test: launches the app, spawns terminals,
 * simulates a pan, and measures frame timing.
 *
 * Run: node scripts/perf-test.mjs (after `npm run build`)
 */
import { execSync } from 'child_process'

// Build first
console.log('Building...')
execSync('npx electron-vite build', { cwd: process.cwd(), stdio: 'inherit' })

console.log('\nLaunching Electron for perf test...')

// We'll use executeJavaScript via the main process debug handler
// The app needs to be running. Let's use a different approach:
// inject a self-profiling script into the renderer.

console.log(`
=== MANUAL PERF TEST ===

1. Run: npm run dev
2. Open 2-3 terminals via "+ Terminal" or double-click
3. Open DevTools console (it should auto-open)
4. Run this in the console:

   // Profile for 3 seconds
   (async () => {
     const frames = [];
     let last = performance.now();
     await new Promise(resolve => {
       function tick(ts) {
         frames.push(ts - last);
         last = ts;
         if (frames.length < 180) requestAnimationFrame(tick);
         else resolve();
       }
       requestAnimationFrame(tick);
     });
     const avg = frames.reduce((a,b) => a+b) / frames.length;
     const max = Math.max(...frames);
     const jank = frames.filter(f => f > 33).length;
     console.table({
       frames: frames.length,
       avgMs: avg.toFixed(1),
       maxMs: max.toFixed(1),
       jankFrames: jank,
       fps: (1000/avg).toFixed(0),
       nodes: document.querySelectorAll('.react-flow__node').length,
       canvases: document.querySelectorAll('canvas').length,
       totalDOM: document.querySelectorAll('*').length
     });
   })()

5. While it's running, pan around the canvas with 2 fingers
6. Check the output table

=== AUTOMATED PROFILING ===

Or paste this to auto-pan and measure:

   (async () => {
     const pane = document.querySelector('.react-flow__pane');
     const rect = pane.getBoundingClientRect();
     const cx = rect.left + rect.width/2;
     const cy = rect.top + rect.height/2;

     // Simulate pan via wheel events
     const frames = [];
     let last = performance.now();
     let ticks = 0;

     function tick(ts) {
       frames.push(ts - last);
       last = ts;
       ticks++;

       // Dispatch a wheel event to simulate panning
       pane.dispatchEvent(new WheelEvent('wheel', {
         clientX: cx, clientY: cy,
         deltaX: 3, deltaY: 2,
         bubbles: true
       }));

       if (ticks < 180) requestAnimationFrame(tick);
       else {
         const avg = frames.reduce((a,b) => a+b) / frames.length;
         const max = Math.max(...frames);
         const jank = frames.filter(f => f > 33).length;
         console.log('=== PAN PERFORMANCE ===');
         console.table({
           frames: frames.length,
           avgMs: avg.toFixed(1),
           maxMs: max.toFixed(1),
           jankFrames: jank + '/' + frames.length,
           fps: (1000/avg).toFixed(0),
           nodes: document.querySelectorAll('.react-flow__node').length,
           canvases: document.querySelectorAll('canvas').length,
           totalDOM: document.querySelectorAll('*').length,
           reactFlowInternals: document.querySelectorAll('[data-testid]').length
         });
       }
     }
     requestAnimationFrame(tick);
   })()
`)

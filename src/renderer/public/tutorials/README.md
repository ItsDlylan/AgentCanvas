# Tutorial assets

Drop `.mp4` / `.jpg` / `.png` files here and register them in
`src/renderer/data/tutorials.ts`. Paths referenced from the registry use
`/tutorials/<file>` — Vite serves this directory at the site root.

Naming convention: `<id>.mp4` + `<id>.jpg` (poster) matching the tutorial's
`id` in the registry keeps things easy to find.

Keep videos short (under ~2 minutes) and re-encode with H.264 + faststart
so they begin playing immediately:

```
ffmpeg -i input.mov -c:v libx264 -preset slow -crf 22 \
  -pix_fmt yuv420p -movflags +faststart output.mp4
```

# AgentCanvas Remotion compositions

Motion-graphics source for the in-app Tutorials overlay. Each composition
renders to `src/renderer/public/tutorials/<id>.mp4`, referenced by id in
`src/renderer/data/tutorials.ts`.

## Develop

```
cd remotion
pnpm install          # installs Remotion + Chromium headless
pnpm run studio       # opens the Remotion Studio in a browser
```

## Render

```
pnpm run render:welcome          # → src/renderer/public/tutorials/welcome.mp4
pnpm run render:welcome:poster   # → src/renderer/public/tutorials/welcome.jpg
```

## Add a new tutorial video

1. Create a new composition file under `src/scenes/` or `src/` and export
   a `<Composition>` entry from `src/Root.tsx`.
2. Add a `render:<id>` script in `package.json` pointing at the output
   path the renderer expects (`../src/renderer/public/tutorials/<id>.mp4`).
3. Register the tutorial in `src/renderer/data/tutorials.ts`.

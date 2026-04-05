import { memo, useState, useCallback } from 'react'
import { useSettings, type Settings, type WorkspaceTemplate, type TemplateTile } from '@/hooks/useSettings'
import { DEVICE_PRESETS } from '@/constants/devicePresets'
import { v4 as uuid } from 'uuid'

type Category = 'general' | 'appearance' | 'terminal' | 'browser' | 'canvas' | 'templates'

interface SettingsPageProps {
  onClose: () => void
}

const CATEGORIES: { id: Category; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'terminal', label: 'Terminal' },
  { id: 'browser', label: 'Browser' },
  { id: 'canvas', label: 'Canvas' },
  { id: 'templates', label: 'Templates' }
]

// ── Shared input components ──────────────────────────────

function Label({ children }: { children: React.ReactNode }) {
  return <label className="text-xs font-medium text-zinc-400">{children}</label>
}

function Description({ children }: { children: React.ReactNode }) {
  return <p className="mt-0.5 text-[10px] text-zinc-600">{children}</p>
}

function TextInput({
  value,
  onChange,
  placeholder
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full rounded border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-xs text-zinc-200 outline-none focus:ring-1 focus:ring-blue-500/50"
    />
  )
}

function NumberInput({
  value,
  onChange,
  min,
  max,
  step = 1
}: {
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
}) {
  return (
    <div className="flex items-center gap-1">
      <button
        onClick={() => onChange(Math.max(min ?? -Infinity, value - step))}
        className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
      >
        -
      </button>
      <input
        type="number"
        value={value}
        onChange={(e) => {
          const n = parseFloat(e.target.value)
          if (!isNaN(n)) onChange(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n)))
        }}
        min={min}
        max={max}
        step={step}
        className="w-20 rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-center text-xs text-zinc-200 outline-none focus:ring-1 focus:ring-blue-500/50"
      />
      <button
        onClick={() => onChange(Math.min(max ?? Infinity, value + step))}
        className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
      >
        +
      </button>
    </div>
  )
}

function SelectInput({
  value,
  onChange,
  options
}: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-xs text-zinc-200 outline-none focus:ring-1 focus:ring-blue-500/50"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      className={`relative h-5 w-9 rounded-full transition-colors ${value ? 'bg-blue-500' : 'bg-zinc-700'}`}
    >
      <span
        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${value ? 'translate-x-4' : 'translate-x-0.5'}`}
      />
    </button>
  )
}

function SettingRow({
  label,
  description,
  children
}: {
  label: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="min-w-0 flex-1">
        <Label>{label}</Label>
        {description && <Description>{description}</Description>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function SectionDivider() {
  return <div className="border-b border-zinc-800" />
}

// ── Category sections ────────────────────────────────────

function GeneralSection({ settings, update }: { settings: Settings; update: (patch: Partial<Settings>) => void }) {
  return (
    <div>
      <h2 className="mb-4 text-sm font-semibold text-zinc-200">General</h2>
      <div className="divide-y divide-zinc-800 rounded-lg border border-zinc-800 bg-zinc-900/50 px-4">
        <SettingRow label="Shell" description="Path to shell executable for new terminals">
          <TextInput
            value={settings.general.shell}
            onChange={(v) => update({ general: { ...settings.general, shell: v } })}
            placeholder="/bin/zsh"
          />
        </SettingRow>
        <SettingRow label="Default Working Directory" description="Starting directory for new workspaces (blank = home)">
          <div className="flex items-center gap-2">
            <TextInput
              value={settings.general.defaultCwd ?? ''}
              onChange={(v) => update({ general: { ...settings.general, defaultCwd: v || null } })}
              placeholder="~/Projects"
            />
            <button
              onClick={async () => {
                const dir = await window.workspace.pickDirectory()
                if (dir) update({ general: { ...settings.general, defaultCwd: dir } })
              }}
              className="shrink-0 rounded border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-xs text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
            >
              Browse
            </button>
          </div>
        </SettingRow>
      </div>
    </div>
  )
}

function AppearanceSection({ settings, update }: { settings: Settings; update: (patch: Partial<Settings>) => void }) {
  return (
    <div>
      <h2 className="mb-4 text-sm font-semibold text-zinc-200">Appearance</h2>
      <div className="divide-y divide-zinc-800 rounded-lg border border-zinc-800 bg-zinc-900/50 px-4">
        <SettingRow label="Font Family" description="Monospace font for terminals">
          <TextInput
            value={settings.appearance.terminalFontFamily}
            onChange={(v) => update({ appearance: { ...settings.appearance, terminalFontFamily: v } })}
          />
        </SettingRow>
        <SettingRow label="Font Size" description="Terminal font size in pixels">
          <NumberInput
            value={settings.appearance.terminalFontSize}
            onChange={(v) => update({ appearance: { ...settings.appearance, terminalFontSize: v } })}
            min={8}
            max={24}
          />
        </SettingRow>
        <SettingRow label="Line Height" description="Terminal line height multiplier">
          <NumberInput
            value={settings.appearance.terminalLineHeight}
            onChange={(v) => update({ appearance: { ...settings.appearance, terminalLineHeight: v } })}
            min={0.8}
            max={2.0}
            step={0.1}
          />
        </SettingRow>
        <SettingRow label="Cursor Style">
          <SelectInput
            value={settings.appearance.cursorStyle}
            onChange={(v) => update({ appearance: { ...settings.appearance, cursorStyle: v as 'bar' | 'block' | 'underline' } })}
            options={[
              { value: 'bar', label: 'Bar' },
              { value: 'block', label: 'Block' },
              { value: 'underline', label: 'Underline' }
            ]}
          />
        </SettingRow>
        <SettingRow label="Cursor Blink" description="Saves CPU when disabled">
          <Toggle
            value={settings.appearance.cursorBlink}
            onChange={(v) => update({ appearance: { ...settings.appearance, cursorBlink: v } })}
          />
        </SettingRow>
      </div>
    </div>
  )
}

function TerminalSection({ settings, update }: { settings: Settings; update: (patch: Partial<Settings>) => void }) {
  const [newKey, setNewKey] = useState('')
  const [newVal, setNewVal] = useState('')

  const addEnvVar = useCallback(() => {
    if (!newKey.trim()) return
    update({
      terminal: {
        ...settings.terminal,
        customEnvVars: { ...settings.terminal.customEnvVars, [newKey.trim()]: newVal }
      }
    })
    setNewKey('')
    setNewVal('')
  }, [newKey, newVal, settings.terminal, update])

  const removeEnvVar = useCallback(
    (key: string) => {
      const next = { ...settings.terminal.customEnvVars }
      delete next[key]
      update({ terminal: { ...settings.terminal, customEnvVars: next } })
    },
    [settings.terminal, update]
  )

  return (
    <div>
      <h2 className="mb-4 text-sm font-semibold text-zinc-200">Terminal</h2>
      <div className="divide-y divide-zinc-800 rounded-lg border border-zinc-800 bg-zinc-900/50 px-4">
        <SettingRow label="Scrollback Lines" description="Max lines kept in terminal history (applies to new terminals)">
          <NumberInput
            value={settings.terminal.scrollback}
            onChange={(v) => update({ terminal: { ...settings.terminal, scrollback: v } })}
            min={500}
            max={100000}
            step={500}
          />
        </SettingRow>
      </div>

      <h3 className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wider text-zinc-500">
        Custom Environment Variables
      </h3>
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50">
        {Object.entries(settings.terminal.customEnvVars).length > 0 && (
          <div className="divide-y divide-zinc-800 px-4">
            {Object.entries(settings.terminal.customEnvVars).map(([key, val]) => (
              <div key={key} className="flex items-center gap-2 py-2">
                <span className="font-mono text-xs text-blue-400">{key}</span>
                <span className="text-xs text-zinc-600">=</span>
                <span className="flex-1 truncate font-mono text-xs text-zinc-300">{val}</span>
                <button
                  onClick={() => removeEnvVar(key)}
                  className="rounded p-1 text-zinc-600 hover:bg-zinc-700 hover:text-red-400"
                >
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2 border-t border-zinc-800 px-4 py-2">
          <input
            type="text"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            placeholder="KEY"
            className="w-28 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 font-mono text-xs text-zinc-200 outline-none focus:ring-1 focus:ring-blue-500/50"
            onKeyDown={(e) => e.key === 'Enter' && addEnvVar()}
          />
          <span className="text-xs text-zinc-600">=</span>
          <input
            type="text"
            value={newVal}
            onChange={(e) => setNewVal(e.target.value)}
            placeholder="value"
            className="flex-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 font-mono text-xs text-zinc-200 outline-none focus:ring-1 focus:ring-blue-500/50"
            onKeyDown={(e) => e.key === 'Enter' && addEnvVar()}
          />
          <button
            onClick={addEnvVar}
            className="rounded border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-xs text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
          >
            Add
          </button>
        </div>
      </div>
    </div>
  )
}

function BrowserSection({ settings, update }: { settings: Settings; update: (patch: Partial<Settings>) => void }) {
  const presetOptions = [
    { value: 'Default', label: 'Default (800x600)' },
    ...DEVICE_PRESETS.map((p) => ({
      value: p.name,
      label: `${p.name} (${p.width}x${p.height})`
    }))
  ]

  return (
    <div>
      <h2 className="mb-4 text-sm font-semibold text-zinc-200">Browser</h2>
      <div className="divide-y divide-zinc-800 rounded-lg border border-zinc-800 bg-zinc-900/50 px-4">
        <SettingRow label="Default URL" description="Starting URL for new browser tiles">
          <TextInput
            value={settings.browser.defaultUrl}
            onChange={(v) => update({ browser: { ...settings.browser, defaultUrl: v } })}
            placeholder="https://www.google.com"
          />
        </SettingRow>
        <SettingRow label="Default Device Preset" description="Device preset for new browser tiles">
          <SelectInput
            value={settings.browser.defaultDevicePreset}
            onChange={(v) => update({ browser: { ...settings.browser, defaultDevicePreset: v } })}
            options={presetOptions}
          />
        </SettingRow>
      </div>
    </div>
  )
}

function CanvasSection({ settings, update }: { settings: Settings; update: (patch: Partial<Settings>) => void }) {
  return (
    <div>
      <h2 className="mb-4 text-sm font-semibold text-zinc-200">Canvas</h2>
      <div className="divide-y divide-zinc-800 rounded-lg border border-zinc-800 bg-zinc-900/50 px-4">
        <SettingRow label="Tile Gap" description="Pixels between auto-placed tiles">
          <NumberInput
            value={settings.canvas.tileGap}
            onChange={(v) => update({ canvas: { ...settings.canvas, tileGap: v } })}
            min={10}
            max={100}
          />
        </SettingRow>
        <SettingRow label="Default Zoom" description="Initial zoom level for new workspaces">
          <NumberInput
            value={settings.canvas.defaultZoom}
            onChange={(v) => update({ canvas: { ...settings.canvas, defaultZoom: v } })}
            min={0.1}
            max={2.0}
            step={0.05}
          />
        </SettingRow>
        <SettingRow label="Min Zoom">
          <NumberInput
            value={settings.canvas.minZoom}
            onChange={(v) => update({ canvas: { ...settings.canvas, minZoom: v } })}
            min={0.05}
            max={1.0}
            step={0.05}
          />
        </SettingRow>
        <SettingRow label="Max Zoom">
          <NumberInput
            value={settings.canvas.maxZoom}
            onChange={(v) => update({ canvas: { ...settings.canvas, maxZoom: v } })}
            min={1.0}
            max={5.0}
            step={0.1}
          />
        </SettingRow>
        <SettingRow label="Background Dot Gap" description="Spacing of canvas background dots">
          <NumberInput
            value={settings.canvas.backgroundDotGap}
            onChange={(v) => update({ canvas: { ...settings.canvas, backgroundDotGap: v } })}
            min={5}
            max={50}
          />
        </SettingRow>
        <SettingRow label="Background Dot Size">
          <NumberInput
            value={settings.canvas.backgroundDotSize}
            onChange={(v) => update({ canvas: { ...settings.canvas, backgroundDotSize: v } })}
            min={0.5}
            max={5}
            step={0.5}
          />
        </SettingRow>
        <SettingRow label="Pan Speed" description="Scroll-to-pan speed multiplier (default 0.5)">
          <NumberInput
            value={settings.canvas.panSpeed}
            onChange={(v) => update({ canvas: { ...settings.canvas, panSpeed: v } })}
            min={0.1}
            max={3.0}
            step={0.1}
          />
        </SettingRow>
      </div>
    </div>
  )
}

// ── Template tile type colors ────────────────────────────

const TILE_COLORS: Record<string, string> = {
  terminal: 'bg-green-500/30 border-green-500/50',
  browser: 'bg-emerald-500/30 border-emerald-500/50',
  notes: 'bg-amber-500/30 border-amber-500/50'
}

const TILE_LABELS: Record<string, string> = {
  terminal: 'T',
  browser: 'B',
  notes: 'N'
}

function TemplatePreview({ tiles }: { tiles: TemplateTile[] }) {
  if (tiles.length === 0) return <span className="text-[10px] text-zinc-600">Empty</span>
  // Calculate bounding box for scaling
  let maxX = 0, maxY = 0
  for (const t of tiles) {
    maxX = Math.max(maxX, t.relativePosition.x + t.width)
    maxY = Math.max(maxY, t.relativePosition.y + t.height)
  }
  const scale = Math.min(140 / maxX, 60 / maxY, 1)

  return (
    <div className="relative" style={{ width: maxX * scale, height: maxY * scale }}>
      {tiles.map((t, i) => (
        <div
          key={i}
          className={`absolute flex items-center justify-center rounded border text-[8px] font-bold text-zinc-300 ${TILE_COLORS[t.type]}`}
          style={{
            left: t.relativePosition.x * scale,
            top: t.relativePosition.y * scale,
            width: t.width * scale,
            height: t.height * scale
          }}
        >
          {TILE_LABELS[t.type]}
        </div>
      ))}
    </div>
  )
}

function TemplatesSection({ settings, update }: { settings: Settings; update: (patch: Partial<Settings>) => void }) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editTiles, setEditTiles] = useState<TemplateTile[]>([])

  const startEdit = useCallback((tmpl: WorkspaceTemplate) => {
    setEditingId(tmpl.id)
    setEditName(tmpl.name)
    setEditTiles([...tmpl.tiles])
  }, [])

  const startNew = useCallback(() => {
    setEditingId('new')
    setEditName('')
    setEditTiles([])
  }, [])

  const saveTemplate = useCallback(() => {
    if (!editName.trim() || editTiles.length === 0) return
    const existing = settings.templates.find((t) => t.id === editingId)
    if (existing) {
      update({
        templates: settings.templates.map((t) =>
          t.id === editingId ? { ...t, name: editName.trim(), tiles: editTiles } : t
        )
      })
    } else {
      update({
        templates: [
          ...settings.templates,
          { id: uuid(), name: editName.trim(), isBuiltIn: false, tiles: editTiles }
        ]
      })
    }
    setEditingId(null)
  }, [editingId, editName, editTiles, settings.templates, update])

  const deleteTemplate = useCallback(
    (id: string) => {
      update({ templates: settings.templates.filter((t) => t.id !== id) })
    },
    [settings.templates, update]
  )

  const addTile = useCallback(
    (type: 'terminal' | 'browser' | 'notes') => {
      const defaults: Record<string, { w: number; h: number }> = {
        terminal: { w: 640, h: 400 },
        browser: { w: 800, h: 600 },
        notes: { w: 400, h: 400 }
      }
      const { w, h } = defaults[type]
      // Place to the right of the last tile
      let maxRight = 0
      for (const t of editTiles) maxRight = Math.max(maxRight, t.relativePosition.x + t.width)
      setEditTiles((prev) => [
        ...prev,
        { type, relativePosition: { x: maxRight > 0 ? maxRight + 40 : 0, y: 0 }, width: w, height: h }
      ])
    },
    [editTiles]
  )

  const removeTile = useCallback((index: number) => {
    setEditTiles((prev) => prev.filter((_, i) => i !== index))
  }, [])

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-200">Templates</h2>
        <button
          onClick={startNew}
          className="flex items-center gap-1 rounded border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-xs text-zinc-300 hover:bg-zinc-700 hover:text-white"
        >
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          New Template
        </button>
      </div>

      {/* Template list */}
      <div className="space-y-2">
        {settings.templates.map((tmpl) => (
          <div
            key={tmpl.id}
            className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-3"
          >
            <TemplatePreview tiles={tmpl.tiles} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-zinc-200">{tmpl.name}</span>
                {tmpl.isBuiltIn && (
                  <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[9px] text-zinc-500">Built-in</span>
                )}
              </div>
              <span className="text-[10px] text-zinc-600">
                {tmpl.tiles.length} tile{tmpl.tiles.length !== 1 ? 's' : ''} &middot;{' '}
                {tmpl.tiles.map((t) => t.type).join(', ')}
              </span>
            </div>
            <div className="flex gap-1">
              {!tmpl.isBuiltIn && (
                <>
                  <button
                    onClick={() => startEdit(tmpl)}
                    className="rounded p-1.5 text-zinc-600 hover:bg-zinc-700 hover:text-zinc-300"
                    title="Edit"
                  >
                    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                      />
                    </svg>
                  </button>
                  <button
                    onClick={() => deleteTemplate(tmpl.id)}
                    className="rounded p-1.5 text-zinc-600 hover:bg-zinc-700 hover:text-red-400"
                    title="Delete"
                  >
                    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Template editor */}
      {editingId && (
        <div className="mt-4 rounded-lg border border-blue-500/30 bg-zinc-900 p-4">
          <h3 className="mb-3 text-xs font-semibold text-zinc-300">
            {editingId === 'new' ? 'New Template' : 'Edit Template'}
          </h3>
          <div className="mb-3">
            <Label>Template Name</Label>
            <div className="mt-1">
              <TextInput value={editName} onChange={setEditName} placeholder="My Template" />
            </div>
          </div>

          <Label>Tiles</Label>
          <div className="mt-2 space-y-1.5">
            {editTiles.map((tile, i) => (
              <div key={i} className="flex items-center gap-2 rounded border border-zinc-800 bg-zinc-800/50 px-3 py-2">
                <span
                  className={`h-2 w-2 rounded-full ${
                    tile.type === 'terminal' ? 'bg-green-500' : tile.type === 'browser' ? 'bg-emerald-500' : 'bg-amber-400'
                  }`}
                />
                <span className="text-xs text-zinc-300 capitalize">{tile.type}</span>
                <span className="text-[10px] text-zinc-600">
                  {tile.width}x{tile.height}
                </span>
                <button
                  onClick={() => removeTile(i)}
                  className="ml-auto rounded p-0.5 text-zinc-600 hover:text-red-400"
                >
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>

          <div className="mt-2 flex gap-1.5">
            <button
              onClick={() => addTile('terminal')}
              className="flex items-center gap-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-[10px] text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
              Terminal
            </button>
            <button
              onClick={() => addTile('browser')}
              className="flex items-center gap-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-[10px] text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Browser
            </button>
            <button
              onClick={() => addTile('notes')}
              className="flex items-center gap-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-[10px] text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
              Note
            </button>
          </div>

          {/* Preview */}
          {editTiles.length > 0 && (
            <div className="mt-3 rounded border border-zinc-800 bg-zinc-950 p-3">
              <span className="mb-2 block text-[10px] text-zinc-600">Preview</span>
              <TemplatePreview tiles={editTiles} />
            </div>
          )}

          <div className="mt-3 flex justify-end gap-2">
            <button
              onClick={() => setEditingId(null)}
              className="rounded px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200"
            >
              Cancel
            </button>
            <button
              onClick={saveTemplate}
              disabled={!editName.trim() || editTiles.length === 0}
              className="rounded bg-blue-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-600 disabled:opacity-40"
            >
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main settings page ───────────────────────────────────

function SettingsPageComponent({ onClose }: SettingsPageProps) {
  const { settings, updateSettings, resetSettings } = useSettings()
  const [activeCategory, setActiveCategory] = useState<Category>('general')

  const update = useCallback(
    (patch: Partial<Settings>) => updateSettings(patch),
    [updateSettings]
  )

  return (
    <div className="absolute inset-0 z-30 flex bg-zinc-950/95 backdrop-blur-sm">
      {/* Sidebar */}
      <div className="flex w-52 flex-col border-r border-zinc-800 bg-zinc-900/80">
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-4">
          <span className="text-sm font-semibold text-zinc-200">Settings</span>
          <button
            onClick={onClose}
            className="rounded p-1 text-zinc-500 hover:bg-zinc-700 hover:text-zinc-200"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <nav className="flex-1 p-2">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              className={`flex w-full items-center rounded-md px-3 py-2 text-left text-xs font-medium transition-colors ${
                activeCategory === cat.id
                  ? 'bg-blue-500/10 text-blue-300 ring-1 ring-blue-500/20'
                  : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </nav>
        <div className="border-t border-zinc-800 p-3">
          <button
            onClick={resetSettings}
            className="flex w-full items-center justify-center gap-1.5 rounded-md bg-zinc-800 py-2 text-xs font-medium text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-zinc-200"
          >
            Reset to Defaults
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="mx-auto max-w-2xl">
          {activeCategory === 'general' && <GeneralSection settings={settings} update={update} />}
          {activeCategory === 'appearance' && <AppearanceSection settings={settings} update={update} />}
          {activeCategory === 'terminal' && <TerminalSection settings={settings} update={update} />}
          {activeCategory === 'browser' && <BrowserSection settings={settings} update={update} />}
          {activeCategory === 'canvas' && <CanvasSection settings={settings} update={update} />}
          {activeCategory === 'templates' && <TemplatesSection settings={settings} update={update} />}
        </div>
      </div>
    </div>
  )
}

export const SettingsPage = memo(SettingsPageComponent)

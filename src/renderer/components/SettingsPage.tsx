import { memo, useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { useSettings, type Settings, type WorkspaceTemplate, type TemplateTile, type HotkeyAction } from '@/hooks/useSettings'
import { useResolvedTemplates, type ResolvedTemplate } from '@/hooks/useResolvedTemplates'
import { useCanvasStore } from '@/store/canvas-store'
import { formatHotkey, captureHotkey, DEFAULT_HOTKEYS } from '@/hooks/useHotkeys'
import { TERMINAL_PRESETS, BROWSER_SPAWN_PRESETS } from '@/constants/devicePresets'
import { DEVICE_PRESETS } from '@/constants/devicePresets'
import { v4 as uuid } from 'uuid'

type Category = 'general' | 'appearance' | 'terminal' | 'browser' | 'canvas' | 'hotkeys' | 'templates' | 'notifications' | 'voice'

interface SettingsPageProps {
  onClose: () => void
}

const CATEGORIES: { id: Category; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'terminal', label: 'Terminal' },
  { id: 'browser', label: 'Browser' },
  { id: 'canvas', label: 'Canvas' },
  { id: 'hotkeys', label: 'Hotkeys' },
  { id: 'templates', label: 'Templates' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'voice', label: 'Voice' }
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
        className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white transition-transform ${value ? 'translate-x-[16px]' : 'translate-x-0'}`}
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

// ── Known IDEs ───────────────────────────────────────────

const KNOWN_IDES = [
  { value: 'code', label: 'VS Code' },
  { value: 'cursor', label: 'Cursor' },
  { value: 'zed', label: 'Zed' },
  { value: 'subl', label: 'Sublime Text' },
  { value: 'idea', label: 'IntelliJ IDEA' },
  { value: 'webstorm', label: 'WebStorm' },
  { value: 'nova', label: 'Nova' },
  { value: 'fleet', label: 'Fleet' }
]

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
        <SettingRow label="Preferred IDE" description="CLI command to open your code editor (used by IDE button on terminals)">
          <div className="flex items-center gap-2">
            <SelectInput
              value={
                !settings.general.ideCommand
                  ? ''
                  : KNOWN_IDES.some((ide) => ide.value === settings.general.ideCommand)
                    ? settings.general.ideCommand
                    : 'custom'
              }
              onChange={(v) => {
                if (v === 'custom') {
                  update({ general: { ...settings.general, ideCommand: '' } })
                } else if (v === '') {
                  update({ general: { ...settings.general, ideCommand: null } })
                } else {
                  update({ general: { ...settings.general, ideCommand: v } })
                }
              }}
              options={[
                { value: '', label: 'None' },
                ...KNOWN_IDES,
                { value: 'custom', label: 'Custom...' }
              ]}
            />
            {settings.general.ideCommand !== null &&
              !KNOWN_IDES.some((ide) => ide.value === settings.general.ideCommand) && (
                <TextInput
                  value={settings.general.ideCommand ?? ''}
                  onChange={(v) => update({ general: { ...settings.general, ideCommand: v || null } })}
                  placeholder="e.g. my-editor"
                />
              )}
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

  const pc = settings.promptCache

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
        Claude Code Prompt Cache
      </h3>
      <div className="divide-y divide-zinc-800 rounded-lg border border-zinc-800 bg-zinc-900/50 px-4">
        <SettingRow label="Show Cache Timer" description="Display prompt cache countdown on Claude Code terminal tiles">
          <Toggle
            value={pc.showTimer}
            onChange={(v) => update({ promptCache: { ...pc, showTimer: v } })}
          />
        </SettingRow>
        <SettingRow label="Cache TTL" description="Prompt cache lifetime — depends on your Claude plan">
          <SelectInput
            value={String(pc.ttlSeconds)}
            onChange={(v) => update({ promptCache: { ...pc, ttlSeconds: Number(v) } })}
            options={[
              { value: '300', label: '5 minutes (Pro)' },
              { value: '3600', label: '1 hour (Max)' }
            ]}
          />
        </SettingRow>
        <SettingRow label="Warning Threshold (sec)" description="Seconds before expiry to trigger warning toast + urgency ranking">
          <NumberInput
            value={pc.warningThresholdSeconds}
            onChange={(v) => update({ promptCache: { ...pc, warningThresholdSeconds: v } })}
            min={10}
            max={1800}
            step={10}
          />
        </SettingRow>
        <SettingRow label="Auto Keep-Alive" description="Automatically send a message to refresh the cache ~15s before it expires">
          <Toggle
            value={pc.autoKeepAlive}
            onChange={(v) => update({ promptCache: { ...pc, autoKeepAlive: v } })}
          />
        </SettingRow>
        <SettingRow label="Keep-Alive Message" description="Text sent to Claude (via PTY) to trigger a cache-refreshing API call">
          <TextInput
            value={pc.keepAliveMessage}
            onChange={(v) => update({ promptCache: { ...pc, keepAliveMessage: v } })}
            placeholder="."
          />
        </SettingRow>
        <SettingRow label="Max Auto Keep-Alives" description="How many times auto keep-alive may fire before stopping. Resets whenever you send a message. 0 = unlimited.">
          <NumberInput
            value={pc.maxAutoKeepAlives}
            onChange={(v) => update({ promptCache: { ...pc, maxAutoKeepAlives: v } })}
            min={0}
            max={1000}
            step={1}
          />
        </SettingRow>
        <SettingRow label="Warning Notification" description="Emit a sticky toast when the cache enters warning threshold">
          <Toggle
            value={pc.notifyOnWarning}
            onChange={(v) => update({ promptCache: { ...pc, notifyOnWarning: v } })}
          />
        </SettingRow>
        <SettingRow label="Expiry Notification" description="Emit a sticky toast when the cache expires">
          <Toggle
            value={pc.notifyOnExpiry}
            onChange={(v) => update({ promptCache: { ...pc, notifyOnExpiry: v } })}
          />
        </SettingRow>
        <SettingRow label="Rank by Urgency" description="Float Claude terminals close to expiry to the top of the Process Panel">
          <Toggle
            value={pc.rankByUrgency}
            onChange={(v) => update({ promptCache: { ...pc, rankByUrgency: v } })}
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

  const [extensions, setExtensions] = useState<Array<{ id: string; name: string; version: string }>>([])

  useEffect(() => {
    window.browser.listExtensions().then(setExtensions)
  }, [])

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
        <SettingRow label="Extensions" description="Place unpacked Chrome extensions in the extensions folder and restart">
          <div className="flex flex-col items-end gap-2">
            {extensions.length > 0 ? (
              <div className="text-xs text-zinc-400 space-y-1">
                {extensions.map((ext) => (
                  <div key={ext.id}>{ext.name} <span className="text-zinc-600">v{ext.version}</span></div>
                ))}
              </div>
            ) : (
              <span className="text-xs text-zinc-600">No extensions loaded</span>
            )}
            <button
              onClick={() => window.browser.openExtensionsDir()}
              className="rounded bg-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-600"
            >
              Open Extensions Folder
            </button>
          </div>
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
        <SettingRow label="Background Mode" description="Visual style of the canvas background">
          <SelectInput
            value={settings.canvas.backgroundMode}
            onChange={(v) => update({ canvas: { ...settings.canvas, backgroundMode: v as any } })}
            options={[
              { value: 'dots', label: 'Dots (Default)' },
              { value: 'matrix', label: 'Matrix Rain' },
              { value: 'starfield', label: 'Starfield' },
              { value: 'circuit', label: 'Circuit Board' },
              { value: 'topographic', label: 'Topographic' },
              { value: 'ocean', label: 'Ocean Waves' },
              { value: 'constellation', label: 'Constellation' },
              { value: 'fireflies', label: 'Fireflies' },
              { value: 'snow', label: 'Snowfall' }
            ]}
          />
        </SettingRow>
        {settings.canvas.backgroundMode === 'dots' && (
          <>
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
          </>
        )}
        <SettingRow label="Pan Speed" description="Scroll-to-pan speed multiplier (default 0.5)">
          <NumberInput
            value={settings.canvas.panSpeed}
            onChange={(v) => update({ canvas: { ...settings.canvas, panSpeed: v } })}
            min={0.1}
            max={3.0}
            step={0.1}
          />
        </SettingRow>
        <SectionDivider />
        <SettingRow label="Minimap" description="Show a mini overview map of all tiles on the canvas">
          <Toggle
            value={settings.canvas.minimapEnabled}
            onChange={(v) => update({ canvas: { ...settings.canvas, minimapEnabled: v } })}
          />
        </SettingRow>
        <SettingRow label="Minimap Position" description="Corner of the screen where the minimap appears">
          <SelectInput
            value={settings.canvas.minimapPosition}
            onChange={(v) =>
              update({
                canvas: {
                  ...settings.canvas,
                  minimapPosition: v as 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
                }
              })
            }
            options={[
              { value: 'top-left', label: 'Top Left' },
              { value: 'top-right', label: 'Top Right' },
              { value: 'bottom-left', label: 'Bottom Left' },
              { value: 'bottom-right', label: 'Bottom Right' }
            ]}
          />
        </SettingRow>
      </div>
    </div>
  )
}

// ── Hotkeys section ──────────────────────────────────────

const HOTKEY_ACTION_META: Record<HotkeyAction, { label: string; description: string }> = {
  toggleProcessPanel: { label: 'Toggle Process Panel', description: 'Show/hide the right panel' },
  toggleWorkspacePanel: { label: 'Toggle Workspace Panel', description: 'Show/hide the left panel' },
  toggleMinimap: { label: 'Toggle Minimap', description: 'Show/hide the minimap HUD' },
  newTerminal: { label: 'New Terminal', description: 'Spawn a new terminal tile' },
  newBrowser: { label: 'New Browser', description: 'Spawn a new browser tile' },
  newNote: { label: 'New Note', description: 'Spawn a new note tile' },
  openSettings: { label: 'Open Settings', description: 'Open the settings page' },
  cycleFocusForward: { label: 'Next Tile', description: 'Cycle focus to the next tile' },
  cycleFocusBackward: { label: 'Previous Tile', description: 'Cycle focus to the previous tile' },
  killFocused: { label: 'Kill Focused Tile', description: 'Close the currently focused tile' },
  openInIde: { label: 'Open in IDE', description: 'Open the focused terminal\'s directory in your IDE' },
  togglePomodoro: { label: 'Toggle Pomodoro', description: 'Show/hide the Pomodoro timer popover' }
}

function HotkeyInput({
  binding,
  isRecording,
  onStartRecording,
  onReset
}: {
  binding: string
  isRecording: boolean
  onStartRecording: () => void
  onReset: () => void
}) {
  return (
    <div className="flex items-center gap-2">
      <button
        onClick={onStartRecording}
        className={`min-w-[120px] rounded border px-3 py-1.5 text-left font-mono text-xs transition-colors ${
          isRecording
            ? 'animate-pulse border-blue-500 bg-blue-500/10 text-blue-300'
            : 'border-zinc-700 bg-zinc-800 text-zinc-200 hover:bg-zinc-700'
        }`}
      >
        {isRecording ? 'Press a key...' : formatHotkey(binding)}
      </button>
      <button
        onClick={onReset}
        className="rounded p-1 text-zinc-600 hover:bg-zinc-700 hover:text-zinc-300"
        title="Reset to default"
      >
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
      </button>
    </div>
  )
}

function HotkeysSection({ settings, update }: { settings: Settings; update: (patch: Partial<Settings>) => void }) {
  const [recordingAction, setRecordingAction] = useState<HotkeyAction | null>(null)

  useEffect(() => {
    if (!recordingAction) return
    const handler = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') {
        setRecordingAction(null)
        return
      }
      const binding = captureHotkey(e)
      if (!binding) return
      update({ hotkeys: { ...settings.hotkeys, [recordingAction]: binding } })
      setRecordingAction(null)
    }
    window.addEventListener('keydown', handler, { capture: true })
    return () => window.removeEventListener('keydown', handler, { capture: true })
  }, [recordingAction, settings.hotkeys, update])

  return (
    <div>
      <h2 className="mb-4 text-sm font-semibold text-zinc-200">Hotkeys</h2>
      <p className="mb-4 text-[10px] text-zinc-600">
        Click a binding to record a new shortcut. Press Escape to cancel.
      </p>
      <div className="divide-y divide-zinc-800 rounded-lg border border-zinc-800 bg-zinc-900/50 px-4">
        {(Object.keys(HOTKEY_ACTION_META) as HotkeyAction[]).map((action) => {
          const meta = HOTKEY_ACTION_META[action]
          return (
            <SettingRow key={action} label={meta.label} description={meta.description}>
              <HotkeyInput
                binding={settings.hotkeys[action]}
                isRecording={recordingAction === action}
                onStartRecording={() => setRecordingAction(action)}
                onReset={() => update({ hotkeys: { ...settings.hotkeys, [action]: DEFAULT_HOTKEYS[action] } })}
              />
            </SettingRow>
          )
        })}
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

const TILE_GAP = 40

type SnapSide = 'right' | 'left' | 'top' | 'bottom'
interface SnapTarget { anchorIdx: number; side: SnapSide; x: number; y: number }

function getSnapTargets(tiles: TemplateTile[], dragIdx: number): SnapTarget[] {
  const dragged = tiles[dragIdx]
  const targets: SnapTarget[] = []
  for (let i = 0; i < tiles.length; i++) {
    if (i === dragIdx) continue
    const t = tiles[i]
    targets.push(
      { anchorIdx: i, side: 'right', x: t.relativePosition.x + t.width + TILE_GAP, y: t.relativePosition.y },
      { anchorIdx: i, side: 'left', x: t.relativePosition.x - dragged.width - TILE_GAP, y: t.relativePosition.y },
      { anchorIdx: i, side: 'bottom', x: t.relativePosition.x, y: t.relativePosition.y + t.height + TILE_GAP },
      { anchorIdx: i, side: 'top', x: t.relativePosition.x, y: t.relativePosition.y - dragged.height - TILE_GAP }
    )
  }
  return targets
}

function nearestSnap(targets: SnapTarget[], dragX: number, dragY: number): SnapTarget | null {
  if (targets.length === 0) return null
  let best: SnapTarget | null = null
  let bestDist = Infinity
  for (const t of targets) {
    const dx = t.x - dragX
    const dy = t.y - dragY
    const dist = dx * dx + dy * dy
    if (dist < bestDist) { bestDist = dist; best = t }
  }
  return best
}

// Shift all tiles so the minimum x,y is 0 — other tiles move out of the way
function normalizePositions(tiles: TemplateTile[]): TemplateTile[] {
  if (tiles.length === 0) return tiles
  let minX = Infinity, minY = Infinity
  for (const t of tiles) {
    minX = Math.min(minX, t.relativePosition.x)
    minY = Math.min(minY, t.relativePosition.y)
  }
  if (minX === 0 && minY === 0) return tiles
  return tiles.map((t) => ({
    ...t,
    relativePosition: { x: t.relativePosition.x - minX, y: t.relativePosition.y - minY }
  }))
}

function InteractiveTemplatePreview({
  tiles,
  onUpdate
}: {
  tiles: TemplateTile[]
  onUpdate: (tiles: TemplateTile[]) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null)
  const dragOriginRef = useRef<{ clientX: number; clientY: number; origX: number; origY: number } | null>(null)

  if (tiles.length === 0) return <span className="text-[10px] text-zinc-600">Add tiles, then drag to arrange</span>

  // Bounding box from settled tile positions only (exclude the dragged tile)
  // so dragging far away doesn't shrink the preview
  let maxX = 0, maxY = 0
  for (let i = 0; i < tiles.length; i++) {
    if (i === dragIdx) continue
    const t = tiles[i]
    maxX = Math.max(maxX, t.relativePosition.x + t.width)
    maxY = Math.max(maxY, t.relativePosition.y + t.height)
  }
  // When not dragging, include all tiles normally
  if (dragIdx === null) {
    for (const t of tiles) {
      maxX = Math.max(maxX, t.relativePosition.x + t.width)
      maxY = Math.max(maxY, t.relativePosition.y + t.height)
    }
  }
  // Include snap target extents so ghost outlines fit in the container
  const snapTargets = dragIdx !== null ? getSnapTargets(tiles, dragIdx) : []
  if (dragIdx !== null) {
    const dragged = tiles[dragIdx]
    for (const st of snapTargets) {
      maxX = Math.max(maxX, st.x + dragged.width)
      maxY = Math.max(maxY, st.y + dragged.height)
    }
  }
  const scale = Math.min(460 / Math.max(maxX, 1), 180 / Math.max(maxY, 1), 0.35)

  // Find which snap target the dragged tile is closest to
  const activeSnap = (dragIdx !== null && dragPos) ? nearestSnap(snapTargets, dragPos.x, dragPos.y) : null

  const handlePointerDown = (e: React.PointerEvent, index: number) => {
    if (tiles.length < 2) return
    e.preventDefault()
    e.stopPropagation()
    const tile = tiles[index]
    setDragIdx(index)
    setDragPos({ x: tile.relativePosition.x, y: tile.relativePosition.y })
    dragOriginRef.current = {
      clientX: e.clientX, clientY: e.clientY,
      origX: tile.relativePosition.x, origY: tile.relativePosition.y
    }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    if (dragIdx === null || !dragOriginRef.current) return
    const { clientX: sx, clientY: sy, origX, origY } = dragOriginRef.current
    const dx = (e.clientX - sx) / scale
    const dy = (e.clientY - sy) / scale
    setDragPos({ x: origX + dx, y: origY + dy })
  }

  const handlePointerUp = () => {
    if (dragIdx !== null && activeSnap) {
      // Snap to target position, then normalize so nothing is negative
      const result = tiles.map((t, i) =>
        i === dragIdx ? { ...t, relativePosition: { x: activeSnap.x, y: activeSnap.y } } : t
      )
      onUpdate(normalizePositions(result))
    }
    setDragIdx(null)
    setDragPos(null)
    dragOriginRef.current = null
  }

  const SIDE_ARROWS: Record<SnapSide, string> = { right: '\u2192', left: '\u2190', bottom: '\u2193', top: '\u2191' }

  return (
    <div
      ref={containerRef}
      className="relative select-none overflow-visible"
      style={{ width: maxX * scale, height: maxY * scale, minHeight: 60 }}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
    >
      {/* Snap zone ghosts */}
      {dragIdx !== null && snapTargets.map((st, si) => {
        const dragged = tiles[dragIdx]
        const isActive = activeSnap === st
        return (
          <div
            key={si}
            className={`absolute rounded border border-dashed pointer-events-none transition-all duration-150 ${
              isActive
                ? 'border-blue-400 bg-blue-500/20 opacity-100 scale-100'
                : 'border-zinc-700/50 opacity-0'
            }`}
            style={{
              left: st.x * scale,
              top: st.y * scale,
              width: dragged.width * scale,
              height: dragged.height * scale
            }}
          >
            {isActive && (
              <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-blue-400">
                {SIDE_ARROWS[st.side]}
              </span>
            )}
          </div>
        )
      })}

      {/* Tiles */}
      {tiles.map((t, i) => {
        const isDragging = dragIdx === i
        // Dragged tile follows the mouse
        const posX = (isDragging && dragPos) ? dragPos.x : t.relativePosition.x
        const posY = (isDragging && dragPos) ? dragPos.y : t.relativePosition.y
        return (
          <div
            key={i}
            onPointerDown={(e) => handlePointerDown(e, i)}
            className={`absolute flex flex-col items-center justify-center rounded border text-[8px] font-bold text-zinc-300 ${
              TILE_COLORS[t.type]
            } ${tiles.length >= 2 ? 'cursor-grab active:cursor-grabbing' : ''} ${
              isDragging ? 'shadow-lg shadow-black/40 brightness-125 z-10' : 'hover:brightness-110'
            }`}
            style={{
              left: posX * scale,
              top: posY * scale,
              width: t.width * scale,
              height: t.height * scale,
              zIndex: isDragging ? 10 : 1,
              transition: isDragging ? 'none' : 'left 0.15s, top 0.15s'
            }}
          >
            <span>{TILE_LABELS[t.type]}</span>
            {t.label && <span className="text-[7px] font-normal text-zinc-400 truncate max-w-full px-1">{t.label}</span>}
          </div>
        )
      })}
    </div>
  )
}

function TemplatesSection({ settings, update }: { settings: Settings; update: (patch: Partial<Settings>) => void }) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editTiles, setEditTiles] = useState<TemplateTile[]>([])
  const [editScope, setEditScope] = useState<'global' | 'project'>('global')

  const workspaces = useCanvasStore((s) => s.workspaces)
  const activeWorkspaceId = useCanvasStore((s) => s.activeWorkspaceId)
  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId)
  const { resolvedTemplates, projectTemplates, saveProjectTemplates, isProjectScope } = useResolvedTemplates(settings.templates)

  const [scopeFilter, setScopeFilter] = useState<'all' | 'global' | string>('all')

  const filteredTemplates = useMemo(() => {
    if (scopeFilter === 'all') return resolvedTemplates
    if (scopeFilter === 'global') return resolvedTemplates.filter((t) => t.scope === 'global')
    return resolvedTemplates.filter((t) => t.scope === 'project')
  }, [resolvedTemplates, scopeFilter])

  const startEdit = useCallback((tmpl: ResolvedTemplate) => {
    setEditingId(tmpl.id)
    setEditName(tmpl.name)
    setEditTiles([...tmpl.tiles])
    setEditScope(tmpl.scope)
  }, [])

  const startNew = useCallback(() => {
    setEditingId('new')
    setEditName('')
    setEditTiles([])
    setEditScope(isProjectScope ? 'project' : 'global')
  }, [isProjectScope])

  const saveTemplate = useCallback(() => {
    if (!editName.trim() || editTiles.length === 0) return

    if (editScope === 'project' && isProjectScope) {
      const existing = projectTemplates.find((t) => t.id === editingId)
      if (existing) {
        saveProjectTemplates(projectTemplates.map((t) =>
          t.id === editingId ? { ...t, name: editName.trim(), tiles: editTiles } : t
        ))
      } else {
        saveProjectTemplates([
          ...projectTemplates,
          { id: uuid(), name: editName.trim(), isBuiltIn: false, tiles: editTiles }
        ])
      }
    } else {
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
    }
    setEditingId(null)
  }, [editingId, editName, editTiles, editScope, settings.templates, update, projectTemplates, saveProjectTemplates, isProjectScope])

  const deleteTemplate = useCallback(
    (tmpl: ResolvedTemplate) => {
      if (tmpl.scope === 'project') {
        saveProjectTemplates(projectTemplates.filter((t) => t.id !== tmpl.id))
      } else {
        update({ templates: settings.templates.filter((t) => t.id !== tmpl.id) })
      }
    },
    [settings.templates, update, projectTemplates, saveProjectTemplates]
  )

  const forkToProject = useCallback(
    (tmpl: WorkspaceTemplate) => {
      if (!isProjectScope) return
      const forked = { ...tmpl, id: uuid(), isBuiltIn: false }
      saveProjectTemplates([...projectTemplates, forked])
    },
    [isProjectScope, projectTemplates, saveProjectTemplates]
  )

  const addTile = useCallback(
    (type: 'terminal' | 'browser' | 'notes') => {
      const defaults: Record<string, { w: number; h: number }> = {
        terminal: { w: 640, h: 400 },
        browser: { w: 800, h: 600 },
        notes: { w: 400, h: 400 }
      }
      const { w, h } = defaults[type]
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

  const updateTileField = useCallback((index: number, field: keyof TemplateTile, value: string | undefined) => {
    setEditTiles((prev) => prev.map((t, i) => (i === index ? { ...t, [field]: value } : t)))
  }, [])

  const updateTileSize = useCallback((index: number, width: number, height: number) => {
    setEditTiles((prev) => prev.map((t, i) => (i === index ? { ...t, width, height } : t)))
  }, [])

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-200">Templates</h2>
        <div className="flex items-center gap-2">
          {/* Scope filter */}
          <select
            value={scopeFilter}
            onChange={(e) => setScopeFilter(e.target.value)}
            className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-300 outline-none focus:border-blue-500"
          >
            <option value="all">All</option>
            <option value="global">Global</option>
            {isProjectScope && (
              <option value={activeWorkspaceId}>
                {activeWorkspace?.name ?? 'Project'}
              </option>
            )}
          </select>
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
      </div>

      {/* Template list */}
      <div className="space-y-2">
        {filteredTemplates.map((tmpl) => (
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
                <span className={`rounded px-1.5 py-0.5 text-[9px] ${
                  tmpl.scope === 'project' ? 'bg-purple-500/20 text-purple-400' : 'bg-zinc-800 text-zinc-500'
                }`}>
                  {tmpl.scope === 'project' ? 'Project' : 'Global'}
                </span>
              </div>
              <span className="text-[10px] text-zinc-600">
                {tmpl.tiles.length} tile{tmpl.tiles.length !== 1 ? 's' : ''} &middot;{' '}
                {tmpl.tiles.map((t) => t.type).join(', ')}
              </span>
            </div>
            <div className="flex gap-1">
              {/* Fork global to project */}
              {tmpl.scope === 'global' && isProjectScope && !tmpl.isBuiltIn && (
                <button
                  onClick={() => forkToProject(tmpl)}
                  className="rounded p-1.5 text-zinc-600 hover:bg-zinc-700 hover:text-purple-400"
                  title="Customize for this project"
                >
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                  </svg>
                </button>
              )}
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
                    onClick={() => deleteTemplate(tmpl)}
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

          {/* Scope selector for new templates */}
          {editingId === 'new' && isProjectScope && (
            <div className="mb-3">
              <Label>Scope</Label>
              <div className="mt-1 flex gap-2">
                <button
                  onClick={() => setEditScope('global')}
                  className={`rounded px-3 py-1.5 text-xs ${editScope === 'global' ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
                >
                  Global
                </button>
                <button
                  onClick={() => setEditScope('project')}
                  className={`rounded px-3 py-1.5 text-xs ${editScope === 'project' ? 'bg-purple-500/30 text-purple-300' : 'text-zinc-500 hover:text-zinc-300'}`}
                >
                  {activeWorkspace?.name ?? 'Project'}
                </button>
              </div>
            </div>
          )}

          <div className="mb-3">
            <Label>Template Name</Label>
            <div className="mt-1">
              <TextInput value={editName} onChange={setEditName} placeholder="My Template" />
            </div>
          </div>

          <Label>Tiles</Label>
          <div className="mt-2 space-y-1.5">
            {editTiles.map((tile, i) => (
              <div key={i} className="rounded border border-zinc-800 bg-zinc-800/50 px-3 py-2">
                <div className="flex items-center gap-2">
                  <span
                    className={`h-2 w-2 rounded-full ${
                      tile.type === 'terminal' ? 'bg-green-500' : tile.type === 'browser' ? 'bg-emerald-500' : 'bg-amber-400'
                    }`}
                  />
                  <span className="text-xs text-zinc-300 capitalize">{tile.type}</span>
                  {(tile.type === 'terminal' || tile.type === 'browser') ? (
                    <select
                      value={`${tile.width}x${tile.height}`}
                      onChange={(e) => {
                        const [w, h] = e.target.value.split('x').map(Number)
                        updateTileSize(i, w, h)
                      }}
                      className="rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-[10px] text-zinc-400 outline-none focus:border-blue-500"
                    >
                      {(tile.type === 'terminal' ? TERMINAL_PRESETS : BROWSER_SPAWN_PRESETS).map((preset) => (
                        <option key={preset.name} value={`${preset.width}x${preset.height}`}>
                          {preset.name} ({preset.width}&times;{preset.height})
                        </option>
                      ))}
                      {/* Show current size if it doesn't match any preset */}
                      {!(tile.type === 'terminal' ? TERMINAL_PRESETS : BROWSER_SPAWN_PRESETS).some(
                        (p) => p.width === tile.width && p.height === tile.height
                      ) && (
                        <option value={`${tile.width}x${tile.height}`}>
                          Custom ({tile.width}&times;{tile.height})
                        </option>
                      )}
                    </select>
                  ) : (
                    <span className="text-[10px] text-zinc-600">
                      {tile.width}x{tile.height}
                    </span>
                  )}
                  <button
                    onClick={() => removeTile(i)}
                    className="ml-auto rounded p-0.5 text-zinc-600 hover:text-red-400"
                  >
                    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                {/* Terminal-specific fields: label, command, cwd */}
                {tile.type === 'terminal' && (
                  <div className="mt-2 space-y-1.5 pl-4">
                    <div className="flex items-center gap-2">
                      <span className="w-14 text-[10px] text-zinc-600">Label</span>
                      <input
                        type="text"
                        value={tile.label || ''}
                        onChange={(e) => updateTileField(i, 'label', e.target.value || undefined)}
                        placeholder="e.g., Dev Server"
                        className="flex-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-300 outline-none placeholder:text-zinc-700 focus:border-blue-500"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-14 text-[10px] text-zinc-600">Command</span>
                      <input
                        type="text"
                        value={tile.command || ''}
                        onChange={(e) => updateTileField(i, 'command', e.target.value || undefined)}
                        placeholder="e.g., npm run dev"
                        className="flex-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-300 outline-none placeholder:text-zinc-700 focus:border-blue-500"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-14 text-[10px] text-zinc-600">CWD</span>
                      <input
                        type="text"
                        value={tile.cwd || ''}
                        onChange={(e) => updateTileField(i, 'cwd', e.target.value || undefined)}
                        placeholder="relative/path or /absolute/path"
                        className="flex-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-300 outline-none placeholder:text-zinc-700 focus:border-blue-500"
                      />
                    </div>
                  </div>
                )}
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

          {/* Interactive layout preview */}
          {editTiles.length > 0 && (
            <div className="mt-3 rounded border border-zinc-800 bg-zinc-950 p-3">
              <span className="mb-2 block text-[10px] text-zinc-600">Layout — drag tiles to arrange</span>
              <InteractiveTemplatePreview tiles={editTiles} onUpdate={setEditTiles} />
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

function NotificationsSection({ settings, update }: { settings: Settings; update: (patch: Partial<Settings>) => void }) {
  const n = settings.notifications ?? { enabled: true, soundEnabled: true, nativeWhenUnfocused: true }
  return (
    <div>
      <h2 className="mb-4 text-sm font-semibold text-zinc-200">Notifications</h2>
      <div className="divide-y divide-zinc-800 rounded-lg border border-zinc-800 bg-zinc-900/50 px-4">
        <SettingRow label="Enable Notifications" description="Show toast notifications from agents">
          <Toggle
            value={n.enabled}
            onChange={(v) => update({ notifications: { ...n, enabled: v } })}
          />
        </SettingRow>
        <SettingRow label="Notification Sounds" description="Play a chime when a notification arrives">
          <Toggle
            value={n.soundEnabled}
            onChange={(v) => update({ notifications: { ...n, soundEnabled: v } })}
          />
        </SettingRow>
        <SettingRow label="Native OS Notifications" description="Show system notifications when the window is unfocused">
          <Toggle
            value={n.nativeWhenUnfocused}
            onChange={(v) => update({ notifications: { ...n, nativeWhenUnfocused: v } })}
          />
        </SettingRow>
      </div>
    </div>
  )
}

// ── Voice settings ───────────────────────────────────────

function VoiceSection({ settings, update }: { settings: Settings; update: (patch: Partial<Settings>) => void }) {
  const v = settings.voice ?? { enabled: false, activationMode: 'push-to-talk', sttProvider: 'whisper', whisperModel: 'tiny', pushToTalkHotkey: 'Mod+Shift+V', wakeWord: 'hey_jarvis', audioFeedback: true, language: 'en', inputDeviceId: null, llmEndpoint: null, llmModel: null, ambientMonitoring: { onWaiting: true, onError: true, onExit: false, onNotification: false } }
  const [devices, setDevices] = useState<Array<{ deviceId: string; label: string }>>([])

  useEffect(() => {
    // Try enumerateDevices first — if permission was already granted in this session,
    // labels will be populated without needing a fresh getUserMedia call.
    // Only request mic access if labels come back blank (permission not yet granted).
    navigator.mediaDevices.enumerateDevices()
      .then((all) => {
        const audioInputs = all.filter((d) => d.kind === 'audioinput')
        const hasLabels = audioInputs.some((d) => d.label)
        if (hasLabels) {
          setDevices(audioInputs.map((d) => ({ deviceId: d.deviceId, label: d.label || `Mic ${d.deviceId.slice(0, 8)}` })))
          return
        }
        // No labels — need a brief getUserMedia to unlock device labels
        return navigator.mediaDevices.getUserMedia({ audio: true })
          .then((stream) => {
            stream.getTracks().forEach((t) => t.stop())
            return navigator.mediaDevices.enumerateDevices()
          })
          .then((all2) => {
            const inputs = (all2 ?? all)
              .filter((d) => d.kind === 'audioinput')
              .map((d) => ({ deviceId: d.deviceId, label: d.label || `Mic ${d.deviceId.slice(0, 8)}` }))
            setDevices(inputs)
          })
      })
      .catch(() => {})
  }, [])

  return (
    <div>
      <h2 className="mb-4 text-sm font-semibold text-zinc-200">Voice</h2>
      <div className="divide-y divide-zinc-800 rounded-lg border border-zinc-800 bg-zinc-900/50 px-4">
        <SettingRow label="Enable Voice" description="Enable voice commands via microphone">
          <Toggle value={v.enabled} onChange={(val) => update({ voice: { ...v, enabled: val } })} />
        </SettingRow>

        <SettingRow label="Input Device" description="Microphone to use for voice commands">
          <SelectInput
            value={v.inputDeviceId ?? ''}
            onChange={(val) => update({ voice: { ...v, inputDeviceId: val || null } })}
            options={[
              { value: '', label: 'System Default' },
              ...devices.map((d) => ({ value: d.deviceId, label: d.label }))
            ]}
          />
        </SettingRow>

        <SettingRow label="Activation Mode" description="How voice listening is triggered">
          <SelectInput
            value={v.activationMode}
            onChange={(val) => update({ voice: { ...v, activationMode: val as 'push-to-talk' | 'wake-word' | 'always' } })}
            options={[
              { value: 'push-to-talk', label: 'Push to Talk' },
              { value: 'wake-word', label: 'Wake Word' },
              { value: 'always', label: 'Always On' }
            ]}
          />
        </SettingRow>

        {v.activationMode === 'wake-word' && (
          <SettingRow label="Wake Word" description="Say this to activate voice commands">
            <SelectInput
              value={v.wakeWord}
              onChange={(val) => update({ voice: { ...v, wakeWord: val } })}
              options={[
                { value: 'hey_jarvis', label: 'Hey Jarvis' },
                { value: 'alexa', label: 'Alexa' },
                { value: 'hey_mycroft', label: 'Hey Mycroft' },
                { value: 'hey_rhasspy', label: 'Hey Rhasspy' }
              ]}
            />
          </SettingRow>
        )}

        <SettingRow label="STT Provider" description={
          v.sttProvider === 'vosk'
            ? 'Vosk recognizes known commands instantly (~200ms), falls back to Whisper for everything else'
            : 'Speech-to-text engine for transcription'
        }>
          <SelectInput
            value={v.sttProvider}
            onChange={(val) => update({ voice: { ...v, sttProvider: val as 'whisper' | 'vosk' | 'web-speech' } })}
            options={[
              { value: 'whisper', label: 'Whisper (local)' },
              { value: 'vosk', label: 'Vosk + Whisper (fast path)' },
              { value: 'web-speech', label: 'Web Speech API' }
            ]}
          />
        </SettingRow>

        {v.sttProvider === 'whisper' && (
          <SettingRow label="Whisper Model" description="Larger models are more accurate but slower">
            <SelectInput
              value={v.whisperModel}
              onChange={(val) => update({ voice: { ...v, whisperModel: val as 'tiny' | 'base' | 'small' } })}
              options={[
                { value: 'tiny', label: 'Tiny (75 MB, fastest)' },
                { value: 'base', label: 'Base (142 MB)' },
                { value: 'small', label: 'Small (466 MB, most accurate)' }
              ]}
            />
          </SettingRow>
        )}

        <SettingRow label="Push-to-Talk Hotkey" description="Keyboard shortcut to activate voice">
          <span className="rounded border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-xs text-zinc-300">
            {v.pushToTalkHotkey}
          </span>
        </SettingRow>
      </div>

      <h3 className="mb-3 mt-6 text-xs font-semibold uppercase tracking-wider text-zinc-500">Ambient Monitoring</h3>
      <div className="divide-y divide-zinc-800 rounded-lg border border-zinc-800 bg-zinc-900/50 px-4">
        <SettingRow label="Waiting Alerts" description="Flash when a terminal enters waiting state (e.g. Claude asking for approval)">
          <Toggle
            value={v.ambientMonitoring?.onWaiting ?? true}
            onChange={(val) => update({ voice: { ...v, ambientMonitoring: { ...v.ambientMonitoring, onWaiting: val } } })}
          />
        </SettingRow>
        <SettingRow label="Error Alerts" description="Flash when an error notification arrives">
          <Toggle
            value={v.ambientMonitoring?.onError ?? true}
            onChange={(val) => update({ voice: { ...v, ambientMonitoring: { ...v.ambientMonitoring, onError: val } } })}
          />
        </SettingRow>
        <SettingRow label="Exit Alerts" description="Flash when a terminal process exits">
          <Toggle
            value={v.ambientMonitoring?.onExit ?? false}
            onChange={(val) => update({ voice: { ...v, ambientMonitoring: { ...v.ambientMonitoring, onExit: val } } })}
          />
        </SettingRow>
        <SettingRow label="All Notifications" description="Flash for every notification, not just errors">
          <Toggle
            value={v.ambientMonitoring?.onNotification ?? false}
            onChange={(val) => update({ voice: { ...v, ambientMonitoring: { ...v.ambientMonitoring, onNotification: val } } })}
          />
        </SettingRow>
      </div>

      <h3 className="mb-3 mt-6 text-xs font-semibold uppercase tracking-wider text-zinc-500">Local LLM (Tier 3)</h3>
      <div className="divide-y divide-zinc-800 rounded-lg border border-zinc-800 bg-zinc-900/50 px-4">
        <SettingRow label="LLM Endpoint" description="Override auto-discovery (leave empty to auto-detect Ollama/LM Studio)">
          <TextInput
            value={v.llmEndpoint ?? ''}
            onChange={(val) => update({ voice: { ...v, llmEndpoint: val || null } })}
            placeholder="http://localhost:11434"
          />
        </SettingRow>

        <SettingRow label="LLM Model" description="Model name (auto-detected if endpoint is set)">
          <TextInput
            value={v.llmModel ?? ''}
            onChange={(val) => update({ voice: { ...v, llmModel: val || null } })}
            placeholder="Auto-detect"
          />
        </SettingRow>

        <SettingRow label="Discover LLM" description="Probe localhost for Ollama and LM Studio">
          <LLMDiscoverButton endpoint={v.llmEndpoint} model={v.llmModel} />
        </SettingRow>
      </div>

      <RecommendedModels />
      <VoiceCommandReference />
    </div>
  )
}

function RecommendedModels() {
  const [expanded, setExpanded] = useState(false)

  const models: Array<{ name: string; params: string; provider: string; note: string; best?: boolean }> = [
    { name: 'qwen2.5:3b', params: '3B', provider: 'Ollama', note: 'Fast, good for quick commands. Low resource usage.', best: true },
    { name: 'qwen2.5:7b', params: '7B', provider: 'Ollama', note: 'Better comprehension for compound commands. Recommended sweet spot.' },
    { name: 'llama3.2:3b', params: '3B', provider: 'Ollama', note: 'Solid alternative to Qwen. Good instruction following.' },
    { name: 'mistral:7b', params: '7B', provider: 'Ollama', note: 'Strong reasoning. Slightly slower than Qwen 7B.' },
    { name: 'phi-4-mini', params: '3.8B', provider: 'Ollama / LM Studio', note: 'Compact, fast JSON output. Good for structured action plans.' },
    { name: 'gemma-3:4b', params: '4B', provider: 'Ollama', note: 'Google model, strong at short structured tasks.' },
    { name: 'deepseek-r1:7b', params: '7B', provider: 'Ollama', note: 'Reasoning-focused. Best for complex multi-step plans, slower.' },
  ]

  return (
    <div className="mt-6">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-2.5 text-left text-xs font-medium text-zinc-300 hover:bg-zinc-800/50"
      >
        <span>Recommended Models</span>
        <span className="text-zinc-600">{expanded ? '−' : '+'}</span>
      </button>
      {expanded && (
        <div className="rounded-b-lg border-x border-b border-zinc-800 bg-zinc-950/50 px-4 py-3">
          <p className="mb-3 text-[10px] text-zinc-500">
            These models work well with the Tier 3 LLM voice router. Install via <code className="rounded bg-zinc-800 px-1 text-zinc-400">ollama pull model_name</code> or load in LM Studio.
            Smaller models (3–4B) are faster; larger models (7B+) understand compound commands better.
          </p>
          <div className="space-y-1.5">
            {models.map((m) => (
              <div key={m.name} className="flex items-start gap-3 rounded px-2 py-1.5 hover:bg-zinc-800/30">
                <div className="flex min-w-0 flex-1 items-baseline gap-2">
                  <code className="shrink-0 rounded bg-zinc-800 px-1.5 py-0.5 text-[11px] text-blue-400">
                    {m.name}
                  </code>
                  {m.best && (
                    <span className="shrink-0 rounded bg-emerald-900/40 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-emerald-400">
                      quick start
                    </span>
                  )}
                  <span className="text-[10px] text-zinc-600">{m.note}</span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="rounded bg-zinc-800/80 px-1.5 py-0.5 text-[10px] text-zinc-500">{m.params}</span>
                  <span className="text-[10px] text-zinc-600">{m.provider}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function VoiceCommandReference() {
  const [expanded, setExpanded] = useState<'builtin' | 'llm' | null>(null)

  return (
    <div className="mt-6">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">Command Reference</h3>

      {/* Built-in commands */}
      <button
        onClick={() => setExpanded(expanded === 'builtin' ? null : 'builtin')}
        className="flex w-full items-center justify-between rounded-t-lg border border-zinc-800 bg-zinc-900/50 px-4 py-2.5 text-left text-xs font-medium text-zinc-300 hover:bg-zinc-800/50"
      >
        <span>Built-in Commands (no LLM required)</span>
        <span className="text-zinc-600">{expanded === 'builtin' ? '−' : '+'}</span>
      </button>
      {expanded === 'builtin' && (
        <div className="border-x border-b border-zinc-800 bg-zinc-950/50 px-4 py-3">
          <CommandGroup title="Tiles">
            <Cmd phrase="open terminal" note="Also: spawn/new terminal" />
            <Cmd phrase="open browser" note="Also: open browser to [url]" />
            <Cmd phrase="create note" note="Also: new/open note" />
            <Cmd phrase="create draw" note="Also: new/open draw" />
            <Cmd phrase="close this" note="Closes focused tile (confirms)" />
            <Cmd phrase="close [name]" note="Close tile by label (confirms)" />
            <Cmd phrase="rename to [name]" note="Renames focused tile" />
          </CommandGroup>
          <CommandGroup title="Navigation">
            <Cmd phrase="go to [tile name]" note="Focus a tile by label" />
            <Cmd phrase="go to workspace [name]" note="Switch workspace" />
            <Cmd phrase="zoom in / zoom out" />
            <Cmd phrase="zoom to fit" note="Also: fit view, show everything" />
            <Cmd phrase="show numbers" note="Number overlay for tile selection" />
            <Cmd phrase="show grid" note="3x3 grid for viewport navigation" />
            <Cmd phrase="focus [1-9]" note="Select numbered tile/grid region" />
          </CommandGroup>
          <CommandGroup title="Agent Control">
            <Cmd phrase="approve / yes / accept" note="Send approval to focused terminal" />
            <Cmd phrase="reject / no / deny" note="Send rejection" />
            <Cmd phrase="stop / interrupt" note="Send Ctrl+C (confirms)" />
            <Cmd phrase="send [text]" note="Send text to focused terminal" />
            <Cmd phrase="send [text] to [target]" note="Send to specific tile (confirms)" />
            <Cmd phrase="tell [agent] to [message]" note="Direct an agent (confirms)" />
            <Cmd phrase="tell all [group] to [message]" note="Broadcast to group (confirms)" />
          </CommandGroup>
          <CommandGroup title="Dictation Stream">
            <Cmd phrase="start dictation" note="Opens streaming panel — words appear as you speak" />
            <Cmd phrase="" note="Edit the transcript, then Send to route through the LLM" />
            <Cmd phrase="" note="Confirm/reject the action plan before it executes" />
            <Cmd phrase="" note="Uses Whisper base model for higher accuracy" />
          </CommandGroup>
          <CommandGroup title="Standup / Note Dictation">
            <Cmd phrase="start standup" note="Dated standup note — speech appended continuously" />
            <Cmd phrase="end standup" />
          </CommandGroup>
          <CommandGroup title="Workflows">
            <Cmd phrase="start [template name]" note="Spawn a workspace template" />
            <Cmd phrase="set up [template name]" note="Also: launch [name]" />
          </CommandGroup>
          <CommandGroup title="Queries">
            <Cmd phrase="status" note="Tile count summary" />
            <Cmd phrase="whats [name] doing" note="Query tile status" />
            <Cmd phrase="any errors" />
            <Cmd phrase="unread" note="Jump to last unread notification" />
            <Cmd phrase="mark all read" />
          </CommandGroup>
          <CommandGroup title="Other">
            <Cmd phrase="undo" note="Undo last reversible action" />
          </CommandGroup>
        </div>
      )}

      {/* LLM commands */}
      <button
        onClick={() => setExpanded(expanded === 'llm' ? null : 'llm')}
        className={`flex w-full items-center justify-between border border-zinc-800 bg-zinc-900/50 px-4 py-2.5 text-left text-xs font-medium text-zinc-300 hover:bg-zinc-800/50 ${expanded === 'builtin' ? '' : 'rounded-t-lg'} ${expanded === 'llm' ? '' : 'rounded-b-lg'}`}
      >
        <span>Natural Language (requires local LLM)</span>
        <span className="text-zinc-600">{expanded === 'llm' ? '−' : '+'}</span>
      </button>
      {expanded === 'llm' && (
        <div className="rounded-b-lg border-x border-b border-zinc-800 bg-zinc-950/50 px-4 py-3">
          <p className="mb-3 text-[10px] text-zinc-500">
            With a local LLM (Ollama or LM Studio), you can speak natural compound commands.
            These are interpreted by the LLM and presented for confirmation before executing.
          </p>
          <CommandGroup title="Quick Commands">
            <Cmd phrase="Set up a code review with three agents for auth" note="Spawns 3 named terminals with prompts" />
            <Cmd phrase="Open a browser to GitHub and a terminal side by side" note="Multi-tile spawn" />
            <Cmd phrase="Rename this to API Server and zoom to fit" note="Multi-step action" />
            <Cmd phrase="Tell all review agents to wrap up and summarize" note="Broadcast with natural language" />
            <Cmd phrase="Close all the note tiles" note="Batch operation" />
            <Cmd phrase="Start a debugging session with devtools" note="Context-aware workspace setup" />
          </CommandGroup>
          <CommandGroup title="Dictation Stream + LLM">
            <Cmd phrase="start dictation → speak at length → edit → send" note="Full workflow for complex multi-step plans" />
            <Cmd phrase="" note="Say &quot;start dictation&quot;, describe what you want in detail, review the transcript, fix any words the voice recognition got wrong, hit Send" />
            <Cmd phrase="" note="The LLM parses your corrected text into an action plan — you see what it heard and what it plans to do, then confirm or reject" />
          </CommandGroup>
        </div>
      )}
    </div>
  )
}

function CommandGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-3 last:mb-0">
      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{title}</div>
      <div className="space-y-1">{children}</div>
    </div>
  )
}

function Cmd({ phrase, note }: { phrase: string; note?: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <code className="shrink-0 rounded bg-zinc-800 px-1.5 py-0.5 text-[11px] text-blue-400">{phrase}</code>
      {note && <span className="text-[10px] text-zinc-600">{note}</span>}
    </div>
  )
}

function LLMDiscoverButton({ endpoint, model }: { endpoint: string | null; model: string | null }) {
  const [status, setStatus] = useState<string>('Not checked')
  const [checking, setChecking] = useState(false)

  const discover = async () => {
    setChecking(true)
    setStatus('Scanning...')
    try {
      const result = await window.voice.discoverLLM(endpoint ?? undefined, model ?? undefined)
      if (result.endpoints.length === 0) {
        setStatus('No LLM found')
      } else {
        const ep = result.endpoints[0]
        setStatus(`${ep.provider}: ${ep.models[0] ?? 'no models'}`)
      }
    } catch {
      setStatus('Error')
    }
    setChecking(false)
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={discover}
        disabled={checking}
        className="rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 disabled:opacity-50"
      >
        {checking ? 'Scanning...' : 'Scan'}
      </button>
      <span className="text-[10px] text-zinc-500">{status}</span>
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

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

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
          {activeCategory === 'hotkeys' && <HotkeysSection settings={settings} update={update} />}
          {activeCategory === 'templates' && <TemplatesSection settings={settings} update={update} />}
          {activeCategory === 'notifications' && <NotificationsSection settings={settings} update={update} />}
          {activeCategory === 'voice' && <VoiceSection settings={settings} update={update} />}
        </div>
      </div>
    </div>
  )
}

export const SettingsPage = memo(SettingsPageComponent)

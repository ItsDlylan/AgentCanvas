/**
 * Lightweight structural validator for TipTap doc JSON coming from the local HTTP API.
 * Blocks malformed payloads before they reach editor.commands.setContent() in the renderer.
 */

const ALLOWED_TYPES = new Set([
  'doc',
  'paragraph',
  'heading',
  'codeBlock',
  'blockquote',
  'bulletList',
  'orderedList',
  'listItem',
  'taskList',
  'taskItem',
  'text',
  'image',
  'video',
  'horizontalRule',
  'hardBreak',
  'table',
  'tableRow',
  'tableCell',
  'tableHeader'
])

const MAX_DEPTH = 12

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function walk(node: unknown, depth: number): boolean {
  if (depth > MAX_DEPTH) return false
  if (!isObject(node)) return false
  if (typeof node.type !== 'string' || !ALLOWED_TYPES.has(node.type)) return false

  if (node.content !== undefined) {
    if (!Array.isArray(node.content)) return false
    for (const child of node.content) {
      if (!walk(child, depth + 1)) return false
    }
  }
  return true
}

export function isValidTiptapDoc(
  content: unknown
): content is { type: 'doc'; content: unknown[] } {
  if (!isObject(content)) return false
  if (content.type !== 'doc') return false
  if (!Array.isArray(content.content)) return false
  for (const child of content.content) {
    if (!walk(child, 1)) return false
  }
  return true
}

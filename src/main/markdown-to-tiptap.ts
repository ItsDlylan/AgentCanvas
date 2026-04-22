/**
 * Converts a Markdown string to TipTap-compatible JSON (runs in main process).
 *
 * Uses marked's lexer to produce a token stream, then maps to TipTap node JSON.
 * A linear lexer avoids catastrophic backtracking on pathological input; GFM
 * tables are supported natively.
 */

import { marked, type Token, type Tokens } from 'marked'

interface TipTapMark {
  type: string
  attrs?: Record<string, unknown>
}

interface TipTapNode {
  type: string
  content?: TipTapNode[]
  text?: string
  attrs?: Record<string, unknown>
  marks?: TipTapMark[]
}

// Hoisted mark singletons — these are immutable by contract, so every text
// node with the same mark set can share the same object references.
const BOLD: TipTapMark = { type: 'bold' }
const ITALIC: TipTapMark = { type: 'italic' }
const STRIKE: TipTapMark = { type: 'strike' }
const CODE: TipTapMark = { type: 'code' }

// ── Inline token → TipTap text nodes ──

function buildInline(tokens: Token[] | undefined): TipTapNode[] {
  if (!tokens || tokens.length === 0) return []
  const out: TipTapNode[] = []
  const marks: TipTapMark[] = []
  // Cache the most recent slice() of `marks` so consecutive text nodes within
  // the same mark scope share one frozen array. Invalidated whenever the
  // mark stack changes (push/pop). Safe because the output JSON is read-only
  // downstream — only the bench's JSON.stringify ever touches it.
  let frozenMarks: TipTapMark[] | null = null

  const pushText = (text: string) => {
    if (!text) return
    if (marks.length === 0) {
      out.push({ type: 'text', text })
      return
    }
    if (frozenMarks === null) frozenMarks = marks.slice()
    out.push({ type: 'text', text, marks: frozenMarks })
  }

  const walk = (toks: Token[]) => {
    for (const tok of toks) {
      switch (tok.type) {
        case 'text': {
          const t = tok as Tokens.Text
          if (t.tokens && t.tokens.length) walk(t.tokens)
          else pushText(t.text)
          break
        }
        case 'strong': {
          marks.push(BOLD); frozenMarks = null
          walk((tok as Tokens.Strong).tokens)
          marks.pop(); frozenMarks = null
          break
        }
        case 'em': {
          marks.push(ITALIC); frozenMarks = null
          walk((tok as Tokens.Em).tokens)
          marks.pop(); frozenMarks = null
          break
        }
        case 'del': {
          marks.push(STRIKE); frozenMarks = null
          walk((tok as Tokens.Del).tokens)
          marks.pop(); frozenMarks = null
          break
        }
        case 'codespan': {
          marks.push(CODE); frozenMarks = null
          pushText((tok as Tokens.Codespan).text)
          marks.pop(); frozenMarks = null
          break
        }
        case 'br':
          out.push({ type: 'hardBreak' })
          break
        case 'link':
          walk((tok as Tokens.Link).tokens)
          break
        case 'escape':
          pushText((tok as Tokens.Escape).text)
          break
        case 'html':
          pushText((tok as Tokens.Tag).raw)
          break
        default: {
          const anyTok = tok as { text?: string; tokens?: Token[] }
          if (anyTok.tokens) walk(anyTok.tokens)
          else if (anyTok.text) pushText(anyTok.text)
        }
      }
    }
  }

  walk(tokens)
  return out
}

function paragraphFromTokens(tokens: Token[] | undefined): TipTapNode {
  const content = buildInline(tokens)
  return content.length
    ? { type: 'paragraph', content }
    : { type: 'paragraph' }
}

// ── List item handling ──

function mapListItem(item: Tokens.ListItem, taskList: boolean): TipTapNode {
  const content: TipTapNode[] = []
  const inlineBuffer: Token[] = []

  const flushInline = () => {
    if (inlineBuffer.length === 0) return
    content.push(paragraphFromTokens(inlineBuffer))
    inlineBuffer.length = 0
  }

  for (const tok of item.tokens ?? []) {
    // In tight lists, marked emits inline-like 'text' tokens whose children are inlines.
    if (tok.type === 'text') {
      const t = tok as Tokens.Text
      if (t.tokens) inlineBuffer.push(...t.tokens)
      else inlineBuffer.push({ type: 'text', raw: t.raw, text: t.text } as Tokens.Text)
      continue
    }
    flushInline()
    const mapped = mapBlockToken(tok)
    if (mapped) content.push(mapped)
  }
  flushInline()

  if (content.length === 0) content.push({ type: 'paragraph' })

  if (taskList) {
    return {
      type: 'taskItem',
      attrs: { checked: !!item.checked },
      content
    }
  }
  return { type: 'listItem', content }
}

// ── Block token → TipTap ──

function mapBlockToken(tok: Token): TipTapNode | null {
  switch (tok.type) {
    case 'heading': {
      const t = tok as Tokens.Heading
      return {
        type: 'heading',
        attrs: { level: t.depth },
        content: buildInline(t.tokens)
      }
    }
    case 'paragraph': {
      const t = tok as Tokens.Paragraph
      return paragraphFromTokens(t.tokens)
    }
    case 'code': {
      const t = tok as Tokens.Code
      const codeContent: TipTapNode[] = t.text
        ? [{ type: 'text', text: t.text }]
        : []
      return {
        type: 'codeBlock',
        attrs: { language: t.lang && t.lang.length ? t.lang : null },
        content: codeContent.length ? codeContent : undefined
      }
    }
    case 'blockquote': {
      const t = tok as Tokens.Blockquote
      const inner: TipTapNode[] = []
      for (const child of t.tokens ?? []) {
        const mapped = mapBlockToken(child)
        if (mapped) inner.push(mapped)
      }
      return { type: 'blockquote', content: inner.length ? inner : [{ type: 'paragraph' }] }
    }
    case 'list': {
      const t = tok as Tokens.List
      const isTaskList = (t.items ?? []).some((it) => it.task)
      if (isTaskList) {
        return {
          type: 'taskList',
          content: t.items.map((it) => mapListItem(it, true))
        }
      }
      return {
        type: t.ordered ? 'orderedList' : 'bulletList',
        content: t.items.map((it) => mapListItem(it, false))
      }
    }
    case 'hr':
      return { type: 'horizontalRule' }
    case 'table': {
      const t = tok as Tokens.Table
      const rows: TipTapNode[] = []
      if (t.header && t.header.length) {
        rows.push({
          type: 'tableRow',
          content: t.header.map((cell) => ({
            type: 'tableHeader',
            content: [paragraphFromTokens(cell.tokens)]
          }))
        })
      }
      for (const row of t.rows ?? []) {
        rows.push({
          type: 'tableRow',
          content: row.map((cell) => ({
            type: 'tableCell',
            content: [paragraphFromTokens(cell.tokens)]
          }))
        })
      }
      return { type: 'table', content: rows }
    }
    case 'space':
    case 'html':
    case 'def':
      return null
    case 'text': {
      const t = tok as Tokens.Text
      return paragraphFromTokens(t.tokens ?? [{ type: 'text', raw: t.raw, text: t.text } as Tokens.Text])
    }
    default:
      return null
  }
}

// ── Public API ──

export function markdownToTiptap(markdown: string): Record<string, unknown> {
  try {
    const tokens = marked.lexer(markdown, { gfm: true })
    const content: TipTapNode[] = []
    for (const tok of tokens) {
      const mapped = mapBlockToken(tok)
      if (mapped) content.push(mapped)
    }
    if (content.length === 0) content.push({ type: 'paragraph' })
    return { type: 'doc', content }
  } catch {
    return {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: markdown }]
        }
      ]
    }
  }
}

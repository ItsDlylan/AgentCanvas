/**
 * Converts a Markdown string to TipTap-compatible JSON (runs in main process).
 *
 * Uses marked's lexer to produce a token stream, then maps to TipTap node JSON.
 * A linear lexer avoids catastrophic backtracking on pathological input; GFM
 * tables are supported natively.
 */

import { marked, type Token, type Tokens } from 'marked'

interface TipTapNode {
  type: string
  content?: TipTapNode[]
  text?: string
  attrs?: Record<string, unknown>
  marks?: { type: string; attrs?: Record<string, unknown> }[]
}

// ── Inline token → TipTap text nodes ──

function buildInline(tokens: Token[] | undefined): TipTapNode[] {
  if (!tokens || tokens.length === 0) return []
  const out: TipTapNode[] = []

  const pushText = (text: string, marks?: TipTapNode['marks']) => {
    if (!text) return
    out.push(marks && marks.length ? { type: 'text', text, marks } : { type: 'text', text })
  }

  const walk = (toks: Token[], marks: NonNullable<TipTapNode['marks']>) => {
    for (const tok of toks) {
      switch (tok.type) {
        case 'text': {
          const t = tok as Tokens.Text
          if (t.tokens && t.tokens.length) walk(t.tokens, marks)
          else pushText(t.text, marks)
          break
        }
        case 'strong': {
          const t = tok as Tokens.Strong
          walk(t.tokens, [...marks, { type: 'bold' }])
          break
        }
        case 'em': {
          const t = tok as Tokens.Em
          walk(t.tokens, [...marks, { type: 'italic' }])
          break
        }
        case 'del': {
          const t = tok as Tokens.Del
          walk(t.tokens, [...marks, { type: 'strike' }])
          break
        }
        case 'codespan': {
          const t = tok as Tokens.Codespan
          pushText(t.text, [...marks, { type: 'code' }])
          break
        }
        case 'br':
          out.push({ type: 'hardBreak' })
          break
        case 'link': {
          const t = tok as Tokens.Link
          walk(t.tokens, marks)
          break
        }
        case 'escape': {
          const t = tok as Tokens.Escape
          pushText(t.text, marks)
          break
        }
        case 'html': {
          const t = tok as Tokens.Tag
          pushText(t.raw, marks)
          break
        }
        default: {
          const anyTok = tok as { text?: string; tokens?: Token[] }
          if (anyTok.tokens) walk(anyTok.tokens, marks)
          else if (anyTok.text) pushText(anyTok.text, marks)
        }
      }
    }
  }

  walk(tokens, [])
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
    if (mapped) content.push(...(Array.isArray(mapped) ? mapped : [mapped]))
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

function mapBlockToken(tok: Token): TipTapNode | TipTapNode[] | null {
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
        if (mapped) inner.push(...(Array.isArray(mapped) ? mapped : [mapped]))
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
      if (mapped) content.push(...(Array.isArray(mapped) ? mapped : [mapped]))
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

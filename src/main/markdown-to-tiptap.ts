/**
 * Converts a Markdown string to TipTap-compatible JSON (runs in main process).
 */

interface TipTapNode {
  type: string
  content?: TipTapNode[]
  text?: string
  attrs?: Record<string, unknown>
  marks?: { type: string }[]
}

// ── Inline mark parsing ──

function parseInline(text: string): TipTapNode[] {
  const nodes: TipTapNode[] = []
  // Regex matches: code, bold, italic, strikethrough, plain text
  const regex = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(\~\~[^~]+\~\~)|([^`*~]+)/g
  let match: RegExpExecArray | null

  while ((match = regex.exec(text)) !== null) {
    const [full] = match
    if (!full) continue

    if (full.startsWith('`') && full.endsWith('`') && full.length > 1) {
      nodes.push({ type: 'text', text: full.slice(1, -1), marks: [{ type: 'code' }] })
    } else if (full.startsWith('**') && full.endsWith('**') && full.length > 3) {
      nodes.push({ type: 'text', text: full.slice(2, -2), marks: [{ type: 'bold' }] })
    } else if (full.startsWith('*') && full.endsWith('*') && full.length > 1) {
      nodes.push({ type: 'text', text: full.slice(1, -1), marks: [{ type: 'italic' }] })
    } else if (full.startsWith('~~') && full.endsWith('~~') && full.length > 3) {
      nodes.push({ type: 'text', text: full.slice(2, -2), marks: [{ type: 'strike' }] })
    } else {
      nodes.push({ type: 'text', text: full })
    }
  }

  return nodes.length > 0 ? nodes : [{ type: 'text', text }]
}

function paragraph(text: string): TipTapNode {
  return { type: 'paragraph', content: parseInline(text) }
}

// ── Block-level parsing ──

export function markdownToTiptap(markdown: string): Record<string, unknown> {
  const lines = markdown.split('\n')
  const content: TipTapNode[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // Code block
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim()
      const codeLines: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i])
        i++
      }
      i++ // skip closing ```
      content.push({
        type: 'codeBlock',
        attrs: { language: lang || null },
        content: codeLines.length ? [{ type: 'text', text: codeLines.join('\n') }] : undefined
      })
      continue
    }

    // Blank line — skip
    if (line.trim() === '') {
      i++
      continue
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      content.push({ type: 'horizontalRule' })
      i++
      continue
    }

    // Heading
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/)
    if (headingMatch) {
      content.push({
        type: 'heading',
        attrs: { level: headingMatch[1].length },
        content: parseInline(headingMatch[2])
      })
      i++
      continue
    }

    // Blockquote (collect consecutive > lines)
    if (line.startsWith('> ') || line === '>') {
      const quoteLines: string[] = []
      while (i < lines.length && (lines[i].startsWith('> ') || lines[i] === '>')) {
        quoteLines.push(lines[i].replace(/^>\s?/, ''))
        i++
      }
      content.push({
        type: 'blockquote',
        content: [paragraph(quoteLines.join('\n'))]
      })
      continue
    }

    // Task list
    const taskMatch = line.match(/^(\s*)- \[([ xX])\]\s+(.*)$/)
    if (taskMatch) {
      const items: TipTapNode[] = []
      while (i < lines.length) {
        const tm = lines[i].match(/^(\s*)- \[([ xX])\]\s+(.*)$/)
        if (!tm) break
        items.push({
          type: 'taskItem',
          attrs: { checked: tm[2] !== ' ' },
          content: [paragraph(tm[3])]
        })
        i++
      }
      content.push({ type: 'taskList', content: items })
      continue
    }

    // Unordered list
    const bulletMatch = line.match(/^(\s*)[-*+]\s+(.*)$/)
    if (bulletMatch && !line.match(/^(\s*)- \[/)) {
      const items: TipTapNode[] = []
      while (i < lines.length) {
        const bm = lines[i].match(/^(\s*)[-*+]\s+(.*)$/)
        if (!bm || lines[i].match(/^(\s*)- \[/)) break
        items.push({ type: 'listItem', content: [paragraph(bm[2])] })
        i++
      }
      content.push({ type: 'bulletList', content: items })
      continue
    }

    // Ordered list
    const orderedMatch = line.match(/^(\s*)\d+\.\s+(.*)$/)
    if (orderedMatch) {
      const items: TipTapNode[] = []
      while (i < lines.length) {
        const om = lines[i].match(/^(\s*)\d+\.\s+(.*)$/)
        if (!om) break
        items.push({ type: 'listItem', content: [paragraph(om[2])] })
        i++
      }
      content.push({ type: 'orderedList', content: items })
      continue
    }

    // Plain paragraph (collect consecutive non-blank non-special lines)
    const paraLines: string[] = []
    while (i < lines.length && lines[i].trim() !== '' && !lines[i].startsWith('#') && !lines[i].startsWith('```') && !lines[i].startsWith('> ') && !lines[i].match(/^(\s*)[-*+]\s+/) && !lines[i].match(/^(\s*)\d+\.\s+/) && !lines[i].match(/^(-{3,}|\*{3,}|_{3,})$/)) {
      paraLines.push(lines[i])
      i++
    }
    if (paraLines.length) {
      content.push(paragraph(paraLines.join('\n')))
    }
  }

  return { type: 'doc', content }
}

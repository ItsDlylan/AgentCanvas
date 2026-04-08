/**
 * Converts TipTap JSONContent to Markdown.
 */

interface TipTapNode {
  type: string
  content?: TipTapNode[]
  text?: string
  attrs?: Record<string, unknown>
  marks?: { type: string; attrs?: Record<string, unknown> }[]
}

function renderMarks(text: string, marks?: TipTapNode['marks']): string {
  if (!marks || marks.length === 0) return text
  let result = text
  for (const mark of marks) {
    switch (mark.type) {
      case 'bold':
      case 'strong':
        result = `**${result}**`
        break
      case 'italic':
      case 'em':
        result = `*${result}*`
        break
      case 'strike':
        result = `~~${result}~~`
        break
      case 'code':
        result = `\`${result}\``
        break
    }
  }
  return result
}

function renderInline(nodes?: TipTapNode[]): string {
  if (!nodes) return ''
  return nodes
    .map((node) => {
      if (node.type === 'text') {
        return renderMarks(node.text ?? '', node.marks)
      }
      if (node.type === 'hardBreak') return '\n'
      return ''
    })
    .join('')
}

function renderNode(node: TipTapNode, indent = ''): string {
  switch (node.type) {
    case 'doc':
      return (node.content ?? []).map((n) => renderNode(n, indent)).join('\n\n')

    case 'paragraph':
      return indent + renderInline(node.content)

    case 'heading': {
      const level = (node.attrs?.level as number) ?? 1
      const prefix = '#'.repeat(level)
      return `${prefix} ${renderInline(node.content)}`
    }

    case 'codeBlock': {
      const lang = (node.attrs?.language as string) ?? ''
      const code = renderInline(node.content)
      return `\`\`\`${lang}\n${code}\n\`\`\``
    }

    case 'blockquote':
      return (node.content ?? [])
        .map((n) => renderNode(n, '> '))
        .join('\n')

    case 'bulletList':
      return (node.content ?? [])
        .map((item) => {
          const lines = renderNode(item, indent)
          return `${indent}- ${lines}`
        })
        .join('\n')

    case 'orderedList':
      return (node.content ?? [])
        .map((item, i) => {
          const lines = renderNode(item, indent)
          return `${indent}${i + 1}. ${lines}`
        })
        .join('\n')

    case 'taskList':
      return (node.content ?? [])
        .map((item) => {
          const checked = item.attrs?.checked ? 'x' : ' '
          const text = renderNode(item, indent)
          return `${indent}- [${checked}] ${text}`
        })
        .join('\n')

    case 'listItem':
    case 'taskItem':
      return (node.content ?? []).map((n) => renderInline(n.content)).join('\n')

    case 'horizontalRule':
      return '---'

    default:
      return renderInline(node.content)
  }
}

export function jsonToMarkdown(content: Record<string, unknown>): string {
  return renderNode(content as unknown as TipTapNode)
}

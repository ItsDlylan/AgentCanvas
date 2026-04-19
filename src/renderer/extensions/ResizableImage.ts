import Image from '@tiptap/extension-image'

type Align = 'left' | 'center' | 'full'

const SIZE_PRESETS: Record<string, string | null> = {
  small: '180px',
  medium: '360px',
  original: null
}

const ICONS = {
  alignLeft:
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="17" y1="10" x2="3" y2="10"/><line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="14" x2="3" y2="14"/><line x1="17" y1="18" x2="3" y2="18"/></svg>',
  alignCenter:
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="10" x2="6" y2="10"/><line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="14" x2="3" y2="14"/><line x1="18" y1="18" x2="6" y2="18"/></svg>',
  alignFull:
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="10" x2="3" y2="10"/><line x1="21" y1="14" x2="3" y2="14"/><line x1="21" y1="18" x2="3" y2="18"/></svg>',
  reveal:
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  copy:
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  trash:
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>'
}

function makeButton(title: string, innerHTML: string): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.title = title
  btn.className = 'image-toolbar-btn'
  btn.contentEditable = 'false'
  btn.innerHTML = innerHTML
  btn.addEventListener('mousedown', (e) => e.preventDefault())
  return btn
}

function makeTextButton(label: string, title: string): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.title = title
  btn.className = 'image-toolbar-btn image-toolbar-btn--text'
  btn.contentEditable = 'false'
  btn.textContent = label
  btn.addEventListener('mousedown', (e) => e.preventDefault())
  return btn
}

function makeDivider(): HTMLSpanElement {
  const d = document.createElement('span')
  d.className = 'image-toolbar-divider'
  d.contentEditable = 'false'
  return d
}

export const ResizableImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-width') || element.style.width || null,
        renderHTML: (attributes: Record<string, unknown>) => {
          if (!attributes.width) return {}
          return { 'data-width': attributes.width }
        }
      },
      align: {
        default: 'left' as Align,
        parseHTML: (element: HTMLElement) => (element.getAttribute('data-align') as Align) || 'left',
        renderHTML: (attributes: Record<string, unknown>) => {
          const align = (attributes.align as Align) || 'left'
          if (align === 'left') return {}
          return { 'data-align': align }
        }
      }
    }
  },

  addNodeView() {
    return ({ node, getPos, editor }) => {
      const container = document.createElement('div')
      container.className = 'resizable-image-wrapper'
      container.dataset.align = (node.attrs.align as Align) || 'left'

      const img = document.createElement('img')
      img.src = node.attrs.src
      if (node.attrs.alt) img.alt = node.attrs.alt
      if (node.attrs.title) img.title = node.attrs.title
      if (node.attrs.width) {
        img.style.width = typeof node.attrs.width === 'number' ? `${node.attrs.width}px` : node.attrs.width
      }

      // ── Resize handle ──
      const handle = document.createElement('div')
      handle.className = 'resize-handle'
      handle.contentEditable = 'false'

      let startX = 0
      let startWidth = 0

      const onMouseMove = (e: MouseEvent) => {
        const newWidth = Math.max(50, startWidth + (e.clientX - startX))
        img.style.width = `${newWidth}px`
      }

      const commitNodeUpdate = (attrs: Record<string, unknown>) => {
        if (typeof getPos !== 'function') return
        editor
          .chain()
          .focus(undefined, { scrollIntoView: false })
          .command(({ tr }) => {
            const position = getPos()
            if (typeof position !== 'number') return false
            tr.setNodeMarkup(position, undefined, { ...node.attrs, ...attrs })
            return true
          })
          .run()
      }

      const onMouseUp = (e: MouseEvent) => {
        document.removeEventListener('mousemove', onMouseMove)
        document.removeEventListener('mouseup', onMouseUp)
        document.body.style.cursor = ''
        const newWidth = Math.max(50, startWidth + (e.clientX - startX))
        commitNodeUpdate({ width: `${newWidth}px` })
      }

      handle.addEventListener('mousedown', (e) => {
        e.preventDefault()
        e.stopPropagation()
        startX = e.clientX
        startWidth = img.getBoundingClientRect().width
        document.body.style.cursor = 'ew-resize'
        document.addEventListener('mousemove', onMouseMove)
        document.addEventListener('mouseup', onMouseUp)
      })

      // ── Hover toolbar ──
      const toolbar = document.createElement('div')
      toolbar.className = 'image-toolbar'
      toolbar.contentEditable = 'false'

      const alignLeftBtn = makeButton('Align left', ICONS.alignLeft)
      const alignCenterBtn = makeButton('Align center', ICONS.alignCenter)
      const alignFullBtn = makeButton('Full width', ICONS.alignFull)

      const sizeSmallBtn = makeTextButton('S', 'Small (180px)')
      const sizeMediumBtn = makeTextButton('M', 'Medium (360px)')
      const sizeOriginalBtn = makeTextButton('Reset', 'Original size')

      const revealBtn = makeButton('Reveal in Finder', ICONS.reveal)
      const copyBtn = makeButton('Copy file path', ICONS.copy)
      const deleteBtn = makeButton('Delete image', ICONS.trash)
      deleteBtn.classList.add('image-toolbar-btn--danger')

      alignLeftBtn.addEventListener('click', (e) => {
        e.preventDefault()
        commitNodeUpdate({ align: 'left' })
      })
      alignCenterBtn.addEventListener('click', (e) => {
        e.preventDefault()
        commitNodeUpdate({ align: 'center' })
      })
      alignFullBtn.addEventListener('click', (e) => {
        e.preventDefault()
        commitNodeUpdate({ align: 'full', width: null })
      })

      sizeSmallBtn.addEventListener('click', (e) => {
        e.preventDefault()
        commitNodeUpdate({ width: SIZE_PRESETS.small })
      })
      sizeMediumBtn.addEventListener('click', (e) => {
        e.preventDefault()
        commitNodeUpdate({ width: SIZE_PRESETS.medium })
      })
      sizeOriginalBtn.addEventListener('click', (e) => {
        e.preventDefault()
        commitNodeUpdate({ width: SIZE_PRESETS.original })
      })

      revealBtn.addEventListener('click', (e) => {
        e.preventDefault()
        const src = node.attrs.src as string
        if (src) window.attachment.reveal(src)
      })

      copyBtn.addEventListener('click', async (e) => {
        e.preventDefault()
        const src = node.attrs.src as string
        if (!src) return
        const path = (await window.attachment.resolvePath(src)) ?? src
        try {
          await navigator.clipboard.writeText(path)
          copyBtn.classList.add('image-toolbar-btn--success')
          setTimeout(() => copyBtn.classList.remove('image-toolbar-btn--success'), 800)
        } catch {
          /* clipboard unavailable — silent */
        }
      })

      deleteBtn.addEventListener('click', async (e) => {
        e.preventDefault()
        if (typeof getPos !== 'function') return
        const pos = getPos()
        if (typeof pos !== 'number') return

        // Extract noteId from the attachment URL before we drop the node reference.
        const src = node.attrs.src as string | undefined
        const match = src?.match(/^agentcanvas:\/\/attachment\/([^/]+)\//)
        const noteId = match?.[1]

        editor.chain().focus().deleteRange({ from: pos, to: pos + node.nodeSize }).run()

        // Explicit delete → bypass the "safe undo" policy and GC immediately.
        // Save first so the sweep reads the post-delete doc from disk.
        if (noteId) {
          await window.note.save(noteId, {}, editor.getJSON())
          window.attachment.sweepNote(noteId)
        }
      })

      toolbar.append(
        alignLeftBtn, alignCenterBtn, alignFullBtn,
        makeDivider(),
        sizeSmallBtn, sizeMediumBtn, sizeOriginalBtn,
        makeDivider(),
        revealBtn, copyBtn,
        makeDivider(),
        deleteBtn
      )

      container.append(img, handle, toolbar)

      return {
        dom: container,
        update: (updatedNode) => {
          if (updatedNode.type.name !== 'image') return false
          img.src = updatedNode.attrs.src
          if (updatedNode.attrs.alt) img.alt = updatedNode.attrs.alt
          if (updatedNode.attrs.title) img.title = updatedNode.attrs.title
          img.style.width = updatedNode.attrs.width
            ? (typeof updatedNode.attrs.width === 'number' ? `${updatedNode.attrs.width}px` : updatedNode.attrs.width)
            : ''
          container.dataset.align = (updatedNode.attrs.align as Align) || 'left'
          node = updatedNode
          return true
        },
        destroy: () => {
          document.removeEventListener('mousemove', onMouseMove)
          document.removeEventListener('mouseup', onMouseUp)
        }
      }
    }
  }
})

import Image from '@tiptap/extension-image'

/**
 * Extends TipTap's Image extension with:
 * - A `width` attribute for persisting resize
 * - A vanilla DOM NodeView with a corner resize handle
 */
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
      }
    }
  },

  addNodeView() {
    return ({ node, getPos, editor }) => {
      const container = document.createElement('div')
      container.className = 'resizable-image-wrapper'

      const img = document.createElement('img')
      img.src = node.attrs.src
      if (node.attrs.alt) img.alt = node.attrs.alt
      if (node.attrs.title) img.title = node.attrs.title
      if (node.attrs.width) {
        img.style.width = typeof node.attrs.width === 'number' ? `${node.attrs.width}px` : node.attrs.width
      }

      const handle = document.createElement('div')
      handle.className = 'resize-handle'
      handle.contentEditable = 'false'

      let startX = 0
      let startWidth = 0

      const onMouseMove = (e: MouseEvent) => {
        const newWidth = Math.max(50, startWidth + (e.clientX - startX))
        img.style.width = `${newWidth}px`
      }

      const onMouseUp = (e: MouseEvent) => {
        document.removeEventListener('mousemove', onMouseMove)
        document.removeEventListener('mouseup', onMouseUp)
        document.body.style.cursor = ''
        const newWidth = Math.max(50, startWidth + (e.clientX - startX))
        if (typeof getPos === 'function') {
          editor
            .chain()
            .focus(undefined, { scrollIntoView: false })
            .command(({ tr }) => {
              const position = getPos()
              if (typeof position !== 'number') return false
              tr.setNodeMarkup(position, undefined, { ...node.attrs, width: `${newWidth}px` })
              return true
            })
            .run()
        }
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

      container.append(img, handle)

      return {
        dom: container,
        update: (updatedNode) => {
          if (updatedNode.type.name !== 'image') return false
          img.src = updatedNode.attrs.src
          if (updatedNode.attrs.alt) img.alt = updatedNode.attrs.alt
          if (updatedNode.attrs.title) img.title = updatedNode.attrs.title
          if (updatedNode.attrs.width) {
            img.style.width = typeof updatedNode.attrs.width === 'number'
              ? `${updatedNode.attrs.width}px`
              : updatedNode.attrs.width
          }
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

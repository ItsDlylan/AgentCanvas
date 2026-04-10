import { Node, mergeAttributes } from '@tiptap/core'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    video: {
      setVideo: (attrs: { src: string; type?: 'local' | 'embed' }) => ReturnType
    }
  }
}

export const VideoNode = Node.create({
  name: 'video',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      src: { default: null },
      width: { default: null },
      type: { default: 'local' } // 'local' | 'embed'
    }
  },

  parseHTML() {
    return [
      { tag: 'video[src]' },
      { tag: 'div[data-video-src]' }
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['video', mergeAttributes(HTMLAttributes, { controls: true, preload: 'metadata' })]
  },

  addCommands() {
    return {
      setVideo:
        (attrs) =>
        ({ commands }) => {
          return commands.insertContent({ type: this.name, attrs })
        }
    }
  },

  addNodeView() {
    return ({ node, getPos, editor }) => {
      const wrapper = document.createElement('div')
      wrapper.className = 'video-wrapper'

      const isEmbed = node.attrs.type === 'embed'
      let mediaEl: HTMLVideoElement | HTMLIFrameElement

      if (isEmbed) {
        const iframe = document.createElement('iframe')
        iframe.src = convertToEmbedUrl(node.attrs.src)
        iframe.setAttribute('frameborder', '0')
        iframe.setAttribute('allowfullscreen', 'true')
        iframe.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture')
        mediaEl = iframe
      } else {
        const video = document.createElement('video')
        video.src = node.attrs.src
        video.controls = true
        video.preload = 'metadata'
        mediaEl = video
      }

      if (node.attrs.width) {
        mediaEl.style.width = typeof node.attrs.width === 'number' ? `${node.attrs.width}px` : node.attrs.width
      }

      const handle = document.createElement('div')
      handle.className = 'resize-handle'
      handle.contentEditable = 'false'

      let startX = 0
      let startWidth = 0

      const onMouseMove = (e: MouseEvent) => {
        const newWidth = Math.max(100, startWidth + (e.clientX - startX))
        mediaEl.style.width = `${newWidth}px`
      }

      const onMouseUp = (e: MouseEvent) => {
        document.removeEventListener('mousemove', onMouseMove)
        document.removeEventListener('mouseup', onMouseUp)
        document.body.style.cursor = ''
        const newWidth = Math.max(100, startWidth + (e.clientX - startX))
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
        startWidth = mediaEl.getBoundingClientRect().width
        document.body.style.cursor = 'ew-resize'
        document.addEventListener('mousemove', onMouseMove)
        document.addEventListener('mouseup', onMouseUp)
      })

      wrapper.append(mediaEl, handle)

      return {
        dom: wrapper,
        update: (updatedNode) => {
          if (updatedNode.type.name !== 'video') return false
          if (isEmbed && updatedNode.attrs.type === 'embed') {
            ;(mediaEl as HTMLIFrameElement).src = convertToEmbedUrl(updatedNode.attrs.src)
          } else if (!isEmbed && updatedNode.attrs.type !== 'embed') {
            ;(mediaEl as HTMLVideoElement).src = updatedNode.attrs.src
          } else {
            return false // type changed, need full re-render
          }
          if (updatedNode.attrs.width) {
            mediaEl.style.width = typeof updatedNode.attrs.width === 'number'
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

/** Convert YouTube/Vimeo URLs to embed URLs */
function convertToEmbedUrl(url: string): string {
  // YouTube
  const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]+)/)
  if (ytMatch) return `https://www.youtube.com/embed/${ytMatch[1]}`
  // Vimeo
  const vimeoMatch = url.match(/vimeo\.com\/(\d+)/)
  if (vimeoMatch) return `https://player.vimeo.com/video/${vimeoMatch[1]}`
  return url
}

import TaskItem from '@tiptap/extension-task-item'
import { getRenderedAttributes } from '@tiptap/core'

/**
 * Extends the default TipTap TaskItem with:
 * - `taskId` — stable UUID assigned on demand when a linked note is spawned
 * - `linkedNoteId` — UUID of the spawned note tile
 *
 * The NodeView injects a small action button into each task item's DOM that
 * dispatches CustomEvents for spawn/navigate, bubbling up to NotesTile.
 */
export const LinkedTaskItem = TaskItem.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      taskId: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-task-id'),
        renderHTML: (attributes: Record<string, unknown>) => {
          if (!attributes.taskId) return {}
          return { 'data-task-id': attributes.taskId }
        }
      },
      linkedNoteId: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-linked-note-id'),
        renderHTML: (attributes: Record<string, unknown>) => {
          if (!attributes.linkedNoteId) return {}
          return { 'data-linked-note-id': attributes.linkedNoteId }
        }
      }
    }
  },

  addNodeView() {
    return ({ node, HTMLAttributes, getPos, editor }) => {
      // Build the base NodeView elements (same structure as original TaskItem)
      const listItem = document.createElement('li')
      const checkboxWrapper = document.createElement('label')
      const checkboxStyler = document.createElement('span')
      const checkbox = document.createElement('input')
      const content = document.createElement('div')
      const linkBtn = document.createElement('button')

      checkboxWrapper.contentEditable = 'false'
      checkbox.type = 'checkbox'
      checkbox.addEventListener('mousedown', (event) => event.preventDefault())
      checkbox.addEventListener('change', (event) => {
        if (!editor.isEditable) {
          checkbox.checked = !checkbox.checked
          return
        }
        const { checked } = event.target as HTMLInputElement
        if (typeof getPos === 'function') {
          editor
            .chain()
            .focus(undefined, { scrollIntoView: false })
            .command(({ tr }) => {
              const position = getPos()
              if (typeof position !== 'number') return false
              const currentNode = tr.doc.nodeAt(position)
              tr.setNodeMarkup(position, undefined, {
                ...currentNode?.attrs,
                checked
              })
              return true
            })
            .run()
        }
      })

      // Apply HTML attributes to the list item
      Object.entries(this.options.HTMLAttributes || {}).forEach(([key, value]) => {
        listItem.setAttribute(key, value as string)
      })
      Object.entries(HTMLAttributes).forEach(([key, value]) => {
        listItem.setAttribute(key, value as string)
      })

      listItem.dataset.checked = String(node.attrs.checked)
      checkbox.checked = node.attrs.checked

      // --- Link button ---
      linkBtn.className = node.attrs.linkedNoteId ? 'task-link-btn linked' : 'task-link-btn'
      linkBtn.contentEditable = 'false'
      linkBtn.type = 'button'
      linkBtn.title = node.attrs.linkedNoteId ? 'Go to linked note' : 'Spawn linked note'

      const updateLinkBtnIcon = (linkedNoteId: string | null) => {
        if (linkedNoteId) {
          linkBtn.innerHTML =
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
            '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>' +
            '<path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>' +
            '</svg>'
          linkBtn.className = 'task-link-btn linked'
          linkBtn.title = 'Go to linked note'
        } else {
          linkBtn.innerHTML =
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
            '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/>' +
            '<path d="M14 2v6h6"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/>' +
            '</svg>'
          linkBtn.className = 'task-link-btn'
          linkBtn.title = 'Spawn linked note'
        }
      }
      updateLinkBtnIcon(node.attrs.linkedNoteId)

      linkBtn.addEventListener('mousedown', (e) => e.preventDefault())
      linkBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        const taskText = content.textContent?.trim() || ''

        if (node.attrs.linkedNoteId) {
          listItem.dispatchEvent(
            new CustomEvent('task:navigate-note', {
              detail: { linkedNoteId: node.attrs.linkedNoteId },
              bubbles: true
            })
          )
        } else {
          // Assign a stable taskId directly via getPos() before dispatching
          let taskId = node.attrs.taskId as string | null
          if (!taskId && typeof getPos === 'function') {
            taskId = crypto.randomUUID()
            editor
              .chain()
              .focus(undefined, { scrollIntoView: false })
              .command(({ tr }) => {
                const pos = getPos()
                if (typeof pos !== 'number') return false
                const currentNode = tr.doc.nodeAt(pos)
                if (!currentNode) return false
                tr.setNodeMarkup(pos, undefined, { ...currentNode.attrs, taskId })
                return true
              })
              .run()
          }
          if (taskId) {
            listItem.dispatchEvent(
              new CustomEvent('task:spawn-note', {
                detail: { taskId, taskText },
                bubbles: true
              })
            )
          }
        }
      })

      checkboxWrapper.append(checkbox, checkboxStyler)
      listItem.append(checkboxWrapper, content, linkBtn)

      let prevRenderedAttributeKeys = new Set(Object.keys(HTMLAttributes))

      return {
        dom: listItem,
        contentDOM: content,
        update: (updatedNode) => {
          if (updatedNode.type !== this.type) return false

          listItem.dataset.checked = String(updatedNode.attrs.checked)
          checkbox.checked = updatedNode.attrs.checked

          // Update link button state
          updateLinkBtnIcon(updatedNode.attrs.linkedNoteId)

          // Sync data attributes for taskId and linkedNoteId
          if (updatedNode.attrs.taskId) {
            listItem.setAttribute('data-task-id', updatedNode.attrs.taskId)
          } else {
            listItem.removeAttribute('data-task-id')
          }
          if (updatedNode.attrs.linkedNoteId) {
            listItem.setAttribute('data-linked-note-id', updatedNode.attrs.linkedNoteId)
          } else {
            listItem.removeAttribute('data-linked-note-id')
          }

          // Update the node reference for click handler
          node = updatedNode

          // Sync rendered HTML attributes
          const extensionAttributes = editor.extensionManager.attributes
          const newHTMLAttributes = getRenderedAttributes(updatedNode, extensionAttributes)
          const newKeys = new Set(Object.keys(newHTMLAttributes))
          const staticAttrs = this.options.HTMLAttributes || {}

          prevRenderedAttributeKeys.forEach((key) => {
            if (!newKeys.has(key)) {
              if (key in staticAttrs) {
                listItem.setAttribute(key, staticAttrs[key])
              } else {
                listItem.removeAttribute(key)
              }
            }
          })

          newKeys.forEach((key) => {
            listItem.setAttribute(key, newHTMLAttributes[key])
          })

          prevRenderedAttributeKeys = newKeys

          return true
        }
      }
    }
  }
})

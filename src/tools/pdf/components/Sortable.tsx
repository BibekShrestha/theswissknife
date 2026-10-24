import type { ReactNode } from 'react'
import {
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type UniqueIdentifier,
} from '@dnd-kit/core'
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable'

/**
 * Drag-to-reorder for a list (Merge's files) or a grid (Reorder's pages),
 * by mouse, touch (press and hold, so a swipe still scrolls) or keyboard
 * (Space to lift, arrows to move, Space to drop, Escape to cancel), with
 * the moves read out to screen readers.
 */
interface SortableProps<T> {
  items: T[]
  /** A stable, non-empty id per item. */
  idOf: (item: T) => string
  /** How the item is read out while it moves, at the start of a sentence: "Page 3", "report.pdf". */
  nameOf: (item: T) => string
  onReorder: (items: T[]) => void
  /** Items wrap in rows (pages) rather than stack (files). */
  grid?: boolean
  children: ReactNode
}

export function Sortable<T>({ items, idOf, nameOf, onReorder, grid = false, children }: SortableProps<T>) {
  const sensors = useSensors(
    // a few pixels of travel before a drag, so clicks on buttons inside still work
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const ids = items.map(idOf)
  const at = (id: UniqueIdentifier) => ids.indexOf(String(id))
  const name = (id: UniqueIdentifier) => {
    const i = at(id)
    return i < 0 ? 'Item' : nameOf(items[i])
  }
  const where = (id: UniqueIdentifier) => `position ${at(id) + 1} of ${items.length}`

  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${name(active.id)}, at ${where(active.id)}.`,
    onDragOver: ({ active, over }) => (over ? `${name(active.id)} moved to ${where(over.id)}.` : `${name(active.id)} is not over a place to drop.`),
    onDragEnd: ({ active, over }) => (over ? `${name(active.id)} dropped at ${where(over.id)}.` : `${name(active.id)} put back where it was.`),
    onDragCancel: ({ active }) => `Moving cancelled. ${name(active.id)} put back at ${where(active.id)}.`,
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return
    const from = at(active.id)
    const to = at(over.id)
    if (from >= 0 && to >= 0) onReorder(arrayMove(items, from, to))
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
      accessibility={{
        announcements,
        screenReaderInstructions: {
          draggable: 'To move it, press Space or Enter, use the arrow keys, then press Space or Enter again to drop it, or Escape to cancel.',
        },
      }}
    >
      <SortableContext items={ids} strategy={grid ? rectSortingStrategy : verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </DndContext>
  )
}

/**
 * Page-level edits that keep everything pointing at pages honest.
 *
 * pdf-lib's copyPages deep-copies whatever a page reaches, and never maps
 * the source page to its copy: a link, a widget's /P or its field's other
 * widgets lead to pages that were not selected, which then ride along in
 * the output as unreachable-by-the-reader orphans (content included), and
 * links land on those orphans instead of the real page. So these edits
 * never copy pages:
 *
 * - keepPages edits a loaded document in place — Remove, Reorder and each
 *   part of Split (on a fork of the parsed document). References to pages
 *   that are left out are pruned (links, bookmarks, form widgets, named
 *   destinations, structure elements), page labels are recomputed, the page
 *   tree is rebuilt in the new order, and unreachable objects are dropped.
 * - mergeInto imports a whole second document into the first, renumbering
 *   its objects, so its links keep pointing at its own pages; its form
 *   fields, bookmarks, structure tree, layers and attachments are merged in.
 */
import {
  PDFArray,
  PDFCatalog,
  PDFContext,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNull,
  PDFNumber,
  PDFObject,
  PDFPageLeaf,
  PDFPageTree,
  PDFRawStream,
  PDFRef,
  PDFStream,
  PDFString,
} from 'pdf-lib'
import { stringBytes } from './crypt/document'
import { documentFromContext } from './parse'

const N = (name: string) => PDFName.of(name)
const latin1 = new TextDecoder('latin1')

function deref(context: PDFContext, obj: PDFObject | undefined): PDFObject | undefined {
  return obj instanceof PDFRef ? context.lookup(obj) : obj
}

function dictAt(context: PDFContext, obj: PDFObject | undefined): PDFDict | undefined {
  const v = deref(context, obj)
  return v instanceof PDFDict ? v : undefined
}

function arrayAt(context: PDFContext, obj: PDFObject | undefined): PDFArray | undefined {
  const v = deref(context, obj)
  return v instanceof PDFArray ? v : undefined
}

function numberAt(context: PDFContext, obj: PDFObject | undefined): number | undefined {
  const v = deref(context, obj)
  return v instanceof PDFNumber ? v.asNumber() : undefined
}

/** A name-tree key as a byte string, for lookups and sorting. */
function keyOf(obj: PDFObject | undefined): string | undefined {
  return obj instanceof PDFString || obj instanceof PDFHexString ? latin1.decode(stringBytes(obj)) : undefined
}

/** Calls visit on the leaf array (/Names or /Nums) of every node of a name or number tree. */
function treeLeaves(context: PDFContext, root: PDFObject | undefined, key: 'Names' | 'Nums', visit: (leaf: PDFArray) => void) {
  const seen = new Set<PDFDict>()
  const stack = [dictAt(context, root)]
  while (stack.length) {
    const node = stack.pop()
    if (!node || seen.has(node)) continue
    seen.add(node)
    const leaf = arrayAt(context, node.get(N(key)))
    if (leaf) visit(leaf)
    const kids = arrayAt(context, node.get(N('Kids')))
    if (kids) for (const kid of kids.asArray()) stack.push(dictAt(context, kid))
  }
}

function treePairs(context: PDFContext, root: PDFObject | undefined, key: 'Names' | 'Nums'): [PDFObject, PDFObject][] {
  const pairs: [PDFObject, PDFObject][] = []
  treeLeaves(context, root, key, (leaf) => {
    for (let i = 0; i + 1 < leaf.size(); i += 2) pairs.push([leaf.get(i), leaf.get(i + 1)])
  })
  return pairs
}

/** Removes the key/value pairs `drop` picks from every leaf of a tree. */
function pruneTree(context: PDFContext, root: PDFObject | undefined, key: 'Names' | 'Nums', drop: (k: PDFObject, v: PDFObject) => boolean) {
  treeLeaves(context, root, key, (leaf) => {
    for (let i = leaf.size() - 2; i >= 0; i -= 2) {
      if (drop(leaf.get(i), leaf.get(i + 1))) {
        leaf.remove(i + 1)
        leaf.remove(i)
      }
    }
  })
}

/** Resolves destinations — explicit, named (catalog /Dests or the /Names tree) or via a GoTo action — to page refs. */
class Destinations {
  private readonly named = new Map<string, PDFObject>()
  private readonly dests: PDFDict | undefined

  constructor(private readonly context: PDFContext, catalog: PDFDict) {
    const names = dictAt(context, catalog.get(N('Names')))
    for (const [k, v] of treePairs(context, names?.get(N('Dests')), 'Names')) {
      const key = keyOf(k)
      if (key !== undefined && !this.named.has(key)) this.named.set(key, v)
    }
    this.dests = dictAt(context, catalog.get(N('Dests')))
  }

  /** The explicit destination array, or undefined. */
  explicit(dest: PDFObject | undefined, depth = 0): PDFArray | undefined {
    const value = deref(this.context, dest)
    if (depth > 8 || value === undefined) return undefined
    if (value instanceof PDFArray) return value
    if (value instanceof PDFDict) return this.explicit(value.get(N('D')), depth + 1)
    if (value instanceof PDFName) return this.explicit(this.dests?.get(value), depth + 1)
    const key = keyOf(value)
    if (key === undefined) return undefined
    return this.explicit(this.named.get(key) ?? this.dests?.get(N(key)), depth + 1)
  }

  /** The page an explicit, named or action destination leads to. */
  target(dest: PDFObject | undefined): PDFRef | undefined {
    const page = this.explicit(dest)?.get(0)
    return page instanceof PDFRef ? page : undefined
  }
}

/** The destination of an annotation or outline item: /Dest, or the /D of a GoTo action. */
function destOf(context: PDFContext, dict: PDFDict): PDFObject | undefined {
  const dest = dict.get(N('Dest'))
  if (dest !== undefined) return dest
  const action = dictAt(context, dict.get(N('A')))
  return action?.get(N('S')) === N('GoTo') ? action.get(N('D')) : undefined
}

function forgetDest(context: PDFContext, dict: PDFDict) {
  dict.delete(N('Dest'))
  const action = dictAt(context, dict.get(N('A')))
  if (action?.get(N('S')) === N('GoTo')) dict.delete(N('A'))
}

/** Replaces a named destination with the explicit one it names, so it no longer depends on the catalog. */
function makeExplicit(context: PDFContext, dests: Destinations, dict: PDFDict) {
  const dest = dict.get(N('Dest'))
  const action = dictAt(context, dict.get(N('A')))
  const goTo = action?.get(N('S')) === N('GoTo') ? action : undefined
  const raw = deref(context, dest ?? goTo?.get(N('D')))
  if (raw === undefined || raw instanceof PDFArray) return
  const explicit = dests.explicit(raw)
  if (!explicit) return
  if (dest !== undefined) dict.set(N('Dest'), explicit)
  else goTo!.set(N('D'), explicit)
}

// ---------------------------------------------------------------- copying

function cloneObject(obj: PDFObject, context: PDFContext, mapRef: (ref: PDFRef) => PDFObject): PDFObject {
  if (obj instanceof PDFRef) return mapRef(obj)
  if (obj instanceof PDFDict) {
    const map = new Map<PDFName, PDFObject>()
    for (const [k, v] of obj.entries()) map.set(k, cloneObject(v, context, mapRef))
    if (obj instanceof PDFCatalog) return PDFCatalog.fromMapWithContext(map, context)
    if (obj instanceof PDFPageTree) return PDFPageTree.fromMapWithContext(map, context)
    if (obj instanceof PDFPageLeaf) return PDFPageLeaf.fromMapWithContext(map, context)
    return PDFDict.fromMapWithContext(map, context)
  }
  if (obj instanceof PDFArray) {
    const array = PDFArray.withContext(context)
    for (const v of obj.asArray()) array.push(cloneObject(v, context, mapRef))
    return array
  }
  // stream contents are never modified here, so the bytes are shared
  if (obj instanceof PDFRawStream) return PDFRawStream.of(cloneObject(obj.dict, context, mapRef) as PDFDict, obj.contents)
  if (obj instanceof PDFStream) {
    const copy = obj.clone(context)
    for (const [k, v] of copy.dict.entries()) copy.dict.set(k, cloneObject(v, context, mapRef))
    return copy
  }
  return obj // names, numbers, strings, booleans, null: immutable
}

/** An independent copy of a parsed document, same object numbers, sharing only stream bytes. */
export function forkDocument(doc: PDFDocument): PDFDocument {
  const source = doc.context
  const context = PDFContext.create()
  const same = (ref: PDFRef) => ref
  for (const [ref, object] of source.enumerateIndirectObjects()) context.assign(ref, cloneObject(object, context, same))
  context.largestObjectNumber = source.largestObjectNumber
  const t = source.trailerInfo
  const copy = (o: PDFObject | undefined) => (o === undefined ? undefined : cloneObject(o, context, same))
  context.trailerInfo = { Root: copy(t.Root), Info: copy(t.Info), ID: copy(t.ID), Encrypt: copy(t.Encrypt) }
  return documentFromContext(context)
}

// ---------------------------------------------------------------- graph upkeep

function trailerRoots(context: PDFContext): PDFObject[] {
  const t = context.trailerInfo
  return [t.Root, t.Info, t.Encrypt, t.ID].filter((o): o is PDFObject => o !== undefined)
}

/** Drops every indirect object nothing reachable from the trailer refers to — pdf-lib writes them all otherwise. */
function collectGarbage(context: PDFContext) {
  const live = new Set<PDFRef>()
  const seen = new Set<PDFObject>()
  const stack = trailerRoots(context)
  while (stack.length) {
    const obj = stack.pop()!
    if (obj instanceof PDFRef) {
      if (live.has(obj)) continue
      live.add(obj)
      const target = context.lookup(obj)
      if (target) stack.push(target)
    } else if (seen.has(obj)) continue
    else if (obj instanceof PDFDict) {
      seen.add(obj)
      for (const [, v] of obj.entries()) stack.push(v)
    } else if (obj instanceof PDFArray) {
      seen.add(obj)
      stack.push(...obj.asArray())
    } else if (obj instanceof PDFStream) {
      seen.add(obj)
      stack.push(obj.dict)
    }
  }
  for (const [ref] of context.enumerateIndirectObjects()) if (!live.has(ref)) context.delete(ref)
}

/**
 * The backstop after the targeted pruning: any remaining reference to a
 * doomed object (a left-out page, its annotations, the old page tree) is
 * removed from dictionaries and nulled in arrays, so nothing can keep it alive.
 */
function scrub(context: PDFContext, doomed: Set<PDFRef>) {
  if (doomed.size === 0) return
  const seen = new Set<PDFObject>()
  const stack = trailerRoots(context)
  while (stack.length) {
    const obj = stack.pop()!
    if (seen.has(obj)) continue
    seen.add(obj)
    if (obj instanceof PDFRef) {
      const target = context.lookup(obj)
      if (target) stack.push(target)
    } else if (obj instanceof PDFDict) {
      for (const [k, v] of obj.entries()) {
        if (v instanceof PDFRef && doomed.has(v)) obj.delete(k)
        else stack.push(v)
      }
    } else if (obj instanceof PDFArray) {
      for (let i = 0; i < obj.size(); i++) {
        const v = obj.get(i)
        if (v instanceof PDFRef && doomed.has(v)) obj.set(i, PDFNull)
        else stack.push(v)
      }
    } else if (obj instanceof PDFStream) stack.push(obj.dict)
  }
}

/** pdf-lib caches both the page list and the page count. */
function invalidatePages(doc: PDFDocument) {
  const internals = doc as unknown as { pageCache: { invalidate(): void }; pageCount?: number }
  internals.pageCache.invalidate()
  internals.pageCount = undefined
}

const INHERITABLE = PDFPageLeaf.InheritableEntries.map(N)

/** Replaces the page tree with one flat node holding `refs` in order; returns the old tree's nodes. */
function rebuildPageTree(doc: PDFDocument, refs: PDFRef[]): Set<PDFRef> {
  const { context, catalog } = doc
  const old = new Set<PDFRef>()
  const stack = [catalog.get(N('Pages'))]
  while (stack.length) {
    const ref = stack.pop()
    if (!(ref instanceof PDFRef) || old.has(ref)) continue
    const node = context.lookup(ref)
    if (!(node instanceof PDFPageTree)) continue
    old.add(ref)
    stack.push(...(arrayAt(context, node.get(N('Kids')))?.asArray() ?? []))
  }
  const leaves = refs.map((ref) => (context.lookup(ref) as PDFPageLeaf))
  // inherited attributes move onto each page before its parents go away
  for (const leaf of leaves) {
    for (const key of INHERITABLE) {
      if (leaf.get(key) !== undefined) continue
      const value = leaf.getInheritableAttribute(key)
      if (value !== undefined) leaf.set(key, value)
    }
  }
  const tree = PDFPageTree.withContext(context)
  const treeRef = context.register(tree)
  tree.set(N('Kids'), context.obj(refs))
  tree.set(N('Count'), context.obj(refs.length))
  for (const leaf of leaves) leaf.set(N('Parent'), treeRef)
  catalog.set(N('Pages'), treeRef)
  invalidatePages(doc)
  return old
}

// ---------------------------------------------------------------- page labels

interface Label {
  style?: PDFName
  prefix?: PDFObject
  n: number
}

/** Each page's label as (style, prefix, number), or null when the document has no /PageLabels. */
function readPageLabels(doc: PDFDocument): Label[] | null {
  const { context } = doc
  const tree = doc.catalog.get(N('PageLabels'))
  if (!dictAt(context, tree)) return null
  const ranges = treePairs(context, tree, 'Nums')
    .map(([k, v]) => [numberAt(context, k), dictAt(context, v)] as const)
    .filter((r): r is readonly [number, PDFDict] => r[0] !== undefined && r[1] !== undefined)
    .sort((a, b) => a[0] - b[0])
  return doc.getPages().map((_, i) => {
    let range: (typeof ranges)[number] | undefined
    for (const r of ranges) if (r[0] <= i) range = r
    if (!range) return { style: N('D'), n: i + 1 }
    const [start, dict] = range
    const style = deref(context, dict.get(N('S')))
    return {
      style: style instanceof PDFName ? style : undefined,
      prefix: deref(context, dict.get(N('P'))),
      n: (numberAt(context, dict.get(N('St'))) ?? 1) + i - start,
    }
  })
}

function writePageLabels(doc: PDFDocument, labels: Label[]) {
  const { context } = doc
  const nums: PDFObject[] = []
  let prev: Label | undefined
  labels.forEach((label, i) => {
    const continues =
      prev && prev.style === label.style && String(prev.prefix) === String(label.prefix) && (label.style === undefined || label.n === prev.n + 1)
    if (!continues) {
      const range = context.obj({}) as PDFDict
      if (label.style) range.set(N('S'), label.style)
      if (label.prefix) range.set(N('P'), label.prefix)
      if (label.style && label.n !== 1) range.set(N('St'), context.obj(label.n))
      nums.push(context.obj(i), range)
    }
    prev = label
  })
  doc.catalog.set(N('PageLabels'), context.register(context.obj({ Nums: nums })))
}

// ---------------------------------------------------------------- outlines

function outlineChildren(context: PDFContext, node: PDFDict): PDFRef[] {
  const out: PDFRef[] = []
  const seen = new Set<PDFRef>()
  let ref = node.get(N('First'))
  while (ref instanceof PDFRef && !seen.has(ref) && context.lookup(ref) instanceof PDFDict) {
    seen.add(ref)
    out.push(ref)
    ref = context.lookup(ref, PDFDict).get(N('Next'))
  }
  return out
}

function linkOutline(context: PDFContext, parentRef: PDFRef, parent: PDFDict, items: PDFRef[]) {
  items.forEach((ref, i) => {
    const item = context.lookup(ref, PDFDict)
    item.set(N('Parent'), parentRef)
    if (i > 0) item.set(N('Prev'), items[i - 1])
    else item.delete(N('Prev'))
    if (i < items.length - 1) item.set(N('Next'), items[i + 1])
    else item.delete(N('Next'))
  })
  if (items.length) {
    parent.set(N('First'), items[0])
    parent.set(N('Last'), items[items.length - 1])
  } else {
    parent.delete(N('First'))
    parent.delete(N('Last'))
  }
}

/** Recomputes /Count bottom-up (positive when open, negative when closed); returns the visible descendants. */
function fixOutlineCounts(context: PDFContext, node: PDFDict, isRoot: boolean, seen = new Set<PDFDict>()): number {
  if (seen.has(node)) return 0
  seen.add(node)
  let visible = 0
  for (const ref of outlineChildren(context, node)) {
    const child = context.lookup(ref, PDFDict)
    const open = (numberAt(context, child.get(N('Count'))) ?? 0) > 0
    const below = fixOutlineCounts(context, child, false, seen)
    visible += 1 + (open ? below : 0)
  }
  const wasOpen = (numberAt(context, node.get(N('Count'))) ?? 0) > 0
  if (visible === 0) node.delete(N('Count'))
  else node.set(N('Count'), context.obj(isRoot || wasOpen ? visible : -visible))
  return visible
}

/** Drops bookmarks that lead to removed pages; one with surviving children stays as a heading without a target. */
function pruneOutline(doc: PDFDocument, gone: (dest: PDFObject | undefined) => boolean) {
  const { context, catalog } = doc
  const rootRef = catalog.get(N('Outlines'))
  const root = dictAt(context, rootRef)
  if (!root || !(rootRef instanceof PDFRef)) return
  const seen = new Set<PDFDict>()
  const prune = (parentRef: PDFRef, parent: PDFDict) => {
    if (seen.has(parent)) return
    seen.add(parent)
    const kept: PDFRef[] = []
    for (const ref of outlineChildren(context, parent)) {
      const item = context.lookup(ref, PDFDict)
      prune(ref, item)
      if (gone(destOf(context, item))) {
        if (item.get(N('First')) === undefined) continue
        forgetDest(context, item)
      }
      kept.push(ref)
    }
    linkOutline(context, parentRef, parent, kept)
  }
  prune(rootRef, root)
  if (fixOutlineCounts(context, root, true) === 0 && root.get(N('First')) === undefined) catalog.delete(N('Outlines'))
}

// ---------------------------------------------------------------- forms

function pruneFields(doc: PDFDocument, removedPages: Set<PDFRef>, goneAnnots: Set<PDFRef>) {
  const { context, catalog } = doc
  const form = dictAt(context, catalog.get(N('AcroForm')))
  const fields = arrayAt(context, form?.get(N('Fields')))
  if (!form || !fields) return
  const dropped = new Set<PDFRef>()
  const seen = new Set<PDFRef>()
  const keep = (ref: PDFObject): boolean => {
    if (!(ref instanceof PDFRef)) return true
    if (seen.has(ref)) return !dropped.has(ref)
    seen.add(ref)
    const node = context.lookup(ref)
    if (!(node instanceof PDFDict)) return true
    let ok = !goneAnnots.has(ref)
    const kids = arrayAt(context, node.get(N('Kids')))
    if (ok && kids && kids.size() > 0) {
      for (let i = kids.size() - 1; i >= 0; i--) if (!keep(kids.get(i))) kids.remove(i)
      ok = kids.size() > 0
    } else if (ok) {
      // a widget listed on no page: its /P says where it lives
      const page = node.get(N('P'))
      ok = !(page instanceof PDFRef && removedPages.has(page))
    }
    if (!ok) dropped.add(ref)
    return ok
  }
  for (let i = fields.size() - 1; i >= 0; i--) if (!keep(fields.get(i))) fields.remove(i)
  const order = arrayAt(context, form.get(N('CO')))
  if (order) for (let i = order.size() - 1; i >= 0; i--) if (dropped.has(order.get(i) as PDFRef)) order.remove(i)
}

// ---------------------------------------------------------------- structure tree

function pruneStructTree(doc: PDFDocument, removedPages: Set<PDFRef>, goneAnnots: Set<PDFRef>, goneKeys: Set<number>) {
  const { context, catalog } = doc
  const root = dictAt(context, catalog.get(N('StructTreeRoot')))
  if (!root) return
  const onRemoved = (pg: PDFObject | undefined) => pg instanceof PDFRef && removedPages.has(pg)
  const pruned = new Set<PDFRef>()
  const seen = new Set<PDFDict>()

  const keepKid = (kid: PDFObject, pg: PDFObject | undefined): boolean => {
    if (kid instanceof PDFNumber) return !onRemoved(pg)
    const dict = dictAt(context, kid)
    if (!dict) return true
    const own = dict.get(N('Pg')) ?? pg
    const type = dict.get(N('Type'))
    if (type === N('MCR')) return !onRemoved(own)
    if (type === N('OBJR')) {
      const target = dict.get(N('Obj'))
      return !onRemoved(own) && !(target instanceof PDFRef && goneAnnots.has(target))
    }
    const ok = pruneElement(dict, own)
    if (!ok && kid instanceof PDFRef) pruned.add(kid)
    return ok
  }

  const pruneElement = (elem: PDFDict, pg: PDFObject | undefined): boolean => {
    if (seen.has(elem)) return true
    seen.add(elem)
    const k = elem.get(N('K'))
    if (k === undefined) return !onRemoved(pg)
    const kids = arrayAt(context, k)
    if (kids) {
      const before = kids.size()
      for (let i = before - 1; i >= 0; i--) if (!keepKid(kids.get(i), pg)) kids.remove(i)
      return before === 0 || kids.size() > 0
    }
    if (keepKid(k, pg)) return true
    elem.delete(N('K'))
    return false
  }

  pruneElement(root, undefined)
  pruneTree(context, root.get(N('ParentTree')), 'Nums', (k) => goneKeys.has(numberAt(context, k) ?? -1))
  pruneTree(context, root.get(N('IDTree')), 'Names', (_, v) => v instanceof PDFRef && pruned.has(v))
  return pruned
}

// ---------------------------------------------------------------- keepPages

function annotRefs(context: PDFContext, page: PDFPageLeaf): PDFObject[] {
  return arrayAt(context, page.get(N('Annots')))?.asArray() ?? []
}

/**
 * Leaves exactly the pages at `order` (0-based, each at most once) in that
 * order, editing the document in place. Everything else that referred to a
 * left-out page is pruned or, failing that, cut loose and garbage-collected.
 */
export function keepPages(doc: PDFDocument, order: number[]): void {
  const { context, catalog } = doc
  const pages = doc.getPages()
  const keptRefs = order.map((i) => pages[i].ref)
  const keptSet = new Set(keptRefs)
  const removed = new Set(pages.map((p) => p.ref).filter((ref) => !keptSet.has(ref)))
  const labels = readPageLabels(doc)
  const dests = new Destinations(context, catalog)
  const gone = (dest: PDFObject | undefined) => {
    const target = dests.target(dest)
    return target !== undefined && removed.has(target)
  }

  // what lives on the removed pages
  const goneAnnots = new Set<PDFRef>()
  const goneKeys = new Set<number>()
  for (const page of pages) {
    if (!removed.has(page.ref)) continue
    const key = numberAt(context, page.node.get(N('StructParents')))
    if (key !== undefined) goneKeys.add(key)
    for (const a of annotRefs(context, page.node)) {
      if (a instanceof PDFRef) goneAnnots.add(a)
      const sp = numberAt(context, dictAt(context, a)?.get(N('StructParent')))
      if (sp !== undefined) goneKeys.add(sp)
    }
  }

  if (removed.size) {
    // links into removed pages go; other annotations just lose such a GoTo action
    for (const ref of keptRefs) {
      const annots = arrayAt(context, (context.lookup(ref) as PDFPageLeaf).get(N('Annots')))
      if (!annots) continue
      for (let i = annots.size() - 1; i >= 0; i--) {
        const a = annots.get(i)
        const annot = dictAt(context, a)
        if (!annot || !gone(destOf(context, annot))) continue
        if (annot.get(N('Subtype')) === N('Link')) {
          annots.remove(i)
          if (a instanceof PDFRef) goneAnnots.add(a)
          const sp = numberAt(context, annot.get(N('StructParent')))
          if (sp !== undefined) goneKeys.add(sp)
        } else forgetDest(context, annot)
      }
    }
    pruneFields(doc, removed, goneAnnots)
    pruneOutline(doc, gone)
    const names = dictAt(context, catalog.get(N('Names')))
    pruneTree(context, names?.get(N('Dests')), 'Names', (_, v) => gone(v))
    const destsDict = dictAt(context, catalog.get(N('Dests')))
    if (destsDict) for (const [k, v] of destsDict.entries()) if (gone(v)) destsDict.delete(k)
    // /OpenAction is a destination array or an action dictionary
    const open = deref(context, catalog.get(N('OpenAction')))
    const openDest = open instanceof PDFDict ? (open.get(N('S')) === N('GoTo') ? open.get(N('D')) : undefined) : open
    if (gone(openDest)) catalog.delete(N('OpenAction'))
    pruneStructTree(doc, removed, goneAnnots, goneKeys)
  }

  if (labels) writePageLabels(doc, order.map((i) => labels[i]))
  const oldTree = rebuildPageTree(doc, keptRefs)
  scrub(context, new Set([...removed, ...goneAnnots, ...oldTree]))
  collectGarbage(context)
}

// ---------------------------------------------------------------- merge

/** Field and attachment names that collide are renamed; returns what was changed, for the person merging. */
export function mergeInto(target: PDFDocument, source: PDFDocument, sourceName: string, labels: (Label[] | null)[]): string[] {
  const notes: string[] = []
  const { context } = target
  const from = source.context

  // the source's named destinations do not come along, so its links must not need them
  const dests = new Destinations(from, source.catalog)
  for (const page of source.getPages()) for (const a of annotRefs(from, page.node)) {
    const annot = dictAt(from, a)
    if (annot) makeExplicit(from, dests, annot)
  }
  const walk = (node: PDFDict, seen: Set<PDFDict>) => {
    for (const ref of outlineChildren(from, node)) {
      const item = from.lookup(ref, PDFDict)
      if (seen.has(item)) continue
      seen.add(item)
      makeExplicit(from, dests, item)
      walk(item, seen)
    }
  }
  const outlineRoot = dictAt(from, source.catalog.get(N('Outlines')))
  if (outlineRoot) walk(outlineRoot, new Set())
  labels.push(readPageLabels(source))

  // import every object under a fresh number
  const map = new Map<PDFRef, PDFRef>()
  for (const [ref] of from.enumerateIndirectObjects()) map.set(ref, context.nextRef())
  const mapRef = (ref: PDFRef): PDFObject => map.get(ref) ?? PDFNull
  for (const [ref, object] of from.enumerateIndirectObjects()) context.assign(map.get(ref)!, cloneObject(object, context, mapRef))
  const root = from.trailerInfo.Root
  const catalog = dictAt(context, root instanceof PDFRef ? mapRef(root) : root && cloneObject(root, context, mapRef))
  const pages = source.getPages().map((p) => map.get(p.ref)!)
  if (!catalog) return notes

  mergeStructTrees(target, catalog, pages)
  mergeFields(target, catalog, sourceName, notes)
  mergeOutlines(target, catalog)
  mergeLayers(target, catalog)
  mergeAttachments(target, catalog, sourceName, notes)

  const pagesSoFar = target.getPages().map((p) => p.ref)
  rebuildPageTree(target, [...pagesSoFar, ...pages])
  return notes
}

function mergeFields(target: PDFDocument, catalog: PDFDict, sourceName: string, notes: string[]) {
  const { context } = target
  const theirs = dictAt(context, catalog.get(N('AcroForm')))
  const theirFields = arrayAt(context, theirs?.get(N('Fields')))
  if (!theirs || !theirFields || theirFields.size() === 0) return
  const ours = dictAt(context, target.catalog.get(N('AcroForm')))
  if (!ours) {
    target.catalog.set(N('AcroForm'), catalog.get(N('AcroForm'))!)
    return
  }
  let fields = arrayAt(context, ours.get(N('Fields')))
  if (!fields) {
    fields = context.obj([])
    ours.set(N('Fields'), fields)
  }
  const nameOf = (ref: PDFObject) => {
    const t = deref(context, dictAt(context, ref)?.get(N('T')))
    return t instanceof PDFString || t instanceof PDFHexString ? t.decodeText() : undefined
  }
  const taken = new Set(fields.asArray().map(nameOf).filter((n): n is string => n !== undefined))
  for (const ref of theirFields.asArray()) {
    const name = nameOf(ref)
    if (name !== undefined && taken.has(name)) {
      let k = 2
      while (taken.has(`${name}_${k}`)) k++
      const renamed = `${name}_${k}`
      dictAt(context, ref)!.set(N('T'), PDFHexString.fromText(renamed))
      notes.push(`Form field “${name}” from ${sourceName} was renamed “${renamed}”: fields with the same name share one value.`)
      taken.add(renamed)
    } else if (name !== undefined) taken.add(name)
    fields.push(ref)
  }
  const theirResources = dictAt(context, theirs.get(N('DR')))
  if (theirResources) {
    let resources = dictAt(context, ours.get(N('DR')))
    if (!resources) {
      resources = context.obj({}) as PDFDict
      ours.set(N('DR'), resources)
    }
    for (const [kind, value] of theirResources.entries()) {
      const theirGroup = dictAt(context, value)
      const ourGroup = dictAt(context, resources.get(kind))
      if (!ourGroup) resources.set(kind, value)
      else if (theirGroup) for (const [k, v] of theirGroup.entries()) if (!ourGroup.has(k)) ourGroup.set(k, v)
    }
  }
  if (deref(context, theirs.get(N('NeedAppearances')))?.toString() === 'true') ours.set(N('NeedAppearances'), context.obj(true))
  const sig = (numberAt(context, ours.get(N('SigFlags'))) ?? 0) | (numberAt(context, theirs.get(N('SigFlags'))) ?? 0)
  if (sig) ours.set(N('SigFlags'), context.obj(sig))
  const theirOrder = arrayAt(context, theirs.get(N('CO')))
  if (theirOrder) {
    const order = arrayAt(context, ours.get(N('CO')))
    if (order) for (const v of theirOrder.asArray()) order.push(v)
    else ours.set(N('CO'), theirOrder)
  }
  if (ours.has(N('XFA')) || theirs.has(N('XFA'))) {
    // an XFA form would override the merged AcroForm fields in viewers that run XFA
    ours.delete(N('XFA'))
    notes.push('The XFA form data was left out: it cannot be combined, and the regular form fields are kept.')
  }
}

function mergeOutlines(target: PDFDocument, catalog: PDFDict) {
  const { context } = target
  const theirs = dictAt(context, catalog.get(N('Outlines')))
  if (!theirs) return
  const items = outlineChildren(context, theirs)
  if (items.length === 0) return
  const existing = target.catalog.get(N('Outlines'))
  let root = dictAt(context, existing)
  let rootRef: PDFRef
  if (root && existing instanceof PDFRef) rootRef = existing
  else {
    root = context.obj({ Type: 'Outlines' }) as PDFDict
    rootRef = context.register(root)
    target.catalog.set(N('Outlines'), rootRef)
  }
  linkOutline(context, rootRef, root, [...outlineChildren(context, root), ...items])
  fixOutlineCounts(context, root, true)
}

function mergeStructTrees(target: PDFDocument, catalog: PDFDict, pages: PDFRef[]) {
  const { context } = target
  const theirRef = catalog.get(N('StructTreeRoot'))
  const theirs = dictAt(context, theirRef)
  if (!theirs || !(theirRef instanceof PDFRef)) return
  const ours = dictAt(context, target.catalog.get(N('StructTreeRoot')))
  const markInfo = catalog.get(N('MarkInfo'))
  if (!ours) {
    target.catalog.set(N('StructTreeRoot'), theirRef)
    if (markInfo && !target.catalog.has(N('MarkInfo'))) target.catalog.set(N('MarkInfo'), markInfo)
    return
  }
  const ourRef = target.catalog.get(N('StructTreeRoot')) as PDFRef
  const pairs = (root: PDFDict) =>
    treePairs(context, root.get(N('ParentTree')), 'Nums')
      .map(([k, v]) => [numberAt(context, k), v] as const)
      .filter((p): p is readonly [number, PDFObject] => p[0] !== undefined)
  const ourPairs = pairs(ours)
  const offset = Math.max(numberAt(context, ours.get(N('ParentTreeNextKey'))) ?? 0, ...ourPairs.map(([k]) => k + 1), 0)
  const shift = (dict: PDFDict | undefined, key: string) => {
    const n = numberAt(context, dict?.get(N(key)))
    if (dict && n !== undefined) dict.set(N(key), context.obj(n + offset))
  }
  for (const ref of pages) {
    const page = context.lookup(ref, PDFDict)
    shift(page, 'StructParents')
    for (const a of arrayAt(context, page.get(N('Annots')))?.asArray() ?? []) shift(dictAt(context, a), 'StructParent')
  }
  const all = [...ourPairs, ...pairs(theirs).map(([k, v]) => [k + offset, v] as const)].sort((a, b) => a[0] - b[0])
  ours.set(N('ParentTree'), context.register(context.obj({ Nums: all.flatMap(([k, v]) => [context.obj(k), v]) })))
  ours.set(N('ParentTreeNextKey'), context.obj(all.length ? all[all.length - 1][0] + 1 : offset))
  const kidsOf = (k: PDFObject | undefined) => {
    const v = deref(context, k)
    return v === undefined ? [] : v instanceof PDFArray ? v.asArray() : [k!]
  }
  const theirKids = kidsOf(theirs.get(N('K')))
  for (const kid of theirKids) dictAt(context, kid)?.set(N('P'), ourRef)
  ours.set(N('K'), context.obj([...kidsOf(ours.get(N('K'))), ...theirKids]))
  for (const key of ['RoleMap', 'ClassMap']) {
    const theirMap = dictAt(context, theirs.get(N(key)))
    if (!theirMap) continue
    const ourMap = dictAt(context, ours.get(N(key)))
    if (!ourMap) ours.set(N(key), theirMap)
    else for (const [k, v] of theirMap.entries()) if (!ourMap.has(k)) ourMap.set(k, v)
  }
  const theirIds = treePairs(context, theirs.get(N('IDTree')), 'Names')
  if (theirIds.length) {
    const ids = treePairs(context, ours.get(N('IDTree')), 'Names')
    const seen = new Set(ids.map(([k]) => keyOf(k)))
    for (const [k, v] of theirIds) if (!seen.has(keyOf(k))) ids.push([k, v])
    ids.sort((a, b) => ((keyOf(a[0]) ?? '') < (keyOf(b[0]) ?? '') ? -1 : 1))
    ours.set(N('IDTree'), context.register(context.obj({ Names: ids.flat() })))
  }
}

/** Optional content (layers): the source's groups join the list, keeping their default on/off state. */
function mergeLayers(target: PDFDocument, catalog: PDFDict) {
  const { context } = target
  const theirs = dictAt(context, catalog.get(N('OCProperties')))
  if (!theirs) return
  const ours = dictAt(context, target.catalog.get(N('OCProperties')))
  if (!ours) {
    target.catalog.set(N('OCProperties'), catalog.get(N('OCProperties'))!)
    return
  }
  const append = (into: PDFDict, from: PDFDict, key: string) => {
    const extra = arrayAt(context, from.get(N(key)))
    if (!extra) return
    const list = arrayAt(context, into.get(N(key)))
    if (list) for (const v of extra.asArray()) list.push(v)
    else into.set(N(key), extra)
  }
  append(ours, theirs, 'OCGs')
  const ourDefault = dictAt(context, ours.get(N('D')))
  const theirDefault = dictAt(context, theirs.get(N('D')))
  if (ourDefault && theirDefault) for (const key of ['ON', 'OFF', 'Order', 'Locked']) append(ourDefault, theirDefault, key)
}

function mergeAttachments(target: PDFDocument, catalog: PDFDict, sourceName: string, notes: string[]) {
  const { context } = target
  const theirs = treePairs(context, dictAt(context, catalog.get(N('Names')))?.get(N('EmbeddedFiles')), 'Names')
  if (theirs.length === 0) return
  let names = dictAt(context, target.catalog.get(N('Names')))
  if (!names) {
    names = context.obj({}) as PDFDict
    target.catalog.set(N('Names'), context.register(names))
  }
  const pairs = treePairs(context, names.get(N('EmbeddedFiles')), 'Names')
  const text = (k: PDFObject) => (k instanceof PDFString || k instanceof PDFHexString ? k.decodeText() : '')
  const taken = new Set(pairs.map(([k]) => text(k)))
  for (const [k, v] of theirs) {
    let key = k
    const name = text(k)
    if (taken.has(name)) {
      const dot = name.lastIndexOf('.')
      const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, '']
      let n = 2
      while (taken.has(`${stem} (${n})${ext}`)) n++
      const renamed = `${stem} (${n})${ext}`
      key = PDFHexString.fromText(renamed)
      const spec = dictAt(context, v)
      if (spec) for (const field of ['UF', 'F']) if (spec.has(N(field))) spec.set(N(field), PDFHexString.fromText(renamed))
      notes.push(`Attachment “${name}” from ${sourceName} was renamed “${renamed}”.`)
    }
    taken.add(text(key))
    pairs.push([key, v])
  }
  pairs.sort((a, b) => (keyOf(a[0])! < keyOf(b[0])! ? -1 : 1))
  names.set(N('EmbeddedFiles'), context.register(context.obj({ Names: pairs.flat() })))
}

/** Page labels for a merged document: each source's own, or plain 1, 2, 3… for a source without any. */
export function finishMerge(target: PDFDocument, labels: (Label[] | null)[], pageCounts: number[]) {
  if (labels.some((l) => l)) {
    writePageLabels(target, labels.flatMap((l, i) => l ?? Array.from({ length: pageCounts[i] }, (_, n) => ({ style: N('D'), n: n + 1 }))))
  }
  collectGarbage(target.context)
}

export { readPageLabels, type Label }

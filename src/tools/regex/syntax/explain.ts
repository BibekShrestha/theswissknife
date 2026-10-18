/**
 * Turns the parse tree into plain-language lines for the Explain tab. Each
 * line quotes the slice of the pattern it describes, so the reader can map
 * words back to syntax.
 */

import type { Char, CharClass, ClassItem, Disjunction, Group, Node, ParsedPattern, Quantifier, Sequence } from './ast'

export interface ExplainNode {
  label: string
  /** The pattern text this line describes. */
  source: string
  start: number
  end: number
  note?: string
  children: ExplainNode[]
}

interface Scope {
  ignoreCase: boolean
  multiline: boolean
  dotAll: boolean
  unicode: boolean
  groups: ParsedPattern['groups']
}

const CONTROL_NAMES: Record<number, string> = {
  0x00: 'NUL',
  0x08: 'backspace',
  0x09: 'tab',
  0x0a: 'line feed (newline)',
  0x0b: 'vertical tab',
  0x0c: 'form feed',
  0x0d: 'carriage return',
  0x20: 'space',
  0xa0: 'no-break space',
  0x2028: 'line separator',
  0x2029: 'paragraph separator',
  0xfeff: 'byte order mark',
}

const GENERAL_CATEGORIES: Record<string, string> = {
  L: 'Letter', LC: 'Cased_Letter', Lu: 'Uppercase_Letter', Ll: 'Lowercase_Letter', Lt: 'Titlecase_Letter',
  Lm: 'Modifier_Letter', Lo: 'Other_Letter', M: 'Mark', Mn: 'Nonspacing_Mark', Mc: 'Spacing_Mark',
  Me: 'Enclosing_Mark', N: 'Number', Nd: 'Decimal_Number', Nl: 'Letter_Number', No: 'Other_Number',
  P: 'Punctuation', Pc: 'Connector_Punctuation', Pd: 'Dash_Punctuation', Ps: 'Open_Punctuation',
  Pe: 'Close_Punctuation', Pi: 'Initial_Punctuation', Pf: 'Final_Punctuation', Po: 'Other_Punctuation',
  S: 'Symbol', Sm: 'Math_Symbol', Sc: 'Currency_Symbol', Sk: 'Modifier_Symbol', So: 'Other_Symbol',
  Z: 'Separator', Zs: 'Space_Separator', Zl: 'Line_Separator', Zp: 'Paragraph_Separator', C: 'Other',
  Cc: 'Control', Cf: 'Format', Cs: 'Surrogate', Co: 'Private_Use', Cn: 'Unassigned',
}

const hex = (value: number) => `U+${value.toString(16).toUpperCase().padStart(4, '0')}`

/** A character as a reader would want it named. */
export function describeChar(value: number): string {
  const name = CONTROL_NAMES[value]
  if (name) return `${name} (${hex(value)})`
  if (value >= 0xd800 && value <= 0xdfff) return `lone surrogate ${hex(value)}`
  if (value < 0x20 || (value >= 0x7f && value < 0xa0)) return `control character ${hex(value)}`
  return `"${String.fromCodePoint(value)}"`
}

const CLASS_ESCAPES: Record<string, string> = {
  d: 'a digit 0–9',
  D: 'any character except a digit 0–9',
  s: 'a whitespace or line-terminator character',
  S: 'any character except whitespace and line terminators',
  w: 'a word character: A–Z, a–z, 0–9 or _',
  W: 'any character except A–Z, a–z, 0–9 and _',
}

const FORM_NOTES: Partial<Record<Char['form'], string>> = {
  octal: 'Legacy octal escape — only allowed without the u or v flag.',
  identity: 'Escape of a character with no special meaning — only allowed without the u or v flag.',
}

function plural(n: number, word: string) {
  return `${n.toLocaleString('en-US')} ${word}${n === 1 ? '' : 's'}`
}

function quantifierLabel(q: Quantifier): string {
  const { min, max } = q
  let count: string
  if (min === 0 && max === 1) count = 'Optional (0 or 1 time)'
  else if (max === Infinity) count = min === 0 ? 'Zero or more times' : min === 1 ? 'One or more times' : `${min.toLocaleString('en-US')} or more times`
  else if (min === max) count = `Exactly ${plural(min, 'time')}`
  else count = `Between ${min.toLocaleString('en-US')} and ${plural(max, 'time')}`
  if (min === max) return q.lazy ? `${count} (the lazy ? changes nothing here)` : count
  return `${count}, ${q.lazy ? 'lazy — as few as possible' : 'greedy — as many as possible'}`
}

function groupLabel(group: Group): string {
  switch (group.kind) {
    case 'capture':
      return group.name ? `Named capture group "${group.name}" (#${group.index})` : `Capture group #${group.index}`
    case 'noncapture':
      return 'Group (non-capturing)'
    case 'lookahead':
      return 'Lookahead: followed by'
    case 'negative-lookahead':
      return 'Negative lookahead: not followed by'
    case 'lookbehind':
      return 'Lookbehind: preceded by'
    case 'negative-lookbehind':
      return 'Negative lookbehind: not preceded by'
    case 'modifiers': {
      const names: Record<string, string> = { i: 'ignore case', m: 'multiline', s: 'dotAll' }
      const parts = [
        ...[...(group.add ?? '')].map((flag) => `${names[flag]} on`),
        ...[...(group.remove ?? '')].map((flag) => `${names[flag]} off`),
      ]
      return parts.length ? `Group with flags changed inside: ${parts.join(', ')}` : 'Group (non-capturing)'
    }
  }
}

export function explainPattern(pattern: string, parsed: ParsedPattern, flags: string): ExplainNode[] {
  const scope: Scope = {
    ignoreCase: flags.includes('i'),
    multiline: flags.includes('m'),
    dotAll: flags.includes('s'),
    unicode: parsed.unicodeMode,
    groups: parsed.groups,
  }
  const node = (label: string, from: { start: number; end: number }, children: ExplainNode[] = [], note?: string): ExplainNode => ({
    label,
    source: pattern.slice(from.start, from.end),
    start: from.start,
    end: from.end,
    note,
    children,
  })

  function disjunction(d: Disjunction, s: Scope): ExplainNode[] {
    if (d.alternatives.length === 1) return sequence(d.alternatives[0], s)
    return [
      node(
        `Either of ${d.alternatives.length} alternatives, tried left to right`,
        d,
        d.alternatives.map((alt, i) => {
          const items = sequence(alt, s)
          if (items.length === 0) return node(`Alternative ${i + 1}: nothing (always matches, empty)`, alt)
          return node(`Alternative ${i + 1}`, alt, items)
        }),
      ),
    ]
  }

  function sequence(seq: Sequence, s: Scope): ExplainNode[] {
    const out: ExplainNode[] = []
    let run: Char[] = []
    const flush = () => {
      if (run.length === 0) return
      if (run.length === 1) out.push(char(run[0], s))
      else {
        const text = run.map((c) => (c.value >= 0xd800 && c.value <= 0xdfff ? '�' : String.fromCodePoint(c.value))).join('')
        const visible = run.every((c) => !CONTROL_NAMES[c.value] || c.value === 0x20) && !/[\u0000-\u001f\u007f-\u009f]/.test(text)
        out.push(
          node(
            visible ? `Literal text "${text}"` : `Literal text of ${run.length} characters`,
            { start: run[0].start, end: run[run.length - 1].end },
            visible ? [] : run.map((c) => char(c, s)),
            s.ignoreCase ? 'Case-insensitive (i flag).' : undefined,
          ),
        )
      }
      run = []
    }
    for (const item of seq.items) {
      if (item.type === 'char') run.push(item)
      else {
        flush()
        out.push(...term(item, s))
      }
    }
    flush()
    return out
  }

  function char(c: Char, s: Scope): ExplainNode {
    const notes = [FORM_NOTES[c.form], s.ignoreCase && /\p{L}/u.test(String.fromCodePoint(c.value)) ? 'Case-insensitive (i flag).' : undefined]
    return node(`Character ${describeChar(c.value)}`, c, [], notes.filter(Boolean).join(' ') || undefined)
  }

  function term(n: Node, s: Scope): ExplainNode[] {
    switch (n.type) {
      case 'disjunction':
        return disjunction(n, s)
      case 'sequence':
        return sequence(n, s)
      case 'char':
        return [char(n, s)]
      case 'dot':
        return [
          node(
            s.dotAll ? 'Any character, including line terminators (s flag)' : 'Any character except line terminators (\\n, \\r, \\u2028, \\u2029)',
            n,
            [],
            s.unicode ? undefined : 'Without u or v, an emoji or other astral character counts as two (UTF-16 code units).',
          ),
        ]
      case 'anchor': {
        const labels = {
          start: s.multiline ? 'Start of a line (m flag)' : 'Start of the input',
          end: s.multiline ? 'End of a line (m flag)' : 'End of the input',
          'word-boundary': 'Word boundary: between a word character (\\w) and a non-word character',
          'not-word-boundary': 'Not a word boundary',
        }
        return [node(labels[n.kind], n)]
      }
      case 'class-escape':
        return [node(`${CLASS_ESCAPES[n.kind][0].toUpperCase()}${CLASS_ESCAPES[n.kind].slice(1)}`, n)]
      case 'property':
        return [node(propertyLabel(n), n)]
      case 'class':
        return [charClass(n, s)]
      case 'backreference': {
        const targets = n.name ? s.groups.filter((g) => g.name === n.name) : s.groups.filter((g) => g.index === n.index)
        const label = n.name ? `Back-reference: the same text group "${n.name}" matched` : `Back-reference: the same text group #${n.index} matched`
        const later = targets.length > 0 && targets.every((g) => g.start >= n.end)
        const inside = targets.some((g) => g.start < n.start && g.end > n.end)
        const note = later
          ? 'The group comes later in the pattern, so here it has not matched yet and this matches the empty string.'
          : inside
            ? 'This is inside the group it refers to, so it matches the empty string.'
            : s.ignoreCase
              ? 'Compared case-insensitively (i flag).'
              : undefined
        return [node(label, n, [], note)]
      }
      case 'quantifier':
        return [node(quantifierLabel(n), n, term(n.body, s))]
      case 'group': {
        let inner = s
        if (n.kind === 'modifiers') {
          inner = { ...s }
          for (const flag of n.add ?? '') setFlag(inner, flag, true)
          for (const flag of n.remove ?? '') setFlag(inner, flag, false)
        }
        const note = n.kind.includes('look')
          ? 'Checks without consuming characters; the engine does not backtrack into it once it succeeds.'
          : undefined
        const children = disjunction(n.body, inner)
        if (children.length === 0) children.push(node('Nothing (matches the empty string)', n.body))
        return [node(groupLabel(n), n, children, note)]
      }
    }
  }

  function charClass(c: CharClass, s: Scope): ExplainNode {
    const children = c.items.map((item) => classItem(item, s))
    let label: string
    if (c.items.length === 0) label = c.negated ? 'Any character at all (empty negated class)' : 'Nothing — an empty class never matches'
    else if (c.op === 'intersection') label = c.negated ? 'Any character not in all of these at once' : 'A character in all of these at once (intersection)'
    else if (c.op === 'subtraction') label = c.negated ? 'Any character not in the first set minus the rest' : 'A character in the first set but not in the others (subtraction)'
    else label = c.negated ? 'Any one character except' : 'One of'
    return node(label, c, children, s.ignoreCase && c.items.length ? 'Case-insensitive (i flag).' : undefined)
  }

  function classItem(item: ClassItem, s: Scope): ExplainNode {
    switch (item.type) {
      case 'char':
        return node(describeChar(item.value), item, [], FORM_NOTES[item.form])
      case 'range':
        return node(`Range ${describeChar(item.from.value)} to ${describeChar(item.to.value)}`, item)
      case 'class-escape':
        return node(CLASS_ESCAPES[item.kind], item)
      case 'property':
        return node(propertyLabel(item), item)
      case 'strings':
        return node(
          item.strings.length === 1 ? `The string "${item.strings[0]}"` : `One of the strings ${item.strings.map((t) => `"${t}"`).join(', ')}`,
          item,
          [],
          'Longest strings are tried first.',
        )
      case 'class':
        return charClass(item, s)
    }
  }

  return disjunction(parsed.ast, scope)
}

function setFlag(scope: Scope, flag: string, on: boolean) {
  if (flag === 'i') scope.ignoreCase = on
  if (flag === 'm') scope.multiline = on
  if (flag === 's') scope.dotAll = on
}

function propertyLabel(p: { negated: boolean; name?: string; value: string; strings: boolean }): string {
  const lead = p.negated ? 'A character without' : 'A character with'
  if (p.strings) return `An emoji sequence or string with property ${p.value} (v flag)`
  if (p.name === 'Script' || p.name === 'sc') return `${lead} Script=${p.value}`
  if (p.name === 'Script_Extensions' || p.name === 'scx') return `${lead} Script_Extensions=${p.value} (used by that script)`
  const category = GENERAL_CATEGORIES[p.value]
  if (p.name || category) return `${lead} General_Category=${category ? `${category} (${p.value})` : p.value}`
  return `${lead} Unicode property ${p.value}`
}

/**
 * A hand-written parser for ECMAScript 2025 regular expressions, including the
 * web-compat grammar of Annex B that applies without the u or v flag, RegExp
 * modifiers ((?i:…)), duplicate named groups in different alternatives, and the
 * v flag's class set syntax (nested classes, &&, --, \q{…}).
 *
 * It exists to explain patterns and spot risky shapes, not to run them: every
 * evaluation still happens in the worker. Validity is tested against the
 * engine itself (parser.test.ts), so when this parser rejects a pattern the
 * engine does too. The one table it borrows from the engine is the list of
 * Unicode property names and values (\p{…}): compiling `\p{Name}` on its own
 * is the only reliable source for the browser's Unicode version, and it runs
 * no user input against anything.
 */

import type {
  Backreference,
  Char,
  CharClass,
  ClassEscape,
  ClassItem,
  Disjunction,
  GroupInfo,
  Node,
  ParseResult,
  Property,
  Sequence,
  StringDisjunction,
} from './ast'

/** Properties of strings, allowed with the v flag only and never negated. */
export const STRING_PROPERTIES = new Set([
  'Basic_Emoji',
  'Emoji_Keycap_Sequence',
  'RGI_Emoji_Modifier_Sequence',
  'RGI_Emoji_Flag_Sequence',
  'RGI_Emoji_Tag_Sequence',
  'RGI_Emoji_ZWJ_Sequence',
  'RGI_Emoji',
])

const NAMED_PROPERTIES = new Set(['General_Category', 'gc', 'Script', 'sc', 'Script_Extensions', 'scx'])

/** Deep nesting is legal but explaining it would overflow the stack. */
export const MAX_DEPTH = 400

const SYNTAX_CHARS = new Set('^$\\.*+?()[]{}|')
const CLASS_SET_SYNTAX = new Set('()[]{}/-\\|')
const CLASS_SET_RESERVED_DOUBLE = new Set('&!#$%*+,.:;<=>?@^`~')
const CLASS_SET_RESERVED_PUNCT = new Set('&-!#%,:;<=>@`~')

const propertyCache = new Map<string, boolean>()

function engineKnowsProperty(text: string, flags: 'u' | 'v'): boolean {
  const key = `${flags}:${text}`
  let known = propertyCache.get(key)
  if (known === undefined) {
    try {
      new RegExp(`\\p{${text}}`, flags)
      known = true
    } catch {
      known = false
    }
    propertyCache.set(key, known)
  }
  return known
}

let idStart: RegExp | null = null
let idContinue: RegExp | null = null

function isIdStart(cp: number): boolean {
  if (cp === 0x24 || cp === 0x5f) return true
  idStart ??= /^\p{ID_Start}$/u
  return idStart.test(String.fromCodePoint(cp))
}

function isIdContinue(cp: number): boolean {
  if (cp === 0x24 || cp === 0x200c || cp === 0x200d) return true
  idContinue ??= /^\p{ID_Continue}$/u
  return idContinue.test(String.fromCodePoint(cp))
}

const isDigit = (c: string | undefined) => c !== undefined && c >= '0' && c <= '9'
const isOctal = (c: string | undefined) => c !== undefined && c >= '0' && c <= '7'
const isHex = (c: string | undefined) => c !== undefined && /^[0-9a-fA-F]$/.test(c)
const isAsciiLetter = (c: string | undefined) => c !== undefined && /^[A-Za-z]$/.test(c)

class SyntaxFailure extends Error {
  constructor(message: string, readonly index: number) {
    super(message)
  }
}

interface PreScan {
  groups: number
  named: boolean
}

/**
 * Counts capturing groups the way engines do before parsing: Annex B decides
 * whether \12 is a back-reference or an octal escape by the total, and whether
 * \k is special by the presence of any named group.
 */
function preScan(src: string, vMode: boolean): PreScan {
  let groups = 0
  let named = false
  let classDepth = 0
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (c === '\\') {
      i++
      continue
    }
    if (classDepth > 0) {
      if (c === ']') classDepth--
      else if (c === '[' && vMode) classDepth++
      continue
    }
    if (c === '[') classDepth = 1
    else if (c === '(') {
      if (src[i + 1] !== '?') groups++
      else if (src[i + 2] === '<' && src[i + 3] !== '=' && src[i + 3] !== '!') {
        groups++
        named = true
      }
    }
  }
  return { groups, named }
}

interface NamedGroupRecord {
  name: string
  start: number
  /** (disjunction id, alternative index) pairs from the root down. */
  path: [number, number][]
}

class Parser {
  pos = 0
  readonly uMode: boolean
  readonly vMode: boolean
  readonly totalGroups: number
  readonly namedGroups: boolean
  groupCount = 0
  readonly groups: GroupInfo[] = []
  readonly named: NamedGroupRecord[] = []
  readonly namedRefs: { name: string; index: number }[] = []
  readonly path: [number, number][] = []
  disjunctionId = 0
  depth = 0

  constructor(readonly src: string, flags: string) {
    this.vMode = flags.includes('v')
    this.uMode = this.vMode || flags.includes('u')
    const scan = preScan(src, this.vMode)
    this.totalGroups = scan.groups
    // u/v mode always parses \k<name>; Annex B only once a named group exists.
    this.namedGroups = this.uMode || scan.named
  }

  fail(message: string, index = this.pos): never {
    throw new SyntaxFailure(message, index)
  }

  peek(offset = 0): string | undefined {
    return this.src[this.pos + offset]
  }

  eat(text: string): boolean {
    if (this.src.startsWith(text, this.pos)) {
      this.pos += text.length
      return true
    }
    return false
  }

  /** One source character: a code point in u/v mode, else a code unit. */
  readSourceChar(): number {
    if (this.uMode) {
      const cp = this.src.codePointAt(this.pos)!
      this.pos += cp > 0xffff ? 2 : 1
      return cp
    }
    return this.src.charCodeAt(this.pos++)
  }

  parsePattern(): ParseResult {
    try {
      const ast = this.parseDisjunction()
      if (this.pos < this.src.length) {
        this.fail(this.peek() === ')' ? "Unmatched ')'" : 'Unexpected character')
      }
      for (const ref of this.namedRefs) {
        if (!this.named.some((group) => group.name === ref.name)) {
          this.fail('Invalid named capture referenced', ref.index)
        }
      }
      this.checkDuplicateNames()
      return {
        ok: true,
        pattern: { ast, groups: this.groups, unicodeMode: this.uMode, unicodeSets: this.vMode },
      }
    } catch (error) {
      if (error instanceof SyntaxFailure) return { ok: false, error: { message: error.message, index: error.index } }
      if (error instanceof RangeError) return { ok: false, error: { message: 'Pattern too deeply nested to explain', index: 0 } }
      throw error
    }
  }

  checkDuplicateNames() {
    for (let i = 0; i < this.named.length; i++) {
      for (let j = i + 1; j < this.named.length; j++) {
        const a = this.named[i]
        const b = this.named[j]
        if (a.name !== b.name) continue
        // They can't both participate only if some disjunction holds them in
        // different alternatives.
        const exclusive = a.path.some(([id, alt]) => b.path.some(([otherId, otherAlt]) => otherId === id && otherAlt !== alt))
        if (!exclusive) this.fail('Duplicate capture group name', b.start)
      }
    }
  }

  parseDisjunction(): Disjunction {
    if (++this.depth > MAX_DEPTH) this.fail('Pattern too deeply nested to explain')
    const start = this.pos
    const id = this.disjunctionId++
    const alternatives: Sequence[] = []
    let index = 0
    for (;;) {
      this.path.push([id, index])
      alternatives.push(this.parseAlternative())
      this.path.pop()
      if (this.peek() !== '|') break
      this.pos++
      index++
    }
    this.depth--
    return { type: 'disjunction', start, end: this.pos, alternatives }
  }

  parseAlternative(): Sequence {
    const start = this.pos
    const items: Node[] = []
    while (this.pos < this.src.length && this.peek() !== '|' && this.peek() !== ')') {
      items.push(this.parseTerm())
    }
    return { type: 'sequence', start, end: this.pos, items }
  }

  parseTerm(): Node {
    const start = this.pos
    const c = this.peek()!
    let atom: Node
    let quantifiable = true

    if (c === '^' || c === '$') {
      this.pos++
      atom = { type: 'anchor', kind: c === '^' ? 'start' : 'end', start, end: this.pos }
      quantifiable = false
    } else if (c === '\\' && (this.peek(1) === 'b' || this.peek(1) === 'B')) {
      this.pos += 2
      atom = { type: 'anchor', kind: this.src[start + 1] === 'b' ? 'word-boundary' : 'not-word-boundary', start, end: this.pos }
      quantifiable = false
    } else if (c === '(') {
      const group = this.parseGroup()
      atom = group
      if (group.kind === 'lookbehind' || group.kind === 'negative-lookbehind') quantifiable = false
      // Annex B lets a lookahead take a quantifier, but only without u/v.
      if ((group.kind === 'lookahead' || group.kind === 'negative-lookahead') && this.uMode) quantifiable = false
    } else if (c === '.') {
      this.pos++
      atom = { type: 'dot', start, end: this.pos }
    } else if (c === '[') {
      atom = this.parseClass()
    } else if (c === '\\') {
      atom = this.parseAtomEscape()
    } else if (c === '*' || c === '+' || c === '?') {
      this.fail('Nothing to repeat')
    } else if (c === '{') {
      if (this.uMode) this.fail(this.bracedQuantifierAhead() ? 'Nothing to repeat' : 'Lone quantifier brackets')
      if (this.bracedQuantifierAhead()) this.fail('Nothing to repeat')
      this.pos++
      atom = { type: 'char', value: 0x7b, form: 'literal', start, end: this.pos }
    } else if (c === ']' || c === '}') {
      if (this.uMode) this.fail('Lone quantifier brackets')
      this.pos++
      atom = { type: 'char', value: c.charCodeAt(0), form: 'literal', start, end: this.pos }
    } else {
      const value = this.readSourceChar()
      atom = { type: 'char', value, form: 'literal', start, end: this.pos }
    }

    const quantifier = this.parseQuantifier()
    if (!quantifier) return atom
    if (!quantifiable) this.fail('Nothing to repeat', start)
    return { type: 'quantifier', ...quantifier, body: atom, start, end: this.pos }
  }

  /** Whether `{n}`, `{n,}` or `{n,m}` starts here. */
  bracedQuantifierAhead(): boolean {
    return /^\{\d+(?:,\d*)?\}/.test(this.src.slice(this.pos, this.pos + 40)) || this.longBraced()
  }

  longBraced(): boolean {
    // Digit runs longer than the 40-character window above.
    let i = this.pos + 1
    if (!isDigit(this.src[i])) return false
    while (isDigit(this.src[i])) i++
    if (this.src[i] === ',') {
      i++
      while (isDigit(this.src[i])) i++
    }
    return this.src[i] === '}'
  }

  parseQuantifier(): { min: number; max: number; lazy: boolean } | null {
    const c = this.peek()
    let min: number
    let max: number
    if (c === '*') {
      min = 0
      max = Infinity
      this.pos++
    } else if (c === '+') {
      min = 1
      max = Infinity
      this.pos++
    } else if (c === '?') {
      min = 0
      max = 1
      this.pos++
    } else if (c === '{') {
      if (!this.bracedQuantifierAhead()) {
        if (this.uMode) this.fail('Incomplete quantifier')
        return null
      }
      const open = this.pos
      this.pos++
      min = this.readNumber()
      max = min
      if (this.eat(',')) max = isDigit(this.peek()) ? this.readNumber() : Infinity
      this.pos++ // }
      if (min > max) this.fail('numbers out of order in {} quantifier', open)
    } else {
      return null
    }
    const lazy = this.eat('?')
    return { min, max, lazy }
  }

  readNumber(): number {
    const start = this.pos
    while (isDigit(this.peek())) this.pos++
    // Engines clamp huge counts; 2^31-1 is V8's ceiling and plenty for comparing.
    return Math.min(Number(this.src.slice(start, this.pos)), 2 ** 31 - 1)
  }

  parseGroup(): Node & { type: 'group' } {
    const start = this.pos
    this.pos++ // (
    let kind: 'capture' | 'noncapture' | 'lookahead' | 'negative-lookahead' | 'lookbehind' | 'negative-lookbehind' | 'modifiers'
    let name: string | undefined
    let add: string | undefined
    let remove: string | undefined
    let index: number | undefined

    if (this.eat('?')) {
      if (this.eat('=')) kind = 'lookahead'
      else if (this.eat('!')) kind = 'negative-lookahead'
      else if (this.eat('<=')) kind = 'lookbehind'
      else if (this.eat('<!')) kind = 'negative-lookbehind'
      else if (this.eat(':')) kind = 'noncapture'
      else if (this.eat('<')) {
        kind = 'capture'
        name = this.parseGroupName()
        this.named.push({ name, start, path: this.path.map(([id, alt]) => [id, alt] as [number, number]) })
      } else if (/[ims-]/.test(this.peek() ?? '')) {
        kind = 'modifiers'
        ;({ add, remove } = this.parseModifiers())
      } else {
        this.fail('Invalid group')
      }
    } else {
      kind = 'capture'
    }

    let info: GroupInfo | undefined
    if (kind === 'capture') {
      index = ++this.groupCount
      info = { index, name, start, end: start }
      this.groups.push(info)
    }
    const body = this.parseDisjunction()
    if (!this.eat(')')) this.fail('Unterminated group', start)
    if (info) info.end = this.pos
    return { type: 'group', kind, index, name, add, remove, body, start, end: this.pos }
  }

  parseModifiers(): { add: string; remove: string } {
    const flagStart = this.pos
    let add = ''
    let remove = ''
    while (/[ims]/.test(this.peek() ?? '')) add += this.src[this.pos++]
    const dash = this.eat('-')
    if (dash) while (/[ims]/.test(this.peek() ?? '')) remove += this.src[this.pos++]
    if (!this.eat(':')) this.fail('Invalid group')
    const all = add + remove
    if (new Set(all).size !== all.length) this.fail('Repeated flag in modifiers group', flagStart)
    if (dash && all.length === 0) this.fail('Invalid group', flagStart)
    return { add, remove }
  }

  /** RegExpIdentifierName between `<` and `>`; the `<` is already consumed. */
  parseGroupName(): string {
    const start = this.pos
    let name = ''
    let first = true
    for (;;) {
      if (this.pos >= this.src.length) this.fail('Invalid capture group name', start)
      if (this.peek() === '>') {
        if (first) this.fail('Invalid capture group name', start)
        this.pos++
        return name
      }
      let cp: number
      if (this.peek() === '\\') {
        this.pos++
        if (this.peek() !== 'u') this.fail('Invalid capture group name', start)
        this.pos++
        const escaped = this.parseUnicodeEscapeBody(true, true)
        if (escaped === null) this.fail('Invalid capture group name', start)
        cp = escaped
      } else {
        // Names always read code points, even without the u flag.
        cp = this.src.codePointAt(this.pos)!
        this.pos += cp > 0xffff ? 2 : 1
      }
      if (cp >= 0xd800 && cp <= 0xdfff) this.fail('Invalid capture group name', start)
      if (first ? !isIdStart(cp) : !isIdContinue(cp)) this.fail('Invalid capture group name', start)
      name += String.fromCodePoint(cp)
      first = false
    }
  }

  /**
   * After `\u`: XXXX (joining an escaped surrogate pair when `unicode`) or,
   * with `unicode`, {X…}. Returns null when malformed; position is then undefined.
   */
  parseUnicodeEscapeBody(unicode: boolean, joinPairs: boolean): number | null {
    if (unicode && this.peek() === '{') {
      this.pos++
      const start = this.pos
      while (isHex(this.peek())) this.pos++
      if (start === this.pos || this.peek() !== '}') return null
      const value = parseInt(this.src.slice(start, this.pos), 16)
      this.pos++
      return value > 0x10ffff ? null : value
    }
    const hex = this.src.slice(this.pos, this.pos + 4)
    if (!/^[0-9a-fA-F]{4}$/.test(hex)) return null
    this.pos += 4
    const value = parseInt(hex, 16)
    if (joinPairs && value >= 0xd800 && value <= 0xdbff && this.src.startsWith('\\u', this.pos)) {
      const trail = this.src.slice(this.pos + 2, this.pos + 6)
      if (/^[0-9a-fA-F]{4}$/.test(trail)) {
        const low = parseInt(trail, 16)
        if (low >= 0xdc00 && low <= 0xdfff) {
          this.pos += 6
          return (value - 0xd800) * 0x400 + (low - 0xdc00) + 0x10000
        }
      }
    }
    return value
  }

  parseAtomEscape(): Node {
    const start = this.pos
    this.pos++ // backslash
    if (this.pos >= this.src.length) this.fail('\\ at end of pattern', start)
    const c = this.peek()!

    if (c >= '1' && c <= '9') {
      const digitsStart = this.pos
      const n = this.readNumber()
      if (n <= this.totalGroups) {
        const ref: Backreference = { type: 'backreference', index: n, start, end: this.pos }
        return ref
      }
      if (this.uMode) this.fail('Invalid escape', start)
      this.pos = digitsStart
      if (c === '8' || c === '9') {
        this.pos++
        return { type: 'char', value: c.charCodeAt(0), form: 'identity', start, end: this.pos }
      }
      return this.legacyOctal(start)
    }
    if (c === 'k' && this.namedGroups) {
      this.pos++
      if (!this.eat('<')) this.fail('Invalid named reference', start)
      const name = this.parseGroupName()
      this.namedRefs.push({ name, index: start })
      return { type: 'backreference', name, start, end: this.pos }
    }
    if ('dDsSwW'.includes(c)) {
      this.pos++
      return { type: 'class-escape', kind: c as ClassEscape['kind'], start, end: this.pos }
    }
    if ((c === 'p' || c === 'P') && this.uMode) {
      return this.parseProperty(start, false)
    }
    return this.parseCharacterEscape(start, false)
  }

  legacyOctal(start: number): Char {
    // \0-\377, longest match first, as Annex B's LegacyOctalEscapeSequence.
    let text = this.src[this.pos++]
    if (isOctal(this.peek())) {
      text += this.src[this.pos++]
      if (text[0] <= '3' && isOctal(this.peek())) text += this.src[this.pos++]
    }
    return { type: 'char', value: parseInt(text, 8), form: 'octal', start, end: this.pos }
  }

  /**
   * CharacterEscape after the backslash (the backslash is at `start`). Used
   * outside classes and inside non-v classes; `inClass` enables the
   * class-only forms Annex B adds.
   */
  parseCharacterEscape(start: number, inClass: boolean): Char {
    const c = this.peek()!
    const char = (value: number, form: Char['form']): Char => ({ type: 'char', value, form, start, end: this.pos })

    switch (c) {
      case 'f': this.pos++; return char(0x0c, 'control')
      case 'n': this.pos++; return char(0x0a, 'control')
      case 'r': this.pos++; return char(0x0d, 'control')
      case 't': this.pos++; return char(0x09, 'control')
      case 'v': this.pos++; return char(0x0b, 'control')
      case 'c': {
        const next = this.peek(1)
        if (isAsciiLetter(next)) {
          this.pos += 2
          return char(next!.charCodeAt(0) % 32, 'control')
        }
        if (inClass && !this.uMode && (isDigit(next) || next === '_')) {
          this.pos += 2
          return char(next!.charCodeAt(0) % 32, 'control')
        }
        if (this.uMode) this.fail('Invalid unicode escape', start)
        // Annex B: a lone \c is a literal backslash; the c is read next.
        return { type: 'char', value: 0x5c, form: 'identity', start, end: this.pos }
      }
      case '0':
        if (!isDigit(this.peek(1))) {
          this.pos++
          return char(0, 'null')
        }
        if (this.uMode) this.fail('Invalid decimal escape', start)
        return this.legacyOctal(start)
      case 'x':
        if (isHex(this.peek(1)) && isHex(this.peek(2))) {
          this.pos += 3
          return char(parseInt(this.src.slice(this.pos - 2, this.pos), 16), 'hex')
        }
        if (this.uMode) this.fail('Invalid escape', start)
        this.pos++
        return char(0x78, 'identity')
      case 'u': {
        this.pos++
        const save = this.pos
        const value = this.parseUnicodeEscapeBody(this.uMode, this.uMode)
        if (value === null) {
          if (this.uMode) this.fail('Invalid Unicode escape', start)
          this.pos = save
          return char(0x75, 'identity')
        }
        return char(value, 'unicode')
      }
    }

    if (inClass && isDigit(c)) {
      if (this.uMode) this.fail('Invalid class escape', start)
      if (c === '8' || c === '9') {
        this.pos++
        return char(c.charCodeAt(0), 'identity')
      }
      return this.legacyOctal(start)
    }

    if (this.uMode) {
      if (SYNTAX_CHARS.has(c) || c === '/' || (inClass && c === '-')) {
        this.pos++
        return char(c.charCodeAt(0), 'escape')
      }
      this.fail(inClass ? 'Invalid class escape' : 'Invalid escape', start)
    }
    if (c === 'k' && this.namedGroups) this.fail('Invalid named reference', start)
    const value = this.readSourceChar()
    return char(value, SYNTAX_CHARS.has(c) || c === '/' || c === '-' ? 'escape' : 'identity')
  }

  parseProperty(start: number, inClass: boolean): Property {
    const negated = this.src[this.pos] === 'P'
    this.pos++
    if (!this.eat('{')) this.fail('Invalid property name', start)
    const bodyStart = this.pos
    while (/[A-Za-z0-9_=]/.test(this.peek() ?? '')) this.pos++
    const body = this.src.slice(bodyStart, this.pos)
    if (!this.eat('}')) this.fail('Invalid property name', start)
    const parts = body.split('=')
    if (parts.length > 2 || parts.some((part) => part === '')) this.fail('Invalid property name', start)
    let strings = false
    if (parts.length === 2) {
      if (!NAMED_PROPERTIES.has(parts[0]) || !engineKnowsProperty(body, 'u')) this.fail('Invalid property name', start)
    } else if (!engineKnowsProperty(body, 'u')) {
      if (this.vMode && STRING_PROPERTIES.has(body) && engineKnowsProperty(body, 'v')) strings = true
      else this.fail('Invalid property name', start)
    }
    if (strings && negated) this.fail('Invalid property name', start)
    void inClass
    return {
      type: 'property',
      negated,
      name: parts.length === 2 ? parts[0] : undefined,
      value: parts.length === 2 ? parts[1] : parts[0],
      strings,
      start,
      end: this.pos,
    }
  }

  parseClass(): CharClass {
    if (this.vMode) {
      const cls = this.parseClassV()
      return cls
    }
    const start = this.pos
    this.pos++ // [
    const negated = this.eat('^')
    const items: ClassItem[] = []
    for (;;) {
      if (this.pos >= this.src.length) this.fail('Unterminated character class', start)
      if (this.peek() === ']') {
        this.pos++
        break
      }
      const a = this.parseClassAtom()
      if (this.peek() === '-' && this.peek(1) !== ']' && this.pos + 1 < this.src.length) {
        const dash = this.pos
        this.pos++
        const b = this.parseClassAtom()
        if (a.type !== 'char' || b.type !== 'char') {
          if (this.uMode) this.fail('Invalid character class', a.start)
          items.push(a, { type: 'char', value: 0x2d, form: 'literal', start: dash, end: dash + 1 }, b)
          continue
        }
        if (a.value > b.value) this.fail('Range out of order in character class', a.start)
        items.push({ type: 'range', from: a, to: b, start: a.start, end: b.end })
        continue
      }
      items.push(a)
    }
    return { type: 'class', negated, op: 'union', items, start, end: this.pos }
  }

  parseClassAtom(): Char | ClassEscape | Property {
    const start = this.pos
    if (this.peek() !== '\\') {
      const value = this.readSourceChar()
      return { type: 'char', value, form: 'literal', start, end: this.pos }
    }
    this.pos++
    if (this.pos >= this.src.length) this.fail('\\ at end of pattern', start)
    const c = this.peek()!
    if (c === 'b') {
      this.pos++
      return { type: 'char', value: 8, form: 'backspace', start, end: this.pos }
    }
    if ('dDsSwW'.includes(c)) {
      this.pos++
      return { type: 'class-escape', kind: c as ClassEscape['kind'], start, end: this.pos }
    }
    if ((c === 'p' || c === 'P') && this.uMode) return this.parseProperty(start, true)
    return this.parseCharacterEscape(start, true)
  }

  // ---- v flag: class set expressions ----

  parseClassV(): CharClass {
    if (++this.depth > MAX_DEPTH) this.fail('Pattern too deeply nested to explain')
    const start = this.pos
    this.pos++ // [
    const negated = this.eat('^')
    let op: CharClass['op'] = 'union'
    const items: ClassItem[] = []

    if (this.peek() !== ']') {
      const first = this.parseClassSetOperand(true)
      items.push(first)
      if (this.src.startsWith('&&', this.pos) || this.src.startsWith('--', this.pos)) {
        op = this.src.startsWith('&&', this.pos) ? 'intersection' : 'subtraction'
        const token = op === 'intersection' ? '&&' : '--'
        if (first.type === 'range') this.fail('Invalid set operation in character class', first.start)
        for (;;) {
          if (!this.eat(token)) this.fail('Invalid set operation in character class')
          if (op === 'intersection' && this.peek() === '&') this.fail('Invalid character in character class')
          items.push(this.parseClassSetOperand(false))
          if (this.peek() === ']') break
          if (this.pos >= this.src.length) this.fail('Unterminated character class', start)
        }
      } else {
        for (;;) {
          if (this.pos >= this.src.length) this.fail('Unterminated character class', start)
          if (this.peek() === ']') break
          if (this.src.startsWith('&&', this.pos) || this.src.startsWith('--', this.pos)) {
            this.fail('Invalid set operation in character class')
          }
          items.push(this.parseClassSetOperand(true))
        }
      }
    }
    if (!this.eat(']')) this.fail('Unterminated character class', start)
    const cls: CharClass = { type: 'class', negated, op, items, start, end: this.pos }
    if (negated && mayContainStrings(cls, true)) this.fail('Negated character class may contain strings', start)
    this.depth--
    return cls
  }

  parseClassSetOperand(allowRange: boolean): ClassItem {
    const start = this.pos
    if (this.pos >= this.src.length) this.fail('Unterminated character class')
    const c = this.peek()
    if (c === '[') return this.parseClassV()
    if (c === '\\') {
      const next = this.peek(1)
      if (next === 'q') {
        this.pos += 2
        if (!this.eat('{')) this.fail('Invalid escape', start)
        return this.parseStringDisjunction(start)
      }
      if (next !== undefined && 'dDsSwW'.includes(next)) {
        this.pos += 2
        return { type: 'class-escape', kind: next as ClassEscape['kind'], start, end: this.pos }
      }
      if (next === 'p' || next === 'P') {
        this.pos++
        return this.parseProperty(start, true)
      }
    }
    const from = this.parseClassSetCharacter()
    if (allowRange && this.peek() === '-' && this.peek(1) !== '-') {
      this.pos++
      const to = this.parseClassSetCharacter()
      if (from.value > to.value) this.fail('Range out of order in character class', from.start)
      return { type: 'range', from, to, start: from.start, end: to.end }
    }
    return from
  }

  parseClassSetCharacter(): Char {
    const start = this.pos
    if (this.pos >= this.src.length) this.fail('Unterminated character class')
    const c = this.peek()!
    if (c === this.peek(1) && CLASS_SET_RESERVED_DOUBLE.has(c)) this.fail('Invalid set operation in character class')
    if (c === '\\') {
      this.pos++
      if (this.pos >= this.src.length) this.fail('\\ at end of pattern', start)
      const e = this.peek()!
      if (e === 'b') {
        this.pos++
        return { type: 'char', value: 8, form: 'backspace', start, end: this.pos }
      }
      if (CLASS_SET_RESERVED_PUNCT.has(e)) {
        this.pos++
        return { type: 'char', value: e.charCodeAt(0), form: 'escape', start, end: this.pos }
      }
      if (isDigit(e) && e !== '0') this.fail('Invalid class escape', start)
      return this.parseCharacterEscape(start, false)
    }
    if (CLASS_SET_SYNTAX.has(c)) this.fail('Invalid character in character class')
    const value = this.readSourceChar()
    return { type: 'char', value, form: 'literal', start, end: this.pos }
  }

  parseStringDisjunction(start: number): StringDisjunction {
    const strings: string[] = []
    let current = ''
    for (;;) {
      if (this.pos >= this.src.length) this.fail('Unterminated character class', start)
      const c = this.peek()
      if (c === '}') {
        this.pos++
        strings.push(current)
        break
      }
      if (c === '|') {
        this.pos++
        strings.push(current)
        current = ''
        continue
      }
      current += String.fromCodePoint(this.parseClassSetCharacter().value)
    }
    return { type: 'strings', strings, start, end: this.pos }
  }
}

/** MayContainStrings from the spec, for the v flag's negation rule. */
export function mayContainStrings(item: ClassItem, ignoreOwnNegation = false): boolean {
  switch (item.type) {
    case 'strings':
      return item.strings.some((text) => [...text].length !== 1)
    case 'property':
      return item.strings
    case 'class': {
      if (item.negated && !ignoreOwnNegation) return false
      if (item.op === 'union') return item.items.some((child) => mayContainStrings(child))
      if (item.op === 'intersection') return item.items.every((child) => mayContainStrings(child))
      return item.items.length > 0 && mayContainStrings(item.items[0])
    }
    default:
      return false
  }
}

const VALID_FLAGS = /^[dgimsuvy]*$/

export function parseRegex(pattern: string, flags: string): ParseResult {
  if (!VALID_FLAGS.test(flags) || new Set(flags).size !== flags.length || (flags.includes('u') && flags.includes('v'))) {
    return { ok: false, error: { message: 'Invalid flags', index: 0 } }
  }
  return new Parser(pattern, flags).parsePattern()
}

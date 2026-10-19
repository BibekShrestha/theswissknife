"""
Builds src/tools/unicode/names/table.ts, the Unicode inspector's character
names, from a pinned source: the Unicode Character Database 16.0.0 as shipped
in CPython 3.14's `unicodedata` module. Nothing is downloaded.

    npm run unicode-names            # or: PYTHON=/path/to/python3.14 npm run unicode-names

One-shot, like the icon font: commit the output. The script refuses to run on
any other UCD version, so the committed table can only change on purpose.

What is stored, and what is not:
  - Every explicit name (about 34k) as one string, sorted by code point, one
    line per name: `<gap>;<shared>;<suffix>` where <gap> is the code point
    distance from the previous name minus one and <shared> is how many leading
    characters the name shares with the previous one (both base 36, empty for
    zero). Front coding roughly halves what gzip has to do.
  - Names that are a prefix plus the code point in hex (rule NR2 in Unicode
    §4.8: CJK ideographs, Egyptian hieroglyphs extended, Khitan, Nushu, Tangut)
    as [first, last, prefix] runs instead of 100k lines.
  - Hangul syllables (rule NR1) are computed in names.ts.
  - Controls have no Name property; their `control` aliases (NameAliases.txt)
    are listed here by hand and each one is checked with unicodedata.lookup.

CPython leaves Tangut ideographs unnamed (it implements NR2 only for CJK), so
assigned letters in the Tangut blocks are given the Tangut prefix; any other
unnamed assigned character fails the build.
"""

import json
import os
import re
import zlib
import sys
import unicodedata

PINNED = '16.0.0'
HERE = os.path.join(os.path.dirname(__file__), '..', 'src', 'tools', 'unicode', 'names')
OUT = os.path.join(HERE, 'table.ts')
# Read only by names.test.ts: the decoded table must reproduce every name.
CHECK = os.path.join(HERE, 'table.check.json')

if unicodedata.unidata_version != PINNED:
    sys.exit(
        f'unicode-names: this Python ships UCD {unicodedata.unidata_version}, the table is pinned to {PINNED}.\n'
        'Run it with CPython 3.14 (PYTHON=/path/to/python3.14 npm run unicode-names).'
    )

CONTROLS = {
    0x00: 'NULL', 0x01: 'START OF HEADING', 0x02: 'START OF TEXT', 0x03: 'END OF TEXT',
    0x04: 'END OF TRANSMISSION', 0x05: 'ENQUIRY', 0x06: 'ACKNOWLEDGE', 0x07: 'ALERT',
    0x08: 'BACKSPACE', 0x09: 'CHARACTER TABULATION', 0x0A: 'LINE FEED', 0x0B: 'LINE TABULATION',
    0x0C: 'FORM FEED', 0x0D: 'CARRIAGE RETURN', 0x0E: 'SHIFT OUT', 0x0F: 'SHIFT IN',
    0x10: 'DATA LINK ESCAPE', 0x11: 'DEVICE CONTROL ONE', 0x12: 'DEVICE CONTROL TWO',
    0x13: 'DEVICE CONTROL THREE', 0x14: 'DEVICE CONTROL FOUR', 0x15: 'NEGATIVE ACKNOWLEDGE',
    0x16: 'SYNCHRONOUS IDLE', 0x17: 'END OF TRANSMISSION BLOCK', 0x18: 'CANCEL',
    0x19: 'END OF MEDIUM', 0x1A: 'SUBSTITUTE', 0x1B: 'ESCAPE', 0x1C: 'INFORMATION SEPARATOR FOUR',
    0x1D: 'INFORMATION SEPARATOR THREE', 0x1E: 'INFORMATION SEPARATOR TWO',
    0x1F: 'INFORMATION SEPARATOR ONE', 0x7F: 'DELETE',
    0x80: 'PADDING CHARACTER', 0x81: 'HIGH OCTET PRESET', 0x82: 'BREAK PERMITTED HERE',
    0x83: 'NO BREAK HERE', 0x84: 'INDEX', 0x85: 'NEXT LINE', 0x86: 'START OF SELECTED AREA',
    0x87: 'END OF SELECTED AREA', 0x88: 'CHARACTER TABULATION SET',
    0x89: 'CHARACTER TABULATION WITH JUSTIFICATION', 0x8A: 'LINE TABULATION SET',
    0x8B: 'PARTIAL LINE FORWARD', 0x8C: 'PARTIAL LINE BACKWARD', 0x8D: 'REVERSE LINE FEED',
    0x8E: 'SINGLE SHIFT TWO', 0x8F: 'SINGLE SHIFT THREE', 0x90: 'DEVICE CONTROL STRING',
    0x91: 'PRIVATE USE ONE', 0x92: 'PRIVATE USE TWO', 0x93: 'SET TRANSMIT STATE',
    0x94: 'CANCEL CHARACTER', 0x95: 'MESSAGE WAITING', 0x96: 'START OF GUARDED AREA',
    0x97: 'END OF GUARDED AREA', 0x98: 'START OF STRING', 0x99: 'SINGLE GRAPHIC CHARACTER INTRODUCER',
    0x9A: 'SINGLE CHARACTER INTRODUCER', 0x9B: 'CONTROL SEQUENCE INTRODUCER',
    0x9C: 'STRING TERMINATOR', 0x9D: 'OPERATING SYSTEM COMMAND', 0x9E: 'PRIVACY MESSAGE',
    0x9F: 'APPLICATION PROGRAM COMMAND',
}

TANGUT_BLOCKS = [(0x17000, 0x187FF), (0x18D00, 0x18D7F)]


def b36(n):
    digits = '0123456789abcdefghijklmnopqrstuvwxyz'
    out = ''
    while True:
        n, r = divmod(n, 36)
        out = digits[r] + out
        if not n:
            return out


def main():
    for cp, alias in CONTROLS.items():
        if unicodedata.category(chr(cp)) != 'Cc':
            sys.exit(f'unicode-names: U+{cp:04X} is not a control')
        if unicodedata.lookup(alias) != chr(cp):
            sys.exit(f'unicode-names: alias {alias!r} does not resolve to U+{cp:04X}')
    controls_total = sum(1 for cp in range(0x110000) if unicodedata.category(chr(cp)) == 'Cc')
    if controls_total != len(CONTROLS):
        sys.exit(f'unicode-names: {controls_total} controls, {len(CONTROLS)} aliases')

    explicit = []
    runs = []  # [first, last, prefix]
    hangul = 0

    def add_run(cp, prefix):
        if runs and runs[-1][2] == prefix and runs[-1][1] == cp - 1:
            runs[-1][1] = cp
        else:
            runs.append([cp, cp, prefix])

    for cp in range(0x110000):
        ch = chr(cp)
        name = unicodedata.name(ch, None)
        cat = unicodedata.category(ch)
        if name is None:
            if cat in ('Cc', 'Cn', 'Co', 'Cs'):
                continue
            if cat == 'Lo' and any(lo <= cp <= hi for lo, hi in TANGUT_BLOCKS):
                add_run(cp, 'TANGUT IDEOGRAPH-')
                continue
            sys.exit(f'unicode-names: U+{cp:04X} is assigned ({cat}) but has no name')
        match = re.fullmatch(r'(.*-)([0-9A-F]{4,6})', name)
        if match and int(match.group(2), 16) == cp:
            add_run(cp, match.group(1))
            continue
        if 0xAC00 <= cp <= 0xD7A3 and name.startswith('HANGUL SYLLABLE '):
            hangul += 1
            continue
        if not re.fullmatch(r'[A-Z0-9 -]+', name):
            sys.exit(f'unicode-names: unexpected character in {name!r}')
        explicit.append((cp, name))

    if hangul != 0xD7A3 - 0xAC00 + 1:
        sys.exit(f'unicode-names: {hangul} Hangul syllables')

    # Every name the table yields (explicit, prefix runs, Hangul, Tangut), in
    # code point order, as `<HEX>;<NAME>\n` - CRC-32 and count for the test.
    crc = 0
    named = 0
    for cp in range(0x110000):
        name = unicodedata.name(chr(cp), None)
        if name is None and any(a <= cp <= b and p == 'TANGUT IDEOGRAPH-' for a, b, p in runs):
            name = f'TANGUT IDEOGRAPH-{cp:X}'
        if name is None:
            continue
        crc = zlib.crc32(f'{cp:X};{name}\n'.encode('ascii'), crc)
        named += 1

    lines = []
    prev_cp = -1
    prev_name = ''
    for cp, name in explicit:
        gap = cp - prev_cp - 1
        shared = 0
        limit = min(len(name), len(prev_name))
        while shared < limit and name[shared] == prev_name[shared]:
            shared += 1
        lines.append(f"{b36(gap) if gap else ''};{b36(shared) if shared else ''};{name[shared:]}")
        prev_cp, prev_name = cp, name

    ranges = ',\n'.join(f"  [0x{a:X}, 0x{b:X}, '{p}']" for a, b, p in runs)
    controls = '\n'.join(f'{cp:x};{alias}' for cp, alias in CONTROLS.items())
    body = '\n'.join(lines)

    with open(OUT, 'w', encoding='ascii', newline='\n') as out:
        out.write(
            '// Generated by scripts/unicode-names.py - do not edit.\n'
            f'// Source: Unicode Character Database {PINNED}, as shipped in CPython 3.14 unicodedata.\n'
            f'// {len(explicit)} explicit names, {len(runs)} prefix runs, Hangul computed, {len(CONTROLS)} control aliases.\n\n'
            f"export const NAMES_VERSION = '{PINNED}'\n\n"
            '/** [first, last, prefix]: the name is prefix + the code point in hex (Unicode rule NR2). */\n'
            f'export const RANGES: readonly (readonly [number, number, string])[] = [\n{ranges},\n]\n\n'
            '/** `<hex>;<alias>` per line: the control-type name aliases from NameAliases.txt. */\n'
            f'export const CONTROLS = `{controls}`\n\n'
            '/** `<gap>;<shared>;<suffix>` per line, front-coded, base 36, decoded by names.ts. */\n'
            f'export const NAMES = `{body}`\n'
        )
    with open(CHECK, 'w', encoding='ascii', newline='\n') as out:
        json.dump({'version': PINNED, 'named': named, 'crc32': crc, 'controls': len(CONTROLS)}, out, indent=2)
        out.write('\n')
    print(f'unicode-names: wrote {len(explicit)} names, {len(runs)} runs to {os.path.relpath(OUT)}')


main()

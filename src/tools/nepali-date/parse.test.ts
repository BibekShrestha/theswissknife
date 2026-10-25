import { describe, expect, it } from 'vitest'
import { parseBs } from './parse'

const KARTIK_8 = { year: 2082, month: 7, day: 8 }

describe('parseBs', () => {
  it.each([
    '2082-07-08', '2082/7/8', '2082.07.08', '2082 7 8', ' 2082-7-08 ', '2082-07-08 BS',
    '२०८२-०७-०८', '8 Kartik 2082', 'Kartik 8, 2082', '2082 Kartik 8', 'kartika 8 2082',
    '२०८२ कार्तिक ८ गते', '८ कार्तिक २०८२', 'वि.सं. २०८२ कात्तिक ८', '8 Kartik, 2082 B.S.',
  ])('reads %s', (text) => {
    expect(parseBs(text)).toEqual({ ok: true, date: KARTIK_8 })
  })

  it('knows the other spellings', () => {
    expect(parseBs('1 Baishakh 2081')).toEqual({ ok: true, date: { year: 2081, month: 1, day: 1 } })
    expect(parseBs('15 Ashadh 2081')).toEqual({ ok: true, date: { year: 2081, month: 3, day: 15 } })
    expect(parseBs('1 Saun 2082')).toEqual({ ok: true, date: { year: 2082, month: 4, day: 1 } })
    expect(parseBs('1 Ashwin 2082')).toEqual({ ok: true, date: { year: 2082, month: 6, day: 1 } })
    expect(parseBs('1 Push 2082')).toEqual({ ok: true, date: { year: 2082, month: 9, day: 1 } })
    expect(parseBs('1 Phagun 2082')).toEqual({ ok: true, date: { year: 2082, month: 11, day: 1 } })
    expect(parseBs('चैत ३० २०८३')).toEqual({ ok: true, date: { year: 2083, month: 12, day: 30 } })
  })

  it('says what is wrong', () => {
    expect(parseBs('')).toEqual({ ok: false, error: 'Enter a BS date.' })
    expect(parseBs('8/7/2082')).toMatchObject({ ok: false, error: expect.stringMatching(/Day-first/) })
    expect(parseBs('2084-01-01')).toMatchObject({ ok: false, error: expect.stringMatching(/2000–2083/) })
    expect(parseBs('2082-07-31')).toEqual({ ok: false, error: 'Kartik 2082 has 30 days.' })
    expect(parseBs('2082-13-01')).toMatchObject({ ok: false, error: expect.stringMatching(/1–12/) })
    expect(parseBs('8 Octember 2082')).toMatchObject({ ok: false, error: expect.stringMatching(/not a BS month/) })
    expect(parseBs('Kartik 2082')).toMatchObject({ ok: false, error: expect.stringMatching(/year first/) })
    expect(parseBs('x'.repeat(100))).toMatchObject({ ok: false })
  })
})

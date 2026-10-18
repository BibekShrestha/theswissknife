import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CheatsheetDrawer } from './components/CheatsheetDrawer'

const noop = () => {}

describe('JQ-4: the closed Reference drawer', () => {
  it('takes its controls out of the tab order', () => {
    const closed = renderToStaticMarkup(<CheatsheetDrawer open={false} onClose={noop} onInsert={noop} />)
    // aria-hidden alone hides it from screen readers but Tab still lands in it.
    expect(closed).toMatch(/<aside[^>]*\binert=""/)
  })

  it('is interactive when open', () => {
    const open = renderToStaticMarkup(<CheatsheetDrawer open onClose={noop} onInsert={noop} />)
    expect(open).not.toMatch(/<aside[^>]*\binert/)
    expect(open).not.toMatch(/<aside[^>]*aria-hidden="true"/)
  })
})

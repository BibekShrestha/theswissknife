// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { renderMarkdown } from '../render/render'
import { buildHtml } from './buildHtml'
import { findFile, localizeHtml, localPath, markdownRef, type LocalFile } from './files'

const local = (path: string, type = 'image/png'): LocalFile => {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const file = new File(['x'], name, { type })
  return { path, name, type, size: 1, file, url: `blob:test/${path}` }
}

describe('localPath', () => {
  it('reads relative references as plain paths', () => {
    expect(localPath('plot.png')).toBe('plot.png')
    expect(localPath('./img/plot.png')).toBe('img/plot.png')
    expect(localPath('../img/plot.png?v=2#x')).toBe('img/plot.png')
    expect(localPath('/img/plot.png')).toBe('img/plot.png')
    expect(localPath('img%20dir/my%20plot.png')).toBe('img dir/my plot.png')
    expect(localPath('img\\plot.png')).toBe('img/plot.png')
    expect(localPath('100%.png')).toBe('100%.png')
  })

  it('ignores anything that is not a local file', () => {
    for (const ref of ['https://ex.com/a.png', '//ex.com/a.png', 'data:image/png;base64,AA', 'blob:x', 'mailto:a@b', '#top', '', '  ', './', '..'])
      expect(localPath(ref), ref).toBeNull()
  })
})

describe('findFile', () => {
  const files = [local('logo.png'), local('docs/img/plot.png'), local('a/icon.svg'), local('b/icon.svg')]

  it('matches by path, then path suffix, then unique name', () => {
    expect(findFile(files, 'logo.png')?.path).toBe('logo.png')
    expect(findFile(files, 'img/plot.png')?.path).toBe('docs/img/plot.png')
    expect(findFile(files, '../../docs/img/plot.png')?.path).toBe('docs/img/plot.png')
    expect(findFile(files, 'assets/logo.png')?.path).toBe('logo.png')
    expect(findFile(files, 'PLOT.PNG')?.path).toBe('docs/img/plot.png')
    expect(findFile(files, 'b/icon.svg')?.path).toBe('b/icon.svg')
  })

  it('refuses to guess between two files of the same name', () => {
    expect(findFile(files, 'icon.svg')).toBeUndefined()
    expect(findFile(files, 'https://ex.com/logo.png')).toBeUndefined()
  })
})

describe('localizeHtml', () => {
  const files = [local('plot.png'), local('spec.pdf', 'application/pdf')]

  it('points Markdown images and raw <img> at the attachments, and lists the rest', () => {
    const { html } = renderMarkdown('![a plot](./plot.png)\n\n<img src="plot.png">\n\n![gone](missing.png) ![](https://ex.com/r.png) ![](missing.png)')
    const out = localizeHtml(html, files, (f) => f.url)
    expect(out.html.match(/src="blob:test\/plot\.png"/g)).toHaveLength(2)
    expect(out.html).toContain('src="https://ex.com/r.png"')
    expect(out.missing).toEqual(['missing.png'])
  })

  it('resolves names with spaces that marked percent-encodes', () => {
    const { html } = renderMarkdown('![x](<my plot.png>)')
    expect(localizeHtml(html, [local('my plot.png')], (f) => f.url).html).toContain('src="blob:test/my plot.png"')
  })

  it('rewrites links only when asked, and leaves anchors alone', () => {
    const { html } = renderMarkdown('[spec](spec.pdf) [top](#top)')
    expect(localizeHtml(html, files, (f, kind) => kind === 'a' ? f.url : null).html).toContain('href="blob:test/spec.pdf"')
    expect(localizeHtml(html, files, () => null).html).toBe(html)
    expect(localizeHtml(html, files, (f) => f.url).html).toContain('href="#top"')
  })

  it('reports missing images even with nothing attached', () => {
    expect(localizeHtml('<p><img src="a.png"></p>', [], () => null).missing).toEqual(['a.png'])
    expect(localizeHtml('<p>no images</p>', [], () => null).missing).toEqual([])
  })

  it('keeps data: image URLs in the export', () => {
    const body = localizeHtml('<img src="plot.png">', files, () => 'data:image/png;base64,eA==').html
    expect(buildHtml({ title: 't', body, css: '' })).toContain('<img src="data:image/png;base64,eA==">')
  })
})

describe('markdownRef', () => {
  it('writes an image or a link, encoding what would break the target', () => {
    expect(markdownRef(local('my plot (1).png'))).toBe('![my plot (1)](my%20plot%20%281%29.png)')
    expect(markdownRef(local('spec.pdf', 'application/pdf'))).toBe('[spec.pdf](spec.pdf)')
  })
})

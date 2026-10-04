/** First-visit document: shows every feature once, and reads as instructions. */
export const SAMPLE = `# Markdown preview & export

Write on the left, read on the right. **Export HTML** gives you one
self-contained file; **Print / PDF** opens your browser's print dialog —
choose *Save as PDF* there. Nothing you type leaves this device.

## Formatting

Everything GitHub understands: **bold**, *italic*, ~~strikethrough~~,
\`inline code\`, [links](https://theswissknife.com) and footnotes.[^local]

> Blockquotes keep their rule in print.

- [x] Task lists
- [x] Tables, with header rows that repeat across printed pages
- [ ] Your document here

| Paper  | Size (mm)   | Common in        |
|--------|-------------|------------------|
| A4     | 210 × 297   | Most of the world |
| Letter | 216 × 279   | US and Canada    |

## Code

\`\`\`ts
// Highlighted without a 300 KB grammar bundle
export function greet(name: string): string {
  return \`Hello, \${name}!\`
}
\`\`\`

## Math

Inline $e^{i\\pi} + 1 = 0$, or a display block:

$$
\\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}
$$

## Diagrams

\`\`\`mermaid
flowchart LR
  A[Markdown] --> B(Preview)
  B --> C[HTML file]
  B --> D[PDF]
\`\`\`

[^local]: Rendering, math and diagrams all run in your browser.
`

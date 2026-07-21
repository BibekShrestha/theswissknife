export type PdfToolId =
  | 'merge' | 'split' | 'rotate' | 'remove-pages' | 'reorder'
  | 'pdf-to-image' | 'image-to-pdf' | 'pdf-to-text'
  | 'compress' | 'page-numbers' | 'watermark'
  | 'protect' | 'unlock'

export type PdfCategory = 'organize' | 'convert' | 'edit' | 'security'

export interface PdfToolMeta {
  id: PdfToolId
  name: string
  description: string
  category: PdfCategory
  icon: string
  color: string
}

export const pdfTools: PdfToolMeta[] = [
  { id: 'merge', name: 'Merge PDF', description: 'Combine multiple PDFs into one document', category: 'organize', icon: 'merge', color: '#dc2626' },
  { id: 'split', name: 'Split PDF', description: 'Extract pages or split into multiple files', category: 'organize', icon: 'content_cut', color: '#ea580c' },
  { id: 'remove-pages', name: 'Remove Pages', description: 'Delete unwanted pages from your PDF', category: 'organize', icon: 'delete', color: '#e11d48' },
  { id: 'rotate', name: 'Rotate PDF', description: 'Rotate pages to the correct orientation', category: 'organize', icon: 'rotate_right', color: '#0891b2' },
  { id: 'reorder', name: 'Reorder Pages', description: 'Rearrange PDF pages in any order', category: 'edit', icon: 'swap_vert', color: '#d946ef' },
  { id: 'pdf-to-image', name: 'PDF to Image', description: 'Convert PDF pages to images', category: 'convert', icon: 'image', color: '#16a34a' },
  { id: 'image-to-pdf', name: 'Image to PDF', description: 'Convert images to a PDF document', category: 'convert', icon: 'photo_library', color: '#059669' },
  { id: 'pdf-to-text', name: 'PDF to Text', description: 'Extract text content from PDF files', category: 'convert', icon: 'text_snippet', color: '#64748b' },
  { id: 'compress', name: 'Compress PDF', description: 'Reduce file size while maintaining quality', category: 'edit', icon: 'compress', color: '#2563eb' },
  { id: 'page-numbers', name: 'Page Numbers', description: 'Add page numbers to your PDF', category: 'edit', icon: 'format_list_numbered', color: '#d97706' },
  { id: 'watermark', name: 'Watermark', description: 'Add text or image watermark to PDF', category: 'edit', icon: 'water_drop', color: '#0d9488' },
  { id: 'protect', name: 'Protect PDF', description: 'Add password protection to your PDF', category: 'security', icon: 'lock', color: '#9333ea' },
  { id: 'unlock', name: 'Unlock PDF', description: 'Remove password from protected PDF', category: 'security', icon: 'lock_open', color: '#db2777' },
]

export const categories: { id: PdfCategory; name: string; description: string }[] = [
  { id: 'organize', name: 'Organize PDF', description: 'Merge, split, and arrange your PDF pages' },
  { id: 'convert', name: 'Convert PDF', description: 'Transform PDFs to and from other formats' },
  { id: 'edit', name: 'Edit PDF', description: 'Compress, add watermarks, and modify PDFs' },
  { id: 'security', name: 'PDF Security', description: 'Protect and unlock PDF documents' },
]

export function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

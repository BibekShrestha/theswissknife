import { degrees, type PDFImage, type PDFPage, type PDFPageDrawSVGOptions, type PDFPageDrawTextOptions } from 'pdf-lib'

/**
 * A page as the reader sees it: the crop box (what viewers show), turned by
 * the page's /Rotate. Drawing in pdf-lib happens in unrotated user space
 * starting at the media box origin, so text placed at "bottom centre" of
 * getSize() lands on the side of a rotated page, sideways, and off the
 * visible area of a page whose boxes do not start at 0,0. This converts
 * from viewer coordinates (origin bottom-left of the visible page, y up).
 */
export interface ViewFrame {
  width: number
  height: number
  /** Draw text whose baseline starts at viewer point (x, y). */
  drawText: (text: string, x: number, y: number, options: Omit<PDFPageDrawTextOptions, 'x' | 'y' | 'rotate'>) => void
  /** Draw an image whose bottom-left corner is at viewer point (x, y), upright as the reader sees the page. */
  drawImage: (image: PDFImage, x: number, y: number, width: number, height: number) => void
  /** Draw an SVG path (y down) whose origin is viewer point (x, y). */
  drawSvgPath: (path: string, x: number, y: number, options: Omit<PDFPageDrawSVGOptions, 'x' | 'y' | 'rotate'>) => void
}

export function viewFrame(page: PDFPage): ViewFrame {
  const box = page.getCropBox()
  const rotation = (((page.getRotation().angle % 360) + 360) % 360) as 0 | 90 | 180 | 270
  const quarter = rotation === 90 || rotation === 270
  const toUser = (x: number, y: number): [number, number] => {
    switch (rotation) {
      case 90: return [box.x + box.width - y, box.y + x]
      case 180: return [box.x + box.width - x, box.y + box.height - y]
      case 270: return [box.x + y, box.y + box.height - x]
      default: return [box.x + x, box.y + y]
    }
  }
  return {
    width: quarter ? box.height : box.width,
    height: quarter ? box.width : box.height,
    drawText(text, x, y, options) {
      const [ux, uy] = toUser(x, y)
      page.drawText(text, { ...options, x: ux, y: uy, rotate: degrees(rotation) })
    },
    drawImage(image, x, y, width, height) {
      const [ux, uy] = toUser(x, y)
      page.drawImage(image, { x: ux, y: uy, width, height, rotate: degrees(rotation) })
    },
    drawSvgPath(path, x, y, options) {
      const [ux, uy] = toUser(x, y)
      page.drawSvgPath(path, { ...options, x: ux, y: uy, rotate: degrees(rotation) })
    },
  }
}

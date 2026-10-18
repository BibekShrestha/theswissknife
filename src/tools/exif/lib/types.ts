export type Format = 'jpeg' | 'png' | 'webp' | 'gif' | 'heif'

export type BlockKind =
  | 'exif'
  | 'xmp'
  | 'iptc'
  | 'photoshop'
  | 'icc'
  | 'mpf'
  | 'comment'
  | 'text'
  | 'time'
  | 'thumbnail'
  | 'trailing'
  | 'other'

export interface Row {
  key: string
  value: string
  /** Identifies the photographer, the camera or the place. */
  sensitive?: boolean
}

export interface Section {
  title: string
  rows: Row[]
}

/** One piece of metadata as the container stores it (a JPEG segment group, a PNG chunk, a HEIF item…). */
export interface Block {
  kind: BlockKind
  /** "EXIF", "XMP (extended)", "ICC colour profile"… */
  label: string
  /** Where it lives: "APP1 segment at 0x2", "eXIf chunk", "Exif item 3". */
  where: string
  size: number
  sections: Section[]
  /** Metadata inside this block's own payload — the IFD1 thumbnail's EXIF, an appended JPEG's. */
  nested?: Block[]
  note?: string
  /** A HEIF item whose payload is all zeros: the entry is still there but carries nothing. */
  empty?: boolean
  /** Why this block's bytes could not be located to remove them (a HEIF item with no usable iloc extent). Never counts as clean. */
  unremovable?: string
  /** An EXIF block holding IFD0 Orientation and nothing else — what "Keep orientation" writes. */
  orientationOnly?: boolean
}

export interface Gps {
  lat: number
  lon: number
  /** metres; negative below sea level */
  alt?: number
}

export interface Analysis {
  format: Format
  /** "JPEG", "PNG", "HEIF (heic)", "AVIF"… */
  formatLabel: string
  mime: string
  size: number
  width?: number
  height?: number
  blocks: Block[]
  /** Headline facts pulled from every block. */
  summary: Row[]
  gps?: Gps
  orientation?: number
  warnings: string[]
  /** SHA-256 (hex) of the image data — every byte that is not metadata. */
  imageDigest: string
  imageBytes: number
}

export interface StripOptions {
  keepOrientation: boolean
  keepIcc: boolean
}

export interface Stripped {
  bytes: Uint8Array<ArrayBuffer>
  /** What was taken out, in file order. */
  removed: string[]
  /** What was deliberately left in. */
  kept: string[]
}

export interface Processed {
  before: Analysis
  after: Analysis
  bytes: Uint8Array<ArrayBuffer>
  removed: string[]
  kept: string[]
  /** Blocks the re-parse of the output still finds, other than those kept on purpose. */
  remaining: Block[]
  /** before.imageDigest === after.imageDigest */
  identical: boolean
}

// Regenerates the Apple-written fixtures from plain.pdf (macOS PDFKit and
// CoreGraphics), so the tools are tested against files they did not write:
//
//   swift make-fixtures.swift plain.pdf .
//
//   rc4-128-objstm.pdf      PDFKit, user "user pw" + owner "owner pw" — RC4-128 (V2 R3), object + xref streams
//   rc4-128-owner-only.pdf  PDFKit, owner "owner pw" only — opens with no password
//   rc4-40.pdf              CoreGraphics, 40-bit key — RC4-40 (V2 R3)
//   aes-128.pdf             CoreGraphics, 128-bit key — AES-128 (V4 R4, AESV2)
//   pdfkit-resaved.pdf      PDFKit, no password — plain.pdf re-saved the way Preview does,
//                           which leaves its old object stream behind (see lib/parse.ts)
//
// plain.pdf is three 300×400 pages reading "Hello page 1" … "Hello page 3",
// written by pdf-lib.
import Foundation
import PDFKit
import CoreGraphics

let args = CommandLine.arguments
let input = URL(fileURLWithPath: args[1])
let outDir = URL(fileURLWithPath: args[2])

let doc = PDFDocument(url: input)!
doc.write(to: outDir.appendingPathComponent("rc4-128-objstm.pdf"),
          withOptions: [.userPasswordOption: "user pw", .ownerPasswordOption: "owner pw"])

PDFDocument(url: input)!.write(to: outDir.appendingPathComponent("pdfkit-resaved.pdf"))

let ownerOnly = PDFDocument(url: input)!
ownerOnly.write(to: outDir.appendingPathComponent("rc4-128-owner-only.pdf"),
                withOptions: [.ownerPasswordOption: "owner pw"])

func coreGraphics(_ name: String, _ keyLength: Int) {
  let src = CGPDFDocument(input as CFURL)!
  let aux: [CFString: Any] = [
    kCGPDFContextUserPassword: "user pw",
    kCGPDFContextOwnerPassword: "owner pw",
    kCGPDFContextEncryptionKeyLength: keyLength,
  ]
  var box = src.page(at: 1)!.getBoxRect(.mediaBox)
  let ctx = CGContext(outDir.appendingPathComponent(name) as CFURL, mediaBox: &box, aux as CFDictionary)!
  for i in 1...src.numberOfPages {
    let page = src.page(at: i)!
    var b = page.getBoxRect(.mediaBox)
    ctx.beginPage(mediaBox: &b)
    ctx.drawPDFPage(page)
    ctx.endPage()
  }
  ctx.closePDF()
}
coreGraphics("rc4-40.pdf", 40)
coreGraphics("aes-128.pdf", 128)

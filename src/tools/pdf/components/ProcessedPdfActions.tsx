import { useState } from 'react'
import { saveAs } from 'file-saver'
import { PdfPreviewModal } from './PdfPreviewModal'

interface ProcessedPdfActionsProps {
  fileName: string
  outputBytes: Uint8Array
}

export function ProcessedPdfActions({ fileName, outputBytes }: ProcessedPdfActionsProps) {
  const [preview, setPreview] = useState(false)

  return (
    <div className="pdf-processed">
      <div className="pdf-processed-header">
        <span className="material-symbols-outlined">check_circle</span>
        <div className="pdf-processed-info">
          <h4>Ready!</h4>
          <p>{fileName}</p>
        </div>
      </div>
      <div className="pdf-processed-actions">
        <button className="pdf-processed-download" onClick={handleDownload}>
          <span className="material-symbols-outlined">download</span> Download
        </button>
        <button className="pdf-processed-preview" onClick={() => setPreview(true)}>
          <span className="material-symbols-outlined">visibility</span> Preview
        </button>
      </div>
      {preview && (
        <PdfPreviewModal
          bytes={outputBytes}
          fileName={fileName}
          onClose={() => setPreview(false)}
        />
      )}
    </div>
  )

  function handleDownload() {
    const blob = new Blob([outputBytes as unknown as BlobPart], { type: 'application/pdf' })
    saveAs(blob, fileName)
  }
}

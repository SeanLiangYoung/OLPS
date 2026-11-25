import mammoth from 'mammoth'
import { PDFParse } from 'pdf-parse'
import * as XLSX from 'xlsx'

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  if (dot < 0) {
    return ''
  }
  return fileName.slice(dot).toLowerCase()
}

export async function extractTextFromSource(bytes: Buffer, fileName: string): Promise<string> {
  const ext = extensionOf(fileName)
  if (ext === '.txt' || ext === '.md' || ext === '.csv') {
    return bytes.toString('utf8')
  }
  if (ext === '.docx') {
    const result = await mammoth.extractRawText({ buffer: bytes })
    return result.value
  }
  if (ext === '.xlsx') {
    const workbook = XLSX.read(bytes, { type: 'buffer' })
    const chunks: string[] = []
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName]
      if (!sheet) {
        continue
      }
      const csv = XLSX.utils.sheet_to_csv(sheet)
      if (csv.trim()) {
        chunks.push(`## ${sheetName}\n\n${csv}`)
      }
    }
    return chunks.join('\n\n')
  }
  if (ext === '.pdf') {
    const parser = new PDFParse({ data: bytes })
    const parsed = await parser.getText()
    await parser.destroy()
    return parsed.text
  }
  throw new Error(`unsupported text extension: ${ext}`)
}
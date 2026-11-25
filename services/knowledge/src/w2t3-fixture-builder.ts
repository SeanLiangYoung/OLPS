import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Document, Packer, Paragraph, TextRun } from 'docx'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import sharp from 'sharp'
import * as XLSX from 'xlsx'

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const W2T3_FIXTURE_DIR = path.join(PACKAGE_ROOT, 'test-fixtures', 'w2t3')

export type W2T3FixtureFiles = {
  dir: string
  files: Record<string, string>
}

async function writeIfMissing(filePath: string, bytes: Buffer): Promise<void> {
  try {
    await fs.access(filePath)
  } catch {
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, bytes)
  }
}

export async function ensureW2T3Fixtures(): Promise<W2T3FixtureFiles> {
  const dir = W2T3_FIXTURE_DIR
  await fs.mkdir(dir, { recursive: true })

  const mapping: Record<string, string> = {}

  const plain = async (name: string, text: string) => {
    const filePath = path.join(dir, name)
    await writeIfMissing(filePath, Buffer.from(text, 'utf8'))
    mapping[name] = filePath
  }

  await plain('sample.txt', 'plain-text-body\n')
  await plain('sample.md', '# heading\n\nmarkdown-body\n')
  await plain('sample.csv', 'col1,col2\na,b\n')

  const doc = new Document({
    sections: [
      {
        children: [new Paragraph({ children: [new TextRun('docx-extracted-text')] })],
      },
    ],
  })
  await writeIfMissing(path.join(dir, 'sample.docx'), Buffer.from(await Packer.toBuffer(doc)))
  mapping['sample.docx'] = path.join(dir, 'sample.docx')

  const workbook = XLSX.utils.book_new()
  const sheet = XLSX.utils.aoa_to_sheet([
    ['name', 'qty'],
    ['widget', '3'],
  ])
  XLSX.utils.book_append_sheet(workbook, sheet, 'Sheet1')
  const xlsxBytes = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer
  await writeIfMissing(path.join(dir, 'sample.xlsx'), xlsxBytes)
  mapping['sample.xlsx'] = path.join(dir, 'sample.xlsx')

  const pdf = await PDFDocument.create()
  const page = pdf.addPage()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  page.drawText('pdf-extracted-text', { x: 50, y: page.getHeight() - 50, size: 12, font })
  await writeIfMissing(path.join(dir, 'sample.pdf'), Buffer.from(await pdf.save()))
  mapping['sample.pdf'] = path.join(dir, 'sample.pdf')

  const png = await sharp({
    create: { width: 11, height: 9, channels: 3, background: '#4488cc' },
  })
    .png()
    .toBuffer()
  await writeIfMissing(path.join(dir, 'sample.png'), png)
  mapping['sample.png'] = path.join(dir, 'sample.png')

  const jpg = await sharp({
    create: { width: 13, height: 7, channels: 3, background: '#cc8844' },
  })
    .jpeg()
    .toBuffer()
  await writeIfMissing(path.join(dir, 'sample.jpg'), jpg)
  mapping['sample.jpg'] = path.join(dir, 'sample.jpg')

  await writeIfMissing(
    path.join(dir, 'sample.jpeg'),
    await sharp({
      create: { width: 5, height: 5, channels: 3, background: '#111111' },
    })
      .jpeg()
      .toBuffer(),
  )
  mapping['sample.jpeg'] = path.join(dir, 'sample.jpeg')

  await writeIfMissing(
    path.join(dir, 'sample.webp'),
    await sharp({
      create: { width: 6, height: 8, channels: 3, background: '#222222' },
    })
      .webp()
      .toBuffer(),
  )
  mapping['sample.webp'] = path.join(dir, 'sample.webp')

  await writeIfMissing(
    path.join(dir, 'sample.gif'),
    await sharp({
      create: { width: 4, height: 4, channels: 4, background: '#333333' },
    })
      .gif()
      .toBuffer(),
  )
  mapping['sample.gif'] = path.join(dir, 'sample.gif')

  const svg = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="12"></svg>',
    'utf8',
  )
  await writeIfMissing(path.join(dir, 'sample.svg'), svg)
  mapping['sample.svg'] = path.join(dir, 'sample.svg')

  const mp4 = Buffer.from('w2t3-mp4-placeholder-not-a-real-video', 'utf8')
  await writeIfMissing(path.join(dir, 'sample.mp4'), mp4)
  mapping['sample.mp4'] = path.join(dir, 'sample.mp4')

  const webm = Buffer.from('w2t3-webm-placeholder-not-a-real-video', 'utf8')
  await writeIfMissing(path.join(dir, 'sample.webm'), webm)
  mapping['sample.webm'] = path.join(dir, 'sample.webm')

  await plain('unknown.foo', 'skipped-binary\n')

  return { dir, files: mapping }
}

export async function readFixtureBytes(fixtureKey: keyof Awaited<ReturnType<typeof ensureW2T3Fixtures>>['files'] | string): Promise<Buffer> {
  const filePath = path.join(W2T3_FIXTURE_DIR, fixtureKey)
  return fs.readFile(filePath)
}
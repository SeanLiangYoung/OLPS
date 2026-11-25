import { fromBuffer, type Entry, type ZipFile } from 'yauzl'
import { ImportPathError, normalizeSourceRelativePath } from './import-path.js'

export class ImportZipError extends Error {
  readonly code: 'import_invalid_zip' | 'import_empty_package' | 'import_invalid_path' | 'import_total_size_exceeded' | 'import_file_size_exceeded'
  constructor(code: ImportZipError['code'], message: string) {
    super(message)
    this.code = code
  }
}

export type ExtractedZipFile = {
  relativePath: string
  bytes: Buffer
}

function assertZipEntryPath(fileName: string): string {
  try {
    return normalizeSourceRelativePath(fileName)
  } catch (err) {
    if (err instanceof ImportPathError) {
      throw new ImportZipError('import_invalid_path', err.message)
    }
    throw err
  }
}

export async function extractZipFiles(
  zipBytes: Buffer,
  limits: { importMaxBytes: number; singleFileMaxBytes: number },
): Promise<ExtractedZipFile[]> {
  let zip: ZipFile
  try {
    zip = await new Promise<ZipFile>((resolve, reject) => {
      fromBuffer(
        zipBytes,
        { lazyEntries: true, validateEntrySizes: true, strictFileNames: false },
        (error, opened) => (error ? reject(error) : resolve(opened)),
      )
    })
  } catch {
    throw new ImportZipError('import_invalid_zip', 'zip parse failed')
  }

  const files: ExtractedZipFile[] = []
  let totalBytes = 0

  return new Promise((resolve, reject) => {
    function fail(error: unknown): void {
      zip.close()
      reject(error)
    }

    zip.on('error', (error) => {
      const message = error instanceof Error ? error.message : String(error)
      if (/relative path/i.test(message) || message.includes('..')) {
        fail(new ImportZipError('import_invalid_path', message))
        return
      }
      fail(new ImportZipError('import_invalid_zip', message))
    })
    zip.on('end', () => {
      if (files.length === 0) {
        fail(new ImportZipError('import_empty_package', 'zip has no file entries'))
        return
      }
      resolve(files)
    })

    zip.on('entry', (entry: Entry) => {
      async function consume(): Promise<void> {
        if (entry.fileName.endsWith('/')) {
          return
        }
        if (entry.isEncrypted()) {
          throw new ImportZipError('import_invalid_zip', 'encrypted zip entry')
        }
        const relativePath = assertZipEntryPath(entry.fileName)
        if (entry.uncompressedSize > limits.singleFileMaxBytes) {
          throw new ImportZipError('import_file_size_exceeded', `file too large: ${relativePath}`)
        }
        if (totalBytes + entry.uncompressedSize > limits.importMaxBytes) {
          throw new ImportZipError('import_total_size_exceeded', 'zip total size exceeded')
        }

        const stream = await new Promise<NodeJS.ReadableStream>((resolveStream, rejectStream) => {
          zip.openReadStream(entry, (error, opened) => (error ? rejectStream(error) : resolveStream(opened)))
        })

        const chunks: Buffer[] = []
        let length = 0
        for await (const chunk of stream) {
          const buffer = Buffer.from(chunk)
          length += buffer.length
          if (length > limits.singleFileMaxBytes) {
            throw new ImportZipError('import_file_size_exceeded', `file too large: ${relativePath}`)
          }
          if (totalBytes + length > limits.importMaxBytes) {
            throw new ImportZipError('import_total_size_exceeded', 'zip total size exceeded')
          }
          chunks.push(buffer)
        }

        totalBytes += length
        files.push({
          relativePath,
          bytes: Buffer.concat(chunks),
        })
      }

      void consume().then(() => zip.readEntry(), fail)
    })

    zip.readEntry()
  })
}
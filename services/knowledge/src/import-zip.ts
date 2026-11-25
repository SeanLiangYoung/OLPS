import fs from 'node:fs/promises'
import path from 'node:path'
import { createWriteStream } from 'node:fs'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fromBuffer, fromFd, type Entry, type ZipFile } from 'yauzl'
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
  bytes?: Buffer
  /** 落在磁盘上的绝对路径；与 bytes 二选一 */
  filePath?: string
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

export async function extractZipFromFilePath(
  zipFilePath: string,
  outputDir: string,
  limits: { importMaxBytes: number; singleFileMaxBytes: number },
): Promise<ExtractedZipFile[]> {
  const handle = await fs.open(zipFilePath, 'r')
  let zip: ZipFile
  try {
    zip = await new Promise<ZipFile>((resolve, reject) => {
      fromFd(
        handle.fd,
        { lazyEntries: true, validateEntrySizes: true, strictFileNames: false },
        (error, opened) => (error ? reject(error) : resolve(opened)),
      )
    })
  } catch {
    await handle.close()
    throw new ImportZipError('import_invalid_zip', 'zip parse failed')
  }

  const files: ExtractedZipFile[] = []
  let totalBytes = 0
  await fs.mkdir(outputDir, { recursive: true })

  try {
    await new Promise<void>((resolve, reject) => {
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
        resolve()
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

          const abs = path.join(outputDir, ...relativePath.split('/'))
          await fs.mkdir(path.dirname(abs), { recursive: true })
          let length = 0
          const counter = new Transform({
            transform(chunk, _encoding, callback) {
              length += chunk.length
              if (length > limits.singleFileMaxBytes) {
                callback(new ImportZipError('import_file_size_exceeded', `file too large: ${relativePath}`))
                return
              }
              if (totalBytes + length > limits.importMaxBytes) {
                callback(new ImportZipError('import_total_size_exceeded', 'zip total size exceeded'))
                return
              }
              callback(null, chunk)
            },
          })
          await pipeline(stream, counter, createWriteStream(abs))
          totalBytes += length
          files.push({ relativePath, filePath: abs })
        }

        void consume().then(() => zip.readEntry(), fail)
      })

      zip.readEntry()
    })
  } finally {
    await handle.close()
  }

  return files
}
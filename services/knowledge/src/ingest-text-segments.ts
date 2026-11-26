/** 超过该长度则走分段多轮产品识别 */
export const INGEST_SEGMENT_THRESHOLD_CHARS = 24_000
/** 单段目标长度 */
export const INGEST_SEGMENT_SIZE_CHARS = 16_000

/**
 * 将抽出文本切成多段，优先在标题行、换页符、段落边界切断。
 */
export function segmentExtractedText(
  text: string,
  segmentSize = INGEST_SEGMENT_SIZE_CHARS,
): string[] {
  const normalized = text.replace(/\r\n/g, '\n').trim()
  if (!normalized) {
    return ['']
  }
  if (normalized.length <= segmentSize) {
    return [normalized]
  }

  const segments: string[] = []
  let cursor = 0
  while (cursor < normalized.length) {
    const hardEnd = Math.min(normalized.length, cursor + segmentSize)
    if (hardEnd >= normalized.length) {
      segments.push(normalized.slice(cursor).trim())
      break
    }
    const window = normalized.slice(cursor, hardEnd)
    const breakAt = findPreferBreak(window)
    const end = cursor + (breakAt > segmentSize * 0.4 ? breakAt : window.length)
    const piece = normalized.slice(cursor, end).trim()
    if (piece) {
      segments.push(piece)
    }
    cursor = end
    while (cursor < normalized.length && /\s/.test(normalized[cursor]!)) {
      cursor += 1
    }
  }
  return segments.length > 0 ? segments : [normalized]
}

function findPreferBreak(window: string): number {
  const markers = ['\n# ', '\n## ', '\n### ', '\f', '\n\n']
  let best = -1
  for (const marker of markers) {
    const idx = window.lastIndexOf(marker)
    if (idx > best) {
      best = idx + (marker === '\f' ? 1 : 0)
    }
  }
  if (best >= 0) {
    return best
  }
  const lineBreak = window.lastIndexOf('\n')
  return lineBreak > 0 ? lineBreak : -1
}

export function slugifyProductKey(raw: string): string {
  const trimmed = raw.trim().toLowerCase()
  const slug = trimmed
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return slug || 'product'
}

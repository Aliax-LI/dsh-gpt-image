/**
 * 图片字节的最小探测：格式识别与像素尺寸。
 * @module gpt-image/lib/image
 */

/**
 * 按魔数识别图片媒体类型。
 * @param bytes - 图片字节。
 * @returns MIME 类型；无法识别时返回 `null`。
 */
export function sniffMediaType(bytes) {
  if (bytes.length >= 8
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png'
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length >= 12
    && bytes.subarray(0, 4).toString('latin1') === 'RIFF'
    && bytes.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp'
  if (bytes.length >= 6 && bytes.subarray(0, 3).toString('latin1') === 'GIF') return 'image/gif'
  if (isSvgText(bytes)) return 'image/svg+xml'
  return null
}

/**
 * 判断字节是不是 SVG 文本（跳过 BOM、空白与 XML 声明）。
 * @param bytes - 文件或响应字节。
 * @returns 是否 SVG。
 */
function isSvgText(bytes) {
  const head = bytes.subarray(0, 512).toString('utf8').replace(/^\uFEFF/, '').trimStart()
  if (!head.startsWith('<')) return false
  return head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))
}

/**
 * 图片格式 → 落盘扩展名。
 * @param mediaType - MIME 类型。
 * @returns 不带点的扩展名。
 */
export function extensionOf(mediaType) {
  switch (mediaType) {
    case 'image/jpeg': return 'jpg'
    case 'image/webp': return 'webp'
    case 'image/gif': return 'gif'
    case 'image/svg+xml': return 'svg'
    default: return 'png'
  }
}

/**
 * 读取图片像素尺寸（PNG / JPEG / WebP / GIF）。
 * @param bytes - 图片字节。
 * @returns `{width, height}`；解析不出来时为 0。
 */
export function imageSize(bytes) {
  const size = sniffPngSize(bytes) ?? sniffJpegSize(bytes) ?? sniffWebpSize(bytes)
    ?? sniffGifSize(bytes) ?? sniffSvgSize(bytes)
  return size ?? { width: 0, height: 0 }
}

/**
 * 从 SVG 的 width/height 或 viewBox 取尺寸。
 * @param bytes - SVG 字节。
 * @returns 尺寸；取不到时 `undefined`。
 */
function sniffSvgSize(bytes) {
  if (!isSvgText(bytes)) return undefined
  const text = bytes.subarray(0, 4096).toString('utf8')
  const svgTag = /<svg[^>]*>/i.exec(text)?.[0]
  if (svgTag == null) return undefined
  const width = /\bwidth="([\d.]+)/i.exec(svgTag)?.[1]
  const height = /\bheight="([\d.]+)/i.exec(svgTag)?.[1]
  if (width != null && height != null) {
    return { width: Math.round(Number(width)), height: Math.round(Number(height)) }
  }
  const viewBox = /\bviewBox="([-\d.]+)[\s,]+([-\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)"/i.exec(svgTag)
  if (viewBox != null) {
    return { width: Math.round(Number(viewBox[3])), height: Math.round(Number(viewBox[4])) }
  }
  return undefined
}

function sniffPngSize(bytes) {
  if (bytes.length < 24) return undefined
  if (bytes[0] !== 0x89 || bytes[1] !== 0x50) return undefined
  if (bytes.subarray(12, 16).toString('latin1') !== 'IHDR') return undefined
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

function sniffGifSize(bytes) {
  if (bytes.length < 10) return undefined
  if (bytes.subarray(0, 3).toString('latin1') !== 'GIF') return undefined
  return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) }
}

function sniffWebpSize(bytes) {
  if (bytes.length < 30) return undefined
  const chunk = bytes.subarray(12, 16).toString('latin1')
  if (chunk === 'VP8X') {
    return { width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) }
  }
  if (chunk === 'VP8 ') {
    return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff }
  }
  if (chunk === 'VP8L') {
    const bits = bytes.readUInt32LE(21)
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
  }
  return undefined
}

function sniffJpegSize(bytes) {
  if (bytes.length < 4) return undefined
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined
  let offset = 2
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) { offset++; continue }
    const marker = bytes[offset + 1]
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue }
    const length = bytes.readUInt16BE(offset + 2)
    if (length < 2) return undefined
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (isSof) {
      return { width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5) }
    }
    offset += 2 + length
  }
  return undefined
}
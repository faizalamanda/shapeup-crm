// ShapeUp POS Monochrome Dithering & ESC/POS Raster Converter
// Converts images into 1-bit monochrome bitmaps using Floyd-Steinberg Dithering.
import { PaperSize } from './printerAdapter'

export interface ProcessedLogoResult {
  dataUrl: string // 1-bit monochrome PNG Data URL for browser preview & HTML printing
  width: number
  height: number
  escPosBytes: Uint8Array // Raw GS v 0 byte stream ready to send to thermal printer
  escPosBase64: string // Base64 serialized byte stream for persistent storage in localStorage
}

/**
 * Loads an image from a URL, Blob, or Data URI into an HTMLImageElement.
 */
export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = (e) => reject(new Error('Gagal memuat gambar: ' + e))
    img.src = src
  })
}

/**
 * Encodes a Uint8Array into a Base64 string.
 */
export function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = ''
  const len = bytes.byteLength
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return typeof window !== 'undefined' ? window.btoa(binary) : Buffer.from(bytes).toString('base64')
}

/**
 * Decodes a Base64 string into a Uint8Array.
 */
export function base64ToUint8Array(base64: string): Uint8Array {
  if (typeof window !== 'undefined') {
    const binary = window.atob(base64)
    const len = binary.length
    const bytes = new Uint8Array(len)
    for (let i = 0; i < len; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    return bytes
  }
  return new Uint8Array(Buffer.from(base64, 'base64'))
}

/**
 * Processes an image element with Floyd-Steinberg Dithering and ESC/POS raster encoding.
 * Width is always clamped and rounded to a multiple of 8 for byte-alignment.
 *
 * @param img - Source HTMLImageElement
 * @param targetPaperSize - '58mm' or '80mm'
 * @param maxHeight - Max dot height (default: 140px)
 */
export function processLogoForThermal(
  img: HTMLImageElement,
  targetPaperSize: PaperSize = '58mm',
  maxHeight: number = 140
): ProcessedLogoResult {
  // 58mm printable width is 384 dots (we target max ~320-360 for pleasant margins)
  // 80mm printable width is 576 dots (target max ~480-512)
  const maxAvailableWidth = targetPaperSize === '80mm' ? 480 : targetPaperSize === 'A4' ? 512 : 320

  let width = img.naturalWidth || img.width
  let height = img.naturalHeight || img.height

  if (!width || !height) {
    throw new Error('Dimensi gambar tidak valid')
  }

  // Scale down proportionally if needed
  if (width > maxAvailableWidth) {
    height = Math.round((height * maxAvailableWidth) / width)
    width = maxAvailableWidth
  }
  if (height > maxHeight) {
    width = Math.round((width * maxHeight) / height)
    height = maxHeight
  }

  // Ensure width is a multiple of 8 dots for ESC/POS byte packing
  width = Math.max(8, Math.floor(width / 8) * 8)
  height = Math.max(1, height)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('Canvas 2D context tidak tersedia')
  }

  // Fill canvas with white background initially (to handle transparent PNGs)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(img, 0, 0, width, height)

  const imgData = ctx.getImageData(0, 0, width, height)
  const data = imgData.data

  // 1. Convert to 2D Grayscale Float Array
  const gray: Float32Array = new Float32Array(width * height)
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3]
    if (alpha < 128) {
      // Treat transparent pixel as pure white
      gray[i / 4] = 255
    } else {
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      // Standard luminance formula
      gray[i / 4] = 0.299 * r + 0.587 * g + 0.114 * b
    }
  }

  // 2. Floyd-Steinberg Error Diffusion Dithering
  // 1-bit output: 0 = White, 1 = Black
  const binaryBits = new Uint8Array(width * height)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x
      const oldVal = gray[idx]
      const newVal = oldVal < 128 ? 0 : 255 // 0 is black, 255 is white
      binaryBits[idx] = newVal === 0 ? 1 : 0 // 1 for black dot in thermal printer

      const err = oldVal - newVal

      if (x + 1 < width) {
        gray[y * width + (x + 1)] += (err * 7) / 16
      }
      if (x - 1 >= 0 && y + 1 < height) {
        gray[(y + 1) * width + (x - 1)] += (err * 3) / 16
      }
      if (y + 1 < height) {
        gray[(y + 1) * width + x] += (err * 5) / 16
      }
      if (x + 1 < width && y + 1 < height) {
        gray[(y + 1) * width + (x + 1)] += (err * 1) / 16
      }
    }
  }

  // 3. Re-write binary dots to Canvas for WYSIWYG HTML/DOM Preview
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixelIdx = (y * width + x) * 4
      const isBlack = binaryBits[y * width + x] === 1
      const val = isBlack ? 0 : 255
      data[pixelIdx] = val
      data[pixelIdx + 1] = val
      data[pixelIdx + 2] = val
      data[pixelIdx + 3] = 255
    }
  }
  ctx.putImageData(imgData, 0, 0)
  const dataUrl = canvas.toDataURL('image/png')

  // 4. Pack into ESC/POS Raster Bit Image (GS v 0 0 xL xH yL yH d1...dk)
  const widthBytes = width / 8
  const rasterBytesCount = widthBytes * height
  const rasterData = new Uint8Array(rasterBytesCount)

  let byteIdx = 0
  for (let y = 0; y < height; y++) {
    for (let bx = 0; bx < widthBytes; bx++) {
      let b = 0
      for (let bit = 0; bit < 8; bit++) {
        const x = bx * 8 + bit
        if (binaryBits[y * width + x] === 1) {
          b |= 0x80 >> bit
        }
      }
      rasterData[byteIdx++] = b
    }
  }

  // ESC/POS Command: GS v 0 m xL xH yL yH
  // 0x1D, 0x76, 0x30, 0x00 (Normal mode)
  const xL = widthBytes & 0xff
  const xH = (widthBytes >> 8) & 0xff
  const yL = height & 0xff
  const yH = (height >> 8) & 0xff

  const commandHeader = new Uint8Array([0x1D, 0x76, 0x30, 0x00, xL, xH, yL, yH])
  const escPosBytes = new Uint8Array(commandHeader.length + rasterData.length)
  escPosBytes.set(commandHeader, 0)
  escPosBytes.set(rasterData, commandHeader.length)

  const escPosBase64 = uint8ArrayToBase64(escPosBytes)

  return {
    dataUrl,
    width,
    height,
    escPosBytes,
    escPosBase64
  }
}


import crypto from 'node:crypto'

const TRIVIAL_PINS = new Set([
  '000000', '111111', '222222', '333333', '444444',
  '555555', '666666', '777777', '888888', '999999',
  '123456', '654321', '012345', '543210'
])

/**
 * Validates whether a PIN string meets security standards (6 numeric digits, non-trivial).
 */
export function validatePinFormat(pin: string): { valid: boolean; error?: string } {
  if (typeof pin !== 'string') {
    return { valid: false, error: 'PIN harus berupa teks angka.' }
  }
  const clean = pin.trim()
  if (!/^\d{6}$/.test(clean)) {
    return { valid: false, error: 'PIN wajib terdiri dari tepat 6 digit angka.' }
  }
  if (TRIVIAL_PINS.has(clean)) {
    return { valid: false, error: 'PIN terlalu mudah ditebak. Hindari urutan atau angka berulang (misal: 123456 atau 000000).' }
  }
  return { valid: true }
}

/**
 * Hash a 6-digit PIN using scrypt with random salt.
 * Format: salt:hash
 */
export function hashPin(pin: string): string {
  const salt = crypto.randomBytes(16).toString('hex')
  const derivedKey = crypto.scryptSync(pin, salt, 32)
  return `${salt}:${derivedKey.toString('hex')}`
}

/**
 * Verify a plain PIN against stored salt:hash string using constant-time comparison.
 */
export function verifyPin(pin: string, storedHash: string): boolean {
  try {
    if (!storedHash || !storedHash.includes(':')) return false
    const [salt, keyHex] = storedHash.split(':')
    if (!salt || !keyHex) return false

    const derivedKey = crypto.scryptSync(pin, salt, 32)
    const keyBuffer = Buffer.from(keyHex, 'hex')
    if (derivedKey.length !== keyBuffer.length) return false
    return crypto.timingSafeEqual(derivedKey, keyBuffer)
  } catch {
    return false
  }
}

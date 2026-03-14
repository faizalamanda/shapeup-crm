export function formatPhoneNumberSmart(phone: string): string {
  if (!phone) return "";

  const raw = phone.trim();
  let cleaned = raw.replace(/\D/g, ""); // Ambil hanya angka

  // 1. KASUS INTERNASIONAL (User pakai + atau sudah kode negara)
  if (raw.startsWith("+") || (!cleaned.startsWith("0") && cleaned.length >= 10)) {
    return cleaned; 
  }

  // 2. KASUS LOKAL INDONESIA (08... atau 8...)
  if (cleaned.startsWith("0")) {
    return "62" + cleaned.substring(1);
  }
  if (cleaned.startsWith("8") && cleaned.length >= 9) {
    return "62" + cleaned;
  }

  return cleaned;
}
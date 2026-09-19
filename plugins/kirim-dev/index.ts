import type { KirimDevPluginConfig } from './types'

// ============================================================
// kirim.dev Plugin — Entry Point
//
// Default: plugin is DISABLED until the user configures it in
// Settings > Integrations > kirim.dev
// ============================================================

export const KIRIMDEV_PLUGIN: KirimDevPluginConfig = {
  id: 'kirimdev',
  name: 'kirim.dev (WhatsApp Business API)',
  version: '1.0.0',
  description:
    'WhatsApp Business API via kirim.dev — autentikasi API key sederhana, inbox percakapan real-time, dan pengiriman pesan teks/template.',
  icon: '💬',
  category: 'messaging',
  enabled: false,   // ← default TIDAK AKTIF; aktifkan di Settings > Integrations
  author: 'ShapeUp CRM Team',
}

export default KIRIMDEV_PLUGIN
export * from './types'

"use client"

import dynamic from 'next/dynamic'
import Link from 'next/link'
import { Suspense } from 'react'

// Lazy-load the inbox component (avoids SSR issues with browser APIs)
const KirimDevInbox = dynamic(
  () => import('@/plugins/kirim-dev/components/KirimDevInbox'),
  {
    ssr: false,
    loading: () => (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100%', color: '#A8A89E', fontSize: 14,
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>💬</div>
          <p>Memuat inbox kirim.dev...</p>
        </div>
      </div>
    ),
  }
)

export default function KirimDevInboxPage() {
  return (
    <div style={{
      height: 'calc(100vh - 64px)',  // account for nav bar
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {/* Page header */}
      <div style={{
        padding: '12px 20px 0',
        background: '#ffffff',
        borderBottom: '1px solid #E2E2DC',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8,
            background: 'linear-gradient(135deg, #25D366, #128C7E)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16,
          }}>💬</div>
          <div>
            <h1 style={{ fontSize: 16, fontWeight: 700, color: '#1C1C1A', lineHeight: 1 }}>
              Inbox — kirim.dev
            </h1>
            <p style={{ fontSize: 11.5, color: '#6B6B63', marginTop: 2 }}>
              WhatsApp Business API via kirim.dev
            </p>
          </div>
        </div>

        {/* Channel switcher */}
        <div style={{ display: 'flex', gap: 4, paddingBottom: 0, alignSelf: 'flex-end' }}>
          <Link
            href="/inbox"
            style={{
              padding: '6px 14px', fontSize: 12.5, fontWeight: 600,
              color: '#6B6B63', textDecoration: 'none',
              borderBottom: '2px solid transparent',
              display: 'flex', alignItems: 'center', gap: 5,
            }}
          >
            <span>📱</span> WABA Official
          </Link>
          <div
            style={{
              padding: '6px 14px', fontSize: 12.5, fontWeight: 700,
              color: '#2563EB',
              borderBottom: '2px solid #2563EB',
              display: 'flex', alignItems: 'center', gap: 5,
            }}
          >
            <span>💬</span> kirim.dev
          </div>
        </div>
      </div>

      {/* Inbox content */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <Suspense fallback={null}>
          <KirimDevInbox />
        </Suspense>
      </div>
    </div>
  )
}

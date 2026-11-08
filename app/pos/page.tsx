import type { Viewport } from 'next'
import POSContainer from './POSContainer'

export const metadata = {
  title: 'ShapeUp POS — Hub & Transaksi Kasir',
  description: 'Aplikasi Kasir Point of Sale dan Session Hub ShapeUp CRM'
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#0f172a',
}

export default function POSPage() {
  return <POSContainer />
}


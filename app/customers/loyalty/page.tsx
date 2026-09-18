// app/customers/loyalty/page.tsx
// Route: /customers/loyalty
// Loyalty Member Program Settings Page
import LoyaltySettingsPage from '@/plugins/loyalty/components/LoyaltySettingsPage'

export const metadata = {
  title: 'Loyalty Program — ShapeUp CRM',
  description: 'Konfigurasi program poin loyalitas pelanggan: earning rules, tier member, redemption, dan kadaluarsa poin.',
}

export default function LoyaltyPage() {
  return <LoyaltySettingsPage />
}

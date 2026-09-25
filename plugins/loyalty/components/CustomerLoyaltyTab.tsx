// ─── CustomerLoyaltyTab — Tab Poin & Loyalty di Customer Detail ───────────────
"use client"
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import {
  CustomerPoints,
  LoyaltyPointLedger,
  LoyaltySettings,
  LoyaltyTier,
  DEFAULT_LOYALTY_SETTINGS,
  resolveTier,
} from '@/plugins/loyalty/types'
import {
  fetchCustomerPoints,
  fetchCustomerPointHistory,
  fetchLoyaltySettings,
  manualAdjustPoints,
} from '@/plugins/loyalty/helpers/loyaltyApi'

const POINT_TYPE_LABELS: Record<string, { label: string; color: string; icon: string }> = {
  earned:   { label: 'Poin Masuk',  color: '#059669', icon: '⬆' },
  redeemed: { label: 'Diredeem',    color: '#7c3aed', icon: '🎁' },
  expired:  { label: 'Kadaluarsa',  color: '#9ca3af', icon: '⌛' },
  adjusted: { label: 'Adjustment',  color: '#f59e0b', icon: '✏️' },
  reversed: { label: 'Dibatalkan',  color: '#dc2626', icon: '⬇' },
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('id-ID', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
  })
}

interface CustomerLoyaltyTabProps {
  customerId: string
  businessId: string
  customerName: string
}

export function CustomerLoyaltyTab({ customerId, businessId, customerName }: CustomerLoyaltyTabProps) {
  // Using singleton supabase client from @/lib/supabase

  const [settings, setSettings] = useState<LoyaltySettings | null>(null)
  const [points, setPoints] = useState<CustomerPoints | null>(null)
  const [history, setHistory] = useState<LoyaltyPointLedger[]>([])
  const [loading, setLoading] = useState(true)

  // Adjust modal
  const [showAdjust, setShowAdjust] = useState(false)
  const [adjustType, setAdjustType] = useState<'add' | 'deduct'>('add')
  const [adjustAmount, setAdjustAmount] = useState(0)
  const [adjustReason, setAdjustReason] = useState('')
  const [adjusting, setAdjusting] = useState(false)
  const [adjustStatus, setAdjustStatus] = useState<'idle' | 'success' | 'error'>('idle')

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [s, p, h] = await Promise.all([
        fetchLoyaltySettings(supabase, businessId),
        fetchCustomerPoints(supabase, businessId, customerId),
        fetchCustomerPointHistory(supabase, businessId, customerId, 30),
      ])
      setSettings(s)
      setPoints(p)
      setHistory(h)
    } finally {
      setLoading(false)
    }
  }, [businessId, customerId])

  useEffect(() => { loadData() }, [loadData])

  const handleAdjust = async () => {
    if (!adjustAmount || !adjustReason.trim()) return
    setAdjusting(true)
    const { data: { user } } = await supabase.auth.getUser()
    const finalPoints = adjustType === 'add' ? adjustAmount : -adjustAmount
    const result = await manualAdjustPoints(supabase, {
      businessId,
      customerId,
      points: finalPoints,
      description: adjustReason,
      createdBy: user?.id ?? '',
    })
    setAdjusting(false)
    if (result.success) {
      setAdjustStatus('success')
      setAdjustAmount(0)
      setAdjustReason('')
      setTimeout(() => {
        setAdjustStatus('idle')
        setShowAdjust(false)
        loadData()
      }, 1200)
    } else {
      setAdjustStatus('error')
    }
  }

  if (loading) {
    return (
      <div className="clt-loading">
        <div className="clt-spinner" />
        <span>Memuat data loyalty...</span>
      </div>
    )
  }

  if (!settings || !settings.is_enabled) {
    return (
      <div className="clt-disabled">
        <div className="clt-disabled-icon">⭐</div>
        <div className="clt-disabled-text">
          <strong>Program Loyalty Belum Aktif</strong>
          <span>Aktifkan program loyalty di menu <strong>Customers → Loyalty Program</strong> untuk mulai memberikan poin ke pelanggan.</span>
        </div>
      </div>
    )
  }

  const tiers = (settings.tiers as LoyaltyTier[]) ?? DEFAULT_LOYALTY_SETTINGS.tiers
  const currentPoints = points?.current_points ?? 0
  const currentTier = resolveTier(currentPoints, tiers)
  const nextTierIdx = tiers.findIndex(t => t.name === currentTier.name) + 1
  const nextTier = nextTierIdx < tiers.length ? tiers[nextTierIdx] : null
  const progressToNext = nextTier
    ? Math.min(100, ((currentPoints - currentTier.min_points) / (nextTier.min_points - currentTier.min_points)) * 100)
    : 100

  return (
    <div className="clt-wrap">
      {/* ─── Balance Card ─────────────────────────────────────────────────── */}
      <div className="clt-balance-card" style={{ borderColor: currentTier.color + '44', background: currentTier.color + '08' }}>
        <div className="clt-balance-tier" style={{ color: currentTier.color }}>
          {currentTier.badge_icon} {currentTier.name}
        </div>
        <div className="clt-balance-points">
          <span className="clt-balance-num">{currentPoints.toLocaleString('id-ID')}</span>
          <span className="clt-balance-label">poin</span>
        </div>

        {/* Progress to next tier */}
        {nextTier && (
          <div className="clt-tier-progress">
            <div className="clt-tier-progress-track">
              <div
                className="clt-tier-progress-fill"
                style={{ width: `${progressToNext}%`, background: currentTier.color }}
              />
            </div>
            <div className="clt-tier-progress-label">
              {nextTier.min_points - currentPoints > 0
                ? `${(nextTier.min_points - currentPoints).toLocaleString('id-ID')} poin lagi menuju ${nextTier.badge_icon} ${nextTier.name}`
                : `Sudah mencapai ${nextTier.name}!`}
            </div>
          </div>
        )}
        {!nextTier && (
          <div className="clt-tier-progress-label" style={{ color: currentTier.color }}>
            🎉 Tier Tertinggi — {currentTier.badge_icon} {currentTier.name}
          </div>
        )}
      </div>

      {/* ─── Lifetime Stats ─────────────────────────────────────────────────── */}
      <div className="clt-lifetime-stats">
        <div className="clt-lifetime-item">
          <span className="clt-lifetime-label">Total Diperoleh</span>
          <span className="clt-lifetime-value clt-lifetime-value--green">
            +{(points?.lifetime_earned ?? 0).toLocaleString('id-ID')}
          </span>
        </div>
        <div className="clt-lifetime-item">
          <span className="clt-lifetime-label">Total Diredeem</span>
          <span className="clt-lifetime-value clt-lifetime-value--purple">
            −{(points?.lifetime_redeemed ?? 0).toLocaleString('id-ID')}
          </span>
        </div>
        <div className="clt-lifetime-item">
          <span className="clt-lifetime-label">Multiplier Tier</span>
          <span className="clt-lifetime-value" style={{ color: currentTier.color }}>
            {currentTier.multiplier}×
          </span>
        </div>
      </div>

      {/* ─── Actions ────────────────────────────────────────────────────────── */}
      <div className="clt-actions">
        <button
          id="loyalty-adjust-points-btn"
          className="clt-action-btn clt-action-btn--adjust"
          onClick={() => { setShowAdjust(true); setAdjustStatus('idle') }}
        >
          ✏️ Adjust Poin
        </button>
        {settings.redemption_enabled && (
          <div className="clt-redeem-info">
            💡 {settings.points_per_redemption} poin = Rp {settings.redemption_value.toLocaleString('id-ID')} diskon
          </div>
        )}
      </div>

      {/* ─── Adjust Modal ─────────────────────────────────────────────────── */}
      {showAdjust && (
        <div className="clt-adjust-modal-overlay" onClick={() => setShowAdjust(false)}>
          <div className="clt-adjust-modal" onClick={e => e.stopPropagation()}>
            <div className="clt-adjust-title">Manual Adjust Poin — {customerName}</div>
            <div className="clt-adjust-type">
              {(['add', 'deduct'] as const).map(t => (
                <button
                  key={t}
                  className={`clt-adjust-type-btn ${adjustType === t ? 'clt-adjust-type-btn--active' : ''}`}
                  onClick={() => setAdjustType(t)}
                >
                  {t === 'add' ? '+ Tambah Poin' : '− Kurangi Poin'}
                </button>
              ))}
            </div>
            <div className="clt-adjust-field">
              <label>Jumlah Poin</label>
              <input
                id="loyalty-adjust-amount"
                type="number"
                min={1}
                value={adjustAmount || ''}
                onChange={e => setAdjustAmount(parseInt(e.target.value) || 0)}
                placeholder="Masukkan jumlah poin"
                className="clt-adjust-input"
              />
            </div>
            <div className="clt-adjust-field">
              <label>Alasan / Keterangan</label>
              <input
                id="loyalty-adjust-reason"
                type="text"
                value={adjustReason}
                onChange={e => setAdjustReason(e.target.value)}
                placeholder="Mis: Promo HUT RI, kompensasi, dll"
                className="clt-adjust-input"
              />
            </div>
            {adjustStatus === 'error' && (
              <div className="clt-adjust-error">Gagal menyimpan. Coba lagi.</div>
            )}
            <div className="clt-adjust-footer">
              <button className="clt-adjust-cancel" onClick={() => setShowAdjust(false)}>Batal</button>
              <button
                id="loyalty-adjust-submit-btn"
                className={`clt-adjust-submit ${adjusting ? 'clt-adjust-submit--saving' : ''} ${adjustStatus === 'success' ? 'clt-adjust-submit--success' : ''}`}
                onClick={handleAdjust}
                disabled={adjusting || !adjustAmount || !adjustReason.trim()}
              >
                {adjusting ? 'Menyimpan...' : adjustStatus === 'success' ? '✓ Berhasil!' : 'Simpan'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── History Table ─────────────────────────────────────────────────── */}
      <div className="clt-history">
        <div className="clt-history-title">Riwayat Poin</div>
        {history.length === 0 ? (
          <div className="clt-history-empty">Belum ada riwayat poin untuk customer ini.</div>
        ) : (
          <div className="clt-history-list">
            {history.map(entry => {
              const meta = POINT_TYPE_LABELS[entry.type] ?? { label: entry.type, color: '#6b7280', icon: '•' }
              const isPositive = entry.points > 0
              return (
                <div key={entry.id} className="clt-history-row">
                  <div className="clt-history-icon" style={{ color: meta.color }}>{meta.icon}</div>
                  <div className="clt-history-info">
                    <div className="clt-history-desc">{entry.description || meta.label}</div>
                    <div className="clt-history-date">{fmtDate(entry.created_at)}</div>
                  </div>
                  <div className="clt-history-right">
                    <div
                      className="clt-history-points"
                      style={{ color: isPositive ? '#059669' : '#dc2626' }}
                    >
                      {isPositive ? '+' : ''}{entry.points.toLocaleString('id-ID')}
                    </div>
                    <div className="clt-history-balance">
                      saldo: {entry.balance_after.toLocaleString('id-ID')}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <style>{cltStyles}</style>
    </div>
  )
}

const cltStyles = `
.clt-loading {
  display: flex; align-items: center; gap: 10px;
  padding: 32px; justify-content: center; color: #9ca3af; font-size: 13px;
}
.clt-spinner {
  width: 18px; height: 18px;
  border: 2px solid #e5e7eb; border-top-color: #8b5cf6;
  border-radius: 50%; animation: loyalty-spin 0.8s linear infinite;
}
@keyframes loyalty-spin { to { transform: rotate(360deg); } }

.clt-disabled {
  display: flex; flex-direction: column; align-items: center;
  text-align: center; padding: 36px 24px; gap: 12px;
}
.clt-disabled-icon { font-size: 36px; opacity: 0.3; }
.clt-disabled-text {
  display: flex; flex-direction: column; gap: 6px;
  font-size: 13px; color: #6b7280; max-width: 280px;
}
.clt-disabled-text strong { font-size: 14px; color: #374151; }

.clt-wrap { display: flex; flex-direction: column; gap: 14px; padding: 4px 0; }

/* Balance Card */
.clt-balance-card {
  border: 2px solid; border-radius: 14px;
  padding: 18px 20px;
  display: flex; flex-direction: column; gap: 10px;
}
.clt-balance-tier { font-size: 13px; font-weight: 700; }
.clt-balance-points { display: flex; align-items: baseline; gap: 6px; }
.clt-balance-num { font-size: 36px; font-weight: 800; color: #111827; line-height: 1; }
.clt-balance-label { font-size: 14px; color: #6b7280; font-weight: 500; }

/* Progress */
.clt-tier-progress { display: flex; flex-direction: column; gap: 4px; }
.clt-tier-progress-track {
  height: 6px; background: #e5e7eb; border-radius: 3px; overflow: hidden;
}
.clt-tier-progress-fill {
  height: 100%; border-radius: 3px; transition: width 0.4s ease;
  min-width: 4px;
}
.clt-tier-progress-label { font-size: 11px; color: #6b7280; }

/* Lifetime Stats */
.clt-lifetime-stats {
  display: grid; grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}
.clt-lifetime-item {
  background: #f9fafb; border: 1.5px solid #e5e7eb;
  border-radius: 10px; padding: 12px;
  display: flex; flex-direction: column; gap: 3px;
}
.clt-lifetime-label { font-size: 11px; color: #9ca3af; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
.clt-lifetime-value { font-size: 18px; font-weight: 700; color: #111827; }
.clt-lifetime-value--green { color: #059669; }
.clt-lifetime-value--purple { color: #7c3aed; }

/* Actions */
.clt-actions { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.clt-action-btn {
  padding: 8px 16px; border-radius: 8px; font-size: 13px; font-weight: 600;
  cursor: pointer; border: 1.5px solid; transition: all 0.15s;
}
.clt-action-btn--adjust {
  background: #fff; border-color: #d1d5db; color: #374151;
}
.clt-action-btn--adjust:hover { border-color: #7c3aed; color: #7c3aed; background: #faf5ff; }
.clt-redeem-info { font-size: 12px; color: #7c3aed; background: #faf5ff; padding: 6px 12px; border-radius: 6px; }

/* Adjust Modal */
.clt-adjust-modal-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.4);
  z-index: 1000; display: flex; align-items: center; justify-content: center;
}
.clt-adjust-modal {
  background: #fff; border-radius: 16px; padding: 24px;
  width: 90%; max-width: 400px;
  display: flex; flex-direction: column; gap: 14px;
  box-shadow: 0 20px 60px rgba(0,0,0,0.15);
}
.clt-adjust-title { font-size: 15px; font-weight: 700; color: #111827; }
.clt-adjust-type { display: flex; gap: 8px; }
.clt-adjust-type-btn {
  flex: 1; padding: 8px; border-radius: 8px; font-size: 13px; font-weight: 600;
  cursor: pointer; border: 1.5px solid #e5e7eb; background: #f9fafb; color: #6b7280;
  transition: all 0.15s;
}
.clt-adjust-type-btn--active {
  border-color: #7c3aed; background: #faf5ff; color: #7c3aed;
}
.clt-adjust-field { display: flex; flex-direction: column; gap: 5px; }
.clt-adjust-field label { font-size: 12px; font-weight: 600; color: #374151; }
.clt-adjust-input {
  padding: 9px 12px; border: 1.5px solid #d1d5db; border-radius: 8px;
  font-size: 13px; outline: none; transition: border-color 0.15s;
  width: 100%; box-sizing: border-box;
}
.clt-adjust-input:focus { border-color: #7c3aed; }
.clt-adjust-error { font-size: 12px; color: #dc2626; }
.clt-adjust-footer { display: flex; justify-content: flex-end; gap: 8px; }
.clt-adjust-cancel {
  padding: 8px 16px; background: #f3f4f6; border: none; border-radius: 8px;
  font-size: 13px; font-weight: 600; cursor: pointer; color: #374151;
}
.clt-adjust-submit {
  padding: 8px 20px; background: #111827; color: #fff;
  border: none; border-radius: 8px; font-size: 13px; font-weight: 600;
  cursor: pointer; transition: all 0.15s;
}
.clt-adjust-submit:disabled { opacity: 0.5; cursor: not-allowed; }
.clt-adjust-submit--saving { background: #374151; }
.clt-adjust-submit--success { background: #059669 !important; }

/* History */
.clt-history-title { font-size: 13px; font-weight: 700; color: #374151; margin-bottom: 8px; }
.clt-history-empty { font-size: 13px; color: #9ca3af; text-align: center; padding: 24px; }
.clt-history-list { display: flex; flex-direction: column; }
.clt-history-row {
  display: flex; align-items: flex-start; gap: 10px;
  padding: 11px 0; border-bottom: 1px solid #f3f4f6;
}
.clt-history-row:last-child { border-bottom: none; }
.clt-history-icon { font-size: 14px; margin-top: 2px; flex-shrink: 0; }
.clt-history-info { flex: 1; min-width: 0; }
.clt-history-desc { font-size: 13px; color: #111827; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.clt-history-date { font-size: 11px; color: #9ca3af; margin-top: 2px; }
.clt-history-right { text-align: right; flex-shrink: 0; }
.clt-history-points { font-size: 14px; font-weight: 700; }
.clt-history-balance { font-size: 11px; color: #9ca3af; }

@media (max-width: 480px) {
  .clt-lifetime-stats { grid-template-columns: 1fr 1fr; }
}
`

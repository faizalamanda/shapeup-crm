"use client"
import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { useUserContext } from '@/components/UserContext'
import {
  LoyaltySettings,
  LoyaltyTier,
  LoyaltySummaryStats,
  DEFAULT_LOYALTY_SETTINGS,
  resolveTier,
} from '@/plugins/loyalty/types'
import {
  fetchLoyaltySettings,
  upsertLoyaltySettings,
  fetchLoyaltySummaryStats,
} from '@/plugins/loyalty/helpers/loyaltyApi'

// ─── Tier Color Picker Options ────────────────────────────────────────────────
const TIER_COLOR_OPTIONS = [
  '#cd7f32', '#9ca3af', '#f59e0b', '#8b5cf6',
  '#ef4444', '#10b981', '#3b82f6', '#ec4899',
  '#f97316', '#14b8a6',
]

// ─── Stats Card ───────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="loyalty-stat-card">
      <div className="loyalty-stat-label">{label}</div>
      <div className="loyalty-stat-value" style={color ? { color } : undefined}>{value}</div>
      {sub && <div className="loyalty-stat-sub">{sub}</div>}
    </div>
  )
}

// ─── Toggle Switch ────────────────────────────────────────────────────────────
function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`loyalty-toggle ${checked ? 'loyalty-toggle--on' : 'loyalty-toggle--off'} ${disabled ? 'loyalty-toggle--disabled' : ''}`}
    >
      <span className="loyalty-toggle-thumb" />
    </button>
  )
}

// ─── Tier Row ─────────────────────────────────────────────────────────────────
function TierRow({
  tier, index, onChange, onRemove, canRemove
}: {
  tier: LoyaltyTier
  index: number
  onChange: (index: number, field: keyof LoyaltyTier, value: any) => void
  onRemove: (index: number) => void
  canRemove: boolean
}) {
  return (
    <div className="loyalty-tier-row">
      <div className="loyalty-tier-badge" style={{ background: tier.color }}>
        {tier.badge_icon}
      </div>
      <input
        className="loyalty-input loyalty-tier-name"
        value={tier.name}
        onChange={e => onChange(index, 'name', e.target.value)}
        placeholder="Nama Tier"
        disabled={index === 0}
      />
      <div className="loyalty-tier-field">
        <span className="loyalty-tier-field-label">Min Poin</span>
        <input
          type="number"
          className="loyalty-input"
          value={tier.min_points}
          onChange={e => onChange(index, 'min_points', parseInt(e.target.value) || 0)}
          min={0}
          disabled={index === 0}
        />
      </div>
      <div className="loyalty-tier-field">
        <span className="loyalty-tier-field-label">Multiplier</span>
        <input
          type="number"
          className="loyalty-input"
          value={tier.multiplier}
          onChange={e => onChange(index, 'multiplier', parseFloat(e.target.value) || 1)}
          min={0.1}
          step={0.1}
        />
        <span className="loyalty-tier-field-unit">×</span>
      </div>
      <div className="loyalty-tier-field">
        <span className="loyalty-tier-field-label">Ikon</span>
        <input
          className="loyalty-input loyalty-tier-icon"
          value={tier.badge_icon}
          onChange={e => onChange(index, 'badge_icon', e.target.value)}
          maxLength={2}
        />
      </div>
      <div className="loyalty-tier-colors">
        {TIER_COLOR_OPTIONS.map(c => (
          <button
            key={c}
            type="button"
            className={`loyalty-color-dot ${tier.color === c ? 'loyalty-color-dot--active' : ''}`}
            style={{ background: c }}
            onClick={() => onChange(index, 'color', c)}
          />
        ))}
      </div>
      {canRemove && (
        <button type="button" className="loyalty-tier-remove" onClick={() => onRemove(index)}>
          ×
        </button>
      )}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function LoyaltySettingsPage() {
  // Using singleton supabase client from @/lib/supabase

  const { activeBusiness } = useUserContext()
  const businessId = activeBusiness?.id ?? null

  const [settings, setSettings] = useState<LoyaltySettings | null>(null)
  const [form, setForm] = useState(DEFAULT_LOYALTY_SETTINGS)
  const [stats, setStats] = useState<LoyaltySummaryStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const [activeSection, setActiveSection] = useState<'earn' | 'tiers' | 'redeem' | 'expiry'>('earn')

  const loadData = useCallback(async () => {
    if (!businessId) return
    setLoading(true)
    try {
      const [s, st] = await Promise.all([
        fetchLoyaltySettings(supabase, businessId),
        fetchLoyaltySummaryStats(supabase, businessId, DEFAULT_LOYALTY_SETTINGS.tiers).catch(() => null),
      ])
      if (s) {
        setSettings(s)
        setForm({
          is_enabled: s.is_enabled,
          program_name: s.program_name,
          amount_per_point: s.amount_per_point,
          min_transaction: s.min_transaction,
          redemption_enabled: s.redemption_enabled,
          points_per_redemption: s.points_per_redemption,
          redemption_value: s.redemption_value,
          max_redemption_pct: s.max_redemption_pct,
          expiry_enabled: s.expiry_enabled,
          expiry_months: s.expiry_months,
          tiers: s.tiers as LoyaltyTier[],
        })
      }
      setStats(st)
    } finally {
      setLoading(false)
    }
  }, [businessId, supabase])

  useEffect(() => { loadData() }, [loadData])

  const handleSave = async () => {
    if (!businessId) return
    setSaving(true)
    setSaveStatus('idle')
    try {
      await upsertLoyaltySettings(supabase, businessId, form)
      setSaveStatus('success')
      setTimeout(() => setSaveStatus('idle'), 2500)
      await loadData()
    } catch {
      setSaveStatus('error')
    } finally {
      setSaving(false)
    }
  }

  const updateTier = (index: number, field: keyof LoyaltyTier, value: any) => {
    const updated = form.tiers.map((t, i) => i === index ? { ...t, [field]: value } : t)
    setForm(f => ({ ...f, tiers: updated }))
  }

  const addTier = () => {
    const last = form.tiers[form.tiers.length - 1]
    setForm(f => ({
      ...f,
      tiers: [...f.tiers, {
        name: 'Tier Baru',
        min_points: (last?.min_points ?? 0) + 1000,
        color: TIER_COLOR_OPTIONS[f.tiers.length % TIER_COLOR_OPTIONS.length],
        multiplier: (last?.multiplier ?? 1) + 0.5,
        badge_icon: '⭐',
      }]
    }))
  }

  const removeTier = (index: number) => {
    setForm(f => ({ ...f, tiers: f.tiers.filter((_, i) => i !== index) }))
  }

  const fmtCurrency = (v: number) => `Rp ${v.toLocaleString('id-ID')}`

  if (loading) {
    return (
      <div className="loyalty-page">
        <div className="loyalty-loading">
          <div className="loyalty-loading-spinner" />
          <span>Memuat program loyalty...</span>
        </div>
      </div>
    )
  }

  const isEnabled = form.is_enabled
  const currentTierPreview = resolveTier(stats?.total_points_outstanding ?? 0, form.tiers)

  return (
    <div className="loyalty-page">
      {/* ─── Header ─────────────────────────────────────────────────────────── */}
      <div className="loyalty-header">
        <div className="loyalty-header-left">
          <div className="loyalty-header-icon">⭐</div>
          <div>
            <h1 className="loyalty-title">Loyalty Member Program</h1>
            <p className="loyalty-subtitle">
              Reward pelanggan setia dengan sistem poin otomatis dari setiap transaksi
            </p>
          </div>
        </div>
        <div className="loyalty-header-right">
          <div className={`loyalty-status-badge ${isEnabled ? 'loyalty-status-badge--on' : 'loyalty-status-badge--off'}`}>
            {isEnabled ? '● Aktif' : '○ Nonaktif'}
          </div>
          <button
            id="loyalty-save-btn"
            className={`loyalty-save-btn ${saving ? 'loyalty-save-btn--saving' : ''} ${saveStatus === 'success' ? 'loyalty-save-btn--success' : ''}`}
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? 'Menyimpan...' : saveStatus === 'success' ? '✓ Tersimpan' : 'Simpan Perubahan'}
          </button>
        </div>
      </div>

      {/* ─── Premium Banner (always shown, toggle to activate) ─────────────── */}
      {!isEnabled && (
        <div className="loyalty-premium-banner">
          <div className="loyalty-premium-banner-icon">💎</div>
          <div className="loyalty-premium-banner-text">
            <strong>Fitur Premium — Loyalty Member Program</strong>
            <span>Program poin loyalitas pelanggan. Aktifkan untuk mulai memberikan reward ke customer Anda.</span>
          </div>
          <button
            className="loyalty-activate-btn"
            onClick={() => setForm(f => ({ ...f, is_enabled: true }))}
          >
            Aktifkan Sekarang
          </button>
        </div>
      )}

      {/* ─── Master Toggle ───────────────────────────────────────────────────── */}
      <div className="loyalty-card loyalty-toggle-card">
        <div className="loyalty-toggle-card-left">
          <div className="loyalty-toggle-label">
            <span className="loyalty-toggle-title">Program Loyalty</span>
            <span className="loyalty-toggle-desc">
              {isEnabled
                ? `"${form.program_name}" sedang aktif. Poin otomatis diberikan pada setiap order completed.`
                : 'Nonaktif. Tidak ada poin yang akan diberikan saat ini.'}
            </span>
          </div>
        </div>
        <Toggle checked={isEnabled} onChange={v => setForm(f => ({ ...f, is_enabled: v }))} />
      </div>

      {/* ─── Program Name ────────────────────────────────────────────────────── */}
      {isEnabled && (
        <div className="loyalty-card">
          <label className="loyalty-field-label">Nama Program</label>
          <input
            id="loyalty-program-name"
            className="loyalty-input loyalty-input--lg"
            value={form.program_name}
            onChange={e => setForm(f => ({ ...f, program_name: e.target.value }))}
            placeholder="Nama program loyalty Anda"
          />
        </div>
      )}

      {/* ─── Stats Summary ────────────────────────────────────────────────────── */}
      {isEnabled && stats && (
        <div className="loyalty-stats-grid">
          <StatCard label="Total Member" value={stats.total_member_count.toLocaleString('id-ID')} sub="customer punya poin" />
          <StatCard label="Poin Beredar" value={stats.total_points_outstanding.toLocaleString('id-ID')} sub="poin aktif tersisa" color="#f59e0b" />
          <StatCard label="Total Diberikan" value={stats.total_points_earned.toLocaleString('id-ID')} sub="sepanjang waktu" color="#10b981" />
          <StatCard label="Total Diredeem" value={stats.total_points_redeemed.toLocaleString('id-ID')} sub="ditukar diskon" color="#8b5cf6" />
        </div>
      )}

      {/* ─── Tier Distribution ───────────────────────────────────────────────── */}
      {isEnabled && stats && stats.tier_distribution.some(t => t.count > 0) && (
        <div className="loyalty-card">
          <div className="loyalty-section-title">Distribusi Tier Member</div>
          <div className="loyalty-tier-dist">
            {stats.tier_distribution.map(t => (
              <div key={t.tier} className="loyalty-tier-dist-item">
                <div className="loyalty-tier-dist-bar-wrap">
                  <div
                    className="loyalty-tier-dist-bar"
                    style={{
                      background: t.color,
                      width: `${stats.total_member_count > 0 ? (t.count / stats.total_member_count) * 100 : 0}%`
                    }}
                  />
                </div>
                <div className="loyalty-tier-dist-label">
                  <span style={{ color: t.color }}>{t.tier}</span>
                  <span>{t.count} member</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── Settings Sections (only when enabled) ───────────────────────────── */}
      {isEnabled && (
        <>
          {/* Section Nav */}
          <div className="loyalty-section-nav">
            {([
              { key: 'earn',   label: '🎯 Earning Rules' },
              { key: 'tiers',  label: '🏆 Tier Member' },
              { key: 'redeem', label: '🎁 Redemption' },
              { key: 'expiry', label: '⏳ Kadaluarsa' },
            ] as const).map(sec => (
              <button
                key={sec.key}
                className={`loyalty-section-tab ${activeSection === sec.key ? 'loyalty-section-tab--active' : ''}`}
                onClick={() => setActiveSection(sec.key)}
              >
                {sec.label}
              </button>
            ))}
          </div>

          {/* ── Earning Rules ─────────────────────────────────────────────────── */}
          {activeSection === 'earn' && (
            <div className="loyalty-card loyalty-card--section">
              <div className="loyalty-section-title">🎯 Aturan Perolehan Poin</div>
              <p className="loyalty-section-desc">
                Poin diberikan dari <strong>nilai setiap order</strong> yang selesai (completed), bukan kumulatif total belanja.
              </p>

              <div className="loyalty-field-group">
                <div className="loyalty-field">
                  <label className="loyalty-field-label">Konversi Poin</label>
                  <div className="loyalty-field-row">
                    <span className="loyalty-field-prefix">Rp</span>
                    <input
                      id="loyalty-amount-per-point"
                      type="number"
                      className="loyalty-input"
                      value={form.amount_per_point}
                      onChange={e => setForm(f => ({ ...f, amount_per_point: parseInt(e.target.value) || 1 }))}
                      min={1}
                    />
                    <span className="loyalty-field-unit">= 1 Poin</span>
                  </div>
                  <p className="loyalty-field-hint">
                    Contoh: Order Rp 150.000 → {Math.floor(150000 / form.amount_per_point)} poin (tier Bronze)
                  </p>
                </div>

                <div className="loyalty-field">
                  <label className="loyalty-field-label">Minimum Transaksi</label>
                  <div className="loyalty-field-row">
                    <span className="loyalty-field-prefix">Rp</span>
                    <input
                      id="loyalty-min-transaction"
                      type="number"
                      className="loyalty-input"
                      value={form.min_transaction}
                      onChange={e => setForm(f => ({ ...f, min_transaction: parseInt(e.target.value) || 0 }))}
                      min={0}
                    />
                  </div>
                  <p className="loyalty-field-hint">
                    {form.min_transaction === 0
                      ? 'Semua transaksi mendapat poin.'
                      : `Hanya order ≥ ${fmtCurrency(form.min_transaction)} yang mendapat poin.`}
                  </p>
                </div>
              </div>

              {/* Live Preview */}
              <div className="loyalty-preview-box">
                <div className="loyalty-preview-title">💡 Preview Contoh</div>
                {[50000, 100000, 250000, 500000].map(amount => {
                  const pts = amount < form.min_transaction ? 0 : Math.floor(amount / form.amount_per_point)
                  const tier1 = form.tiers.find(t => t.name === 'Bronze')
                  const pts_gold = amount < form.min_transaction ? 0 : Math.floor(Math.floor(amount / form.amount_per_point) * (form.tiers.find(t => t.name === 'Gold')?.multiplier ?? 2))
                  return (
                    <div key={amount} className="loyalty-preview-row">
                      <span>Order {fmtCurrency(amount)}</span>
                      <span>
                        {pts === 0 ? <span className="loyalty-preview-zero">0 poin (di bawah minimum)</span> : (
                          <><strong>{pts} poin</strong> (Bronze) · <strong>{pts_gold} poin</strong> (Gold)</>
                        )}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* ── Tier Configuration ────────────────────────────────────────────── */}
          {activeSection === 'tiers' && (
            <div className="loyalty-card loyalty-card--section">
              <div className="loyalty-section-title">🏆 Konfigurasi Tier Member</div>
              <p className="loyalty-section-desc">
                Tier ditentukan dari <strong>saldo poin saat ini</strong>. Member dengan lebih banyak poin mendapat multiplier lebih tinggi.
              </p>

              <div className="loyalty-tiers-list">
                {form.tiers.map((tier, i) => (
                  <TierRow
                    key={i}
                    tier={tier}
                    index={i}
                    onChange={updateTier}
                    onRemove={removeTier}
                    canRemove={form.tiers.length > 1 && i > 0}
                  />
                ))}
              </div>

              <button className="loyalty-add-tier-btn" onClick={addTier}>
                + Tambah Tier
              </button>

              {/* Tier progression preview */}
              <div className="loyalty-tier-progress-preview">
                {form.tiers.map((tier, i) => (
                  <div key={i} className="loyalty-tier-progress-item">
                    <div className="loyalty-tier-progress-dot" style={{ background: tier.color }} />
                    <div className="loyalty-tier-progress-info">
                      <span className="loyalty-tier-progress-name" style={{ color: tier.color }}>
                        {tier.badge_icon} {tier.name}
                      </span>
                      <span className="loyalty-tier-progress-req">
                        {tier.min_points === 0 ? 'Semua member' : `≥ ${tier.min_points.toLocaleString('id-ID')} poin`}
                        {' · '}{tier.multiplier}× poin per transaksi
                      </span>
                    </div>
                    {i < form.tiers.length - 1 && <div className="loyalty-tier-progress-line" />}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Redemption ────────────────────────────────────────────────────── */}
          {activeSection === 'redeem' && (
            <div className="loyalty-card loyalty-card--section">
              <div className="loyalty-section-title">🎁 Aturan Penukaran Poin</div>

              <div className="loyalty-field-group">
                <div className="loyalty-toggle-field">
                  <div>
                    <div className="loyalty-field-label">Aktifkan Redemption</div>
                    <div className="loyalty-field-hint">Customer bisa tukar poin jadi diskon saat transaksi</div>
                  </div>
                  <Toggle
                    checked={form.redemption_enabled}
                    onChange={v => setForm(f => ({ ...f, redemption_enabled: v }))}
                  />
                </div>

                {form.redemption_enabled && (
                  <>
                    <div className="loyalty-field">
                      <label className="loyalty-field-label">Rate Penukaran</label>
                      <div className="loyalty-redemption-rate">
                        <input
                          id="loyalty-points-per-redemption"
                          type="number"
                          className="loyalty-input loyalty-input--sm"
                          value={form.points_per_redemption}
                          onChange={e => setForm(f => ({ ...f, points_per_redemption: parseInt(e.target.value) || 1 }))}
                          min={1}
                        />
                        <span className="loyalty-field-unit">poin</span>
                        <span className="loyalty-field-eq">=</span>
                        <span className="loyalty-field-prefix">Rp</span>
                        <input
                          id="loyalty-redemption-value"
                          type="number"
                          className="loyalty-input loyalty-input--sm"
                          value={form.redemption_value}
                          onChange={e => setForm(f => ({ ...f, redemption_value: parseInt(e.target.value) || 1 }))}
                          min={1}
                        />
                        <span className="loyalty-field-unit">diskon</span>
                      </div>
                      <p className="loyalty-field-hint">
                        100 poin = {fmtCurrency(Math.round((form.redemption_value / form.points_per_redemption) * 100))} diskon
                      </p>
                    </div>

                    <div className="loyalty-field">
                      <label className="loyalty-field-label">Maksimal Redeem per Transaksi</label>
                      <div className="loyalty-field-row">
                        <input
                          id="loyalty-max-redemption-pct"
                          type="number"
                          className="loyalty-input loyalty-input--sm"
                          value={form.max_redemption_pct}
                          onChange={e => setForm(f => ({ ...f, max_redemption_pct: Math.min(100, parseInt(e.target.value) || 0) }))}
                          min={1}
                          max={100}
                        />
                        <span className="loyalty-field-unit">% dari nilai transaksi</span>
                      </div>
                      <p className="loyalty-field-hint">
                        Diskon dari poin tidak boleh melebihi {form.max_redemption_pct}% dari total order
                      </p>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* ── Expiry ────────────────────────────────────────────────────────── */}
          {activeSection === 'expiry' && (
            <div className="loyalty-card loyalty-card--section">
              <div className="loyalty-section-title">⏳ Kadaluarsa Poin</div>

              <div className="loyalty-field-group">
                <div className="loyalty-toggle-field">
                  <div>
                    <div className="loyalty-field-label">Aktifkan Kadaluarsa Poin</div>
                    <div className="loyalty-field-hint">Poin akan hangus jika customer tidak aktif selama periode tertentu</div>
                  </div>
                  <Toggle
                    checked={form.expiry_enabled}
                    onChange={v => setForm(f => ({ ...f, expiry_enabled: v }))}
                  />
                </div>

                {form.expiry_enabled && (
                  <div className="loyalty-field">
                    <label className="loyalty-field-label">Periode Kadaluarsa</label>
                    <div className="loyalty-field-row">
                      <input
                        id="loyalty-expiry-months"
                        type="number"
                        className="loyalty-input loyalty-input--sm"
                        value={form.expiry_months}
                        onChange={e => setForm(f => ({ ...f, expiry_months: parseInt(e.target.value) || 1 }))}
                        min={1}
                      />
                      <span className="loyalty-field-unit">bulan tanpa aktivitas</span>
                    </div>
                    <p className="loyalty-field-hint">
                      Poin customer akan hangus jika tidak ada transaksi dalam {form.expiry_months} bulan terakhir.
                    </p>
                  </div>
                )}

                {!form.expiry_enabled && (
                  <div className="loyalty-info-box">
                    ℹ️ Poin tidak akan pernah kadaluarsa. Customer bisa mengumpulkan poin tanpa batas waktu.
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* ─── Save Footer ─────────────────────────────────────────────────────── */}
      <div className="loyalty-footer">
        {saveStatus === 'error' && (
          <div className="loyalty-save-error">Gagal menyimpan. Coba lagi.</div>
        )}
        <button
          className={`loyalty-save-btn loyalty-save-btn--lg ${saving ? 'loyalty-save-btn--saving' : ''} ${saveStatus === 'success' ? 'loyalty-save-btn--success' : ''}`}
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? 'Menyimpan...' : saveStatus === 'success' ? '✓ Perubahan Tersimpan' : 'Simpan Perubahan'}
        </button>
      </div>

      <style>{loyaltyStyles}</style>
    </div>
  )
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const loyaltyStyles = `
.loyalty-page {
  max-width: 820px;
  margin: 0 auto;
  padding: 24px 16px 80px;
  font-family: inherit;
}

.loyalty-loading {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 60px;
  justify-content: center;
  color: #6b7280;
}
.loyalty-loading-spinner {
  width: 22px; height: 22px;
  border: 2px solid #e5e7eb;
  border-top-color: #8b5cf6;
  border-radius: 50%;
  animation: loyalty-spin 0.8s linear infinite;
}
@keyframes loyalty-spin { to { transform: rotate(360deg); } }

/* Header */
.loyalty-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 24px;
  flex-wrap: wrap;
}
.loyalty-header-left { display: flex; align-items: center; gap: 16px; }
.loyalty-header-icon {
  width: 52px; height: 52px;
  background: linear-gradient(135deg, #fef3c7, #fde68a);
  border-radius: 14px;
  display: flex; align-items: center; justify-content: center;
  font-size: 26px;
  border: 1.5px solid #fcd34d;
  flex-shrink: 0;
}
.loyalty-title { font-size: 20px; font-weight: 700; color: #111827; margin: 0; }
.loyalty-subtitle { font-size: 13px; color: #6b7280; margin: 2px 0 0; }
.loyalty-header-right { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }

/* Status Badge */
.loyalty-status-badge {
  font-size: 12px;
  font-weight: 600;
  padding: 5px 12px;
  border-radius: 20px;
  border: 1.5px solid;
}
.loyalty-status-badge--on { color: #059669; background: #d1fae5; border-color: #6ee7b7; }
.loyalty-status-badge--off { color: #9ca3af; background: #f3f4f6; border-color: #e5e7eb; }

/* Save Button */
.loyalty-save-btn {
  padding: 9px 20px;
  background: #111827;
  color: #fff;
  border: none;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.18s;
  white-space: nowrap;
}
.loyalty-save-btn:hover:not(:disabled) { background: #374151; }
.loyalty-save-btn:disabled { opacity: 0.6; cursor: not-allowed; }
.loyalty-save-btn--success { background: #059669 !important; }
.loyalty-save-btn--saving { background: #374151; }
.loyalty-save-btn--lg { width: 100%; max-width: 280px; padding: 12px 24px; font-size: 14px; }

/* Premium Banner */
.loyalty-premium-banner {
  display: flex;
  align-items: center;
  gap: 14px;
  background: linear-gradient(135deg, #1e1b4b, #312e81);
  border-radius: 14px;
  padding: 18px 20px;
  margin-bottom: 18px;
  color: #fff;
  flex-wrap: wrap;
}
.loyalty-premium-banner-icon { font-size: 28px; flex-shrink: 0; }
.loyalty-premium-banner-text {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 13px;
  opacity: 0.9;
  min-width: 200px;
}
.loyalty-premium-banner-text strong { font-size: 15px; font-weight: 700; opacity: 1; }
.loyalty-activate-btn {
  padding: 9px 20px;
  background: #fbbf24;
  color: #1e1b4b;
  border: none;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s;
}
.loyalty-activate-btn:hover { background: #f59e0b; }

/* Card */
.loyalty-card {
  background: #fff;
  border: 1.5px solid #e5e7eb;
  border-radius: 14px;
  padding: 20px;
  margin-bottom: 14px;
}
.loyalty-card--section { margin-bottom: 0; border-top: none; border-radius: 0 0 14px 14px; }

/* Toggle Card */
.loyalty-toggle-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.loyalty-toggle-card-left { flex: 1; }
.loyalty-toggle-label { display: flex; flex-direction: column; gap: 2px; }
.loyalty-toggle-title { font-weight: 600; font-size: 15px; color: #111827; }
.loyalty-toggle-desc { font-size: 13px; color: #6b7280; }

/* Toggle Switch */
.loyalty-toggle {
  width: 44px; height: 24px;
  border-radius: 12px;
  border: none;
  cursor: pointer;
  position: relative;
  transition: background 0.2s;
  flex-shrink: 0;
  outline: none;
}
.loyalty-toggle--on { background: #8b5cf6; }
.loyalty-toggle--off { background: #d1d5db; }
.loyalty-toggle--disabled { opacity: 0.5; cursor: not-allowed; }
.loyalty-toggle-thumb {
  position: absolute;
  width: 18px; height: 18px;
  background: #fff;
  border-radius: 50%;
  top: 3px;
  transition: left 0.2s;
  box-shadow: 0 1px 3px rgba(0,0,0,0.2);
}
.loyalty-toggle--on .loyalty-toggle-thumb { left: 23px; }
.loyalty-toggle--off .loyalty-toggle-thumb { left: 3px; }

/* Stats Grid */
.loyalty-stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 12px;
  margin-bottom: 14px;
}
.loyalty-stat-card {
  background: #fff;
  border: 1.5px solid #e5e7eb;
  border-radius: 12px;
  padding: 16px;
}
.loyalty-stat-label { font-size: 11px; font-weight: 600; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.05em; }
.loyalty-stat-value { font-size: 22px; font-weight: 700; color: #111827; margin: 4px 0; }
.loyalty-stat-sub { font-size: 11px; color: #9ca3af; }

/* Tier Distribution */
.loyalty-section-title { font-size: 14px; font-weight: 700; color: #111827; margin-bottom: 12px; }
.loyalty-section-desc { font-size: 13px; color: #6b7280; margin-bottom: 18px; }
.loyalty-tier-dist { display: flex; flex-direction: column; gap: 10px; }
.loyalty-tier-dist-item { display: flex; flex-direction: column; gap: 4px; }
.loyalty-tier-dist-bar-wrap {
  height: 8px; background: #f3f4f6; border-radius: 4px; overflow: hidden;
}
.loyalty-tier-dist-bar {
  height: 100%; border-radius: 4px;
  min-width: 4px;
  transition: width 0.4s ease;
}
.loyalty-tier-dist-label {
  display: flex; justify-content: space-between;
  font-size: 12px; font-weight: 600;
}

/* Section Nav */
.loyalty-section-nav {
  display: flex;
  gap: 0;
  background: #fff;
  border: 1.5px solid #e5e7eb;
  border-bottom: none;
  border-radius: 14px 14px 0 0;
  overflow: hidden;
  margin-top: 14px;
}
.loyalty-section-tab {
  flex: 1;
  padding: 12px 8px;
  font-size: 12px;
  font-weight: 600;
  background: none;
  border: none;
  cursor: pointer;
  color: #6b7280;
  transition: all 0.15s;
  border-bottom: 2px solid transparent;
  white-space: nowrap;
}
.loyalty-section-tab:hover { background: #f9fafb; color: #374151; }
.loyalty-section-tab--active {
  color: #7c3aed;
  border-bottom-color: #7c3aed;
  background: #faf5ff;
}

/* Fields */
.loyalty-field-group { display: flex; flex-direction: column; gap: 20px; }
.loyalty-field { display: flex; flex-direction: column; gap: 6px; }
.loyalty-field-label { font-size: 13px; font-weight: 600; color: #374151; }
.loyalty-field-hint { font-size: 12px; color: #9ca3af; margin: 2px 0 0; }
.loyalty-field-row { display: flex; align-items: center; gap: 8px; }
.loyalty-field-prefix { font-size: 13px; color: #6b7280; font-weight: 500; }
.loyalty-field-unit { font-size: 13px; color: #6b7280; }
.loyalty-field-eq { font-size: 16px; color: #9ca3af; margin: 0 4px; }
.loyalty-redemption-rate { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.loyalty-toggle-field { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }

/* Input */
.loyalty-input {
  padding: 8px 12px;
  border: 1.5px solid #d1d5db;
  border-radius: 8px;
  font-size: 13px;
  color: #111827;
  background: #fff;
  outline: none;
  transition: border-color 0.15s;
  width: 100%;
  box-sizing: border-box;
}
.loyalty-input:focus { border-color: #7c3aed; }
.loyalty-input--lg { font-size: 15px; padding: 10px 14px; }
.loyalty-input--sm { width: 90px; flex-shrink: 0; }

/* Preview Box */
.loyalty-preview-box {
  background: #f8fafc;
  border: 1.5px solid #e5e7eb;
  border-radius: 10px;
  padding: 14px;
  margin-top: 18px;
}
.loyalty-preview-title { font-size: 12px; font-weight: 700; color: #6b7280; margin-bottom: 10px; }
.loyalty-preview-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
  padding: 5px 0;
  border-bottom: 1px solid #e5e7eb;
  color: #374151;
  gap: 8px;
  flex-wrap: wrap;
}
.loyalty-preview-row:last-child { border-bottom: none; }
.loyalty-preview-zero { color: #9ca3af; }

/* Tier Rows */
.loyalty-tiers-list { display: flex; flex-direction: column; gap: 12px; margin-bottom: 14px; }
.loyalty-tier-row {
  display: flex;
  align-items: center;
  gap: 10px;
  background: #f9fafb;
  border: 1.5px solid #e5e7eb;
  border-radius: 10px;
  padding: 12px;
  flex-wrap: wrap;
}
.loyalty-tier-badge {
  width: 34px; height: 34px;
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 16px;
  flex-shrink: 0;
}
.loyalty-tier-name { width: 100px; flex-shrink: 0; }
.loyalty-tier-icon { width: 50px; text-align: center; }
.loyalty-tier-field { display: flex; align-items: center; gap: 4px; }
.loyalty-tier-field-label { font-size: 11px; color: #9ca3af; white-space: nowrap; }
.loyalty-tier-field-unit { font-size: 12px; color: #6b7280; }
.loyalty-tier-colors { display: flex; gap: 4px; flex-wrap: wrap; }
.loyalty-color-dot {
  width: 18px; height: 18px;
  border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer;
  transition: transform 0.15s, border-color 0.15s;
  flex-shrink: 0;
}
.loyalty-color-dot:hover { transform: scale(1.2); }
.loyalty-color-dot--active { border-color: #1e1b4b; transform: scale(1.15); }
.loyalty-tier-remove {
  width: 26px; height: 26px;
  background: #fee2e2; color: #dc2626;
  border: none; border-radius: 50%;
  cursor: pointer; font-size: 16px; font-weight: 700;
  display: flex; align-items: center; justify-content: center;
  line-height: 1;
  transition: background 0.15s;
}
.loyalty-tier-remove:hover { background: #fecaca; }
.loyalty-add-tier-btn {
  width: 100%;
  padding: 10px;
  background: none;
  border: 1.5px dashed #d1d5db;
  border-radius: 8px;
  color: #6b7280;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
  margin-bottom: 20px;
}
.loyalty-add-tier-btn:hover { background: #f9fafb; border-color: #7c3aed; color: #7c3aed; }

/* Tier Progress Preview */
.loyalty-tier-progress-preview {
  display: flex;
  flex-direction: column;
  gap: 0;
  border: 1.5px solid #e5e7eb;
  border-radius: 10px;
  overflow: hidden;
}
.loyalty-tier-progress-item {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 16px;
  position: relative;
  background: #fff;
  border-bottom: 1px solid #f3f4f6;
}
.loyalty-tier-progress-item:last-child { border-bottom: none; }
.loyalty-tier-progress-dot {
  width: 12px; height: 12px;
  border-radius: 50%;
  flex-shrink: 0;
}
.loyalty-tier-progress-info { display: flex; flex-direction: column; gap: 1px; }
.loyalty-tier-progress-name { font-size: 13px; font-weight: 700; }
.loyalty-tier-progress-req { font-size: 12px; color: #9ca3af; }
.loyalty-tier-progress-line {
  position: absolute;
  left: 21px; bottom: -6px;
  width: 2px; height: 12px;
  background: #e5e7eb;
  z-index: 1;
}

/* Info Box */
.loyalty-info-box {
  background: #f0f9ff;
  border: 1.5px solid #bae6fd;
  border-radius: 8px;
  padding: 12px 14px;
  font-size: 13px;
  color: #0369a1;
}

/* Footer */
.loyalty-footer {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 12px;
  margin-top: 24px;
  padding-top: 20px;
  border-top: 1px solid #e5e7eb;
}
.loyalty-save-error { font-size: 13px; color: #dc2626; }

@media (max-width: 640px) {
  .loyalty-header { flex-direction: column; }
  .loyalty-section-nav { flex-wrap: wrap; }
  .loyalty-section-tab { flex: none; min-width: 45%; }
  .loyalty-stats-grid { grid-template-columns: 1fr 1fr; }
  .loyalty-tier-row { flex-direction: column; align-items: flex-start; }
}
`

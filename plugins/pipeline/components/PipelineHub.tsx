'use client';

import React, { useState, useMemo, useCallback } from 'react';
import { Pipeline, PipelineType } from '../types';

// ─── Pipeline type config ─────────────────────────────────────────────────────
const PIPELINE_TYPE_CONFIG: Record<PipelineType, { label: string; icon: string; gradient: string; badge: string; badgeText: string }> = {
  sales: {
    label: 'Sales CRM',
    icon: '💼',
    gradient: 'from-blue-500 to-cyan-500',
    badge: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 border border-blue-200 dark:border-blue-800',
    badgeText: 'Penjualan',
  },
  productivity: {
    label: 'Produktivitas',
    icon: '⚡',
    gradient: 'from-violet-500 to-purple-600',
    badge: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300 border border-violet-200 dark:border-violet-800',
    badgeText: 'Produktivitas',
  },
  production: {
    label: 'Produksi',
    icon: '🏭',
    gradient: 'from-orange-500 to-amber-500',
    badge: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300 border border-orange-200 dark:border-orange-800',
    badgeText: 'Produksi',
  },
  hiring: {
    label: 'Rekrutmen',
    icon: '👥',
    gradient: 'from-emerald-500 to-teal-500',
    badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800',
    badgeText: 'Rekrutmen',
  },
  custom: {
    label: 'Kustom',
    icon: '📋',
    gradient: 'from-slate-500 to-gray-600',
    badge: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300 border border-gray-200 dark:border-gray-700',
    badgeText: 'Kustom',
  },
};

// ─── Format helpers ───────────────────────────────────────────────────────────
function formatIDR(value: number): string {
  if (!value) return 'Rp 0';
  if (value >= 1_000_000_000) return `Rp ${(value / 1_000_000_000).toFixed(1)}M`;
  if (value >= 1_000_000) return `Rp ${(value / 1_000_000).toFixed(1)}jt`;
  if (value >= 1_000) return `Rp ${(value / 1_000).toFixed(0)}rb`;
  return `Rp ${value}`;
}

function formatDate(isoString: string): string {
  return new Date(isoString).toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

// ─── Types ────────────────────────────────────────────────────────────────────
type ViewMode = 'grid' | 'list' | 'icon';
type SortBy = 'name' | 'created' | 'type' | 'cards';

interface PipelineHubProps {
  pipelines: Pipeline[];
  activeBusiness: { id: string; name?: string } | null;
  userProfile: { id: string; full_name?: string | null } | null;
  onSelectPipeline: (id: string) => void;
  onPipelineCreated: (pipeline: Pipeline) => void;
  onRefresh: () => void;
}

// ─── Create Modal ─────────────────────────────────────────────────────────────
function CreatePipelineModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (p: Pipeline) => void;
}) {
  const [name, setName] = useState('');
  const [type, setType] = useState<PipelineType>('sales');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || loading) return;
    setLoading(true);
    try {
      const res = await fetch('/api/pipeline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), type, description: description.trim() || undefined }),
      });
      const json = await res.json();
      if (!res.ok || !json.success || !json.pipeline) {
        alert('Gagal membuat pipeline: ' + (json.error || 'Terjadi kesalahan.'));
        return;
      }
      onCreated(json.pipeline);
    } catch (err: any) {
      alert('Error: ' + (err.message || 'Kesalahan jaringan.'));
    } finally {
      setLoading(false);
    }
  };

  const typeOptions: { value: PipelineType; label: string; desc: string; icon: string }[] = [
    { value: 'sales', label: 'Sales CRM', desc: 'Lead → Negosiasi → Deal Won/Lost', icon: '💼' },
    { value: 'productivity', label: 'Produktivitas & Task', desc: 'Backlog → In Progress → Done', icon: '⚡' },
    { value: 'production', label: 'Produksi / Manufaktur', desc: 'Pesanan → Proses → QC → Selesai', icon: '🏭' },
    { value: 'hiring', label: 'Rekrutmen / HR', desc: 'Pelamar → Interview → Hired', icon: '👥' },
    { value: 'custom', label: 'Kustom', desc: 'Atur stages sesuai kebutuhan Anda', icon: '📋' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 w-full max-w-lg overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-5 flex items-center justify-between">
          <div>
            <h3 className="text-base font-black text-white">Buat Pipeline Baru</h3>
            <p className="text-xs text-blue-100 mt-0.5">Pilih template workflow yang sesuai kebutuhan</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-xl bg-white/20 hover:bg-white/30 flex items-center justify-center text-white transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Name */}
          <div>
            <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1.5">Nama Pipeline <span className="text-red-500">*</span></label>
            <input
              type="text"
              required
              autoFocus
              placeholder="Contoh: Sales Q3 2026, Sprint October..."
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full px-4 py-2.5 text-sm bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900 dark:text-gray-100 font-semibold transition-all"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1.5">Deskripsi <span className="text-gray-400 font-normal">(opsional)</span></label>
            <textarea
              placeholder="Jelaskan tujuan pipeline ini..."
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={2}
              className="w-full px-4 py-2.5 text-sm bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900 dark:text-gray-100 resize-none transition-all"
            />
          </div>

          {/* Type selector */}
          <div>
            <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-2">Template Workflow</label>
            <div className="grid grid-cols-1 gap-2">
              {typeOptions.map(opt => (
                <label
                  key={opt.value}
                  className={`flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all ${
                    type === opt.value
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40'
                      : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 bg-white dark:bg-gray-800/50'
                  }`}
                >
                  <input type="radio" name="type" value={opt.value} checked={type === opt.value} onChange={() => setType(opt.value)} className="sr-only" />
                  <span className="text-xl">{opt.icon}</span>
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-bold text-gray-900 dark:text-gray-100 block">{opt.label}</span>
                    <span className="text-xs text-gray-500 dark:text-gray-400">{opt.desc}</span>
                  </div>
                  {type === opt.value && (
                    <div className="w-5 h-5 rounded-full bg-blue-600 flex items-center justify-center shrink-0">
                      <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                    </div>
                  )}
                </label>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-100 dark:border-gray-800">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl font-semibold transition-colors">
              Batal
            </button>
            <button
              type="submit"
              disabled={loading || !name.trim()}
              className="px-6 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-xl text-sm font-bold shadow-lg shadow-blue-500/25 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                  Membuat...
                </span>
              ) : '✦ Buat Pipeline'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Grid Card ────────────────────────────────────────────────────────────────
function PipelineGridCard({ pipeline, onClick }: { pipeline: Pipeline; onClick: () => void }) {
  const cfg = PIPELINE_TYPE_CONFIG[pipeline.type] || PIPELINE_TYPE_CONFIG.custom;
  const stagesCount = pipeline.stages?.length || 0;
  const cardsCount = (pipeline as any).cards_count || 0;

  return (
    <button
      onClick={onClick}
      className="group relative bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-5 text-left hover:shadow-xl hover:shadow-blue-500/10 dark:hover:shadow-blue-900/20 hover:-translate-y-1 transition-all duration-300 overflow-hidden focus:outline-none focus:ring-2 focus:ring-blue-500"
    >
      {/* Background accent */}
      <div className={`absolute top-0 right-0 w-32 h-32 bg-gradient-to-br ${cfg.gradient} opacity-5 group-hover:opacity-10 rounded-full -mr-10 -mt-10 transition-opacity duration-300`} />
      
      {/* Top row */}
      <div className="flex items-start justify-between mb-4">
        <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${cfg.gradient} flex items-center justify-center text-2xl shadow-lg group-hover:scale-110 transition-transform duration-300`}>
          {cfg.icon}
        </div>
        <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${cfg.badge}`}>
          {cfg.badgeText}
        </span>
      </div>

      {/* Name + description */}
      <div className="mb-4">
        <h3 className="text-sm font-black text-gray-900 dark:text-gray-100 truncate group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
          {pipeline.name}
        </h3>
        {pipeline.description && (
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 line-clamp-2 leading-relaxed">
            {pipeline.description}
          </p>
        )}
      </div>

      {/* Stats row */}
      <div className="flex items-center gap-3 mb-4">
        <div className="flex items-center gap-1.5">
          <div className="w-4 h-4 rounded-md bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
            <svg className="w-2.5 h-2.5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" /></svg>
          </div>
          <span className="text-xs font-bold text-gray-700 dark:text-gray-300">{stagesCount} Stage</span>
        </div>
        {cardsCount > 0 && (
          <div className="flex items-center gap-1.5">
            <div className="w-4 h-4 rounded-md bg-blue-50 dark:bg-blue-950/40 flex items-center justify-center">
              <svg className="w-2.5 h-2.5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
            </div>
            <span className="text-xs font-bold text-blue-600 dark:text-blue-400">{cardsCount} Card</span>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between pt-3 border-t border-gray-100 dark:border-gray-800">
        <span className="text-[10px] text-gray-400 dark:text-gray-500">
          {formatDate(pipeline.created_at)}
        </span>
        <span className="text-xs font-bold text-blue-600 dark:text-blue-400 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          Buka
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" /></svg>
        </span>
      </div>
    </button>
  );
}

// ─── List Row ─────────────────────────────────────────────────────────────────
function PipelineListRow({ pipeline, onClick }: { pipeline: Pipeline; onClick: () => void }) {
  const cfg = PIPELINE_TYPE_CONFIG[pipeline.type] || PIPELINE_TYPE_CONFIG.custom;
  const stagesCount = pipeline.stages?.length || 0;
  const cardsCount = (pipeline as any).cards_count || 0;

  return (
    <button
      onClick={onClick}
      className="group w-full flex items-center gap-4 px-5 py-4 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl hover:shadow-md hover:border-blue-300 dark:hover:border-blue-700 hover:-translate-y-0.5 transition-all text-left focus:outline-none focus:ring-2 focus:ring-blue-500"
    >
      {/* Icon */}
      <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${cfg.gradient} flex items-center justify-center text-xl shadow-sm shrink-0 group-hover:scale-105 transition-transform`}>
        {cfg.icon}
      </div>

      {/* Name + desc */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-black text-gray-900 dark:text-gray-100 truncate group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
            {pipeline.name}
          </span>
          <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${cfg.badge}`}>
            {cfg.badgeText}
          </span>
        </div>
        {pipeline.description && (
          <p className="text-xs text-gray-400 dark:text-gray-500 truncate mt-0.5">{pipeline.description}</p>
        )}
      </div>

      {/* Stats */}
      <div className="hidden sm:flex items-center gap-5 shrink-0 text-xs text-gray-500 dark:text-gray-400">
        <div className="text-center">
          <div className="font-black text-gray-800 dark:text-gray-200">{stagesCount}</div>
          <div className="text-[10px]">Stage</div>
        </div>
        <div className="text-center">
          <div className="font-black text-blue-600 dark:text-blue-400">{cardsCount}</div>
          <div className="text-[10px]">Card</div>
        </div>
        <div className="text-right">
          <div className="text-[10px] text-gray-400">{formatDate(pipeline.created_at)}</div>
        </div>
      </div>

      {/* Arrow */}
      <div className="shrink-0 w-7 h-7 rounded-lg bg-gray-100 dark:bg-gray-800 group-hover:bg-blue-50 dark:group-hover:bg-blue-950/40 flex items-center justify-center transition-colors">
        <svg className="w-3.5 h-3.5 text-gray-400 group-hover:text-blue-500 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
        </svg>
      </div>
    </button>
  );
}

// ─── Icon Card ────────────────────────────────────────────────────────────────
function PipelineIconCard({ pipeline, onClick }: { pipeline: Pipeline; onClick: () => void }) {
  const cfg = PIPELINE_TYPE_CONFIG[pipeline.type] || PIPELINE_TYPE_CONFIG.custom;
  return (
    <button
      onClick={onClick}
      className="group flex flex-col items-center gap-3 p-4 rounded-2xl hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-all focus:outline-none focus:ring-2 focus:ring-blue-500"
    >
      <div className={`w-16 h-16 rounded-2xl bg-gradient-to-br ${cfg.gradient} flex items-center justify-center text-3xl shadow-xl group-hover:scale-110 group-hover:shadow-2xl transition-all duration-300`}>
        {cfg.icon}
      </div>
      <div className="text-center">
        <div className="text-xs font-black text-gray-900 dark:text-gray-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors line-clamp-2 leading-tight max-w-[90px]">
          {pipeline.name}
        </div>
        <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">{cfg.label}</div>
      </div>
    </button>
  );
}

// ─── Empty State ──────────────────────────────────────────────────────────────
function EmptyState({ onCreateClick }: { onCreateClick: () => void }) {
  return (
    <div className="flex-1 flex items-center justify-center py-20 px-6">
      <div className="text-center max-w-sm space-y-6">
        {/* Animated icon group */}
        <div className="relative w-28 h-28 mx-auto">
          <div className="absolute inset-0 bg-gradient-to-br from-blue-100 to-indigo-100 dark:from-blue-950/40 dark:to-indigo-950/40 rounded-3xl animate-pulse" />
          <div className="absolute inset-0 flex items-center justify-center text-5xl">📊</div>
          {/* Floating icons */}
          <div className="absolute -top-2 -right-2 w-8 h-8 bg-white dark:bg-gray-800 shadow-lg rounded-xl flex items-center justify-center text-base animate-bounce" style={{ animationDelay: '0s', animationDuration: '2s' }}>💼</div>
          <div className="absolute -bottom-2 -left-2 w-8 h-8 bg-white dark:bg-gray-800 shadow-lg rounded-xl flex items-center justify-center text-base animate-bounce" style={{ animationDelay: '0.7s', animationDuration: '2s' }}>⚡</div>
        </div>

        <div>
          <h3 className="text-xl font-black text-gray-900 dark:text-gray-100 mb-2">Belum Ada Pipeline</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
            Buat pipeline pertama Anda untuk mengelola <strong>prospek penjualan</strong>, <strong>task tim</strong>, <strong>produksi</strong>, atau workflow apapun.
          </p>
        </div>

        {/* Template suggestions */}
        <div className="grid grid-cols-2 gap-2 text-left">
          {(['sales', 'productivity', 'production', 'hiring'] as PipelineType[]).map(t => {
            const c = PIPELINE_TYPE_CONFIG[t];
            return (
              <div key={t} className={`flex items-center gap-2 p-2.5 rounded-xl bg-gradient-to-br ${c.gradient} bg-opacity-10`} style={{ background: 'transparent' }}>
                <span className="text-lg">{c.icon}</span>
                <span className="text-xs font-bold text-gray-700 dark:text-gray-300">{c.label}</span>
              </div>
            );
          })}
        </div>

        <button
          onClick={onCreateClick}
          className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-xl font-bold text-sm shadow-lg shadow-blue-500/25 hover:shadow-blue-500/40 transition-all hover:-translate-y-0.5"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" /></svg>
          Buat Pipeline Pertama
        </button>
      </div>
    </div>
  );
}

// ─── Main PipelineHub Component ───────────────────────────────────────────────
export default function PipelineHub({
  pipelines,
  activeBusiness,
  userProfile,
  onSelectPipeline,
  onPipelineCreated,
  onRefresh,
}: PipelineHubProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState<PipelineType | 'all'>('all');
  const [sortBy, setSortBy] = useState<SortBy>('created');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Aggregate stats
  const stats = useMemo(() => {
    const totalCards = pipelines.reduce((s, p) => s + ((p as any).cards_count || 0), 0);
    const totalValue = pipelines.reduce((s, p) => s + ((p as any).total_value || 0), 0);
    return { totalCards, totalValue };
  }, [pipelines]);

  // Filtered & sorted pipelines
  const filtered = useMemo(() => {
    let result = [...pipelines];
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(p => p.name.toLowerCase().includes(q) || (p.description || '').toLowerCase().includes(q));
    }
    if (filterType !== 'all') {
      result = result.filter(p => p.type === filterType);
    }
    result.sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      if (sortBy === 'type') return a.type.localeCompare(b.type);
      if (sortBy === 'cards') return ((b as any).cards_count || 0) - ((a as any).cards_count || 0);
      // default: created (desc)
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
    return result;
  }, [pipelines, search, filterType, sortBy]);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await onRefresh();
    setIsRefreshing(false);
  }, [onRefresh]);

  const handlePipelineCreated = (p: Pipeline) => {
    setShowCreateModal(false);
    onPipelineCreated(p);
  };

  return (
    <div className="flex flex-col min-h-[calc(100vh-140px)] bg-gradient-to-br from-slate-50 via-blue-50/20 to-indigo-50/10 dark:from-gray-950 dark:via-gray-900 dark:to-gray-950 rounded-2xl overflow-hidden border border-gray-200 dark:border-gray-800">

      {/* ── Header ── */}
      <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm border-b border-gray-200 dark:border-gray-800 px-6 py-5 shrink-0">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          {/* Title */}
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center text-2xl shadow-lg shadow-blue-500/30">
              📊
            </div>
            <div>
              <h1 className="text-lg font-black text-gray-900 dark:text-gray-100 tracking-tight">Pipeline Hub</h1>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {activeBusiness?.name && <span className="font-semibold text-gray-600 dark:text-gray-300">{activeBusiness.name}</span>}
                {activeBusiness?.name ? ' · ' : ''}{pipelines.length} Pipeline Aktif
              </p>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            {/* Refresh */}
            <button
              onClick={handleRefresh}
              title="Refresh"
              className="p-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:border-blue-300 dark:hover:border-blue-700 transition-all"
            >
              <svg className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-blue-600' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>

            {/* View toggle */}
            <div className="flex items-center bg-gray-100 dark:bg-gray-800 rounded-xl p-1 gap-0.5">
              {([
                { mode: 'grid', icon: <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" /></svg>, title: 'Grid' },
                { mode: 'list', icon: <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" /></svg>, title: 'List' },
                { mode: 'icon', icon: <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2V5a2 2 0 00-2-2H5zM5 11a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2v-2a2 2 0 00-2-2H5zM11 5a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V5zM14 11a1 1 0 011 1v1h1a1 1 0 110 2h-1v1a1 1 0 11-2 0v-1h-1a1 1 0 110-2h1v-1a1 1 0 011-1z" /></svg>, title: 'Ikon' },
              ] as { mode: ViewMode; icon: React.ReactNode; title: string }[]).map(({ mode, icon, title }) => (
                <button
                  key={mode}
                  onClick={() => setViewMode(mode)}
                  title={title}
                  className={`p-2 rounded-lg transition-all ${viewMode === mode ? 'bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-400 shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'}`}
                >
                  {icon}
                </button>
              ))}
            </div>

            {/* Create button */}
            <button
              onClick={() => setShowCreateModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-xl text-xs font-bold shadow-lg shadow-blue-500/25 hover:shadow-blue-500/40 transition-all hover:-translate-y-0.5"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" /></svg>
              Pipeline Baru
            </button>
          </div>
        </div>

        {/* Stats bar */}
        {pipelines.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
              <span className="text-xs font-bold text-gray-700 dark:text-gray-300">{pipelines.length} Pipeline</span>
            </div>
            {stats.totalCards > 0 && (
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-indigo-500" />
                <span className="text-xs font-bold text-gray-700 dark:text-gray-300">{stats.totalCards} Card Aktif</span>
              </div>
            )}
            {stats.totalValue > 0 && (
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-emerald-500" />
                <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400">{formatIDR(stats.totalValue)} Total Pipeline Value</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Filters ── */}
      {pipelines.length > 0 && (
        <div className="px-6 py-3 bg-white/60 dark:bg-gray-900/60 backdrop-blur-sm border-b border-gray-100 dark:border-gray-800 flex flex-wrap items-center gap-3 shrink-0">
          {/* Search */}
          <div className="relative flex-1 min-w-[180px] max-w-xs">
            <input
              type="text"
              placeholder="Cari pipeline..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/50 text-gray-900 dark:text-gray-100 transition-all"
            />
            <svg className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
          </div>

          {/* Type filter */}
          <select
            value={filterType}
            onChange={e => setFilterType(e.target.value as PipelineType | 'all')}
            className="px-3 py-1.5 text-xs bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-gray-700 dark:text-gray-300 font-medium focus:outline-none"
          >
            <option value="all">Semua Tipe</option>
            <option value="sales">💼 Sales CRM</option>
            <option value="productivity">⚡ Produktivitas</option>
            <option value="production">🏭 Produksi</option>
            <option value="hiring">👥 Rekrutmen</option>
            <option value="custom">📋 Kustom</option>
          </select>

          {/* Sort */}
          <select
            value={sortBy}
            onChange={e => setSortBy(e.target.value as SortBy)}
            className="px-3 py-1.5 text-xs bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-gray-700 dark:text-gray-300 font-medium focus:outline-none"
          >
            <option value="created">Terbaru</option>
            <option value="name">Nama A–Z</option>
            <option value="type">Tipe</option>
            <option value="cards">Banyak Card</option>
          </select>

          {/* Result count */}
          {filtered.length !== pipelines.length && (
            <span className="text-xs text-gray-400 dark:text-gray-500">
              {filtered.length} hasil
            </span>
          )}
        </div>
      )}

      {/* ── Content ── */}
      <div className="flex-1 overflow-auto p-6">
        {pipelines.length === 0 ? (
          <EmptyState onCreateClick={() => setShowCreateModal(true)} />
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center space-y-3">
            <div className="text-4xl opacity-30">🔍</div>
            <p className="text-sm font-semibold text-gray-500 dark:text-gray-400">Tidak ada pipeline yang cocok</p>
            <button onClick={() => { setSearch(''); setFilterType('all'); }} className="text-xs text-blue-600 hover:text-blue-700 font-bold">Reset filter</button>
          </div>
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filtered.map(p => (
              <PipelineGridCard key={p.id} pipeline={p} onClick={() => onSelectPipeline(p.id)} />
            ))}
            {/* Create new card */}
            <button
              onClick={() => setShowCreateModal(true)}
              className="group flex flex-col items-center justify-center gap-3 p-5 rounded-2xl border-2 border-dashed border-gray-300 dark:border-gray-700 hover:border-blue-400 dark:hover:border-blue-600 hover:bg-blue-50/50 dark:hover:bg-blue-950/20 transition-all min-h-[180px]"
            >
              <div className="w-12 h-12 rounded-xl border-2 border-dashed border-gray-300 dark:border-gray-600 group-hover:border-blue-400 dark:group-hover:border-blue-500 flex items-center justify-center text-gray-400 group-hover:text-blue-500 transition-all">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" /></svg>
              </div>
              <span className="text-xs font-bold text-gray-500 dark:text-gray-400 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">Pipeline Baru</span>
            </button>
          </div>
        ) : viewMode === 'list' ? (
          <div className="space-y-2 max-w-4xl mx-auto">
            {filtered.map(p => (
              <PipelineListRow key={p.id} pipeline={p} onClick={() => onSelectPipeline(p.id)} />
            ))}
          </div>
        ) : (
          /* Icon view */
          <div className="flex flex-wrap gap-2 justify-start">
            {filtered.map(p => (
              <PipelineIconCard key={p.id} pipeline={p} onClick={() => onSelectPipeline(p.id)} />
            ))}
            <button
              onClick={() => setShowCreateModal(true)}
              className="group flex flex-col items-center gap-3 p-4 rounded-2xl hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-all"
            >
              <div className="w-16 h-16 rounded-2xl border-2 border-dashed border-gray-300 dark:border-gray-600 group-hover:border-blue-400 dark:group-hover:border-blue-500 flex items-center justify-center text-gray-400 group-hover:text-blue-500 transition-all">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
              </div>
              <span className="text-xs font-bold text-gray-500 dark:text-gray-400 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">Tambah</span>
            </button>
          </div>
        )}
      </div>

      {/* Create Modal */}
      {showCreateModal && (
        <CreatePipelineModal
          onClose={() => setShowCreateModal(false)}
          onCreated={handlePipelineCreated}
        />
      )}
    </div>
  );
}

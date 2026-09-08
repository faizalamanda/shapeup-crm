'use client';

import React, { useState } from 'react';
import { Pipeline, PipelineStage, PipelineMember, PipelineType, PipelineVisibility } from '../types';

interface PipelineSettingsProps {
  pipeline: Pipeline;
  stages: PipelineStage[];
  members: PipelineMember[];
  staffProfiles: { id: string; full_name?: string | null; email?: string | null }[];
  onClose: () => void;
  onUpdatePipeline: (updates: Partial<Pipeline>) => Promise<void>;
  onDeletePipeline: () => Promise<void>;
  onAddMember: (userId: string, role: PipelineMember['role']) => Promise<void>;
  onRemoveMember: (userId: string) => Promise<void>;
  onReorderStages: (orderedIds: string[]) => Promise<void>;
}

export default function PipelineSettings({
  pipeline,
  stages,
  members,
  staffProfiles,
  onClose,
  onUpdatePipeline,
  onDeletePipeline,
  onAddMember,
  onRemoveMember,
  onReorderStages,
}: PipelineSettingsProps) {
  const [activeTab, setActiveTab] = useState<'general' | 'access' | 'stages' | 'danger'>('general');

  // General tab form
  const [name, setName] = useState(pipeline.name);
  const [description, setDescription] = useState(pipeline.description || '');
  const [icon, setIcon] = useState(pipeline.icon || 'kanban');
  const [type, setType] = useState<PipelineType>(pipeline.type || 'sales');
  const [currency, setCurrency] = useState(pipeline.currency || 'IDR');
  const [visibility, setVisibility] = useState<PipelineVisibility>(pipeline.visibility || 'everyone');
  const [isSavingGeneral, setIsSavingGeneral] = useState(false);

  // Access tab form
  const [selectedStaffId, setSelectedStaffId] = useState('');
  const [selectedRole, setSelectedRole] = useState<PipelineMember['role']>('editor');
  const [isAddingMember, setIsAddingMember] = useState(false);

  // Stages tab reorder list
  const [stageList, setStageList] = useState<PipelineStage[]>(stages);
  const [isSavingStages, setIsSavingStages] = useState(false);

  const handleSaveGeneral = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setIsSavingGeneral(true);
      await onUpdatePipeline({
        name: name.trim(),
        description: description.trim() || null,
        icon,
        type,
        currency,
        visibility,
      });
      alert('Pengaturan umum berhasil disimpan.');
    } finally {
      setIsSavingGeneral(false);
    }
  };

  const handleAddMemberSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedStaffId || isAddingMember) return;

    try {
      setIsAddingMember(true);
      await onAddMember(selectedStaffId, selectedRole);
      setSelectedStaffId('');
    } finally {
      setIsAddingMember(false);
    }
  };

  const moveStageInList = (index: number, direction: 'up' | 'down') => {
    const updated = [...stageList];
    const targetIdx = direction === 'up' ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= updated.length) return;

    const temp = updated[index];
    updated[index] = updated[targetIdx];
    updated[targetIdx] = temp;

    setStageList(updated);
  };

  const handleSaveStageOrder = async () => {
    try {
      setIsSavingStages(true);
      const orderedIds = stageList.map((s) => s.id);
      await onReorderStages(orderedIds);
      alert('Urutan stage berhasil disimpan.');
    } finally {
      setIsSavingStages(false);
    }
  };

  const getInitials = (name?: string | null) => {
    if (!name) return 'U';
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .substring(0, 2)
      .toUpperCase();
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 animate-in fade-in duration-150">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between bg-gray-50/50 dark:bg-gray-900/40">
          <div>
            <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
              <svg className="w-5 h-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Pengaturan Pipeline: {pipeline.name}
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Konfigurasi tipe workflow, hak akses tim, dan susunan stage
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-xl transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-gray-200 dark:border-gray-700 bg-gray-50/30 dark:bg-gray-900/20 px-6">
          <button
            type="button"
            onClick={() => setActiveTab('general')}
            className={`py-3 px-4 text-xs font-bold border-b-2 transition-all ${
              activeTab === 'general'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400'
            }`}
          >
            Umum & Informasi
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('access')}
            className={`py-3 px-4 text-xs font-bold border-b-2 transition-all ${
              activeTab === 'access'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400'
            }`}
          >
            Hak Akses & Anggota ({members.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('stages')}
            className={`py-3 px-4 text-xs font-bold border-b-2 transition-all ${
              activeTab === 'stages'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400'
            }`}
          >
            Urutan Stage ({stages.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('danger')}
            className={`py-3 px-4 text-xs font-bold border-b-2 transition-all ${
              activeTab === 'danger'
                ? 'border-red-600 text-red-600 dark:text-red-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400'
            }`}
          >
            Zona Bahaya
          </button>
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
          
          {/* 1. General Tab */}
          {activeTab === 'general' && (
            <form onSubmit={handleSaveGeneral} className="space-y-4 max-w-xl">
              <div>
                <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                  Nama Pipeline
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-xl focus:border-blue-500 focus:outline-hidden text-gray-900 dark:text-gray-100 font-semibold"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                  Deskripsi Pipeline
                </label>
                <textarea
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Penjelasan singkat kegunaan pipeline ini..."
                  className="w-full px-3 py-2 text-xs bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-xl focus:border-blue-500 focus:outline-hidden text-gray-900 dark:text-gray-100"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                    Tipe Pipeline (Kategori)
                  </label>
                  <select
                    value={type}
                    onChange={(e) => setType(e.target.value as PipelineType)}
                    className="w-full px-3 py-2 text-xs bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-xl focus:outline-hidden text-gray-900 dark:text-gray-100 font-medium"
                  >
                    <option value="sales">Penjualan / Sales CRM</option>
                    <option value="productivity">Produktivitas & Tugas</option>
                    <option value="production">Manufaktur / Produksi</option>
                    <option value="hiring">Rekrutmen / HR</option>
                    <option value="custom">Kustom / Prosedur Khusus</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                    Mata Uang (Currency)
                  </label>
                  <select
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-xl focus:outline-hidden text-gray-900 dark:text-gray-100 font-medium"
                  >
                    <option value="IDR">IDR (Rupiah Indonesia)</option>
                    <option value="USD">USD (US Dollar)</option>
                    <option value="EUR">EUR (Euro)</option>
                    <option value="SGD">SGD (Singapore Dollar)</option>
                    <option value="MYR">MYR (Malaysian Ringgit)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                  Visibilitas Hak Akses
                </label>
                <div className="space-y-2 mt-1">
                  <label className="flex items-center gap-2.5 p-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-900/50 cursor-pointer">
                    <input
                      type="radio"
                      name="visibility"
                      value="everyone"
                      checked={visibility === 'everyone'}
                      onChange={() => setVisibility('everyone')}
                      className="text-blue-600 focus:ring-blue-500"
                    />
                    <div>
                      <div className="text-xs font-bold text-gray-800 dark:text-gray-200">Semua Anggota Bisnis (Everyone)</div>
                      <div className="text-[11px] text-gray-500">Seluruh staff di bisnis ini dapat melihat & mengakses pipeline ini.</div>
                    </div>
                  </label>

                  <label className="flex items-center gap-2.5 p-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-900/50 cursor-pointer">
                    <input
                      type="radio"
                      name="visibility"
                      value="members_only"
                      checked={visibility === 'members_only'}
                      onChange={() => setVisibility('members_only')}
                      className="text-blue-600 focus:ring-blue-500"
                    />
                    <div>
                      <div className="text-xs font-bold text-gray-800 dark:text-gray-200">Terbatas Hanya Anggota Terpilih (Members Only)</div>
                      <div className="text-[11px] text-gray-500">Hanya user yang didaftarkan di tab Hak Akses yang dapat melihat pipeline ini. User lain tidak melihatnya.</div>
                    </div>
                  </label>
                </div>
              </div>

              <div className="pt-4 flex justify-end">
                <button
                  type="submit"
                  disabled={isSavingGeneral}
                  className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-md disabled:opacity-50"
                >
                  {isSavingGeneral ? 'Menyimpan...' : 'Simpan Perubahan'}
                </button>
              </div>
            </form>
          )}

          {/* 2. Access / Members Tab */}
          {activeTab === 'access' && (
            <div className="space-y-6 max-w-2xl">
              <div>
                <h4 className="text-sm font-bold text-gray-800 dark:text-gray-200 mb-1">Tambah Anggota ke Pipeline</h4>
                <p className="text-xs text-gray-500 mb-3">
                  Pilih staff di bisnis Anda untuk memberikan akses ke pipeline ini.
                </p>

                <form onSubmit={handleAddMemberSubmit} className="flex gap-2 items-center">
                  <select
                    value={selectedStaffId}
                    onChange={(e) => setSelectedStaffId(e.target.value)}
                    className="flex-1 px-3 py-2 text-xs bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-xl text-gray-900 dark:text-gray-100 font-medium"
                  >
                    <option value="">-- Pilih Staff Bisnis --</option>
                    {staffProfiles
                      .filter((sp) => !members.some((m) => m.user_id === sp.id))
                      .map((sp) => (
                        <option key={sp.id} value={sp.id}>
                          {sp.full_name || sp.email}
                        </option>
                      ))}
                  </select>

                  <select
                    value={selectedRole}
                    onChange={(e) => setSelectedRole(e.target.value as PipelineMember['role'])}
                    className="w-32 px-3 py-2 text-xs bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-xl text-gray-900 dark:text-gray-100 font-medium"
                  >
                    <option value="editor">Editor</option>
                    <option value="owner">Owner</option>
                    <option value="viewer">Viewer</option>
                  </select>

                  <button
                    type="submit"
                    disabled={isAddingMember || !selectedStaffId}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-xs disabled:opacity-50 shrink-0"
                  >
                    + Tambah
                  </button>
                </form>
              </div>

              <div className="space-y-2">
                <h4 className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Daftar Anggota Berakses ({members.length})
                </h4>

                <div className="space-y-2 max-h-72 overflow-y-auto custom-scrollbar">
                  {members.map((m) => (
                    <div
                      key={m.id || m.user_id}
                      className="p-3 bg-gray-50 dark:bg-gray-900/60 rounded-xl border border-gray-200/80 dark:border-gray-700 flex items-center justify-between gap-3"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold">
                          {getInitials(m.profile?.full_name)}
                        </div>
                        <div>
                          <div className="text-xs font-bold text-gray-900 dark:text-gray-100">
                            {m.profile?.full_name || 'User'}
                          </div>
                          <div className="text-[11px] text-gray-500">{m.profile?.email || '-'}</div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300">
                          {m.role}
                        </span>

                        <button
                          type="button"
                          onClick={() => {
                            if (confirm(`Keluarkan ${m.profile?.full_name || 'user'} dari pipeline?`)) {
                              onRemoveMember(m.user_id);
                            }
                          }}
                          className="p-1.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-lg text-xs font-bold transition-colors"
                          title="Hapus akses"
                        >
                          &times;
                        </button>
                      </div>
                    </div>
                  ))}

                  {members.length === 0 && (
                    <div className="text-xs text-gray-400 py-4 text-center border border-dashed border-gray-200 dark:border-gray-800 rounded-xl">
                      Belum ada anggota terdaftar.
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* 3. Stages Order Tab */}
          {activeTab === 'stages' && (
            <div className="space-y-4 max-w-xl">
              <p className="text-xs text-gray-500">
                Gunakan tombol panah untuk merubah urutan stage di Kanban board Anda.
              </p>

              <div className="space-y-2">
                {stageList.map((st, idx) => (
                  <div
                    key={st.id}
                    className="p-3 bg-gray-50 dark:bg-gray-900/60 rounded-xl border border-gray-200/80 dark:border-gray-700 flex items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-3">
                      <span className="w-4 h-4 rounded-full shrink-0" style={{ backgroundColor: st.color }} />
                      <span className="text-xs font-bold text-gray-800 dark:text-gray-200">{st.name}</span>
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        disabled={idx === 0}
                        onClick={() => moveStageInList(idx, 'up')}
                        className="p-1.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-xs disabled:opacity-30 hover:bg-gray-100"
                        title="Naikkan"
                      >
                        ▲
                      </button>
                      <button
                        type="button"
                        disabled={idx === stageList.length - 1}
                        onClick={() => moveStageInList(idx, 'down')}
                        className="p-1.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-xs disabled:opacity-30 hover:bg-gray-100"
                        title="Turunkan"
                      >
                        ▼
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="pt-4 flex justify-end">
                <button
                  type="button"
                  onClick={handleSaveStageOrder}
                  disabled={isSavingStages}
                  className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-md disabled:opacity-50"
                >
                  {isSavingStages ? 'Menyimpan...' : 'Simpan Urutan Stage'}
                </button>
              </div>
            </div>
          )}

          {/* 4. Danger Zone */}
          {activeTab === 'danger' && (
            <div className="p-4 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800/60 rounded-2xl space-y-4 max-w-xl">
              <div>
                <h4 className="text-sm font-bold text-red-800 dark:text-red-300">Hapus Seluruh Pipeline Ini</h4>
                <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                  Tindakan ini akan menghapus permanen pipeline "{pipeline.name}", beserta semua stage, kartu, dan riwayat aktivitas di dalamnya. Tindakan ini tidak dapat dibatalkan!
                </p>
              </div>

              <button
                type="button"
                onClick={() => {
                  if (confirm(`APAKAH ANDA YAKIN ingin menghapus pipeline "${pipeline.name}" secara permanen?`)) {
                    onDeletePipeline();
                    onClose();
                  }
                }}
                className="px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold shadow-md transition-all"
              >
                Hapus Pipeline Permanen
              </button>
            </div>
          )}

        </div>

      </div>
    </div>
  );
}

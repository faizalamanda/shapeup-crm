'use client';

import React, { useState, useEffect } from 'react';
import { PipelineCard, PipelineStage, PipelineActivity, CardLabel, CardPriority, CardStatus } from '../types';
import { formatCurrency } from '../helpers/kanbanUtils';

interface CardModalProps {
  card: PipelineCard | null;
  stages: PipelineStage[];
  staffProfiles: { id: string; full_name?: string | null; email?: string | null }[];
  currency: string;
  onClose: () => void;
  onUpdateCard: (cardId: string, updates: Partial<PipelineCard>) => Promise<void>;
  onDeleteCard: (cardId: string) => Promise<void>;
  onFetchActivities: (cardId: string) => Promise<PipelineActivity[]>;
  onAddComment: (cardId: string, text: string) => Promise<void>;
}

const PRESET_LABEL_COLORS = [
  { name: 'Prioritas Tinggi', color: '#EF4444' },
  { name: 'Klien VIP', color: '#8B5CF6' },
  { name: 'Penting', color: '#F59E0B' },
  { name: 'Tindak Lanjut', color: '#3B82F6' },
  { name: 'Produksi', color: '#10B981' },
];

export default function CardModal({
  card,
  stages,
  staffProfiles,
  currency,
  onClose,
  onUpdateCard,
  onDeleteCard,
  onFetchActivities,
  onAddComment,
}: CardModalProps) {
  if (!card) return null;

  const [title, setTitle] = useState(card.title);
  const [description, setDescription] = useState(card.description || '');
  const [stageId, setStageId] = useState(card.stage_id);
  const [value, setValue] = useState(String(card.value || 0));
  const [priority, setPriority] = useState<CardPriority>(card.priority || 'medium');
  const [status, setStatus] = useState<CardStatus>(card.status || 'active');
  const [assigneeId, setAssigneeId] = useState(card.assignee_id || '');
  const [dueDate, setDueDate] = useState(card.due_date ? card.due_date.substring(0, 10) : '');
  const [labels, setLabels] = useState<CardLabel[]>(card.labels || []);
  
  // Custom label addition
  const [newLabelName, setNewLabelName] = useState('');
  const [newLabelColor, setNewLabelColor] = useState('#3B82F6');
  const [showLabelPicker, setShowLabelPicker] = useState(false);

  // Activity log state
  const [activities, setActivities] = useState<PipelineActivity[]>([]);
  const [loadingActivities, setLoadingActivities] = useState(true);
  const [commentText, setCommentText] = useState('');
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let isMounted = true;
    if (card?.id) {
      setLoadingActivities(true);
      onFetchActivities(card.id).then((acts) => {
        if (isMounted) {
          setActivities(acts || []);
          setLoadingActivities(false);
        }
      });
    }
    return () => {
      isMounted = false;
    };
  }, [card?.id]);

  const handleSaveField = async (fieldUpdates: Partial<PipelineCard>) => {
    try {
      setIsSaving(true);
      await onUpdateCard(card.id, fieldUpdates);
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddCommentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commentText.trim() || isSubmittingComment) return;

    try {
      setIsSubmittingComment(true);
      await onAddComment(card.id, commentText.trim());
      setCommentText('');
      const updatedActs = await onFetchActivities(card.id);
      setActivities(updatedActs || []);
    } finally {
      setIsSubmittingComment(false);
    }
  };

  const handleAddLabel = (name: string, color: string) => {
    if (!name.trim()) return;
    const exists = labels.some((l) => l.name.toLowerCase() === name.toLowerCase());
    if (exists) return;

    const newLabelObj = { id: String(Date.now()), name: name.trim(), color };
    const updated = [...labels, newLabelObj];
    setLabels(updated);
    handleSaveField({ labels: updated });
    setNewLabelName('');
    setShowLabelPicker(false);
  };

  const handleRemoveLabel = (labelId: string) => {
    const updated = labels.filter((l) => l.id !== labelId);
    setLabels(updated);
    handleSaveField({ labels: updated });
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
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
        
        {/* Header bar */}
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between gap-4 bg-gray-50/50 dark:bg-gray-900/40">
          <div className="flex items-center gap-3 min-w-0">
            {/* Status toggle pill */}
            <div className="flex items-center bg-gray-200 dark:bg-gray-700 p-0.5 rounded-lg text-xs font-semibold">
              <button
                type="button"
                onClick={() => {
                  setStatus('active');
                  handleSaveField({ status: 'active' });
                }}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  status === 'active' ? 'bg-white dark:bg-gray-800 text-blue-600 dark:text-blue-400 shadow-xs' : 'text-gray-600 dark:text-gray-400'
                }`}
              >
                Aktif
              </button>
              <button
                type="button"
                onClick={() => {
                  setStatus('won');
                  handleSaveField({ status: 'won' });
                }}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  status === 'won' ? 'bg-emerald-600 text-white shadow-xs' : 'text-gray-600 dark:text-gray-400 hover:text-emerald-600'
                }`}
              >
                Won
              </button>
              <button
                type="button"
                onClick={() => {
                  setStatus('lost');
                  handleSaveField({ status: 'lost' });
                }}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  status === 'lost' ? 'bg-red-600 text-white shadow-xs' : 'text-gray-600 dark:text-gray-400 hover:text-red-600'
                }`}
              >
                Lost
              </button>
            </div>

            {isSaving && (
              <span className="text-xs text-blue-600 dark:text-blue-400 animate-pulse font-medium">
                Menyimpan...
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                if (confirm('Hapus kartu ini secara permanen?')) {
                  onDeleteCard(card.id);
                  onClose();
                }
              }}
              className="p-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-xl transition-colors text-xs font-semibold flex items-center gap-1"
              title="Hapus Kartu"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              Hapus
            </button>

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
        </div>

        {/* Modal Main Content (2-Column Grid on desktop) */}
        <div className="flex-1 overflow-y-auto p-6 grid grid-cols-1 lg:grid-cols-3 gap-6 custom-scrollbar">
          
          {/* Left Column: Details & Editing (2 cols) */}
          <div className="lg:col-span-2 space-y-6">
            
            {/* Title Input */}
            <div>
              <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">
                Judul Kartu
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={() => {
                  if (title.trim() && title !== card.title) {
                    handleSaveField({ title: title.trim() });
                  }
                }}
                className="w-full text-xl font-bold px-3 py-2 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl focus:border-blue-500 focus:outline-hidden text-gray-900 dark:text-gray-100"
              />
            </div>

            {/* Labels section */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Label / Tag
                </label>
                <button
                  type="button"
                  onClick={() => setShowLabelPicker(!showLabelPicker)}
                  className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline"
                >
                  + Tambah Label
                </button>
              </div>

              <div className="flex flex-wrap gap-2 items-center">
                {labels.map((label) => (
                  <span
                    key={label.id}
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold text-white shadow-xs"
                    style={{ backgroundColor: label.color || '#3B82F6' }}
                  >
                    {label.name}
                    <button
                      type="button"
                      onClick={() => handleRemoveLabel(label.id)}
                      className="hover:opacity-75 focus:outline-hidden"
                    >
                      &times;
                    </button>
                  </span>
                ))}

                {labels.length === 0 && !showLabelPicker && (
                  <span className="text-xs text-gray-400 italic">Belum ada label</span>
                )}
              </div>

              {/* Label Picker Popover */}
              {showLabelPicker && (
                <div className="mt-3 p-3 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl space-y-3 animate-in fade-in duration-100">
                  <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">Pilih Preset atau Buat Kustom</div>
                  <div className="flex flex-wrap gap-1.5">
                    {PRESET_LABEL_COLORS.map((preset) => (
                      <button
                        key={preset.name}
                        type="button"
                        onClick={() => handleAddLabel(preset.name, preset.color)}
                        className="px-2.5 py-1 rounded-md text-xs font-medium text-white shadow-xs transition-transform hover:scale-105"
                        style={{ backgroundColor: preset.color }}
                      >
                        + {preset.name}
                      </button>
                    ))}
                  </div>

                  <div className="flex gap-2 pt-2 border-t border-gray-200 dark:border-gray-800">
                    <input
                      type="text"
                      placeholder="Nama label kustom..."
                      value={newLabelName}
                      onChange={(e) => setNewLabelName(e.target.value)}
                      className="flex-1 px-2.5 py-1 text-xs bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-gray-900 dark:text-gray-100"
                    />
                    <input
                      type="color"
                      value={newLabelColor}
                      onChange={(e) => setNewLabelColor(e.target.value)}
                      className="w-8 h-8 p-0.5 rounded-lg border border-gray-300 dark:border-gray-700 cursor-pointer"
                    />
                    <button
                      type="button"
                      onClick={() => handleAddLabel(newLabelName, newLabelColor)}
                      className="px-3 py-1 bg-blue-600 text-white rounded-lg text-xs font-semibold"
                    >
                      Tambah
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Description Textarea */}
            <div>
              <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">
                Deskripsi / Catatan Detail
              </label>
              <textarea
                rows={5}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                onBlur={() => {
                  if (description !== (card.description || '')) {
                    handleSaveField({ description: description.trim() });
                  }
                }}
                placeholder="Tuliskan instruksi, spesifikasi, atau catatan penting..."
                className="w-full text-sm p-3 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl focus:border-blue-500 focus:outline-hidden text-gray-900 dark:text-gray-100 resize-y"
              />
            </div>

            {/* Activity & Comment Timeline */}
            <div className="pt-4 border-t border-gray-200 dark:border-gray-700 space-y-4">
              <h4 className="text-sm font-bold text-gray-800 dark:text-gray-200 flex items-center gap-2">
                <svg className="w-4 h-4 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Aktivitas & Diskusi Tim
              </h4>

              {/* Add Comment Input */}
              <form onSubmit={handleAddCommentSubmit} className="flex gap-2">
                <input
                  type="text"
                  placeholder="Tulis komentar atau update..."
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  className="flex-1 px-3 py-2 text-xs bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl focus:border-blue-500 focus:outline-hidden text-gray-900 dark:text-gray-100"
                />
                <button
                  type="submit"
                  disabled={isSubmittingComment || !commentText.trim()}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold shadow-xs disabled:opacity-50"
                >
                  Kirim
                </button>
              </form>

              {/* Timeline list */}
              {loadingActivities ? (
                <div className="text-xs text-gray-400 py-4 text-center">Memuat riwayat aktivitas...</div>
              ) : (
                <div className="space-y-3 max-h-60 overflow-y-auto custom-scrollbar pr-1">
                  {activities.map((act) => (
                    <div key={act.id} className="p-3 bg-gray-50/70 dark:bg-gray-900/60 rounded-xl border border-gray-100 dark:border-gray-800 text-xs flex gap-3">
                      <div className="w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">
                        {getInitials(act.user?.full_name)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between text-gray-500 dark:text-gray-400">
                          <span className="font-semibold text-gray-800 dark:text-gray-200">
                            {act.user?.full_name || 'Anggota Tim'}
                          </span>
                          <span className="text-[10px]">
                            {new Date(act.created_at).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' })}
                          </span>
                        </div>
                        
                        {act.activity_type === 'comment' ? (
                          <p className="mt-1 text-gray-800 dark:text-gray-200 font-medium">
                            {act.details.comment_text || act.details.text}
                          </p>
                        ) : act.activity_type === 'stage_change' ? (
                          <p className="mt-0.5 text-blue-600 dark:text-blue-400 font-medium">
                            Memindahkan dari <span className="font-bold">{act.details.from_stage_name}</span> ke <span className="font-bold">{act.details.to_stage_name}</span>
                          </p>
                        ) : (
                          <p className="mt-0.5 text-gray-600 dark:text-gray-400">
                            Pembaruan kartu ({act.activity_type})
                          </p>
                        )}
                      </div>
                    </div>
                  ))}

                  {activities.length === 0 && (
                    <div className="text-xs text-gray-400 py-3 text-center">Belum ada riwayat aktivitas.</div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Right Column: Properties Sidebar (1 col) */}
          <div className="bg-gray-50 dark:bg-gray-900/50 p-4 rounded-2xl border border-gray-200/80 dark:border-gray-800 space-y-4">
            
            {/* Stage Selector */}
            <div>
              <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 mb-1">
                Stage Pipeline
              </label>
              <select
                value={stageId}
                onChange={(e) => {
                  const newSt = e.target.value;
                  setStageId(newSt);
                  handleSaveField({ stage_id: newSt });
                }}
                className="w-full px-3 py-2 text-xs font-semibold bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl focus:outline-hidden text-gray-900 dark:text-gray-100"
              >
                {stages.map((st) => (
                  <option key={st.id} value={st.id}>
                    {st.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Value / Amount */}
            <div>
              <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 mb-1">
                Nilai / Target (Optional - {currency})
              </label>
              <input
                type="number"
                min="0"
                step="1000"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onBlur={() => {
                  const valNum = Number(value) || 0;
                  if (valNum !== card.value) {
                    handleSaveField({ value: valNum });
                  }
                }}
                className="w-full px-3 py-2 text-xs font-bold bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl focus:outline-hidden text-gray-900 dark:text-gray-100"
              />
              <span className="text-[11px] text-gray-400 mt-0.5 block">
                Formatted: {formatCurrency(Number(value) || 0, currency)}
              </span>
            </div>

            {/* Assignee Selector */}
            <div>
              <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 mb-1">
                Penanggung Jawab (Assignee)
              </label>
              <select
                value={assigneeId}
                onChange={(e) => {
                  const val = e.target.value || null;
                  setAssigneeId(val || '');
                  handleSaveField({ assignee_id: val });
                }}
                className="w-full px-3 py-2 text-xs font-semibold bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl focus:outline-hidden text-gray-900 dark:text-gray-100"
              >
                <option value="">-- Belum Ditentukan --</option>
                {staffProfiles.map((staff) => (
                  <option key={staff.id} value={staff.id}>
                    {staff.full_name || staff.email}
                  </option>
                ))}
              </select>
            </div>

            {/* Priority Selector */}
            <div>
              <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 mb-1">
                Tingkat Prioritas
              </label>
              <select
                value={priority}
                onChange={(e) => {
                  const val = e.target.value as CardPriority;
                  setPriority(val);
                  handleSaveField({ priority: val });
                }}
                className="w-full px-3 py-2 text-xs font-semibold bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl focus:outline-hidden text-gray-900 dark:text-gray-100"
              >
                <option value="low">Rendah (Low)</option>
                <option value="medium">Sedang (Medium)</option>
                <option value="high">Tinggi (High)</option>
                <option value="urgent">Urgent / Sangat Tinggi</option>
              </select>
            </div>

            {/* Due Date Picker */}
            <div>
              <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 mb-1">
                Batas Waktu (Due Date)
              </label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => {
                  const val = e.target.value || null;
                  setDueDate(val || '');
                  handleSaveField({ due_date: val });
                }}
                className="w-full px-3 py-2 text-xs font-semibold bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl focus:outline-hidden text-gray-900 dark:text-gray-100"
              />
            </div>

            <div className="pt-2 border-t border-gray-200 dark:border-gray-800 text-[11px] text-gray-400 space-y-1">
              <div>Dibuat pada: {new Date(card.created_at).toLocaleDateString('id-ID')}</div>
              <div>Diperbarui: {new Date(card.updated_at).toLocaleDateString('id-ID')}</div>
            </div>
          </div>

        </div>

      </div>
    </div>
  );
}

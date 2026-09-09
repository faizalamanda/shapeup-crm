'use client';

import React, { useState } from 'react';
import { PipelineStage, PipelineCard } from '../types';
import CardItem from './CardItem';
import StageColorPicker from './StageColorPicker';
import { formatCurrency, isWipLimitExceeded } from '../helpers/kanbanUtils';

interface KanbanColumnProps {
  stage: PipelineStage;
  cards: PipelineCard[];
  currency: string;
  onUpdateStage: (stageId: string, updates: Partial<PipelineStage>) => void;
  onDeleteStage: (stageId: string) => void;
  onCreateCard: (stageId: string, title: string) => Promise<void>;
  onCardClick: (card: PipelineCard) => void;
  onDropCard: (targetStageId: string) => void;
  onDragStartCard: (e: React.DragEvent, card: PipelineCard) => void;
  onDragStartColumn?: (e: React.DragEvent, stageId: string) => void;
}

export default function KanbanColumn({
  stage,
  cards,
  currency,
  onUpdateStage,
  onDeleteStage,
  onCreateCard,
  onCardClick,
  onDropCard,
  onDragStartCard,
  onDragStartColumn,
}: KanbanColumnProps) {
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleInput, setTitleInput] = useState(stage.name);
  const [isDragOver, setIsDragOver] = useState(false);

  // Quick card add state
  const [isAddingCard, setIsAddingCard] = useState(false);
  const [newCardTitle, setNewCardTitle] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Stage menu popover state
  const [showStageMenu, setShowStageMenu] = useState(false);
  const [wipInput, setWipInput] = useState(stage.wip_limit ? String(stage.wip_limit) : '');

  const totalStageValue = cards.reduce((sum, card) => sum + (Number(card.value) || 0), 0);
  const isExceeded = isWipLimitExceeded(stage, cards.length);

  const handleTitleSubmit = () => {
    if (titleInput.trim() && titleInput !== stage.name) {
      onUpdateStage(stage.id, { name: titleInput.trim() });
    } else {
      setTitleInput(stage.name);
    }
    setIsEditingTitle(false);
  };

  const handleQuickAddCard = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCardTitle.trim() || isSubmitting) return;

    try {
      setIsSubmitting(true);
      await onCreateCard(stage.id, newCardTitle.trim());
      setNewCardTitle('');
      setIsAddingCard(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleWipSave = () => {
    const limit = wipInput ? parseInt(wipInput, 10) : null;
    onUpdateStage(stage.id, { wip_limit: isNaN(limit!) ? null : limit });
    setShowStageMenu(false);
  };

  const [sortBy, setSortBy] = useState<'manual' | 'alpha_asc' | 'alpha_desc' | 'created_desc' | 'created_asc' | 'value_desc' | 'value_asc'>('manual');

  const sortedCards = [...cards].sort((a, b) => {
    switch (sortBy) {
      case 'alpha_asc':
        return a.title.localeCompare(b.title);
      case 'alpha_desc':
        return b.title.localeCompare(a.title);
      case 'created_desc':
        return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
      case 'created_asc':
        return new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime();
      case 'value_desc':
        return (b.value || 0) - (a.value || 0);
      case 'value_asc':
        return (a.value || 0) - (b.value || 0);
      default:
        return 0;
    }
  });

  const handleCopyText = async () => {
    let text = `Stage: ${stage.name}\n`;
    text += `Total Kartu: ${cards.length}\n`;
    if (totalStageValue > 0) {
      text += `Total Nilai: ${formatCurrency(totalStageValue, currency)}\n`;
    }
    text += `\nDaftar Kartu:\n`;
    sortedCards.forEach((card, index) => {
      text += `${index + 1}. ${card.title}`;
      if (card.value > 0) {
        text += ` - ${formatCurrency(card.value, currency)}`;
      }
      text += '\n';
    });
    
    try {
      await navigator.clipboard.writeText(text);
      alert('Berhasil disalin ke clipboard!');
      setShowStageMenu(false);
    } catch (err) {
      console.error('Gagal menyalin:', err);
      alert('Gagal menyalin ke clipboard');
    }
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragOver(true);
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragOver(false);
        onDropCard(stage.id);
      }}
      className={`w-72 sm:w-80 shrink-0 flex flex-col rounded-2xl bg-gray-100/80 dark:bg-gray-900/60 border transition-colors duration-150 max-h-full ${
        isDragOver
          ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-950/20 ring-2 ring-blue-400/30'
          : 'border-gray-200/80 dark:border-gray-800'
      }`}
    >
      {/* Column Header */}
      <div className="p-3.5 pb-2 flex flex-col gap-1.5 border-b border-gray-200/60 dark:border-gray-800/80">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            {/* Color indicator / picker */}
            <StageColorPicker
              currentColor={stage.color || '#3B82F6'}
              onChangeColor={(color) => onUpdateStage(stage.id, { color })}
            />

            {/* Editable Stage Name */}
            {isEditingTitle ? (
              <input
                type="text"
                value={titleInput}
                onChange={(e) => setTitleInput(e.target.value)}
                onBlur={handleTitleSubmit}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleTitleSubmit();
                  if (e.key === 'Escape') {
                    setTitleInput(stage.name);
                    setIsEditingTitle(false);
                  }
                }}
                autoFocus
                className="w-full px-2 py-0.5 text-sm font-bold bg-white dark:bg-gray-800 border border-blue-500 rounded-md focus:outline-hidden text-gray-900 dark:text-gray-100"
              />
            ) : (
              <h3
                onClick={() => setIsEditingTitle(true)}
                className="text-sm font-bold text-gray-800 dark:text-gray-200 truncate cursor-pointer hover:text-blue-600 dark:hover:text-blue-400"
                title="Klik untuk ubah nama stage"
              >
                {stage.name}
              </h3>
            )}

            {/* Card Count & WIP Limit Badge */}
            <span
              className={`px-2 py-0.5 rounded-full text-xs font-semibold shrink-0 ${
                isExceeded
                  ? 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400 border border-red-300'
                  : 'bg-gray-200 dark:bg-gray-800 text-gray-700 dark:text-gray-300'
              }`}
              title={stage.wip_limit ? `WIP Limit: ${stage.wip_limit}` : 'Jumlah Kartu'}
            >
              {cards.length} {stage.wip_limit ? `/ ${stage.wip_limit}` : ''}
            </span>
          </div>

          {/* Stage Menu button */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowStageMenu(!showStageMenu)}
              className="p-1 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors"
              title="Opsi stage"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
              </svg>
            </button>

            {/* Stage Menu Popover */}
            {showStageMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowStageMenu(false)} />
                <div className="absolute right-0 mt-1 w-56 p-3 bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 z-50 animate-in fade-in zoom-in-95 duration-100 text-xs">
                  <div className="font-semibold text-gray-700 dark:text-gray-300 mb-2">Pengaturan Stage</div>
                  
                  {/* WIP Limit setting */}
                  <div className="mb-3">
                    <label className="block text-[11px] text-gray-500 dark:text-gray-400 mb-1">
                      Batas WIP (Work in Progress):
                    </label>
                    <div className="flex gap-1.5">
                      <input
                        type="number"
                        min="1"
                        placeholder="Tanpa batas"
                        value={wipInput}
                        onChange={(e) => setWipInput(e.target.value)}
                        className="w-full px-2 py-1 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-md focus:outline-hidden text-gray-900 dark:text-gray-100"
                      />
                      <button
                        type="button"
                        onClick={handleWipSave}
                        className="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-md font-medium"
                      >
                        Simpan
                      </button>
                    </div>
                  </div>

                  <hr className="my-2 border-gray-100 dark:border-gray-700" />

                  {/* Sorting settings */}
                  <div className="mb-3">
                    <label className="block text-[11px] text-gray-500 dark:text-gray-400 mb-1">
                      Urutkan Kartu:
                    </label>
                    <select
                      value={sortBy}
                      onChange={(e) => setSortBy(e.target.value as any)}
                      className="w-full px-2 py-1.5 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-md focus:outline-hidden text-gray-900 dark:text-gray-100 text-xs"
                    >
                      <option value="manual">Manual (Default)</option>
                      <option value="alpha_asc">Abjad (A - Z)</option>
                      <option value="alpha_desc">Abjad (Z - A)</option>
                      <option value="created_desc">Terbaru Dibuat</option>
                      <option value="created_asc">Terlama Dibuat</option>
                      <option value="value_desc">Nilai Terbesar</option>
                      <option value="value_asc">Nilai Terkecil</option>
                    </select>
                  </div>

                  <hr className="my-2 border-gray-100 dark:border-gray-700" />

                  {/* Copy state button */}
                  <button
                    type="button"
                    onClick={handleCopyText}
                    className="w-full text-left px-2 py-1.5 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md font-medium flex items-center gap-1.5 transition-colors mb-1"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                    </svg>
                    Salin Isi Stage (Teks)
                  </button>

                  {/* Delete stage button */}
                  <button
                    type="button"
                    onClick={() => {
                      setShowStageMenu(false);
                      if (confirm(`Hapus stage "${stage.name}" dan semua kartunya?`)) {
                        onDeleteStage(stage.id);
                      }
                    }}
                    className="w-full text-left px-2 py-1.5 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-md font-medium flex items-center gap-1.5 transition-colors"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                    Hapus Stage Ini
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Total Value Bar */}
        {totalStageValue > 0 && (
          <div className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 flex items-center justify-between">
            <span>Total Nilai:</span>
            <span className="text-gray-800 dark:text-gray-200 font-bold">{formatCurrency(totalStageValue, currency)}</span>
          </div>
        )}
      </div>

      {/* Cards List Container */}
      <div className="p-2 flex-1 overflow-y-auto min-h-[150px] space-y-2.5 custom-scrollbar">
        {sortedCards.map((card) => (
          <CardItem
            key={card.id}
            card={card}
            currency={currency}
            onCardClick={onCardClick}
            onDragStartCard={onDragStartCard}
          />
        ))}

        {cards.length === 0 && !isAddingCard && (
          <div className="h-24 flex items-center justify-center border-2 border-dashed border-gray-200 dark:border-gray-800 rounded-xl text-xs text-gray-400 dark:text-gray-600 font-medium">
            Belum ada kartu
          </div>
        )}
      </div>

      {/* Footer / Quick Add Form */}
      <div className="p-2 border-t border-gray-200/60 dark:border-gray-800/80">
        {isAddingCard ? (
          <form onSubmit={handleQuickAddCard} className="space-y-2">
            <textarea
              value={newCardTitle}
              onChange={(e) => setNewCardTitle(e.target.value)}
              placeholder="Masukkan judul kartu..."
              rows={2}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleQuickAddCard(e);
                }
              }}
              className="w-full p-2 text-xs bg-white dark:bg-gray-800 border border-blue-500 rounded-xl focus:outline-hidden text-gray-900 dark:text-gray-100 shadow-xs resize-none"
            />
            <div className="flex items-center justify-end gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setIsAddingCard(false);
                  setNewCardTitle('');
                }}
                className="px-2.5 py-1 text-xs text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-800 rounded-lg font-medium"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={isSubmitting || !newCardTitle.trim()}
                className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold shadow-xs disabled:opacity-50"
              >
                {isSubmitting ? 'Menyimpan...' : 'Tambah'}
              </button>
            </div>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setIsAddingCard(true)}
            className="w-full py-2 px-3 flex items-center justify-center gap-1.5 text-xs font-semibold text-gray-600 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-gray-200/70 dark:hover:bg-gray-800/70 rounded-xl transition-all"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Tambah Kartu Baru
          </button>
        )}
      </div>
    </div>
  );
}

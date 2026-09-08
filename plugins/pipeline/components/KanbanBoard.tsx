'use client';

import React, { useState } from 'react';
import { PipelineStage, PipelineCard } from '../types';
import KanbanColumn from './KanbanColumn';

interface KanbanBoardProps {
  stages: PipelineStage[];
  cards: PipelineCard[];
  currency: string;
  onUpdateStage: (stageId: string, updates: Partial<PipelineStage>) => void;
  onDeleteStage: (stageId: string) => void;
  onCreateStage: (name: string) => Promise<void>;
  onCreateCard: (stageId: string, title: string) => Promise<void>;
  onCardClick: (card: PipelineCard) => void;
  onMoveCard: (cardId: string, targetStageId: string, newDisplayOrder: number) => Promise<void>;
}

export default function KanbanBoard({
  stages,
  cards,
  currency,
  onUpdateStage,
  onDeleteStage,
  onCreateStage,
  onCreateCard,
  onCardClick,
  onMoveCard,
}: KanbanBoardProps) {
  const [draggedCard, setDraggedCard] = useState<PipelineCard | null>(null);

  // Quick stage creation state
  const [isAddingStage, setIsAddingStage] = useState(false);
  const [newStageName, setNewStageName] = useState('');
  const [isCreatingStage, setIsCreatingStage] = useState(false);

  const handleDragStartCard = (e: React.DragEvent, card: PipelineCard) => {
    setDraggedCard(card);
    e.dataTransfer.setData('text/plain', card.id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDropCard = async (targetStageId: string) => {
    if (!draggedCard) return;

    if (draggedCard.stage_id === targetStageId) {
      setDraggedCard(null);
      return;
    }

    // Determine position: push to end of target stage
    const cardsInTargetStage = cards.filter((c) => c.stage_id === targetStageId);
    const newOrder = cardsInTargetStage.length;

    const cardToMove = draggedCard;
    setDraggedCard(null);

    await onMoveCard(cardToMove.id, targetStageId, newOrder);
  };

  const handleAddStageSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStageName.trim() || isCreatingStage) return;

    try {
      setIsCreatingStage(true);
      await onCreateStage(newStageName.trim());
      setNewStageName('');
      setIsAddingStage(false);
    } finally {
      setIsCreatingStage(false);
    }
  };

  return (
    <div className="flex-1 min-h-0 overflow-x-auto custom-scrollbar p-4 flex gap-4 items-start">
      {stages.map((stage) => {
        const stageCards = cards
          .filter((c) => c.stage_id === stage.id)
          .sort((a, b) => a.display_order - b.display_order);

        return (
          <KanbanColumn
            key={stage.id}
            stage={stage}
            cards={stageCards}
            currency={currency}
            onUpdateStage={onUpdateStage}
            onDeleteStage={onDeleteStage}
            onCreateCard={onCreateCard}
            onCardClick={onCardClick}
            onDropCard={handleDropCard}
            onDragStartCard={handleDragStartCard}
          />
        );
      })}

      {/* Add New Stage Column */}
      <div className="w-72 sm:w-80 shrink-0">
        {isAddingStage ? (
          <form
            onSubmit={handleAddStageSubmit}
            className="p-3 bg-white dark:bg-gray-800 border border-blue-500 rounded-2xl shadow-md space-y-2.5"
          >
            <input
              type="text"
              placeholder="Nama Stage Baru..."
              value={newStageName}
              onChange={(e) => setNewStageName(e.target.value)}
              autoFocus
              className="w-full px-3 py-1.5 text-xs font-semibold bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-xl focus:outline-hidden text-gray-900 dark:text-gray-100"
            />
            <div className="flex items-center justify-end gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setIsAddingStage(false);
                  setNewStageName('');
                }}
                className="px-3 py-1 text-xs text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg font-medium"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={isCreatingStage || !newStageName.trim()}
                className="px-3.5 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold shadow-xs disabled:opacity-50"
              >
                {isCreatingStage ? 'Menyimpan...' : 'Tambah Stage'}
              </button>
            </div>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setIsAddingStage(true)}
            className="w-full h-14 border-2 border-dashed border-gray-300 dark:border-gray-700 hover:border-blue-500 dark:hover:border-blue-400 rounded-2xl flex items-center justify-center gap-2 text-xs font-bold text-gray-600 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-all bg-white/40 dark:bg-gray-800/40"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
            </svg>
            Tambah Stage Baru
          </button>
        )}
      </div>
    </div>
  );
}

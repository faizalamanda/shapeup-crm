'use client';

import React from 'react';
import { PipelineCard } from '../types';
import { formatCurrency, formatDueDateStatus } from '../helpers/kanbanUtils';

interface CardItemProps {
  card: PipelineCard;
  currency: string;
  onCardClick: (card: PipelineCard) => void;
  onDragStartCard: (e: React.DragEvent, card: PipelineCard) => void;
}

export default function CardItem({ card, currency, onCardClick, onDragStartCard }: CardItemProps) {
  const dueStatus = formatDueDateStatus(card.due_date);

  const getPriorityBadge = (priority: string) => {
    switch (priority) {
      case 'urgent':
        return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300">Urgent</span>;
      case 'high':
        return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">Tinggi</span>;
      case 'medium':
        return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300">Sedang</span>;
      case 'low':
      default:
        return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300">Rendah</span>;
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
    <div
      draggable
      onDragStart={(e) => onDragStartCard(e, card)}
      onClick={() => onCardClick(card)}
      className={`group relative p-3.5 bg-white dark:bg-gray-800 rounded-xl border border-gray-200/80 dark:border-gray-700/80 shadow-xs hover:shadow-md transition-all duration-150 cursor-grab active:cursor-grabbing hover:-translate-y-0.5 ${
        card.status === 'won' ? 'ring-1 ring-emerald-500/40 bg-emerald-50/20 dark:bg-emerald-950/10' : ''
      } ${card.status === 'lost' ? 'opacity-70 bg-gray-50/50 dark:bg-gray-900/40' : ''}`}
    >
      {/* Top Labels row */}
      {card.labels && card.labels.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {card.labels.map((label) => (
            <span
              key={label.id || label.name}
              className="inline-block px-2 py-0.5 rounded-md text-[10px] font-semibold text-white shadow-xs"
              style={{ backgroundColor: label.color || '#3B82F6' }}
            >
              {label.name}
            </span>
          ))}
        </div>
      )}

      {/* Card Title */}
      <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 line-clamp-2 leading-snug">
        {card.title}
      </h4>

      {/* Description Preview if present */}
      {card.description && (
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400 line-clamp-2 leading-relaxed">
          {card.description}
        </p>
      )}

      {/* Value if present */}
      {card.value > 0 && (
        <div className="mt-2.5 text-xs font-bold text-gray-800 dark:text-gray-200 flex items-center gap-1">
          <svg className="w-3.5 h-3.5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {formatCurrency(Number(card.value), currency)}
        </div>
      )}

      {/* Footer row: Priority, Due Date, Assignee */}
      <div className="mt-3 pt-2.5 border-t border-gray-100 dark:border-gray-700/60 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          {getPriorityBadge(card.priority)}

          {/* Due date indicator */}
          {dueStatus.text && (
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium ${dueStatus.colorClass}`}>
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 002-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              {dueStatus.text}
            </span>
          )}
        </div>

        {/* Assignee Avatar */}
        {card.assignee ? (
          <div
            className="w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center text-[10px] font-bold ring-2 ring-white dark:ring-gray-800 overflow-hidden shrink-0"
            title={card.assignee.full_name || 'Ter-assign'}
          >
            <div className="w-full h-full bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 flex items-center justify-center font-bold text-[10px]">
              {(card.assignee.full_name || card.assignee.email || '?').charAt(0).toUpperCase()}
            </div>
          </div>
        ) : (
          <div className="w-6 h-6 rounded-full border border-dashed border-gray-300 dark:border-gray-600 flex items-center justify-center text-gray-400 text-[10px] shrink-0" title="Belum ada penanggung jawab">
            ?
          </div>
        )}
      </div>
    </div>
  );
}

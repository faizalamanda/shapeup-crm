import { PipelineCard, PipelineStage, KanbanFilterState, PipelineStatsSummary, PipelineType } from '../types';

/**
 * Format currency with internationalization support
 */
export function formatCurrency(amount: number, currencyCode: string = 'IDR'): string {
  if (amount === undefined || amount === null) return '0';
  
  if (currencyCode === 'IDR') {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      maximumFractionDigits: 0,
    }).format(amount);
  }

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currencyCode,
    maximumFractionDigits: 0,
  }).format(amount);
}

/**
 * Default color palette for pipeline stages
 */
export const STAGE_COLORS = [
  '#3B82F6', // Blue
  '#6366F1', // Indigo
  '#8B5CF6', // Purple
  '#EC4899', // Pink
  '#F43F5E', // Rose
  '#EF4444', // Red
  '#F97316', // Orange
  '#F59E0B', // Amber
  '#10B981', // Emerald
  '#06B6D4', // Cyan
  '#64748B', // Slate
];

/**
 * Default stage presets based on pipeline type
 */
export function getDefaultStagePresets(type: PipelineType = 'sales'): { name: string; color: string; wip_limit?: number | null; is_won_stage?: boolean; is_lost_stage?: boolean }[] {
  switch (type) {
    case 'sales':
      return [
        { name: 'Prospek Baru', color: '#3B82F6' },
        { name: 'Kualifikasi', color: '#6366F1' },
        { name: 'Presentasi / Penawaran', color: '#8B5CF6' },
        { name: 'Negosiasi', color: '#F59E0B' },
        { name: 'Won (Berhasil)', color: '#10B981', is_won_stage: true },
        { name: 'Lost (Gagal)', color: '#EF4444', is_lost_stage: true },
      ];
    case 'productivity':
      return [
        { name: 'Backlog / Ide', color: '#64748B' },
        { name: 'Siap Dikerjakan', color: '#3B82F6' },
        { name: 'Sedang Berlangsung', color: '#F59E0B' },
        { name: 'Dalam Review', color: '#8B5CF6' },
        { name: 'Selesai', color: '#10B981', is_won_stage: true },
      ];
    case 'production':
      return [
        { name: 'Pesanan Masuk', color: '#3B82F6' },
        { name: 'Persiapan Bahan', color: '#6366F1' },
        { name: 'Proses Manufaktur', color: '#F97316' },
        { name: 'Quality Control', color: '#F59E0B' },
        { name: 'Siap Kirim / Selesai', color: '#10B981', is_won_stage: true },
      ];
    case 'hiring':
      return [
        { name: 'Pelamar Masuk', color: '#3B82F6' },
        { name: 'Skrining CV', color: '#6366F1' },
        { name: 'Interview HR', color: '#8B5CF6' },
        { name: 'Interview User', color: '#F59E0B' },
        { name: 'Offered / Hired', color: '#10B981', is_won_stage: true },
        { name: 'Ditolak', color: '#EF4444', is_lost_stage: true },
      ];
    case 'custom':
    default:
      return [
        { name: 'To Do', color: '#3B82F6' },
        { name: 'In Progress', color: '#F59E0B' },
        { name: 'Done', color: '#10B981', is_won_stage: true },
      ];
  }
}

/**
 * Filter cards based on filter state
 */
export function filterCards(cards: PipelineCard[], filters: KanbanFilterState): PipelineCard[] {
  return cards.filter((card) => {
    // Search query match (title, description)
    if (filters.search.trim() !== '') {
      const q = filters.search.toLowerCase();
      const matchTitle = card.title.toLowerCase().includes(q);
      const matchDesc = card.description ? card.description.toLowerCase().includes(q) : false;
      if (!matchTitle && !matchDesc) return false;
    }

    // Assignee filter
    if (filters.assigneeId !== 'all') {
      if (filters.assigneeId === 'unassigned') {
        if (card.assignee_id) return false;
      } else if (card.assignee_id !== filters.assigneeId) {
        return false;
      }
    }

    // Priority filter
    if (filters.priority !== 'all' && card.priority !== filters.priority) {
      return false;
    }

    // Status filter
    if (filters.status !== 'all' && card.status !== filters.status) {
      return false;
    }

    // Label filter
    if (filters.labelId !== 'all') {
      const hasLabel = card.labels && card.labels.some((l) => l.id === filters.labelId);
      if (!hasLabel) return false;
    }

    return true;
  });
}

/**
 * Check if stage WIP limit is exceeded
 */
export function isWipLimitExceeded(stage: PipelineStage, currentCardCount: number): boolean {
  if (!stage.wip_limit || stage.wip_limit <= 0) return false;
  return currentCardCount >= stage.wip_limit;
}

/**
 * Compute overall pipeline statistics summary
 */
export function calculatePipelineStats(stages: PipelineStage[], cards: PipelineCard[]): PipelineStatsSummary {
  let totalCards = 0;
  let totalValue = 0;
  let wonCards = 0;
  let wonValue = 0;
  let lostCards = 0;

  const stageStatsMap = new Map<string, { stageId: string; stageName: string; color: string; count: number; value: number }>();

  stages.forEach((stage) => {
    stageStatsMap.set(stage.id, {
      stageId: stage.id,
      stageName: stage.name,
      color: stage.color,
      count: 0,
      value: 0,
    });
  });

  cards.forEach((card) => {
    if (card.status === 'archived') return;

    totalCards += 1;
    const val = Number(card.value) || 0;
    totalValue += val;

    if (card.status === 'won') {
      wonCards += 1;
      wonValue += val;
    } else if (card.status === 'lost') {
      lostCards += 1;
    }

    const st = stageStatsMap.get(card.stage_id);
    if (st) {
      st.count += 1;
      st.value += val;
    }
  });

  const closedCards = wonCards + lostCards;
  const conversionRate = closedCards > 0 ? (wonCards / closedCards) * 100 : 0;

  return {
    totalCards,
    totalValue,
    wonCards,
    wonValue,
    lostCards,
    conversionRate: Math.round(conversionRate * 10) / 10,
    stageStats: Array.from(stageStatsMap.values()),
  };
}

/**
 * Format due date indicator with relative labels
 */
export function formatDueDateStatus(dueDateStr?: string | null): { text: string; colorClass: string; isOverdue: boolean } {
  if (!dueDateStr) return { text: '', colorClass: '', isOverdue: false };

  const due = new Date(dueDateStr);
  const now = new Date();
  
  // Set both to start of day for comparison
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());

  const diffTime = dueDay.getTime() - today.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  const formattedDate = due.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });

  if (diffDays < 0) {
    return {
      text: `Terlambat (${formattedDate})`,
      colorClass: 'bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-400 border border-red-200 dark:border-red-800',
      isOverdue: true,
    };
  } else if (diffDays === 0) {
    return {
      text: `Hari ini (${formattedDate})`,
      colorClass: 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-200 dark:border-amber-800',
      isOverdue: false,
    };
  } else if (diffDays === 1) {
    return {
      text: `Besok (${formattedDate})`,
      colorClass: 'bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-400 border border-blue-200 dark:border-blue-800',
      isOverdue: false,
    };
  } else {
    return {
      text: formattedDate,
      colorClass: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
      isOverdue: false,
    };
  }
}

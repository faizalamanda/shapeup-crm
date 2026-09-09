'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { useUserContext } from '@/components/UserContext';
import {
  Pipeline,
  PipelineStage,
  PipelineCard,
  PipelineActivity,
  PipelineMember,
  KanbanFilterState,
  CardPriority,
  CardStatus,
  PipelineType,
} from '../types';
import {
  fetchPipelines,
  fetchPipelineById,
  createPipeline,
  updatePipeline,
  deletePipeline,
  createStage,
  updateStage,
  reorderStages,
  deleteStage,
  fetchPipelineCards,
  createCard,
  updateCard,
  moveCard,
  deleteCard,
  fetchCardActivities,
  addCardActivity,
  fetchBusinessStaffProfiles,
  fetchPipelineMembers,
  addPipelineMember,
  removePipelineMember,
} from '../helpers/pipelineApi';
import { filterCards, calculatePipelineStats } from '../helpers/kanbanUtils';
import KanbanBoard from './KanbanBoard';
import PipelineStats from './PipelineStats';
import PipelineSettings from './PipelineSettings';
import CardModal from './CardModal';

export default function PipelineMain() {
  const { activeBusiness, userProfile } = useUserContext();
  
  const supabase = useMemo(() => {
    return createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || '',
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
    );
  }, []);

  // Pipelines state
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [selectedPipelineId, setSelectedPipelineId] = useState<string>('');
  const [activePipeline, setActivePipeline] = useState<Pipeline | null>(null);
  
  // Board Data state
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [cards, setCards] = useState<PipelineCard[]>([]);
  const [members, setMembers] = useState<PipelineMember[]>([]);
  const [staffProfiles, setStaffProfiles] = useState<{ id: string; full_name?: string | null; email?: string | null }[]>([]);

  // Sync state
  const [isSyncing, setIsSyncing] = useState(false);
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(false);

  // UI Modals & Filters
  const [loading, setLoading] = useState(true);
  const [showStats, setShowStats] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [selectedCardForModal, setSelectedCardForModal] = useState<PipelineCard | null>(null);
  
  // Create Pipeline Modal state
  const [showCreatePipelineModal, setShowCreatePipelineModal] = useState(false);
  const [newPipelineName, setNewPipelineName] = useState('');
  const [newPipelineType, setNewPipelineType] = useState<PipelineType>('sales');
  const [isCreatingPipeline, setIsCreatingPipeline] = useState(false);

  // Filter state
  const [filters, setFilters] = useState<KanbanFilterState>({
    search: '',
    assigneeId: 'all',
    priority: 'all',
    status: 'active',
    labelId: 'all',
  });

  // Load business staff & pipeline list on mount or active business change
  useEffect(() => {
    if (!activeBusiness?.id) return;

    let isMounted = true;
    setLoading(true);

    const initData = async () => {
      // 1. Fetch staff profiles
      const { data: staff } = await fetchBusinessStaffProfiles(supabase, activeBusiness.id);
      if (isMounted && staff) setStaffProfiles(staff);

      // 2. Fetch pipelines accessible to user
      const { data: pipeList } = await fetchPipelines(supabase, activeBusiness.id, userProfile?.id);
      if (isMounted) {
        setPipelines(pipeList || []);
        if (pipeList && pipeList.length > 0) {
          // Select first pipeline by default if none selected
          if (!selectedPipelineId || !pipeList.some((p) => p.id === selectedPipelineId)) {
            setSelectedPipelineId(pipeList[0].id);
          }
        } else {
          setSelectedPipelineId('');
          setActivePipeline(null);
          setStages([]);
          setCards([]);
        }
        setLoading(false);
      }
    };

    initData();

    return () => {
      isMounted = false;
    };
  }, [activeBusiness?.id, userProfile?.id, supabase]);

  // Load selected pipeline detail (stages, cards, members) when selectedPipelineId changes
  useEffect(() => {
    if (!selectedPipelineId) return;

    let isMounted = true;
    const loadPipelineDetail = async () => {
      setIsSyncing(true);
      try {
        const { data: pipe } = await fetchPipelineById(supabase, selectedPipelineId);
        if (!isMounted || !pipe) return;

        setActivePipeline(pipe);
        setStages(pipe.stages || []);

        // Fetch cards
        const { data: cardList } = await fetchPipelineCards(supabase, selectedPipelineId);
        if (isMounted) setCards(cardList || []);

        // Fetch members
        const { data: memberList } = await fetchPipelineMembers(supabase, selectedPipelineId);
        if (isMounted) setMembers(memberList || []);
      } finally {
        if (isMounted) setIsSyncing(false);
      }
    };

    loadPipelineDetail();

    return () => {
      isMounted = false;
    };
  }, [selectedPipelineId, supabase]);

  // Manual sync handler
  const handleManualSync = async () => {
    if (!selectedPipelineId) return;
    setIsSyncing(true);
    try {
      const { data: pipe } = await fetchPipelineById(supabase, selectedPipelineId);
      if (pipe) {
        setActivePipeline(pipe);
        setStages(pipe.stages || []);
      }
      const { data: cardList } = await fetchPipelineCards(supabase, selectedPipelineId);
      if (cardList) setCards(cardList || []);
      const { data: memberList } = await fetchPipelineMembers(supabase, selectedPipelineId);
      if (memberList) setMembers(memberList || []);
    } catch (err) {
      console.error('Manual sync error', err);
    } finally {
      setIsSyncing(false);
    }
  };

  // Auto sync effect
  useEffect(() => {
    if (!autoSyncEnabled || !selectedPipelineId) return;
    const intervalId = setInterval(async () => {
      try {
        const { data: pipe } = await fetchPipelineById(supabase, selectedPipelineId);
        if (pipe) {
          setActivePipeline(pipe);
          setStages(pipe.stages || []);
        }
        const { data: cardList } = await fetchPipelineCards(supabase, selectedPipelineId);
        if (cardList) setCards(cardList || []);
        const { data: memberList } = await fetchPipelineMembers(supabase, selectedPipelineId);
        if (memberList) setMembers(memberList || []);
      } catch (err) {
        console.error('Auto sync error', err);
      }
    }, 60000); // sync every 60 seconds (1 menit) untuk menghemat resource (CPU/RAM/Supabase Free Tier)

    return () => clearInterval(intervalId);
  }, [autoSyncEnabled, selectedPipelineId, supabase]);

  // Filtered Cards Memo
  const filteredCards = useMemo(() => {
    return filterCards(cards, filters);
  }, [cards, filters]);

  // Stats calculation
  const statsSummary = useMemo(() => {
    return calculatePipelineStats(stages, cards);
  }, [stages, cards]);

  // Handlers for Pipeline Actions
  const handleCreatePipelineSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPipelineName.trim() || !activeBusiness?.id || isCreatingPipeline) return;

    try {
      setIsCreatingPipeline(true);
      const res = await fetch('/api/pipeline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newPipelineName.trim(),
          type: newPipelineType,
        }),
      });

      const json = await res.json();
      if (!res.ok || !json.success || !json.pipeline) {
        alert('Gagal membuat pipeline baru: ' + (json.error || 'Terjadi kesalahan pada server.'));
        return;
      }

      const newPipe = json.pipeline;
      setPipelines((prev) => [...prev, newPipe]);
      setSelectedPipelineId(newPipe.id);
      setNewPipelineName('');
      setShowCreatePipelineModal(false);
    } catch (err: any) {
      alert('Gagal membuat pipeline baru: ' + (err.message || 'Kesalahan jaringan.'));
    } finally {
      setIsCreatingPipeline(false);
    }
  };

  const handleUpdatePipeline = async (updates: Partial<Pipeline>) => {
    if (!selectedPipelineId) return;
    try {
      const res = await fetch(`/api/pipeline/${selectedPipelineId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      const json = await res.json();
      if (json.success && json.pipeline) {
        const updated = json.pipeline;
        setActivePipeline(updated);
        setPipelines((prev) => prev.map((p) => (p.id === updated.id ? { ...p, ...updated } : p)));
      } else {
        alert('Gagal memperbarui pipeline: ' + (json.error || 'Terjadi kesalahan.'));
      }
    } catch (err: any) {
      alert('Gagal memperbarui pipeline: ' + (err.message || 'Kesalahan jaringan.'));
    }
  };

  const handleDeletePipeline = async () => {
    if (!selectedPipelineId) return;
    try {
      const res = await fetch(`/api/pipeline/${selectedPipelineId}`, {
        method: 'DELETE',
      });
      const json = await res.json();
      if (json.success) {
        const updatedList = pipelines.filter((p) => p.id !== selectedPipelineId);
        setPipelines(updatedList);
        if (updatedList.length > 0) {
          setSelectedPipelineId(updatedList[0].id);
        } else {
          setSelectedPipelineId('');
          setActivePipeline(null);
          setStages([]);
          setCards([]);
        }
      } else {
        alert('Gagal menghapus pipeline: ' + (json.error || 'Terjadi kesalahan.'));
      }
    } catch (err: any) {
      alert('Gagal menghapus pipeline: ' + (err.message || 'Kesalahan jaringan.'));
    }
  };

  // Stage handlers
  const handleCreateStage = async (name: string) => {
    if (!selectedPipelineId) return;
    const { data: newSt } = await createStage(supabase, {
      pipeline_id: selectedPipelineId,
      name,
    });
    if (newSt) {
      setStages((prev) => [...prev, newSt]);
    }
  };

  const handleUpdateStage = async (stageId: string, updates: Partial<PipelineStage>) => {
    const { data: updated } = await updateStage(supabase, stageId, updates);
    if (updated) {
      setStages((prev) => prev.map((s) => (s.id === stageId ? { ...s, ...updated } : s)));
    }
  };

  const handleReorderStages = async (orderedIds: string[]) => {
    if (!selectedPipelineId) return;
    await reorderStages(supabase, selectedPipelineId, orderedIds);
    setStages((prev) => {
      const sorted = [...prev].sort((a, b) => orderedIds.indexOf(a.id) - orderedIds.indexOf(b.id));
      return sorted;
    });
  };

  const handleDeleteStage = async (stageId: string) => {
    await deleteStage(supabase, stageId);
    setStages((prev) => prev.filter((s) => s.id !== stageId));
    setCards((prev) => prev.filter((c) => c.stage_id !== stageId));
  };

  // Card handlers
  const handleCreateCard = async (stageId: string, title: string) => {
    if (!selectedPipelineId) return;
    const { data: newC } = await createCard(supabase, {
      pipeline_id: selectedPipelineId,
      stage_id: stageId,
      title,
      created_by: userProfile?.id,
    });
    if (newC) {
      setCards((prev) => [...prev, newC]);
    }
  };

  const handleUpdateCard = async (cardId: string, updates: Partial<PipelineCard>) => {
    // Optimistic UI update
    setCards((prev) => prev.map((c) => (c.id === cardId ? { ...c, ...updates } : c)));
    if (selectedCardForModal && selectedCardForModal.id === cardId) {
      setSelectedCardForModal((prev) => (prev ? { ...prev, ...updates } : null));
    }

    const { data: updated } = await updateCard(supabase, cardId, updates, userProfile?.id);
    if (updated) {
      setCards((prev) => prev.map((c) => (c.id === cardId ? updated : c)));
    }
  };

  const handleMoveCard = async (cardId: string, targetStageId: string, newDisplayOrder: number) => {
    // Optimistic UI update
    setCards((prev) =>
      prev.map((c) =>
        c.id === cardId ? { ...c, stage_id: targetStageId, display_order: newDisplayOrder } : c
      )
    );

    await moveCard(supabase, {
      card_id: cardId,
      target_stage_id: targetStageId,
      new_display_order: newDisplayOrder,
      user_id: userProfile?.id,
    });
  };

  const handleDeleteCard = async (cardId: string) => {
    await deleteCard(supabase, cardId);
    setCards((prev) => prev.filter((c) => c.id !== cardId));
  };

  // Activity handlers
  const handleFetchActivities = async (cardId: string) => {
    const { data } = await fetchCardActivities(supabase, cardId);
    return data || [];
  };

  const handleAddComment = async (cardId: string, text: string) => {
    await addCardActivity(supabase, cardId, userProfile?.id, 'comment', { comment_text: text });
  };

  // Member management handlers
  const handleAddMember = async (userId: string, role: PipelineMember['role']) => {
    if (!selectedPipelineId) return;
    const { data: newM } = await addPipelineMember(supabase, selectedPipelineId, userId, role);
    if (newM) {
      setMembers((prev) => [...prev.filter((m) => m.user_id !== userId), newM]);
    }
  };

  const handleRemoveMember = async (userId: string) => {
    if (!selectedPipelineId) return;
    await removePipelineMember(supabase, selectedPipelineId, userId);
    setMembers((prev) => prev.filter((m) => m.user_id !== userId));
  };

  return (
    <div className="flex-1 flex flex-col min-h-[calc(100vh-160px)] bg-gray-50/50 dark:bg-gray-950/50 font-sans">
      
      {/* Top Header & Filter Toolbar */}
      <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 p-3 sm:px-6 shrink-0 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          
          {/* Pipeline Dropdown & Title */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-600/10 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400 flex items-center justify-center font-black text-xl shrink-0">
              📊
            </div>

            <div>
              <div className="flex items-center gap-2">
                <select
                  value={selectedPipelineId}
                  onChange={(e) => setSelectedPipelineId(e.target.value)}
                  disabled={pipelines.length === 0}
                  className="text-base font-black text-gray-900 dark:text-gray-100 bg-transparent border-none focus:outline-hidden cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 p-0"
                >
                  {pipelines.map((pipe) => (
                    <option key={pipe.id} value={pipe.id} className="text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-800 font-semibold">
                      {pipe.name} ({pipe.type.toUpperCase()})
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  onClick={() => setShowCreatePipelineModal(true)}
                  className="p-1 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/40 rounded-lg transition-colors"
                  title="Buat Pipeline Baru"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                  </svg>
                </button>
              </div>

              {activePipeline && (
                <p className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-md">
                  {activePipeline.description || `Pipeline ${activePipeline.type} • Mata Uang ${activePipeline.currency}`}
                </p>
              )}
            </div>
          </div>

          {/* Action Toolbar buttons */}
          {activePipeline && (
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 cursor-pointer text-xs font-bold text-gray-600 dark:text-gray-300 mr-2">
                <input 
                  type="checkbox" 
                  className="rounded text-blue-600 focus:ring-blue-500 bg-gray-100 dark:bg-gray-800 border-gray-300 dark:border-gray-700 w-3.5 h-3.5"
                  checked={autoSyncEnabled}
                  onChange={(e) => setAutoSyncEnabled(e.target.checked)}
                />
                Auto Sync
              </label>

              <button
                type="button"
                onClick={handleManualSync}
                disabled={isSyncing}
                className="p-2 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 transition-colors disabled:opacity-50"
                title="Sync Manual"
              >
                <svg className={`w-4 h-4 ${isSyncing ? 'animate-spin text-blue-600 dark:text-blue-400' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>

              <button
                type="button"
                onClick={() => setShowStats(!showStats)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all flex items-center gap-1.5 ${
                  showStats
                    ? 'bg-blue-50 text-blue-600 border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800'
                    : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:bg-gray-50'
                }`}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
                Statistik
              </button>

              <button
                type="button"
                onClick={() => setShowSettingsModal(true)}
                className="p-2 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 transition-colors"
                title="Pengaturan Pipeline"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>
            </div>
          )}
        </div>

        {/* Filter Controls Row */}
        {activePipeline && (
          <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-gray-100 dark:border-gray-800">
            {/* Search Input */}
            <div className="relative flex-1 min-w-[200px]">
              <input
                type="text"
                placeholder="Cari kartu / task..."
                value={filters.search}
                onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))}
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl focus:outline-hidden text-gray-900 dark:text-gray-100"
              />
              <svg className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>

            {/* Assignee Filter */}
            <select
              value={filters.assigneeId}
              onChange={(e) => setFilters((prev) => ({ ...prev, assigneeId: e.target.value }))}
              className="px-2.5 py-1.5 text-xs bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-gray-700 dark:text-gray-300 font-medium"
            >
              <option value="all">Semua Staff</option>
              <option value="unassigned">Tanpa Assignee</option>
              {staffProfiles.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.full_name || s.email}
                </option>
              ))}
            </select>

            {/* Priority Filter */}
            <select
              value={filters.priority}
              onChange={(e) => setFilters((prev) => ({ ...prev, priority: e.target.value as CardPriority | 'all' }))}
              className="px-2.5 py-1.5 text-xs bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-gray-700 dark:text-gray-300 font-medium"
            >
              <option value="all">Semua Prioritas</option>
              <option value="urgent">Urgent</option>
              <option value="high">Tinggi</option>
              <option value="medium">Sedang</option>
              <option value="low">Rendah</option>
            </select>

            {/* Status Filter */}
            <select
              value={filters.status}
              onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value as CardStatus | 'all' }))}
              className="px-2.5 py-1.5 text-xs bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-gray-700 dark:text-gray-300 font-medium"
            >
              <option value="active">Kartu Aktif</option>
              <option value="won">Won Only</option>
              <option value="lost">Lost Only</option>
              <option value="all">Semua (Termasuk Won/Lost)</option>
            </select>
          </div>
        )}
      </header>

      {/* Analytics Summary Banner if Toggled */}
      {showStats && activePipeline && (
        <PipelineStats stats={statsSummary} currency={activePipeline.currency || 'IDR'} />
      )}

      {/* Main Board View */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-2">
            <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-xs text-gray-500">Memuat pipeline & data Kanban...</p>
          </div>
        </div>
      ) : activePipeline ? (
        <KanbanBoard
          stages={stages}
          cards={filteredCards}
          currency={activePipeline.currency || 'IDR'}
          onUpdateStage={handleUpdateStage}
          onDeleteStage={handleDeleteStage}
          onCreateStage={handleCreateStage}
          onCreateCard={handleCreateCard}
          onCardClick={(card) => setSelectedCardForModal(card)}
          onMoveCard={handleMoveCard}
        />
      ) : (
        /* Empty State (No Pipelines created yet) */
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="max-w-md text-center space-y-4 p-8 bg-white dark:bg-gray-900 rounded-3xl border border-gray-200 dark:border-gray-800 shadow-xl">
            <div className="w-16 h-16 bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-400 rounded-2xl flex items-center justify-center text-3xl mx-auto font-black">
              📊
            </div>
            <div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">Belum Ada Pipeline</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 leading-relaxed">
                Buat pipeline pertama Anda untuk mengelola prospek penjualan, proyek produksi, atau alur kerja tim.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowCreatePipelineModal(true)}
              className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-md transition-all"
            >
              + Buat Pipeline Sekarang
            </button>
          </div>
        </div>
      )}

      {/* Modal: Create Pipeline */}
      {showCreatePipelineModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-700 pb-3">
              <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">Buat Pipeline Baru</h3>
              <button
                type="button"
                onClick={() => setShowCreatePipelineModal(false)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleCreatePipelineSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                  Nama Pipeline
                </label>
                <input
                  type="text"
                  required
                  placeholder="Contoh: Sales Lead Q3, Production Orders..."
                  value={newPipelineName}
                  onChange={(e) => setNewPipelineName(e.target.value)}
                  autoFocus
                  className="w-full px-3 py-2 text-xs bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-xl focus:border-blue-500 focus:outline-hidden text-gray-900 dark:text-gray-100 font-semibold"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                  Kategori Workflow
                </label>
                <select
                  value={newPipelineType}
                  onChange={(e) => setNewPipelineType(e.target.value as PipelineType)}
                  className="w-full px-3 py-2 text-xs bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-xl focus:outline-hidden text-gray-900 dark:text-gray-100 font-medium"
                >
                  <option value="sales">Penjualan / Sales CRM (Preset: Prospek -&gt; Negosiasi -&gt; Won/Lost)</option>
                  <option value="productivity">Produktivitas & Task (Preset: Backlog -&gt; In Progress -&gt; Done)</option>
                  <option value="production">Produksi / Manufaktur (Preset: Pesanan -&gt; Proses -&gt; QC -&gt; Selesai)</option>
                  <option value="hiring">Rekrutmen / HR (Preset: Pelamar -&gt; Interview -&gt; Hired)</option>
                  <option value="custom">Kustom (Preset sederhana)</option>
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreatePipelineModal(false)}
                  className="px-4 py-2 text-xs text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-xl font-semibold"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={isCreatingPipeline || !newPipelineName.trim()}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-xs disabled:opacity-50"
                >
                  {isCreatingPipeline ? 'Membuat...' : 'Buat Pipeline'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Settings */}
      {showSettingsModal && activePipeline && (
        <PipelineSettings
          pipeline={activePipeline}
          stages={stages}
          members={members}
          staffProfiles={staffProfiles}
          onClose={() => setShowSettingsModal(false)}
          onUpdatePipeline={handleUpdatePipeline}
          onDeletePipeline={handleDeletePipeline}
          onAddMember={handleAddMember}
          onRemoveMember={handleRemoveMember}
          onReorderStages={handleReorderStages}
        />
      )}

      {/* Modal: Card Detail & Edit */}
      {selectedCardForModal && activePipeline && (
        <CardModal
          card={selectedCardForModal}
          stages={stages}
          staffProfiles={staffProfiles}
          currency={activePipeline.currency || 'IDR'}
          onClose={() => setSelectedCardForModal(null)}
          onUpdateCard={handleUpdateCard}
          onDeleteCard={handleDeleteCard}
          onFetchActivities={handleFetchActivities}
          onAddComment={handleAddComment}
        />
      )}

    </div>
  );
}

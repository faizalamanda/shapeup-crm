"use client"
import React, { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useUserContext } from '@/components/UserContext'
import PipelineMain from '@/plugins/pipeline'
import PipelineHub from '@/plugins/pipeline/components/PipelineHub'
import { getCache, setCache } from '@/plugins/pipeline/helpers/cacheUtils'
import Link from 'next/link'
import { Pipeline } from '@/plugins/pipeline/types'

type PageView = 'loading' | 'disabled' | 'hub' | 'board'

export default function PipelinePage() {
  const { activeBusiness, userProfile, bizLoading } = useUserContext()
  const [view, setView] = useState<PageView>('loading')
  const [selectedPipelineId, setSelectedPipelineId] = useState<string | null>(null)
  const [pipelines, setPipelines] = useState<Pipeline[]>([])

  // Using singleton supabase client from @/lib/supabase

  const checkAccess = useCallback(async () => {
    if (!activeBusiness?.id || !userProfile?.id) return

    const cacheKeyPipes = `pipeline_hub_${activeBusiness.id}_${userProfile.id}`
    const cacheKeyStatus = `pipeline_status_${activeBusiness.id}`

    // 1. Instant Load from Cache
    const cachedPipes = getCache<Pipeline[]>(cacheKeyPipes)
    const cachedStatus = getCache<boolean>(cacheKeyStatus)

    if (cachedStatus !== null && cachedPipes !== null) {
      if (!cachedStatus && cachedPipes.length === 0) {
        setView('disabled')
      } else {
        setPipelines(cachedPipes)
        setView(prev => (prev === 'loading' ? 'hub' : prev))
      }
    } else {
      setView('loading')
    }

    // 2. Background Sync (Concurrent Fetch)
    try {
      const fetchIntegrations = fetch('/api/integrations?summary=true').then(res => res.json()).catch(() => null)
      const fetchSupabase = supabase
        .from('pipelines')
        .select(`
          *,
          stages:pipeline_stages(id, name, color, display_order),
          members:pipeline_members(id, user_id, role)
        `)
        .eq('business_id', activeBusiness.id)
        .order('created_at', { ascending: true })

      const [json, pipeRes] = await Promise.all([fetchIntegrations, fetchSupabase])

      let pluginActive = true // Default active for all businesses unless explicitly disabled
      if (json && json.success) {
        if (json.statuses && json.statuses.pipeline) {
          pluginActive = json.statuses.pipeline.is_active !== false
        } else if (Array.isArray(json.integrations)) {
          const pipelineRecord = json.integrations.find(
            (i: any) => i.platform_name === 'pipeline' || i.provider === 'pipeline'
          )
          if (pipelineRecord) {
            pluginActive = pipelineRecord.is_active !== false
          }
        }
      }

      const pipes = pipeRes.data || []
      
      const accessiblePipes = ((pipes as Pipeline[]) || []).filter((p: Pipeline) => {
        if (p.visibility === 'everyone') return true
        if (p.created_by === userProfile.id) return true
        return p.members?.some((m: any) => m.user_id === userProfile.id)
      })

      // Fallback: If there are accessible pipelines, the plugin is active
      if (accessiblePipes.length > 0) {
        pluginActive = true
      }

      // 3. Seamless Update & Cache Write
      setCache(cacheKeyStatus, pluginActive)
      setCache(cacheKeyPipes, accessiblePipes)

      if (!pluginActive) {
        setView('disabled')
      } else {
        setPipelines(accessiblePipes)
        setView(prev => (prev === 'loading' || prev === 'disabled' ? 'hub' : prev))
      }
    } catch {
      // Fallback in case of error, if we were loading, go to hub
      setView(prev => (prev === 'loading' ? 'hub' : prev))
    }
  }, [activeBusiness?.id, userProfile?.id, supabase])

  useEffect(() => {
    if (activeBusiness?.id && userProfile?.id) {
      checkAccess()
    }
  }, [activeBusiness?.id, userProfile?.id, checkAccess])

  // Handle pipeline selected from hub → go to board
  const handleSelectPipeline = (pipelineId: string) => {
    setSelectedPipelineId(pipelineId)
    setView('board')
  }

  // Handle back from board → hub
  const handleBackToHub = () => {
    setSelectedPipelineId(null)
    setView('hub')
    // Refresh pipeline list
    checkAccess()
  }

  // Handle new pipeline created from hub
  const handlePipelineCreated = (newPipeline: Pipeline) => {
    setPipelines(prev => [...prev, newPipeline])
    setSelectedPipelineId(newPipeline.id)
    setView('board')
  }

  // Loading state while resolving business / profile
  if (bizLoading || (view === 'loading' && activeBusiness?.id)) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-indigo-50/20 dark:from-gray-950 dark:via-gray-900 dark:to-gray-950 flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="relative w-16 h-16 mx-auto">
            <div className="w-16 h-16 border-4 border-blue-100 dark:border-blue-900/40 rounded-full" />
            <div className="absolute inset-0 w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
          </div>
          <p className="text-sm font-semibold text-gray-500 dark:text-gray-400 animate-pulse">Memuat Pipeline...</p>
        </div>
      </div>
    )
  }

  // No active business selected state
  if (!bizLoading && !activeBusiness?.id) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-indigo-50/20 dark:from-gray-950 dark:via-gray-900 dark:to-gray-950 flex items-center justify-center p-6">
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-3xl p-10 max-w-md w-full text-center shadow-2xl space-y-6">
          <div className="w-20 h-20 bg-amber-100 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 rounded-2xl flex items-center justify-center text-4xl mx-auto shadow-lg">
            ⚠️
          </div>
          <div>
            <h2 className="text-xl font-black text-gray-900 dark:text-gray-100 mb-2">Belum Ada Unit Bisnis Aktif</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
              Silakan pilih atau buat unit bisnis aktif terlebih dahulu untuk mengakses fitur Pipeline & Kanban.
            </p>
          </div>
          <Link
            href="/settings/business"
            className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold shadow-lg shadow-blue-500/25 transition-all hover:shadow-blue-500/40 w-full"
          >
            🏢 Pengaturan Unit Bisnis
          </Link>
        </div>
      </div>
    )
  }

  // Plugin not active
  if (view === 'disabled') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-indigo-50/20 dark:from-gray-950 dark:via-gray-900 dark:to-gray-950 flex items-center justify-center p-6">
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-3xl p-10 max-w-md w-full text-center shadow-2xl space-y-6">
          <div className="w-20 h-20 bg-gradient-to-br from-blue-100 to-indigo-100 dark:from-blue-950/60 dark:to-indigo-950/60 text-blue-600 dark:text-blue-400 rounded-2xl flex items-center justify-center text-4xl mx-auto shadow-lg">
            📊
          </div>
          <div>
            <h2 className="text-xl font-black text-gray-900 dark:text-gray-100 mb-2">Plugin Pipeline Belum Aktif</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
              Modul <strong className="text-gray-700 dark:text-gray-300">Universal Pipeline & Kanban</strong> belum diaktifkan untuk unit bisnis ini. Aktifkan terlebih dahulu di Pengaturan Plugin & Integrasi.
            </p>
          </div>
          <Link
            href="/settings/integrations"
            className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white text-sm font-bold shadow-lg shadow-blue-500/25 transition-all hover:shadow-blue-500/40 w-full"
          >
            ⚡ Aktifkan Plugin di Pengaturan
          </Link>
        </div>
      </div>
    )
  }

  // Hub view (Pipeline selection landing page)
  if (view === 'hub') {
    return (
      <PipelineHub
        pipelines={pipelines}
        activeBusiness={activeBusiness}
        userProfile={userProfile}
        onSelectPipeline={handleSelectPipeline}
        onPipelineCreated={handlePipelineCreated}
        onRefresh={checkAccess}
      />
    )
  }

  // Board view
  return (
    <div className="flex flex-col w-full min-h-[calc(100vh-140px)] rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden text-gray-900 dark:text-gray-100">
      <PipelineMain
        initialPipelineId={selectedPipelineId || undefined}
        onBackToHub={handleBackToHub}
      />
    </div>
  )
}

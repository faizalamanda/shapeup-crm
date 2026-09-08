'use client';

import React from 'react';
import { PipelineStatsSummary } from '../types';
import { formatCurrency } from '../helpers/kanbanUtils';

interface PipelineStatsProps {
  stats: PipelineStatsSummary;
  currency: string;
}

export default function PipelineStats({ stats, currency }: PipelineStatsProps) {
  return (
    <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 p-4 animate-in slide-in-from-top-2 duration-150">
      <div className="max-w-7xl mx-auto space-y-4">
        
        {/* Top 4 KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          
          <div className="p-3.5 bg-gray-50 dark:bg-gray-900/60 rounded-xl border border-gray-200/70 dark:border-gray-800">
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Total Kartu Aktif</span>
            <div className="mt-1 text-xl font-black text-gray-900 dark:text-gray-100">
              {stats.totalCards} <span className="text-xs font-normal text-gray-500">kartu</span>
            </div>
          </div>

          <div className="p-3.5 bg-gray-50 dark:bg-gray-900/60 rounded-xl border border-gray-200/70 dark:border-gray-800">
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Total Nilai Pipeline</span>
            <div className="mt-1 text-xl font-black text-blue-600 dark:text-blue-400">
              {formatCurrency(stats.totalValue, currency)}
            </div>
          </div>

          <div className="p-3.5 bg-gray-50 dark:bg-gray-900/60 rounded-xl border border-gray-200/70 dark:border-gray-800">
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Nilai Won (Berhasil)</span>
            <div className="mt-1 text-xl font-black text-emerald-600 dark:text-emerald-400">
              {formatCurrency(stats.wonValue, currency)} <span className="text-xs font-normal text-gray-500">({stats.wonCards} deal)</span>
            </div>
          </div>

          <div className="p-3.5 bg-gray-50 dark:bg-gray-900/60 rounded-xl border border-gray-200/70 dark:border-gray-800">
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Tingkat Konversi</span>
            <div className="mt-1 text-xl font-black text-purple-600 dark:text-purple-400">
              {stats.conversionRate}%
            </div>
          </div>

        </div>

        {/* Stage Distribution Progress Bar */}
        {stats.stageStats.length > 0 && (
          <div className="space-y-1.5 pt-1">
            <div className="flex items-center justify-between text-xs font-semibold text-gray-600 dark:text-gray-300">
              <span>Distribusi Per Stage</span>
              <span>Total {stats.totalCards} Kartu</span>
            </div>

            {/* Visual stacked bar */}
            <div className="h-3 w-full bg-gray-100 dark:bg-gray-900 rounded-full overflow-hidden flex">
              {stats.stageStats.map((st) => {
                const percentage = stats.totalCards > 0 ? (st.count / stats.totalCards) * 100 : 0;
                if (percentage === 0) return null;
                return (
                  <div
                    key={st.stageId}
                    style={{ width: `${percentage}%`, backgroundColor: st.color }}
                    className="h-full transition-all duration-300 relative group"
                    title={`${st.stageName}: ${st.count} kartu (${Math.round(percentage)}%)`}
                  />
                );
              })}
            </div>

            {/* Legend chips */}
            <div className="flex flex-wrap gap-3 pt-1">
              {stats.stageStats.map((st) => (
                <div key={st.stageId} className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: st.color }} />
                  <span className="font-medium text-gray-800 dark:text-gray-200">{st.stageName}:</span>
                  <span className="font-bold">{st.count}</span>
                  {st.value > 0 && (
                    <span className="text-gray-400">({formatCurrency(st.value, currency)})</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

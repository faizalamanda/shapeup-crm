"use client"
import React, { useState } from 'react'
import { StockMove, PivotGroupRow } from '../types'
import { buildMoveAnalysisPivot } from '../inventoryHelper'

interface MoveAnalysisTabProps {
  moves: StockMove[]
  loading: boolean
}

export default function MoveAnalysisTab({ moves, loading }: MoveAnalysisTabProps) {
  const [pivotGroupBy, setPivotGroupBy] = useState<'product' | 'type' | 'status'>('product')

  const pivotData: PivotGroupRow[] = buildMoveAnalysisPivot(moves, pivotGroupBy)

  const formatCurrency = (val: number) =>
    new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(val)

  // Top 5 Products by Movement Volume for Bar Chart
  const topProductsPivot = buildMoveAnalysisPivot(moves, 'product').slice(0, 5)
  const maxMoveCount = Math.max(...topProductsPivot.map(p => p.moveCount), 1)

  // Movement Types Share
  const typePivot = buildMoveAnalysisPivot(moves, 'type')
  const totalMovesCount = moves.length || 1

  return (
    <div className="space-y-6">
      {/* Visual Analytics Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Chart 1: Top 5 Produk Paling Aktif (Bar Chart SVG) */}
        <div className="bg-white border border-[#E2E2DC] rounded-xl p-5 shadow-xs">
          <h4 className="text-sm font-bold text-[#1C1C1A] mb-4 flex items-center gap-2">
            <span>📊</span> Top 5 Produk Paling Aktif (Frekuensi Mutasi)
          </h4>
          <div className="space-y-3.5">
            {topProductsPivot.length === 0 ? (
              <div className="text-xs text-[#82827A] py-6 text-center">Belum ada data pergerakan produk.</div>
            ) : (
              topProductsPivot.map((item, idx) => {
                const pct = Math.round((item.moveCount / maxMoveCount) * 100)
                return (
                  <div key={idx} className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="font-bold text-[#1C1C1A] truncate max-w-[240px]">{item.groupLabel}</span>
                      <span className="font-extrabold text-blue-700">{item.moveCount} Mutasi ({item.totalQtyIn + item.totalQtyOut} Unit)</span>
                    </div>
                    <div className="h-3 bg-[#F7F7F5] rounded-full overflow-hidden border border-[#E2E2DC]">
                      <div
                        className="h-full bg-gradient-to-r from-blue-500 to-indigo-600 rounded-full transition-all duration-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>

        {/* Chart 2: Distribusi Tipe Pergerakan Stok */}
        <div className="bg-white border border-[#E2E2DC] rounded-xl p-5 shadow-xs">
          <h4 className="text-sm font-bold text-[#1C1C1A] mb-4 flex items-center gap-2">
            <span>📈</span> Distribusi Tipe Pergerakan (Movement Share)
          </h4>
          <div className="space-y-3.5">
            {typePivot.map((item, idx) => {
              const pct = Math.round((item.moveCount / totalMovesCount) * 100)
              const colors = [
                'from-emerald-500 to-teal-600',
                'from-rose-500 to-pink-600',
                'from-amber-500 to-orange-600',
                'from-blue-500 to-cyan-600',
              ]
              return (
                <div key={idx} className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="font-bold text-[#1C1C1A]">{item.groupLabel}</span>
                    <span className="font-bold text-[#6B6B63]">{pct}% ({item.moveCount} Transaksi)</span>
                  </div>
                  <div className="h-3 bg-[#F7F7F5] rounded-full overflow-hidden border border-[#E2E2DC]">
                    <div
                      className={`h-full bg-gradient-to-r ${colors[idx % colors.length]} rounded-full transition-all duration-500`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Interactive Pivot Table Section */}
      <div className="bg-white border border-[#E2E2DC] rounded-xl overflow-hidden shadow-xs">
        <div className="p-4 border-b border-[#E2E2DC] flex flex-wrap justify-between items-center gap-3 bg-white">
          <h3 className="text-xs sm:text-sm font-bold text-[#1C1C1A]">
            Pivot Table Analisis Permintaan & Pergerakan Barang
          </h3>

          <div className="flex items-center gap-2 text-xs">
            <span className="text-[#6B6B63]">Kelompokkan Berdasarkan:</span>
            <select
              value={pivotGroupBy}
              onChange={e => setPivotGroupBy(e.target.value as any)}
              className="bg-[#F7F7F5] text-[#1C1C1A] font-bold border border-[#E2E2DC] rounded-lg px-3 py-1.5 focus:outline-none focus:border-blue-500"
            >
              <option value="product">Produk</option>
              <option value="type">Tipe Mutasi</option>
              <option value="status">Status Mutasi</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-[#2D2D2A]">
            <thead className="bg-[#F7F7F5] text-[#6B6B63] uppercase tracking-wider font-bold border-b border-[#E2E2DC]">
              <tr>
                <th className="py-3 px-4">Grup / Kategori Analisis</th>
                <th className="py-3 px-4 text-center">Jumlah Transaksi</th>
                <th className="py-3 px-4 text-right">Stok Masuk (+Qty In)</th>
                <th className="py-3 px-4 text-right">Stok Keluar (-Qty Out)</th>
                <th className="py-3 px-4 text-right">Pergerakan Bersih (Net)</th>
                <th className="py-3 px-4 text-right">Total Perputaran Finansial</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E2DC]">
              {loading ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-[#82827A]">
                    Menganalisis pergerakan persediaan...
                  </td>
                </tr>
              ) : pivotData.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-[#82827A]">
                    Tidak ada data mutasi persediaan untuk dianalisis.
                  </td>
                </tr>
              ) : (
                pivotData.map((row, idx) => (
                  <tr key={idx} className="hover:bg-[#F9F9F8] transition-colors">
                    <td className="py-3 px-4 font-bold text-[#1C1C1A]">{row.groupLabel}</td>
                    <td className="py-3 px-4 text-center font-mono font-medium text-[#6B6B63]">{row.moveCount} Transaksi</td>
                    <td className="py-3 px-4 text-right font-bold text-emerald-700">+{row.totalQtyIn}</td>
                    <td className="py-3 px-4 text-right font-bold text-rose-700">-{row.totalQtyOut}</td>
                    <td className={`py-3 px-4 text-right font-extrabold ${row.netMovement >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                      {row.netMovement > 0 ? `+${row.netMovement}` : row.netMovement}
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-extrabold text-blue-700">
                      {formatCurrency(row.totalValue)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

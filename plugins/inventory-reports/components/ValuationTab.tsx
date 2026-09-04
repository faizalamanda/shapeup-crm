"use client"
import React, { useState } from 'react'
import { StockReportItem, StockMove } from '../types'
import { calculateValuation } from '../inventoryHelper'

interface ValuationTabProps {
  stockItems: StockReportItem[]
  moves: StockMove[]
  loading: boolean
}

export default function ValuationTab({ stockItems, moves, loading }: ValuationTabProps) {
  const [selectedMethod, setSelectedMethod] = useState<'FIFO' | 'LIFO' | 'AVCO' | 'STANDARD'>('FIFO')

  const valuationResult = calculateValuation(selectedMethod, stockItems, moves)

  // Calculate comparison results for all 4 methods side-by-side
  const fifoVal = calculateValuation('FIFO', stockItems, moves).totalValuation
  const lifoVal = calculateValuation('LIFO', stockItems, moves).totalValuation
  const avcoVal = calculateValuation('AVCO', stockItems, moves).totalValuation
  const standardVal = calculateValuation('STANDARD', stockItems, moves).totalValuation

  const formatCurrency = (val: number) =>
    new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(val)

  return (
    <div className="space-y-6">
      {/* Valuation Method Selector Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[
          { key: 'FIFO', name: 'Metode FIFO', badge: 'First-In, First-Out', val: fifoVal, color: 'border-emerald-500 bg-emerald-50 text-emerald-800' },
          { key: 'LIFO', name: 'Metode LIFO', badge: 'Last-In, First-Out', val: lifoVal, color: 'border-amber-500 bg-amber-50 text-amber-800' },
          { key: 'AVCO', name: 'Metode AVCO', badge: 'Average Cost (Rata-rata)', val: avcoVal, color: 'border-blue-500 bg-blue-50 text-blue-800' },
          { key: 'STANDARD', name: 'Standard Price', badge: 'Harga Modal Tetap', val: standardVal, color: 'border-purple-500 bg-purple-50 text-purple-800' },
        ].map(m => {
          const isSelected = selectedMethod === m.key
          return (
            <button
              key={m.key}
              onClick={() => setSelectedMethod(m.key as any)}
              className={`p-4 rounded-xl border text-left transition-all relative overflow-hidden cursor-pointer shadow-xs ${
                isSelected
                  ? `${m.color} ring-2 ring-blue-600 border-transparent shadow-md`
                  : 'bg-white border-[#E2E2DC] text-[#2D2D2A] hover:border-[#D6D6CE]'
              }`}
            >
              <div className="text-xs font-bold uppercase tracking-wider">{m.name}</div>
              <div className="text-[11px] opacity-80 mt-0.5">{m.badge}</div>
              <div className="text-lg font-extrabold font-mono mt-3">{formatCurrency(m.val)}</div>
              {isSelected && (
                <div className="absolute top-2 right-2 w-2.5 h-2.5 rounded-full bg-blue-600 animate-pulse" />
              )}
            </button>
          )
        })}
      </div>

      {/* Selected Valuation Description Banner */}
      <div className="bg-white border border-[#E2E2DC] rounded-xl p-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 shadow-xs">
        <div>
          <span className="text-xs font-bold text-blue-700 uppercase tracking-wider">
            Metode Aktif: {valuationResult.methodName}
          </span>
          <p className="text-xs text-[#6B6B63] mt-1 max-w-3xl leading-relaxed">
            {valuationResult.description}
          </p>
        </div>
        <div className="text-right whitespace-nowrap bg-[#F7F7F5] px-4 py-2.5 rounded-xl border border-[#E2E2DC]">
          <div className="text-[11px] font-bold text-[#6B6B63]">Total Penilaian Finansial</div>
          <div className="text-xl font-extrabold font-mono text-emerald-700">
            {formatCurrency(valuationResult.totalValuation)}
          </div>
        </div>
      </div>

      {/* Itemized Valuation Table */}
      <div className="bg-white border border-[#E2E2DC] rounded-xl overflow-hidden shadow-xs">
        <div className="p-4 border-b border-[#E2E2DC] bg-white">
          <h3 className="text-xs sm:text-sm font-bold text-[#1C1C1A]">
            Rincian Penilaian Finansial Persediaan Per Produk ({valuationResult.itemBreakdown.length} SKU)
          </h3>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-[#2D2D2A]">
            <thead className="bg-[#F7F7F5] text-[#6B6B63] uppercase tracking-wider font-bold border-b border-[#E2E2DC]">
              <tr>
                <th className="py-3 px-4">Nama Produk & SKU</th>
                <th className="py-3 px-4 text-right">Stok Fisik (Qty)</th>
                <th className="py-3 px-4 text-right">Harga Modal Standar</th>
                <th className="py-3 px-4 text-right">Unit Cost {valuationResult.method}</th>
                <th className="py-3 px-4 text-right">Total Nilai {valuationResult.method}</th>
                <th className="py-3 px-4 text-right">Selisih / Varians</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E2DC]">
              {loading ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-[#82827A]">
                    Menghitung penilaian persediaan...
                  </td>
                </tr>
              ) : valuationResult.itemBreakdown.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-[#82827A]">
                    Tidak ada item persediaan untuk dinilai.
                  </td>
                </tr>
              ) : (
                valuationResult.itemBreakdown.map(item => (
                  <tr key={item.productId} className="hover:bg-[#F9F9F8] transition-colors">
                    <td className="py-3 px-4">
                      <div className="font-bold text-[#1C1C1A]">{item.productName}</div>
                      {item.sku && <div className="text-[10px] text-[#6B6B63] font-mono">SKU: {item.sku}</div>}
                    </td>
                    <td className="py-3 px-4 text-right font-bold text-[#1C1C1A]">{item.qtyOnHand}</td>
                    <td className="py-3 px-4 text-right font-mono text-[#6B6B63]">
                      {formatCurrency(item.standardCost)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-amber-700 font-bold">
                      {formatCurrency(item.unitCostCalculated)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-emerald-700 font-extrabold">
                      {formatCurrency(item.totalValueCalculated)}
                    </td>
                    <td className={`py-3 px-4 text-right font-mono font-bold ${item.varianceVsStandard >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                      {item.varianceVsStandard > 0 ? `+${formatCurrency(item.varianceVsStandard)}` : formatCurrency(item.varianceVsStandard)}
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

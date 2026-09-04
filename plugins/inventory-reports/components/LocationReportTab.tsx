"use client"
import React from 'react'
import { LocationReportSummary } from '../types'

interface LocationReportTabProps {
  locations: LocationReportSummary[]
  loading: boolean
}

export default function LocationReportTab({ locations, loading }: LocationReportTabProps) {
  const formatCurrency = (val: number) =>
    new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(val)

  const getTypeBadge = (type: string) => {
    switch (type) {
      case 'internal':
        return <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">Internal Gudang</span>
      case 'vendor':
        return <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">Lokasi Vendor / Supplier</span>
      case 'customer':
        return <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">Transit / Pelanggan</span>
      default:
        return <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200">Lainnya</span>
    }
  }

  return (
    <div className="space-y-6">
      {/* Location Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {locations.map(loc => (
          <div key={loc.locationId} className="bg-white border border-[#E2E2DC] rounded-xl p-5 shadow-xs hover:border-[#D6D6CE] transition-all">
            <div className="flex justify-between items-start">
              <div>
                <span className="text-xs font-mono text-[#6B6B63]">{loc.locationCode}</span>
                <h4 className="text-base font-bold text-[#1C1C1A] mt-0.5">{loc.locationName}</h4>
              </div>
              {getTypeBadge(loc.locationType)}
            </div>

            <div className="grid grid-cols-2 gap-3 mt-4 pt-3 border-t border-[#E2E2DC]">
              <div>
                <div className="text-[11px] text-[#6B6B63]">Total Stok Physical</div>
                <div className="text-lg font-bold text-[#1C1C1A] mt-0.5">{loc.totalQty.toLocaleString('id-ID')}</div>
              </div>
              <div>
                <div className="text-[11px] text-[#6B6B63]">Stok Tersedia</div>
                <div className="text-lg font-bold text-emerald-700 mt-0.5">{loc.availableQty.toLocaleString('id-ID')}</div>
              </div>
            </div>

            <div className="mt-3 pt-3 border-t border-[#E2E2DC] flex justify-between items-center text-xs">
              <span className="text-[#6B6B63]">Nilai Persediaan:</span>
              <span className="font-extrabold text-blue-700 font-mono">{formatCurrency(loc.totalValue)}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Detailed Locations Table */}
      <div className="bg-white border border-[#E2E2DC] rounded-xl overflow-hidden shadow-xs">
        <div className="p-4 border-b border-[#E2E2DC] bg-white">
          <h3 className="text-xs sm:text-sm font-bold text-[#1C1C1A]">
            Detail Distribusi Persediaan Per Lokasi & Gudang
          </h3>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-[#2D2D2A]">
            <thead className="bg-[#F7F7F5] text-[#6B6B63] uppercase tracking-wider font-bold border-b border-[#E2E2DC]">
              <tr>
                <th className="py-3 px-4">Kode & Nama Lokasi</th>
                <th className="py-3 px-4">Tipe Lokasi</th>
                <th className="py-3 px-4 text-center">Varian Produk</th>
                <th className="py-3 px-4 text-right">Stok Fisik</th>
                <th className="py-3 px-4 text-right">Stok Terpesan</th>
                <th className="py-3 px-4 text-right">Stok Tersedia</th>
                <th className="py-3 px-4 text-right">Total Nilai Finansial</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E2DC]">
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-[#82827A]">
                    Memuat data lokasi...
                  </td>
                </tr>
              ) : (
                locations.map(loc => (
                  <tr key={loc.locationId} className="hover:bg-[#F9F9F8] transition-colors">
                    <td className="py-3 px-4 font-bold text-[#1C1C1A]">
                      <div>{loc.locationName}</div>
                      <div className="text-[10px] text-[#6B6B63] font-mono">{loc.locationCode}</div>
                    </td>
                    <td className="py-3 px-4">{getTypeBadge(loc.locationType)}</td>
                    <td className="py-3 px-4 text-center font-semibold text-[#1C1C1A]">{loc.totalProductsCount} SKU</td>
                    <td className="py-3 px-4 text-right font-bold text-[#1C1C1A]">{loc.totalQty}</td>
                    <td className="py-3 px-4 text-right text-amber-700 font-semibold">{loc.reservedQty}</td>
                    <td className="py-3 px-4 text-right text-emerald-700 font-bold">{loc.availableQty}</td>
                    <td className="py-3 px-4 text-right text-blue-700 font-extrabold font-mono">
                      {formatCurrency(loc.totalValue)}
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

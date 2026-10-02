'use client'

import React, { useState, useEffect, useCallback } from 'react'

export default function PendingReturnsTab() {
  const [moves, setMoves] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [processingId, setProcessingId] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  const loadReturns = useCallback(async () => {
    try {
      setLoading(true)
      setErrorMsg(null)
      const res = await fetch('/api/inventory/returns')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Gagal memuat data retur')
      
      setMoves(Array.isArray(json) ? json : [])
    } catch (err: any) {
      setErrorMsg(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadReturns()
  }, [loadReturns])

  const handleAction = async (moveId: string, action: 'terima' | 'hilang') => {
    if (!window.confirm(`Yakin ingin menandai barang ini sebagai ${action.toUpperCase()}?`)) return

    setProcessingId(moveId)
    setErrorMsg(null)
    setSuccessMsg(null)
    try {
      const res = await fetch('/api/inventory/returns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ moveId, action })
      })

      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Gagal memproses retur')

      setSuccessMsg(json.message)
      await loadReturns()
    } catch (err: any) {
      setErrorMsg(err.message)
    } finally {
      setProcessingId(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center mb-4">
        <div>
          <h2 className="text-xl font-bold text-gray-800">Karantina Retur (Pending)</h2>
          <p className="text-sm text-gray-500">
            Daftar barang dari pesanan batal/retur yang sedang dalam perjalanan atau menunggu konfirmasi gudang.
          </p>
        </div>
      </div>

      {errorMsg && (
        <div className="bg-red-50 text-red-600 p-3 rounded-lg border border-red-200 text-sm">
          {errorMsg}
        </div>
      )}

      {successMsg && (
        <div className="bg-green-50 text-green-600 p-3 rounded-lg border border-green-200 text-sm">
          {successMsg}
        </div>
      )}

      <div className="overflow-x-auto bg-white rounded-xl shadow-sm border border-gray-200">
        <table className="min-w-full text-left text-sm text-gray-600">
          <thead className="bg-gray-50 text-xs font-semibold text-gray-500 uppercase">
            <tr>
              <th className="px-4 py-3 border-b">TANGGAL</th>
              <th className="px-4 py-3 border-b">REFERENSI</th>
              <th className="px-4 py-3 border-b">PRODUK</th>
              <th className="px-4 py-3 border-b text-right">QTY RETUR</th>
              <th className="px-4 py-3 border-b text-center">AKSI GUDANG</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                  Memuat data...
                </td>
              </tr>
            ) : moves.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                  Tidak ada barang retur yang nyangkut.
                </td>
              </tr>
            ) : (
              moves.map((m: any) => (
                <tr key={m.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 whitespace-nowrap">
                    {new Date(m.created_at).toLocaleDateString('id-ID')}
                  </td>
                  <td className="px-4 py-3 font-medium text-gray-800">
                    {m.reference}
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-800">{m.product?.name || '-'}</div>
                    {m.product?.sku && <div className="text-xs text-gray-500">{m.product.sku}</div>}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold">
                    {m.qty}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex gap-2 justify-center">
                      <button
                        disabled={processingId === m.id}
                        onClick={() => handleAction(m.id, 'terima')}
                        className="px-3 py-1.5 text-xs font-medium bg-emerald-100 text-emerald-700 hover:bg-emerald-200 rounded disabled:opacity-50"
                      >
                        {processingId === m.id ? '...' : 'Terima & Jual'}
                      </button>
                      <button
                        disabled={processingId === m.id}
                        onClick={() => handleAction(m.id, 'hilang')}
                        className="px-3 py-1.5 text-xs font-medium bg-red-100 text-red-700 hover:bg-red-200 rounded disabled:opacity-50"
                      >
                        {processingId === m.id ? '...' : 'Hilang / Rusak'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

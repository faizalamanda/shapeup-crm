'use client'

import React, { useState } from 'react'
import {
  Table, TableHeader, TableColumn, TableBody, TableRow, TableCell,
  Button, Chip, Spinner, useDisclosure
} from '@nextui-org/react'
import useSWR from 'swr'
import { toast } from 'sonner'

const fetcher = (url: string) => fetch(url).then(res => res.json())

export default function PendingReturnsTab() {
  const { data, error, isLoading, mutate } = useSWR('/api/inventory/returns', fetcher)
  const [processingId, setProcessingId] = useState<string | null>(null)

  const handleAction = async (moveId: string, action: 'terima' | 'hilang') => {
    if (!confirm(`Yakin ingin menandai barang ini sebagai ${action.toUpperCase()}?`)) return

    setProcessingId(moveId)
    try {
      const res = await fetch('/api/inventory/returns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ moveId, action })
      })

      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Gagal memproses retur')

      toast.success(json.message)
      mutate()
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setProcessingId(null)
    }
  }

  if (isLoading) return <div className="flex justify-center p-8"><Spinner /></div>
  if (error) return <div className="p-4 text-danger">Gagal memuat data retur</div>

  const moves = Array.isArray(data) ? data : []

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-xl font-bold">Karantina Retur (Pending)</h2>
          <p className="text-sm text-default-500">
            Daftar barang dari pesanan batal/retur yang sedang dalam perjalanan atau menunggu konfirmasi gudang.
          </p>
        </div>
      </div>

      <Table aria-label="Tabel Pending Returns">
        <TableHeader>
          <TableColumn>TANGGAL</TableColumn>
          <TableColumn>REFERENSI</TableColumn>
          <TableColumn>PRODUK</TableColumn>
          <TableColumn align="end">QTY RETUR</TableColumn>
          <TableColumn align="center">AKSI GUDANG</TableColumn>
        </TableHeader>
        <TableBody emptyContent="Tidak ada barang retur yang nyangkut.">
          {moves.map((m: any) => (
            <TableRow key={m.id}>
              <TableCell>{new Date(m.created_at).toLocaleDateString('id-ID')}</TableCell>
              <TableCell><span className="font-semibold">{m.reference}</span></TableCell>
              <TableCell>
                <div className="flex flex-col">
                  <span>{m.product?.name || '-'}</span>
                  {m.product?.sku && <span className="text-tiny text-default-400">{m.product.sku}</span>}
                </div>
              </TableCell>
              <TableCell>{m.qty}</TableCell>
              <TableCell>
                <div className="flex gap-2 justify-center">
                  <Button
                    size="sm"
                    color="success"
                    variant="flat"
                    isLoading={processingId === m.id}
                    onClick={() => handleAction(m.id, 'terima')}
                  >
                    Terima & Jual
                  </Button>
                  <Button
                    size="sm"
                    color="danger"
                    variant="flat"
                    isLoading={processingId === m.id}
                    onClick={() => handleAction(m.id, 'hilang')}
                  >
                    Hilang / Rusak
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

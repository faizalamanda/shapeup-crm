"use client"
import React from 'react'

interface PaginationProps {
  currentPage: number
  totalCount: number
  pageSize: number
  onPageChange: (page: number) => void
  onPageSizeChange?: (pageSize: number) => void
  pageSizeOptions?: number[]
  isLoading?: boolean
  position?: 'top' | 'bottom'
}

export function Pagination({
  currentPage,
  totalCount,
  pageSize,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 25, 50, 100],
  isLoading = false,
  position = 'bottom',
}: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))
  const startItem = totalCount === 0 ? 0 : (currentPage - 1) * pageSize + 1
  const endItem = Math.min(currentPage * pageSize, totalCount)

  // Generate page numbers array with ellipsis
  const getPageNumbers = () => {
    const pages: (number | string)[] = []
    const maxVisible = 5

    if (totalPages <= maxVisible + 2) {
      for (let i = 1; i <= totalPages; i++) pages.push(i)
    } else {
      pages.push(1)
      if (currentPage > 3) pages.push('...')

      const start = Math.max(2, currentPage - 1)
      const end = Math.min(totalPages - 1, currentPage + 1)

      for (let i = start; i <= end; i++) {
        if (i > 1 && i < totalPages) pages.push(i)
      }

      if (currentPage < totalPages - 2) pages.push('...')
      pages.push(totalPages)
    }
    return pages
  }

  const isTop = position === 'top'

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '12px',
        padding: '12px 4px',
        marginTop: isTop ? '0px' : '16px',
        marginBottom: isTop ? '12px' : '0px',
        borderTop: isTop ? 'none' : '1px solid var(--su-border)',
        borderBottom: isTop ? '1px solid var(--su-border)' : 'none',
        fontSize: '12px',
        color: 'var(--su-text-muted)',
      }}
    >
      {/* Left: Info & Rows per page selector */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
        <span>
          Menampilkan <strong>{startItem.toLocaleString('id-ID')}</strong>–<strong>{endItem.toLocaleString('id-ID')}</strong> dari <strong>{totalCount.toLocaleString('id-ID')}</strong> data
        </span>

        {onPageSizeChange && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span>Per halaman:</span>
            <select
              value={pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              disabled={isLoading}
              style={{
                padding: '4px 8px',
                borderRadius: '6px',
                border: '1px solid var(--su-border)',
                background: 'white',
                fontSize: '12px',
                fontWeight: 600,
                color: 'var(--su-text)',
                cursor: isLoading ? 'not-allowed' : 'pointer',
              }}
            >
              {pageSizeOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Right: Navigation Controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        {/* Previous Button */}
        <button
          type="button"
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage <= 1 || isLoading}
          style={{
            padding: '6px 12px',
            borderRadius: '6px',
            border: '1px solid var(--su-border)',
            background: currentPage <= 1 || isLoading ? 'var(--su-bg-subtle, #F7F7F5)' : 'white',
            color: currentPage <= 1 || isLoading ? 'var(--su-text-faint)' : 'var(--su-text)',
            fontSize: '12px',
            fontWeight: 600,
            cursor: currentPage <= 1 || isLoading ? 'not-allowed' : 'pointer',
            transition: 'all 0.12s',
          }}
        >
          ← Prev
        </button>

        {/* Page Numbers */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          {getPageNumbers().map((num, idx) => {
            if (num === '...') {
              return (
                <span
                  key={`ellipsis-${idx}`}
                  style={{ padding: '0 4px', color: 'var(--su-text-faint)', fontWeight: 600 }}
                >
                  ...
                </span>
              )
            }

            const pageNum = num as number
            const isActive = pageNum === currentPage

            return (
              <button
                key={pageNum}
                type="button"
                onClick={() => onPageChange(pageNum)}
                disabled={isLoading}
                style={{
                  minWidth: '32px',
                  height: '32px',
                  padding: '0 6px',
                  borderRadius: '6px',
                  border: isActive ? '1px solid var(--su-primary)' : '1px solid var(--su-border)',
                  background: isActive ? 'var(--su-primary)' : 'white',
                  color: isActive ? 'white' : 'var(--su-text)',
                  fontSize: '12px',
                  fontWeight: isActive ? 700 : 500,
                  cursor: isLoading ? 'not-allowed' : 'pointer',
                  transition: 'all 0.12s',
                }}
              >
                {pageNum}
              </button>
            )
          })}
        </div>

        {/* Next Button */}
        <button
          type="button"
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage >= totalPages || isLoading}
          style={{
            padding: '6px 12px',
            borderRadius: '6px',
            border: '1px solid var(--su-border)',
            background: currentPage >= totalPages || isLoading ? 'var(--su-bg-subtle, #F7F7F5)' : 'white',
            color: currentPage >= totalPages || isLoading ? 'var(--su-text-faint)' : 'var(--su-text)',
            fontSize: '12px',
            fontWeight: 600,
            cursor: currentPage >= totalPages || isLoading ? 'not-allowed' : 'pointer',
            transition: 'all 0.12s',
          }}
        >
          Next →
        </button>
      </div>
    </div>
  )
}

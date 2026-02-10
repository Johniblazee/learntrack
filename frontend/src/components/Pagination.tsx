import { Button } from '@/components/ui/button'
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'

interface PaginationProps {
  currentPage: number
  totalPages: number
  onPageChange: (page: number) => void
  hasNext: boolean
  hasPrev: boolean
  className?: string
}

export function Pagination({
  currentPage,
  totalPages,
  onPageChange,
  hasNext,
  hasPrev,
  className = ''
}: PaginationProps) {
  const getPageNumbers = () => {
    const pages: (number | string)[] = []
    const maxVisible = 5
    
    if (totalPages <= maxVisible) {
      // Show all pages if total is small
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i)
      }
    } else {
      // Always show first page
      pages.push(1)
      
      if (currentPage > 3) {
        pages.push('...')
      }
      
      // Show pages around current page
      const start = Math.max(2, currentPage - 1)
      const end = Math.min(totalPages - 1, currentPage + 1)
      
      for (let i = start; i <= end; i++) {
        pages.push(i)
      }
      
      if (currentPage < totalPages - 2) {
        pages.push('...')
      }
      
      // Always show last page
      pages.push(totalPages)
    }
    
    return pages
  }

  if (totalPages <= 1) {
    return null
  }

  return (
    <div className={`flex items-center justify-center gap-2 ${className}`}>
      {/* First Page */}
      <Button
        variant="outline"
        size="icon"
        onClick={() => onPageChange(1)}
        disabled={!hasPrev}
        className="h-8 w-8"
      >
        <ChevronsLeft className="h-4 w-4" />
      </Button>
      
      {/* Previous Page */}
      <Button
        variant="outline"
        size="icon"
        onClick={() => onPageChange(currentPage - 1)}
        disabled={!hasPrev}
        className="h-8 w-8"
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>
      
      {/* Page Numbers */}
      <div className="flex items-center gap-1">
        {getPageNumbers().map((page, index) => {
          if (page === '...') {
            return (
              <span key={`ellipsis-${index}`} className="px-2 text-gray-400">
                ...
              </span>
            )
          }
          
          const pageNum = page as number
          const isActive = pageNum === currentPage
          
          return (
            <Button
              key={pageNum}
              variant={isActive ? 'default' : 'outline'}
              size="sm"
              onClick={() => onPageChange(pageNum)}
              className={`h-8 min-w-[2rem] ${
                isActive
                  ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white'
                  : 'hover:bg-gray-800'
              }`}
            >
              {pageNum}
            </Button>
          )
        })}
      </div>
      
      {/* Next Page */}
      <Button
        variant="outline"
        size="icon"
        onClick={() => onPageChange(currentPage + 1)}
        disabled={!hasNext}
        className="h-8 w-8"
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
      
      {/* Last Page */}
      <Button
        variant="outline"
        size="icon"
        onClick={() => onPageChange(totalPages)}
        disabled={!hasNext}
        className="h-8 w-8"
      >
        <ChevronsRight className="h-4 w-4" />
      </Button>
    </div>
  )
}


import { motion } from 'motion/react'
import { cn } from '@/lib/utils'

interface FolderCardProps {
  name: string
  count?: number
  onClick?: () => void
  className?: string
}

export function FolderCard({ name, count, onClick, className }: FolderCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group relative w-48 h-32 cursor-pointer focus:outline-none',
        className,
      )}
    >
      <div className="relative w-full h-full [perspective:800px]">
        {/* Back panel */}
        <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-amber-400 to-amber-500 shadow-md" />

        {/* Tab on top-left */}
        <div className="absolute -top-2.5 left-3 w-16 h-5 rounded-t-lg bg-amber-400 shadow-sm" />

        {/* Front panel — lifts on hover */}
        <motion.div
          className="absolute inset-0 rounded-xl bg-gradient-to-br from-amber-300 to-amber-400 shadow-lg flex flex-col items-center justify-center gap-1 origin-bottom"
          initial={{ rotateX: 0 }}
          whileHover={{ rotateX: -18 }}
          transition={{ type: 'spring', stiffness: 300, damping: 20 }}
        >
          <span className="text-sm font-semibold text-amber-900 truncate max-w-[90%] px-2">
            {name}
          </span>
          {count !== undefined && (
            <span className="text-xs text-amber-800/70">
              {count} {count === 1 ? 'file' : 'files'}
            </span>
          )}
        </motion.div>
      </div>
    </button>
  )
}

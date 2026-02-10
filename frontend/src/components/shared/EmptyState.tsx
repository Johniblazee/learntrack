/**
 * Reusable empty state component
 * Provides consistent empty state UX across the application
 */

import { Button } from '@/components/ui/button'
import { LucideIcon } from 'lucide-react'

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description: string
  actionLabel?: string
  onAction?: () => void
}

/**
 * Empty state component for when no data is available
 * @param icon - Lucide icon component to display
 * @param title - Title text
 * @param description - Description text
 * @param actionLabel - Optional action button label
 * @param onAction - Optional action button callback
 * 
 * @example
 * <EmptyState
 *   icon={Users}
 *   title="No students found"
 *   description="Get started by adding your first student"
 *   actionLabel="Add Student"
 *   onAction={() => setAddModalOpen(true)}
 * />
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction
}: EmptyStateProps) {
  return (
    <div className="text-center py-12">
      <Icon className="w-16 h-16 mx-auto text-gray-400 mb-4" />
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
        {title}
      </h3>
      <p className="text-gray-600 dark:text-slate-400 mb-4">
        {description}
      </p>
      {actionLabel && onAction && (
        <Button onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </div>
  )
}


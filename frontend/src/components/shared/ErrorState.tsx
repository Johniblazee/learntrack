/**
 * Reusable error state component
 * Provides consistent error UX across the application
 */

import { Button } from '@/components/ui/button'
import { AlertCircle } from 'lucide-react'

interface ErrorStateProps {
  message: string
  onRetry?: () => void
}

/**
 * Error state component for when data loading fails
 * @param message - Error message to display
 * @param onRetry - Optional retry callback
 * 
 * @example
 * {error && <ErrorState message={error} onRetry={refetch} />}
 */
export function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <div className="text-center py-12">
      <AlertCircle className="w-16 h-16 mx-auto text-red-500 mb-4" />
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
        Something went wrong
      </h3>
      <p className="text-red-600 dark:text-red-400 mb-4">{message}</p>
      {onRetry && (
        <Button onClick={onRetry} variant="outline">
          Try Again
        </Button>
      )}
    </div>
  )
}


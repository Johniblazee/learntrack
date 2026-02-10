/**
 * Reusable list skeleton loader component
 */
import { Skeleton } from '@/components/ui/skeleton'

interface ListSkeletonProps {
  /**
   * Number of list items
   */
  count?: number
  
  /**
   * Whether to show avatar
   */
  showAvatar?: boolean
  
  /**
   * Number of text lines per item
   */
  lines?: number
  
  /**
   * Additional CSS classes
   */
  className?: string
}

/**
 * List item skeleton
 */
export function ListItemSkeleton({ 
  showAvatar = true, 
  lines = 2 
}: Omit<ListSkeletonProps, 'count' | 'className'>) {
  return (
    <div className="flex items-start gap-3 p-4 border-b last:border-b-0 animate-pulse">
      {showAvatar && (
        <Skeleton className="h-10 w-10 rounded-full flex-shrink-0" />
      )}
      <div className="flex-1 space-y-2">
        {Array.from({ length: lines }).map((_, i) => (
          <Skeleton
            key={i}
            className="h-4"
            style={{ width: i === 0 ? '80%' : '60%' }}
          />
        ))}
      </div>
    </div>
  )
}

/**
 * List skeleton
 */
export function ListSkeleton({ 
  count = 5, 
  showAvatar = true, 
  lines = 2,
  className = ''
}: ListSkeletonProps) {
  return (
    <div className={`rounded-md border border-border ${className}`}>
      {Array.from({ length: count }).map((_, i) => (
        <ListItemSkeleton key={i} showAvatar={showAvatar} lines={lines} />
      ))}
    </div>
  )
}

/**
 * Notification list skeleton
 */
export function NotificationListSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-start gap-3 p-4 rounded-lg bg-card border border-border animate-pulse">
          <Skeleton className="h-10 w-10 rounded-full flex-shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-3 w-24" />
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * Activity list skeleton
 */
export function ActivityListSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="space-y-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-start gap-4 animate-pulse">
          <Skeleton className="h-8 w-8 rounded-full flex-shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-32" />
          </div>
          <Skeleton className="h-6 w-16 rounded-full" />
        </div>
      ))}
    </div>
  )
}

/**
 * Assignment list skeleton
 */
export function AssignmentListSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="p-4 rounded-lg border border-border animate-pulse">
          <div className="flex items-start justify-between mb-3">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-6 w-20 rounded-full" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-40" />
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * Message list skeleton
 */
export function MessageListSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="space-y-1">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-start gap-3 p-3 hover:bg-muted/30 rounded-lg animate-pulse">
          <Skeleton className="h-10 w-10 rounded-full flex-shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-16" />
            </div>
            <Skeleton className="h-4 w-full" />
          </div>
        </div>
      ))}
    </div>
  )
}

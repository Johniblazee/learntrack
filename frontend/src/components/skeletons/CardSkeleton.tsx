/**
 * Reusable card skeleton loader component
 */
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

interface CardSkeletonProps {
  /**
   * Number of skeleton cards to render
   */
  count?: number
  
  /**
   * Whether to show header skeleton
   */
  showHeader?: boolean
  
  /**
   * Number of content lines to show
   */
  contentLines?: number
  
  /**
   * Additional CSS classes
   */
  className?: string
}

/**
 * Single card skeleton
 */
export function CardSkeleton({ 
  showHeader = true, 
  contentLines = 3,
  className = ''
}: Omit<CardSkeletonProps, 'count'>) {
  return (
    <Card className={`animate-pulse ${className}`}>
      {showHeader && (
        <CardHeader>
          <Skeleton className="h-6 w-3/4" />
        </CardHeader>
      )}
      <CardContent className="space-y-3">
        {Array.from({ length: contentLines }).map((_, i) => (
          <Skeleton
            key={i}
            className="h-4"
            style={{ width: `${100 - (i * 10)}%` }}
          />
        ))}
      </CardContent>
    </Card>
  )
}

/**
 * Multiple card skeletons
 */
export function CardSkeletonGroup({ 
  count = 3, 
  showHeader = true, 
  contentLines = 3,
  className = ''
}: CardSkeletonProps) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <CardSkeleton 
          key={i} 
          showHeader={showHeader} 
          contentLines={contentLines}
          className={className}
        />
      ))}
    </>
  )
}

/**
 * Stats card skeleton (for dashboard stats)
 */
export function StatsCardSkeleton({ count = 4 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <Card key={i} className="animate-pulse">
          <CardContent className="p-6 space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-16" />
            <Skeleton className="h-3 w-32" />
          </CardContent>
        </Card>
      ))}
    </>
  )
}

/**
 * Profile card skeleton (for student/user profiles)
 */
export function ProfileCardSkeleton() {
  return (
    <Card className="animate-pulse">
      <CardContent className="p-6">
        <div className="flex items-start gap-4">
          {/* Avatar skeleton */}
          <Skeleton className="h-16 w-16 rounded-full" />
          
          {/* Info skeleton */}
          <div className="flex-1 space-y-3">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-64" />
            <div className="flex gap-2">
              <Skeleton className="h-6 w-20 rounded-full" />
              <Skeleton className="h-6 w-20 rounded-full" />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

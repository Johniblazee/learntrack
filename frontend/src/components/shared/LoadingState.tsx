/**
 * Reusable loading skeleton component
 * Provides consistent loading UX across the application
 */


interface LoadingStateProps {
  count?: number
  type?: 'card' | 'list' | 'table'
}

/**
 * Loading skeleton component
 * @param count - Number of skeleton items to show (default: 3)
 * @param type - Type of skeleton layout (default: 'card')
 * 
 * @example
 * {loading && <LoadingState count={5} type="list" />}
 */
export function LoadingState({ count = 3, type = 'card' }: LoadingStateProps) {
  if (type === 'card') {
    return (
      <div className="space-y-4">
        {Array.from({ length: count }).map((_, index) => (
          <div
            key={index}
            className="p-4 bg-muted rounded-lg animate-pulse"
          >
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 bg-muted-foreground/20 rounded-full" />
              <div className="flex-1 space-y-3">
                <div className="h-4 bg-muted-foreground/20 rounded w-1/4" />
                <div className="h-3 bg-muted-foreground/20 rounded w-1/2" />
                <div className="h-3 bg-muted-foreground/20 rounded w-3/4" />
              </div>
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (type === 'list') {
    return (
      <div className="space-y-2">
        {Array.from({ length: count }).map((_, index) => (
          <div
            key={index}
            className="h-12 bg-muted rounded animate-pulse"
          />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {Array.from({ length: count }).map((_, index) => (
        <div
          key={index}
          className="p-4 bg-muted rounded-lg animate-pulse"
        >
          <div className="space-y-3">
            <div className="h-4 bg-muted-foreground/20 rounded w-1/3" />
            <div className="h-3 bg-muted-foreground/20 rounded w-1/2" />
            <div className="h-3 bg-muted-foreground/20 rounded w-3/4" />
          </div>
        </div>
      ))}
    </div>
  )
}


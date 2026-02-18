import { Loader2 } from 'lucide-react'

import { cn } from '@/lib/utils'

type SpinnerSize = 'sm' | 'md' | 'lg' | 'xl'

const spinnerSizes: Record<SpinnerSize, string> = {
  sm: 'h-4 w-4',
  md: 'h-5 w-5',
  lg: 'h-8 w-8',
  xl: 'h-12 w-12',
}

interface LoadingSpinnerProps {
  size?: SpinnerSize
  className?: string
}

export function LoadingSpinner({ size = 'md', className }: LoadingSpinnerProps) {
  return <Loader2 className={cn('animate-spin text-primary', spinnerSizes[size], className)} />
}

interface LoadingStateProps {
  message?: string
  size?: SpinnerSize
  fullScreen?: boolean
  className?: string
  messageClassName?: string
}

export function LoadingState({
  message = 'Loading...',
  size = 'lg',
  fullScreen = false,
  className,
  messageClassName,
}: LoadingStateProps) {
  return (
    <div
      className={cn(
        'flex items-center justify-center',
        fullScreen ? 'min-h-screen bg-background' : 'py-8',
        className,
      )}
    >
      <div className="flex flex-col items-center gap-3 text-center">
        <LoadingSpinner size={size} />
        <p className={cn('text-sm text-muted-foreground', messageClassName)}>{message}</p>
      </div>
    </div>
  )
}

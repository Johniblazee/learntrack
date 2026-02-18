import * as React from 'react'
import { Loader2 } from 'lucide-react'

import { cn } from '@/lib/utils'

type SpinnerSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl'
type SpinnerTone = 'primary' | 'muted' | 'inherit'

const sizeClasses: Record<SpinnerSize, string> = {
  xs: 'h-3 w-3',
  sm: 'h-4 w-4',
  md: 'h-5 w-5',
  lg: 'h-8 w-8',
  xl: 'h-12 w-12',
}

const toneClasses: Record<SpinnerTone, string> = {
  primary: 'text-primary',
  muted: 'text-muted-foreground',
  inherit: 'text-current',
}

interface LoadingSpinnerProps extends React.ComponentProps<typeof Loader2> {
  size?: SpinnerSize
  tone?: SpinnerTone
}

export function LoadingSpinner({
  size = 'md',
  tone = 'primary',
  className,
  ...props
}: LoadingSpinnerProps) {
  return (
    <Loader2
      aria-hidden="true"
      className={cn('shrink-0 animate-spin', sizeClasses[size], toneClasses[tone], className)}
      {...props}
    />
  )
}

interface LoadingStateProps {
  message?: string
  description?: string
  size?: SpinnerSize
  tone?: SpinnerTone
  className?: string
  fullScreen?: boolean
  minHeightClassName?: string
}

export function LoadingState({
  message = 'Loading...',
  description,
  size = 'lg',
  tone = 'primary',
  className,
  fullScreen = false,
  minHeightClassName = 'h-64',
}: LoadingStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 text-center',
        fullScreen ? 'min-h-screen' : minHeightClassName,
        className,
      )}
    >
      <LoadingSpinner size={size} tone={tone} />
      <div className="space-y-0.5">
        <p className="text-sm font-medium text-foreground">{message}</p>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
    </div>
  )
}

interface LoadingButtonContentProps {
  label: string
  spinnerSize?: SpinnerSize
  className?: string
}

export function LoadingButtonContent({
  label,
  spinnerSize = 'sm',
  className,
}: LoadingButtonContentProps) {
  return (
    <span className={cn('inline-flex items-center', className)}>
      <LoadingSpinner size={spinnerSize} tone="inherit" className="mr-2" />
      {label}
    </span>
  )
}

/**
 * React Error Boundary Component
 * Catches JavaScript errors in child component tree and displays fallback UI
 * 
 * Usage:
 * <ErrorBoundary fallback={<ErrorFallback />}>
 *   <YourComponent />
 * </ErrorBoundary>
 */

import { Component, ErrorInfo, ReactNode } from 'react'
import posthog from '@/lib/posthog'
import { AlertCircle, RefreshCw, Home, Bug } from 'lucide-react'
import { Button } from './ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'

interface ErrorBoundaryProps {
  children: ReactNode
  fallback?: ReactNode
  onError?: (error: Error, errorInfo: ErrorInfo) => void
  showDetails?: boolean
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
  errorInfo: ErrorInfo | null
}

/**
 * Error Boundary class component
 * Must be a class component as React hooks don't support error boundaries
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null, errorInfo: null }
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Log error to console in development
    console.error('ErrorBoundary caught an error:', error, errorInfo)

    // Report to PostHog
    posthog.capture('$exception', {
      message: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
    })

    // Update state with error info
    this.setState({ errorInfo })

    // Call optional error handler
    this.props.onError?.(error, errorInfo)
  }

  handleReset = (): void => {
    this.setState({ hasError: false, error: null, errorInfo: null })
  }

  handleReload = (): void => {
    window.location.reload()
  }

  handleGoHome = (): void => {
    window.location.href = '/'
  }

  render(): ReactNode {
    if (this.state.hasError) {
      // Use custom fallback if provided
      if (this.props.fallback) {
        return this.props.fallback
      }

      // Default fallback UI
      return (
        <ErrorFallback
          error={this.state.error}
          errorInfo={this.state.errorInfo}
          onReset={this.handleReset}
          onReload={this.handleReload}
          onGoHome={this.handleGoHome}
          showDetails={this.props.showDetails}
        />
      )
    }

    return this.props.children
  }
}

interface ErrorFallbackProps {
  error: Error | null
  errorInfo?: ErrorInfo | null
  onReset?: () => void
  onReload?: () => void
  onGoHome?: () => void
  showDetails?: boolean
}

/**
 * Default fallback UI for error boundaries
 * Can also be used standalone for custom error handling
 */
export function ErrorFallback({
  error,
  errorInfo,
  onReset,
  onReload,
  onGoHome,
  showDetails = process.env.NODE_ENV === 'development',
}: ErrorFallbackProps) {
  return (
    <div className="flex items-center justify-center min-h-[400px] p-6 bg-background">
      <Card className="max-w-lg w-full">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <div className="rounded-full bg-red-100 dark:bg-red-900/20 p-4">
              <AlertCircle className="h-10 w-10 text-red-600 dark:text-red-400" />
            </div>
          </div>
          <CardTitle className="text-xl">Something went wrong</CardTitle>
          <CardDescription>
            An unexpected error occurred. Don't worry, your data is safe.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Error details (development only by default) */}
          {showDetails && error && (
            <div className="rounded-lg bg-red-50 dark:bg-red-900/10 p-4 space-y-2">
              <div className="flex items-center gap-2 text-red-700 dark:text-red-400">
                <Bug className="h-4 w-4" />
                <span className="font-medium text-sm">Error Details</span>
              </div>
              <p className="text-sm font-mono text-red-600 dark:text-red-300 break-all">
                {error.message}
              </p>
              {errorInfo?.componentStack && (
                <details className="mt-2">
                  <summary className="text-xs text-red-500 cursor-pointer hover:underline">
                    Component Stack
                  </summary>
                  <pre className="mt-2 text-xs overflow-auto max-h-32 text-red-400">
                    {errorInfo.componentStack}
                  </pre>
                </details>
              )}
            </div>
          )}

          {/* Action buttons */}
          <div className="flex flex-col gap-2">
            {onReset && (
              <Button onClick={onReset} className="w-full" size="lg">
                <RefreshCw className="mr-2 h-4 w-4" />
                Try Again
              </Button>
            )}
            <div className="flex gap-2">
              {onReload && (
                <Button onClick={onReload} variant="outline" className="flex-1">
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Reload Page
                </Button>
              )}
              {onGoHome && (
                <Button onClick={onGoHome} variant="outline" className="flex-1">
                  <Home className="mr-2 h-4 w-4" />
                  Go Home
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export default ErrorBoundary


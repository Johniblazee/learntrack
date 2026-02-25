import { AlertCircle, RefreshCw, Home, ArrowLeft } from 'lucide-react'
import { Button } from './ui/button'
import { Alert, AlertDescription, AlertTitle } from './ui/alert'

interface ErrorScreenProps {
  title?: string
  message?: string
  error?: Error | string
  onRetry?: () => void
  onGoBack?: () => void
  onGoHome?: () => void
  showDetails?: boolean
}

function ErrorScreen({
  title = 'Something went wrong',
  message = 'An unexpected error occurred. Please try again.',
  error,
  onRetry,
  onGoBack,
  onGoHome,
  showDetails = false,
}: ErrorScreenProps) {
  const errorMessage = error instanceof Error ? error.message : error

  return (
    <div className="flex items-center justify-center min-h-[400px] p-6">
      <div className="max-w-md w-full space-y-6">
        {/* Error Icon */}
        <div className="flex justify-center">
          <div className="rounded-full bg-red-100 dark:bg-red-900/20 p-4">
            <AlertCircle className="h-12 w-12 text-red-600 dark:text-red-400" />
          </div>
        </div>

        {/* Error Message */}
        <div className="text-center space-y-2">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
            {title}
          </h2>
          <p className="text-gray-600 dark:text-gray-400">
            {message}
          </p>
        </div>

        {/* Error Details */}
        {showDetails && errorMessage && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Error Details</AlertTitle>
            <AlertDescription className="mt-2 text-sm font-mono">
              {errorMessage}
            </AlertDescription>
          </Alert>
        )}

        {/* Action Buttons */}
        <div className="flex flex-col gap-3">
          {onRetry && (
            <Button
              onClick={onRetry}
              className="w-full"
              size="lg"
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Try Again
            </Button>
          )}

          <div className="flex gap-3">
            {onGoBack && (
              <Button
                onClick={onGoBack}
                variant="outline"
                className="flex-1"
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                Go Back
              </Button>
            )}

            {onGoHome && (
              <Button
                onClick={onGoHome}
                variant="outline"
                className="flex-1"
              >
                <Home className="mr-2 h-4 w-4" />
                Home
              </Button>
            )}
          </div>
        </div>

        {/* Help Text */}
        <p className="text-center text-sm text-gray-500 dark:text-gray-400">
          If this problem persists, please contact support.
        </p>
      </div>
    </div>
  )
}

export function ServerError({ onRetry, error }: { onRetry?: () => void; error?: Error | string }) {
  return (
    <ErrorScreen
      title="Server Error"
      message="The server encountered an error. Our team has been notified."
      error={error}
      onRetry={onRetry}
      showDetails={true}
    />
  )
}


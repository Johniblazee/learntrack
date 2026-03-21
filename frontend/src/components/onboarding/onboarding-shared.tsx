import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'

interface OnboardingShellProps {
  backgroundClassName: string
  title: string
  description: string
  icon: LucideIcon
  iconContainerClassName: string
  step: number
  totalSteps: number
  loading: boolean
  nextButtonClassName: string
  completeButtonClassName?: string
  onBack: () => void
  onNext: () => void
  onComplete: () => void
  onSkip: () => void
  children: ReactNode
}

export function OnboardingShell({
  backgroundClassName,
  title,
  description,
  icon: Icon,
  iconContainerClassName,
  step,
  totalSteps,
  loading,
  nextButtonClassName,
  completeButtonClassName = 'bg-green-600 hover:bg-green-700',
  onBack,
  onNext,
  onComplete,
  onSkip,
  children,
}: OnboardingShellProps) {
  const progress = (step / totalSteps) * 100

  return (
    <div className={`min-h-screen flex items-center justify-center p-4 ${backgroundClassName}`}>
      <Card className="w-full max-w-2xl shadow-xl">
        <CardHeader className="text-center">
          <div className={`mx-auto mb-4 w-16 h-16 rounded-full flex items-center justify-center ${iconContainerClassName}`}>
            <Icon className="w-8 h-8 text-white" />
          </div>
          <CardTitle className="text-3xl font-bold">{title}</CardTitle>
          <CardDescription className="text-lg">{description}</CardDescription>
          <div className="mt-4">
            <Progress value={progress} className="h-2" />
            <p className="text-sm text-muted-foreground mt-2">
              Step {step} of {totalSteps}
            </p>
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          {children}

          <div className="flex items-center justify-between pt-6 border-t border-border">
            <div>
              {step > 1 && (
                <Button variant="outline" onClick={onBack} disabled={loading}>
                  Back
                </Button>
              )}
            </div>

            <div className="flex items-center gap-3">
              <Button variant="ghost" onClick={onSkip} disabled={loading}>
                Skip for now
              </Button>
              {step < totalSteps ? (
                <Button onClick={onNext} className={nextButtonClassName}>
                  Next
                </Button>
              ) : (
                <Button
                  onClick={onComplete}
                  disabled={loading}
                  className={completeButtonClassName}
                >
                  {loading ? 'Saving...' : 'Complete Setup'}
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

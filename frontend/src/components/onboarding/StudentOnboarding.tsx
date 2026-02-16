import { useState } from 'react'
import { useAuth, useUser } from '@clerk/clerk-react'
import { useNavigate } from 'react-router-dom'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from '@/contexts/ToastContext'
import { BookOpen, User, CheckCircle } from 'lucide-react'
import { OnboardingShell } from './onboarding-shared'
import { completeOnboarding, saveOnboardingProfile, useOnboardingSteps } from './onboarding-utils'

export default function StudentOnboarding() {
  const { getToken } = useAuth()
  const { user } = useUser()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)

  const [formData, setFormData] = useState({
    displayName: user?.fullName || '',
    grade: '',
    interests: '',
  })

  const totalSteps = 2
  const { step, handleNext, handleBack } = useOnboardingSteps({
    totalSteps,
    validateStep: (currentStep) => {
      if (currentStep === 1 && !formData.displayName) {
        return 'Please enter your name'
      }

      return null
    },
  })

  const handleComplete = async () => {
    try {
      setLoading(true)
      const responseOk = await saveOnboardingProfile(getToken, {
        name: formData.displayName,
        grade: formData.grade,
      })

      if (responseOk) {
        toast.success('Welcome to LearnTrack! 🎉')
        completeOnboarding(navigate)
      } else {
        toast.error('Failed to save profile')
      }
    } catch (error) {
      console.error('Failed to complete onboarding:', error)
      toast.error('Failed to complete onboarding')
    } finally {
      setLoading(false)
    }
  }

  const handleSkip = () => {
    completeOnboarding(navigate)
  }

  return (
    <OnboardingShell
      backgroundClassName="bg-gradient-to-br from-blue-50 to-purple-50 dark:from-slate-900 dark:to-slate-800"
      title="Welcome to LearnTrack!"
      description="Let's set up your student profile"
      icon={BookOpen}
      iconContainerClassName="bg-blue-600"
      step={step}
      totalSteps={totalSteps}
      loading={loading}
      nextButtonClassName="bg-blue-600 hover:bg-blue-700"
      onBack={handleBack}
      onNext={handleNext}
      onComplete={handleComplete}
      onSkip={handleSkip}
    >
          {/* Step 1: Display Name */}
          {step === 1 && (
            <div className="space-y-4 animate-in fade-in duration-300">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/20 rounded-full flex items-center justify-center">
                  <User className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                </div>
                <div>
                  <h3 className="text-xl font-semibold text-gray-900 dark:text-white">
                    What's your name?
                  </h3>
                  <p className="text-sm text-gray-600 dark:text-slate-400">
                    This is how your teacher will see you
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="displayName">Your Name *</Label>
                <Input
                  id="displayName"
                  value={formData.displayName}
                  onChange={(e) =>
                    setFormData({ ...formData, displayName: e.target.value })
                  }
                  placeholder="e.g., John Smith"
                  className="text-lg"
                  autoFocus
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="grade">Grade Level (Optional)</Label>
                <Input
                  id="grade"
                  value={formData.grade}
                  onChange={(e) => setFormData({ ...formData, grade: e.target.value })}
                  placeholder="e.g., 9th Grade, Year 10"
                />
              </div>
            </div>
          )}

          {/* Step 2: Interests */}
          {step === 2 && (
            <div className="space-y-4 animate-in fade-in duration-300">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 bg-green-100 dark:bg-green-900/20 rounded-full flex items-center justify-center">
                  <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400" />
                </div>
                <div>
                  <h3 className="text-xl font-semibold text-gray-900 dark:text-white">
                    What are you interested in?
                  </h3>
                  <p className="text-sm text-gray-600 dark:text-slate-400">
                    This helps us personalize your learning experience
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="interests">Interests (Optional)</Label>
                <Input
                  id="interests"
                  value={formData.interests}
                  onChange={(e) =>
                    setFormData({ ...formData, interests: e.target.value })
                  }
                  placeholder="e.g., Math, Science, Sports, Music"
                />
                <p className="text-xs text-gray-500 dark:text-slate-400">
                  Separate multiple interests with commas
                </p>
              </div>

              <div className="p-4 bg-green-50 dark:bg-green-900/10 rounded-lg">
                <h4 className="font-semibold text-green-900 dark:text-green-300 mb-2">
                  You're all set! 🎉
                </h4>
                <p className="text-sm text-green-800 dark:text-green-400">
                  Click "Complete Setup" to start learning. You can:
                </p>
                <ul className="text-sm text-green-800 dark:text-green-400 mt-2 space-y-1 list-disc list-inside">
                  <li>View and complete assignments</li>
                  <li>Chat with your teacher and parents</li>
                  <li>Access learning materials</li>
                  <li>Track your progress</li>
                </ul>
              </div>
            </div>
          )}
    </OnboardingShell>
  )
}


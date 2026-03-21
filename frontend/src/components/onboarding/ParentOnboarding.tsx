import { useState } from 'react'
import { useAuth, useUser } from '@clerk/clerk-react'
import { useNavigate } from 'react-router-dom'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from '@/contexts/ToastContext'
import { Heart, User, CheckCircle } from 'lucide-react'
import { OnboardingShell } from './onboarding-shared'
import { completeOnboarding, saveOnboardingProfile, useOnboardingSteps } from './onboarding-utils'

export default function ParentOnboarding() {
  const { getToken } = useAuth()
  const { user } = useUser()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)

  const [formData, setFormData] = useState({
    displayName: user?.fullName || '',
    phone: '',
    preferredContact: 'email',
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
        phone: formData.phone,
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
      backgroundClassName="bg-background"
      title="Welcome to LearnTrack!"
      description="Let's set up your parent profile"
      icon={Heart}
      iconContainerClassName="bg-primary"
      step={step}
      totalSteps={totalSteps}
      loading={loading}
      nextButtonClassName="bg-pink-600 hover:bg-pink-700"
      onBack={handleBack}
      onNext={handleNext}
      onComplete={handleComplete}
      onSkip={handleSkip}
    >
          {/* Step 1: Display Name */}
          {step === 1 && (
            <div className="space-y-4 animate-in fade-in duration-300">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 bg-pink-100 dark:bg-pink-900/20 rounded-full flex items-center justify-center">
                  <User className="w-5 h-5 text-pink-600 dark:text-pink-400" />
                </div>
                <div>
                  <h3 className="text-xl font-semibold text-foreground">
                    What's your name?
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    This is how the teacher will see you
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
                  placeholder="e.g., Jane Smith"
                  className="text-lg"
                  autoFocus
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="phone">Phone Number (Optional)</Label>
                <Input
                  id="phone"
                  type="tel"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  placeholder="e.g., (555) 123-4567"
                />
                <p className="text-xs text-muted-foreground">
                  For important notifications about your child
                </p>
              </div>
            </div>
          )}

          {/* Step 2: Complete */}
          {step === 2 && (
            <div className="space-y-4 animate-in fade-in duration-300">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 bg-green-100 dark:bg-green-900/20 rounded-full flex items-center justify-center">
                  <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400" />
                </div>
                <div>
                  <h3 className="text-xl font-semibold text-foreground">
                    You're all set!
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    Ready to support your child's learning journey
                  </p>
                </div>
              </div>

              <div className="p-4 bg-green-50 dark:bg-green-900/10 rounded-lg">
                <h4 className="font-semibold text-green-900 dark:text-green-300 mb-2">
                  Welcome to LearnTrack! 🎉
                </h4>
                <p className="text-sm text-green-800 dark:text-green-400">
                  Click "Complete Setup" to get started. You can:
                </p>
                <ul className="text-sm text-green-800 dark:text-green-400 mt-2 space-y-1 list-disc list-inside">
                  <li>View your child's assignments and progress</li>
                  <li>Chat with your child's teacher</li>
                  <li>Receive notifications about deadlines</li>
                  <li>Support your child's learning</li>
                </ul>
              </div>

              <div className="p-4 bg-blue-50 dark:bg-blue-900/10 rounded-lg">
                <h4 className="font-semibold text-blue-900 dark:text-blue-300 mb-2">
                  💡 Quick Tip
                </h4>
                <p className="text-sm text-blue-800 dark:text-blue-400">
                  The teacher will link your account to your child's profile. Once linked, you'll be able to see all their assignments and progress.
                </p>
              </div>
            </div>
          )}
    </OnboardingShell>
  )
}


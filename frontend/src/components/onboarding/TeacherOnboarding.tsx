import { useState } from 'react'
import { useAuth, useUser } from '@clerk/clerk-react'
import { useNavigate } from 'react-router-dom'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from '@/contexts/ToastContext'
import { GraduationCap, Clock, User, CheckCircle } from 'lucide-react'
import { OnboardingShell } from './onboarding-shared'
import { completeOnboarding, saveOnboardingProfile, useOnboardingSteps } from './onboarding-utils'

const TIMEZONES = [
  { value: 'America/New_York', label: 'Eastern Time (ET)' },
  { value: 'America/Chicago', label: 'Central Time (CT)' },
  { value: 'America/Denver', label: 'Mountain Time (MT)' },
  { value: 'America/Los_Angeles', label: 'Pacific Time (PT)' },
  { value: 'America/Phoenix', label: 'Arizona Time (MST)' },
  { value: 'America/Anchorage', label: 'Alaska Time (AKT)' },
  { value: 'Pacific/Honolulu', label: 'Hawaii Time (HST)' },
  { value: 'Europe/London', label: 'London (GMT)' },
  { value: 'Europe/Paris', label: 'Paris (CET)' },
  { value: 'Asia/Tokyo', label: 'Tokyo (JST)' },
  { value: 'Asia/Shanghai', label: 'Shanghai (CST)' },
  { value: 'Australia/Sydney', label: 'Sydney (AEDT)' },
]

export default function TeacherOnboarding() {
  const { getToken } = useAuth()
  const { user } = useUser()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)

  const [formData, setFormData] = useState({
    displayName: user?.fullName || '',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York',
    schoolName: '',
    subjects: '',
  })

  const totalSteps = 3
  const { step, handleNext, handleBack } = useOnboardingSteps({
    totalSteps,
    validateStep: (currentStep) => {
      if (currentStep === 1 && !formData.displayName) {
        return 'Please enter your display name'
      }

      if (currentStep === 2 && !formData.timezone) {
        return 'Please select your timezone'
      }

      return null
    },
  })

  const handleComplete = async () => {
    try {
      setLoading(true)
      const responseOk = await saveOnboardingProfile(getToken, {
        name: formData.displayName,
        timezone: formData.timezone,
        school_name: formData.schoolName,
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
      backgroundClassName="bg-muted"
      title="Welcome to LearnTrack!"
      description="Let's set up your teaching profile"
      icon={GraduationCap}
      iconContainerClassName="bg-purple-600"
      step={step}
      totalSteps={totalSteps}
      loading={loading}
      nextButtonClassName="bg-purple-600 hover:bg-purple-700"
      onBack={handleBack}
      onNext={handleNext}
      onComplete={handleComplete}
      onSkip={handleSkip}
    >
          {/* Step 1: Display Name */}
          {step === 1 && (
            <div className="space-y-4 animate-in fade-in duration-300">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 bg-purple-100 dark:bg-purple-900/20 rounded-full flex items-center justify-center">
                  <User className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                </div>
                <div>
                  <h3 className="text-xl font-semibold text-foreground">
                    What should students call you?
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    This name will be visible to students and parents
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="displayName">Display Name *</Label>
                <Input
                  id="displayName"
                  value={formData.displayName}
                  onChange={(e) =>
                    setFormData({ ...formData, displayName: e.target.value })
                  }
                  placeholder="e.g., Mr. Smith, Dr. Johnson, Ms. Lee"
                  className="text-lg"
                  autoFocus
                />
                <p className="text-xs text-muted-foreground">
                  Examples: Mr. Smith, Dr. Johnson, Professor Lee, Ms. Garcia
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="schoolName">School/Organization (Optional)</Label>
                <Input
                  id="schoolName"
                  value={formData.schoolName}
                  onChange={(e) =>
                    setFormData({ ...formData, schoolName: e.target.value })
                  }
                  placeholder="e.g., Lincoln High School"
                />
              </div>
            </div>
          )}

          {/* Step 2: Timezone */}
          {step === 2 && (
            <div className="space-y-4 animate-in fade-in duration-300">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/20 rounded-full flex items-center justify-center">
                  <Clock className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                </div>
                <div>
                  <h3 className="text-xl font-semibold text-foreground">
                    What's your timezone?
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    This helps us show correct times for assignments and deadlines
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="timezone">Timezone *</Label>
                <Select
                  value={formData.timezone}
                  onValueChange={(value) =>
                    setFormData({ ...formData, timezone: value })
                  }
                >
                  <SelectTrigger className="text-lg">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIMEZONES.map((tz) => (
                      <SelectItem key={tz.value} value={tz.value}>
                        {tz.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="p-4 bg-blue-50 dark:bg-blue-900/10 rounded-lg">
                <p className="text-sm text-blue-900 dark:text-blue-300">
                  <strong>Current time in your timezone:</strong>{' '}
                  {new Date().toLocaleTimeString('en-US', { timeZone: formData.timezone })}
                </p>
              </div>
            </div>
          )}

          {/* Step 3: Subjects */}
          {step === 3 && (
            <div className="space-y-4 animate-in fade-in duration-300">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 bg-green-100 dark:bg-green-900/20 rounded-full flex items-center justify-center">
                  <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400" />
                </div>
                <div>
                  <h3 className="text-xl font-semibold text-foreground">
                    What subjects do you teach?
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    You can add more subjects later
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="subjects">Subjects (Optional)</Label>
                <Input
                  id="subjects"
                  value={formData.subjects}
                  onChange={(e) =>
                    setFormData({ ...formData, subjects: e.target.value })
                  }
                  placeholder="e.g., Mathematics, Science, English"
                />
                <p className="text-xs text-muted-foreground">
                  Separate multiple subjects with commas
                </p>
              </div>

              <div className="p-4 bg-green-50 dark:bg-green-900/10 rounded-lg">
                <h4 className="font-semibold text-green-900 dark:text-green-300 mb-2">
                  You're all set! 🎉
                </h4>
                <p className="text-sm text-green-800 dark:text-green-400">
                  Click "Complete Setup" to start using LearnTrack. You can:
                </p>
                <ul className="text-sm text-green-800 dark:text-green-400 mt-2 space-y-1 list-disc list-inside">
                  <li>Invite students and parents</li>
                  <li>Create assignments and questions</li>
                  <li>Chat with students and parents</li>
                  <li>Upload reference materials</li>
                </ul>
              </div>
            </div>
          )}
    </OnboardingShell>
  )
}


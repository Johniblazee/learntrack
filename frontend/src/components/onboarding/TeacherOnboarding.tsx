import { useState } from 'react'
import { useAuth, useUser } from '@clerk/clerk-react'
import { useNavigate } from 'react-router-dom'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Progress } from '@/components/ui/progress'
import { toast } from '@/contexts/ToastContext'
import { GraduationCap, Clock, User, CheckCircle } from 'lucide-react'
import { API_BASE_URL } from '@/lib/config'

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
  const [step, setStep] = useState(1)
  const [loading, setLoading] = useState(false)

  const [formData, setFormData] = useState({
    displayName: user?.fullName || '',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York',
    schoolName: '',
    subjects: '',
  })

  const totalSteps = 3
  const progress = (step / totalSteps) * 100

  const handleNext = () => {
    if (step === 1 && !formData.displayName) {
      toast.error('Please enter your display name')
      return
    }
    if (step === 2 && !formData.timezone) {
      toast.error('Please select your timezone')
      return
    }
    if (step < totalSteps) {
      setStep(step + 1)
    }
  }

  const handleBack = () => {
    if (step > 1) {
      setStep(step - 1)
    }
  }

  const handleComplete = async () => {
    try {
      setLoading(true)
      const token = await getToken()

      // Update user profile
      const response = await fetch(`${API_BASE_URL}/users/me`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: formData.displayName,
          timezone: formData.timezone,
          school_name: formData.schoolName,
          // Store subjects as metadata
        })
      })

      if (response.ok) {
        toast.success('Welcome to LearnTrack! 🎉')
        // Mark onboarding as complete in localStorage
        localStorage.setItem('onboarding_complete', 'true')
        navigate('/dashboard')
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
    localStorage.setItem('onboarding_complete', 'true')
    navigate('/dashboard')
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 to-blue-50 dark:from-slate-900 dark:to-slate-800 flex items-center justify-center p-4">
      <Card className="w-full max-w-2xl shadow-xl">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 w-16 h-16 bg-purple-600 rounded-full flex items-center justify-center">
            <GraduationCap className="w-8 h-8 text-white" />
          </div>
          <CardTitle className="text-3xl font-bold">Welcome to LearnTrack!</CardTitle>
          <CardDescription className="text-lg">
            Let's set up your teaching profile
          </CardDescription>
          <div className="mt-4">
            <Progress value={progress} className="h-2" />
            <p className="text-sm text-gray-600 dark:text-slate-400 mt-2">
              Step {step} of {totalSteps}
            </p>
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* Step 1: Display Name */}
          {step === 1 && (
            <div className="space-y-4 animate-in fade-in duration-300">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 bg-purple-100 dark:bg-purple-900/20 rounded-full flex items-center justify-center">
                  <User className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                </div>
                <div>
                  <h3 className="text-xl font-semibold text-gray-900 dark:text-white">
                    What should students call you?
                  </h3>
                  <p className="text-sm text-gray-600 dark:text-slate-400">
                    This name will be visible to students and parents
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="displayName">Display Name *</Label>
                <Input
                  id="displayName"
                  value={formData.displayName}
                  onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
                  placeholder="e.g., Mr. Smith, Dr. Johnson, Ms. Lee"
                  className="text-lg"
                  autoFocus
                />
                <p className="text-xs text-gray-500 dark:text-slate-400">
                  Examples: Mr. Smith, Dr. Johnson, Professor Lee, Ms. Garcia
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="schoolName">School/Organization (Optional)</Label>
                <Input
                  id="schoolName"
                  value={formData.schoolName}
                  onChange={(e) => setFormData({ ...formData, schoolName: e.target.value })}
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
                  <h3 className="text-xl font-semibold text-gray-900 dark:text-white">
                    What's your timezone?
                  </h3>
                  <p className="text-sm text-gray-600 dark:text-slate-400">
                    This helps us show correct times for assignments and deadlines
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="timezone">Timezone *</Label>
                <Select
                  value={formData.timezone}
                  onValueChange={(value) => setFormData({ ...formData, timezone: value })}
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
                  <h3 className="text-xl font-semibold text-gray-900 dark:text-white">
                    What subjects do you teach?
                  </h3>
                  <p className="text-sm text-gray-600 dark:text-slate-400">
                    You can add more subjects later
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="subjects">Subjects (Optional)</Label>
                <Input
                  id="subjects"
                  value={formData.subjects}
                  onChange={(e) => setFormData({ ...formData, subjects: e.target.value })}
                  placeholder="e.g., Mathematics, Science, English"
                />
                <p className="text-xs text-gray-500 dark:text-slate-400">
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

          {/* Navigation Buttons */}
          <div className="flex items-center justify-between pt-6 border-t border-gray-200 dark:border-slate-700">
            <div>
              {step > 1 && (
                <Button variant="outline" onClick={handleBack} disabled={loading}>
                  Back
                </Button>
              )}
            </div>

            <div className="flex items-center gap-3">
              <Button variant="ghost" onClick={handleSkip} disabled={loading}>
                Skip for now
              </Button>
              {step < totalSteps ? (
                <Button onClick={handleNext} className="bg-purple-600 hover:bg-purple-700">
                  Next
                </Button>
              ) : (
                <Button
                  onClick={handleComplete}
                  disabled={loading}
                  className="bg-green-600 hover:bg-green-700"
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


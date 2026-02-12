import { useState } from 'react'
import { useAuth, useUser } from '@clerk/clerk-react'
import { useNavigate } from 'react-router-dom'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { toast } from '@/contexts/ToastContext'
import { BookOpen, User, CheckCircle } from 'lucide-react'
import { API_BASE_URL } from '@/lib/config'

export default function StudentOnboarding() {
  const { getToken } = useAuth()
  const { user } = useUser()
  const navigate = useNavigate()
  const [step, setStep] = useState(1)
  const [loading, setLoading] = useState(false)

  const [formData, setFormData] = useState({
    displayName: user?.fullName || '',
    grade: '',
    interests: '',
  })

  const totalSteps = 2
  const progress = (step / totalSteps) * 100

  const handleNext = () => {
    if (step === 1 && !formData.displayName) {
      toast.error('Please enter your name')
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

      const response = await fetch(`${API_BASE_URL}/users/me`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: formData.displayName,
          grade: formData.grade,
        })
      })

      if (response.ok) {
        toast.success('Welcome to LearnTrack! 🎉')
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
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-purple-50 dark:from-slate-900 dark:to-slate-800 flex items-center justify-center p-4">
      <Card className="w-full max-w-2xl shadow-xl">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 w-16 h-16 bg-blue-600 rounded-full flex items-center justify-center">
            <BookOpen className="w-8 h-8 text-white" />
          </div>
          <CardTitle className="text-3xl font-bold">Welcome to LearnTrack!</CardTitle>
          <CardDescription className="text-lg">
            Let's set up your student profile
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
                  onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
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
                  onChange={(e) => setFormData({ ...formData, interests: e.target.value })}
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
                <Button onClick={handleNext} className="bg-blue-600 hover:bg-blue-700">
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


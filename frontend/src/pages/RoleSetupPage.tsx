import { useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { GraduationCap, BookOpen, Users } from "lucide-react"
import { toast } from '@/contexts/ToastContext'
import { useApiClient } from '@/lib/api-client'
import { useUserContext } from '@/contexts/UserContext'

type OnboardingRole = 'tutor' | 'student' | 'parent'

export default function RoleSetupPage() {
  const navigate = useNavigate()
  const apiClient = useApiClient()
  const { refreshBackendUser } = useUserContext()
  const [selectedRole, setSelectedRole] = useState<OnboardingRole | ''>('')
  const [isLoading, setIsLoading] = useState(false)

  const handleContinue = async () => {
    if (!selectedRole) return

    setIsLoading(true)
    try {
      const response = await apiClient.post('/users/me/role', { role: selectedRole })

      if (response.error || response.status >= 400) {
        throw new Error(response.error || `Failed to set role (${response.status})`)
      }

      await refreshBackendUser()
      navigate('/dashboard')
    } catch (error) {
      console.error('Error updating role:', error)
      toast.error('Failed to set role', {
        description: error instanceof Error && error.message
          ? error.message
          : 'Please try again or contact support if the issue persists.',
      })
    } finally {
      setIsLoading(false)
    }
  }

  const roles: Array<{
    id: OnboardingRole
    title: string
    description: string
    icon: typeof GraduationCap
    iconColor: string
  }> = [
    {
      id: 'tutor',
      title: 'I am a Tutor',
      description: 'Create courses, manage assignments, and track student progress.',
      icon: GraduationCap,
      iconColor: 'text-orange-500'
    },
    {
      id: 'student',
      title: 'I am a Student',
      description: 'Access course materials, submit assignments, and view your grades.',
      icon: BookOpen,
      iconColor: 'text-yellow-500'
    },
    {
      id: 'parent',
      title: 'I am a Parent',
      description: "Monitor your child's progress, view assignments, and communicate with tutors.",
      icon: Users,
      iconColor: 'text-orange-500'
    }
  ]

  return (
    <div className="min-h-screen bg-white dark:bg-[#1a1a1a] flex items-center justify-center p-4">
      <div className="w-full max-w-4xl">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-4xl md:text-5xl font-bold text-foreground mb-3">
            Welcome to LearnTrack!
          </h1>
          <p className="text-muted-foreground text-lg">
            To get started, please select your role.
          </p>
        </div>

        {/* Role Cards */}
        <div className="grid md:grid-cols-3 gap-6 mb-8">
          {roles.map((role) => {
            const IconComponent = role.icon
            const isSelected = selectedRole === role.id

            return (
              <button
                key={role.id}
                onClick={() => setSelectedRole(role.id)}
                className={`
                  relative p-6 rounded-xl text-left transition-all duration-200
                  ${isSelected
                    ? 'bg-primary text-primary-foreground ring-2 ring-primary'
                    : 'bg-muted hover:bg-muted/80'
                  }
                `}
              >
                {/* Icon */}
                <div className="mb-4">
                  <IconComponent className={`w-8 h-8 ${role.iconColor}`} />
                </div>

                {/* Title */}
                <h3 className="text-lg font-semibold text-foreground mb-2">
                  {role.title}
                </h3>

                {/* Description */}
                <p className="text-sm text-muted-foreground">
                  {role.description}
                </p>

                {/* Selection Indicator */}
                {isSelected && (
                  <div className="absolute top-4 right-4">
                    <div className="w-6 h-6 bg-[#C8A882] rounded-full flex items-center justify-center">
                      <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                  </div>
                )}
              </button>
            )
          })}
        </div>

        {/* Continue Button */}
        <div className="flex justify-center">
          <button
            onClick={handleContinue}
            disabled={!selectedRole || isLoading}
            className={`
              px-12 py-3 rounded-lg font-semibold text-lg transition-all duration-200
              ${selectedRole && !isLoading
                ? 'bg-[#C8A882] hover:bg-[#B89872] text-white shadow-lg hover:shadow-xl'
                : 'bg-muted text-muted-foreground cursor-not-allowed'
              }
            `}
          >
            {isLoading ? 'Setting up...' : 'Continue'}
          </button>
        </div>
      </div>
    </div>
  )
}

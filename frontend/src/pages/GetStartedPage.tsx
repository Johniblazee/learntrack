import { useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { GraduationCap, BookOpen, Users } from "lucide-react"

export default function GetStartedPage() {
  const navigate = useNavigate()
  const [selectedRole, setSelectedRole] = useState<string>('')

  const handleContinue = () => {
    if (!selectedRole) return

    // Store the selected role in sessionStorage for use after Clerk authentication
    sessionStorage.setItem('selectedRole', selectedRole)
    // Navigate to sign-up page
    navigate('/sign-up')
  }

  const roles = [
    {
      id: 'tutor',
      title: 'I am a Tutor',
      description: 'Create courses, manage assignments, and track student progress.',
      icon: GraduationCap,
      iconColor: 'text-[#5c4a38]'
    },
    {
      id: 'student',
      title: 'I am a Student',
      description: 'Access course materials, submit assignments, and view your grades.',
      icon: BookOpen,
      iconColor: 'text-[#5c4a38]'
    },
    {
      id: 'parent',
      title: 'I am a Parent',
      description: "Monitor your child's progress, view assignments, and communicate with tutors.",
      icon: Users,
      iconColor: 'text-[#5c4a38]'
    }
  ]

  return (
    <div className="min-h-screen bg-white dark:bg-[#1a1a1a] flex items-center justify-center p-4">
      <div className="w-full max-w-4xl">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-4xl md:text-5xl font-bold text-gray-900 dark:text-white mb-3">
            Welcome to LearnTrack!
          </h1>
          <p className="text-gray-600 dark:text-gray-400 text-lg">
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
                    ? 'bg-[#5c4a38]/10 dark:bg-[#5c4a38]/20 ring-2 ring-[#5c4a38]'
                    : 'bg-gray-100 dark:bg-gray-800/50 hover:bg-[#5c4a38]/10 dark:hover:bg-[#5c4a38]/10'
                  }
                `}
              >
                {/* Icon */}
                <div className="mb-4">
                  <IconComponent className={`w-8 h-8 ${role.iconColor}`} />
                </div>

                {/* Title */}
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                  {role.title}
                </h3>

                {/* Description */}
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  {role.description}
                </p>

                {/* Selection Indicator */}
                {isSelected && (
                  <div className="absolute top-4 right-4">
                    <div className="w-6 h-6 bg-[#5c4a38] rounded-full flex items-center justify-center">
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
        <div className="flex justify-center mb-6">
          <button
            onClick={handleContinue}
            disabled={!selectedRole}
            className={`
              px-12 py-3 rounded-lg font-semibold text-lg transition-all duration-200
              ${selectedRole
                ? 'bg-[#5c4a38] hover:bg-[#4a3a2a] text-white shadow-lg hover:shadow-xl'
                : 'bg-gray-300 dark:bg-gray-700 text-gray-500 dark:text-gray-500 cursor-not-allowed'
              }
            `}
          >
            Continue
          </button>
        </div>

        {/* Sign In Link */}
        <div className="text-center">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Already have an account?{' '}
            <button
              onClick={() => navigate('/sign-in')}
              className="text-[#5c4a38] hover:text-[#4a3a2a] font-semibold transition-colors"
            >
              Sign in here
            </button>
          </p>
        </div>
      </div>
    </div>
  )
}

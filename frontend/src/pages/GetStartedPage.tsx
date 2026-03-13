import { Link, useNavigate } from 'react-router-dom'
import { GraduationCap } from "lucide-react"

export default function GetStartedPage() {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen bg-white dark:bg-[#1a1a1a] flex items-center justify-center p-4">
      <div className="w-full max-w-lg text-center">
        {/* Icon */}
        <div className="mb-6 flex justify-center">
          <div className="w-16 h-16 bg-[#5c4a38]/10 dark:bg-[#5c4a38]/20 rounded-2xl flex items-center justify-center">
            <GraduationCap className="w-8 h-8 text-[#5c4a38]" />
          </div>
        </div>

        {/* Header */}
        <h1 className="text-4xl md:text-5xl font-bold text-gray-900 dark:text-white mb-3">
          Welcome to LearnTrack!
        </h1>
        <p className="text-gray-600 dark:text-gray-400 text-lg mb-2">
          Create your tutoring account to get started.
        </p>
        <p className="text-gray-500 dark:text-gray-500 text-sm mb-10">
          Manage students, create assignments, and track progress — all in one place.
        </p>

        {/* Get Started Button */}
        <div className="mb-6">
          <button
            onClick={() => navigate('/sign-up')}
            className="px-12 py-3 rounded-lg font-semibold text-lg transition-all duration-200 bg-[#5c4a38] hover:bg-[#4a3a2a] text-white shadow-lg hover:shadow-xl"
          >
            Get Started
          </button>
        </div>

        {/* Sign In Link */}
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Already have an account?{' '}
          <Link
            to="/sign-in"
            className="text-[#5c4a38] hover:text-[#4a3a2a] font-semibold transition-colors"
          >
            Sign in here
          </Link>
        </p>
      </div>
    </div>
  )
}

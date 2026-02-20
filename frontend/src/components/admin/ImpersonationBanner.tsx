import { useLocation, useNavigate } from 'react-router-dom'
import { AlertTriangle, X, User, Shield } from 'lucide-react'
import { useImpersonation } from '../../contexts/ImpersonationContext'

export function ImpersonationBanner() {
  const { isImpersonating, impersonatedUser, endImpersonation, isLoading } = useImpersonation()
  const navigate = useNavigate()
  const location = useLocation()

  if (!isImpersonating || !impersonatedUser) {
    return null
  }

  const handleExitImpersonation = async () => {
    await endImpersonation()
    if (location.pathname.startsWith('/admin')) {
      navigate('/admin/users')
      return
    }

    navigate('/dashboard')
  }

  const roleColors: Record<string, string> = {
    tutor: 'text-purple-200',
    student: 'text-blue-200',
    parent: 'text-green-200',
  }

  return (
    <div className="sticky top-0 left-0 right-0 z-[100] bg-gradient-to-r from-amber-500 via-orange-500 to-red-500 text-white shadow-lg">
      <div className="max-w-7xl mx-auto px-4 py-2 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="p-1.5 bg-white/20 rounded-lg shrink-0">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <Shield className="w-4 h-4 shrink-0" />
            <span className="font-medium">Acting as User</span>
            <span className="text-white/80 hidden sm:inline">|</span>
            <div className="flex min-w-0 items-center gap-2">
              <User className="w-4 h-4 shrink-0" />
              <span className="font-semibold truncate max-w-[24ch]">{impersonatedUser.name}</span>
              <span className={`text-sm shrink-0 ${roleColors[impersonatedUser.role] || 'text-white/80'}`}>
                ({impersonatedUser.role})
              </span>
              <span className="text-white/60 text-sm truncate hidden md:inline max-w-[28ch]">
                {impersonatedUser.email}
              </span>
            </div>
          </div>
        </div>

        <button
          onClick={handleExitImpersonation}
          disabled={isLoading}
          className="flex items-center gap-2 px-3 py-1.5 bg-white/20 hover:bg-white/30 rounded-lg transition-colors font-medium disabled:opacity-50 shrink-0"
        >
          <X className="w-4 h-4" />
          {isLoading ? 'Stopping...' : 'Stop Acting as User'}
        </button>
      </div>
    </div>
  )
}


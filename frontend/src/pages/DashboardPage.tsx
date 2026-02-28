import { useUser } from '@clerk/clerk-react'
import { useNavigate } from 'react-router-dom'
import { useEffect, useMemo } from 'react'

import TutorDashboard from '@/components/TutorDashboard/index'
import StudentDashboard from '@/components/StudentDashboard'
import ParentDashboard from '@/components/ParentDashboard'
import { LoadingState } from '@/components/ui/loading-state'
import { useImpersonation } from '@/contexts/ImpersonationContext'
import { useUserContext } from '@/contexts/UserContext'
import { useNotificationSocket } from '@/hooks/useNotificationSocket'

type DashboardView = 'tutor' | 'student' | 'parent'

function isDashboardRole(value: unknown): value is DashboardView {
  return value === 'tutor' || value === 'student' || value === 'parent'
}

export default function DashboardPage() {
  const { isLoaded, user } = useUser()
  const navigate = useNavigate()
  const { role: backendRole, isBackendLoaded } = useUserContext()
  const { isImpersonating, impersonatedUser } = useImpersonation()

  // Bridge Socket.IO notification events → TanStack Query invalidation (C3-GAP)
  useNotificationSocket()

  const clerkRole = (user?.publicMetadata?.role || user?.unsafeMetadata?.role) as string | undefined

  const effectiveView = useMemo<DashboardView>(() => {
    if (isImpersonating && isDashboardRole(impersonatedUser?.role)) {
      return impersonatedUser.role
    }

    if (isDashboardRole(backendRole)) {
      return backendRole
    }

    if (isDashboardRole(clerkRole)) {
      return clerkRole
    }

    return 'tutor'
  }, [backendRole, clerkRole, impersonatedUser?.role, isImpersonating])

  useEffect(() => {
    if (!isLoaded) {
      return
    }

    if (!isBackendLoaded && !isDashboardRole(clerkRole)) {
      return
    }

    if (!backendRole && !clerkRole) {
      navigate('/role-setup')
    }
  }, [backendRole, clerkRole, isBackendLoaded, isLoaded, navigate])

  if (!isLoaded || (!isBackendLoaded && !isDashboardRole(clerkRole))) {
    return <LoadingState fullScreen message="Loading dashboard..." size="xl" />
  }

  if (!backendRole && !clerkRole) {
    return <LoadingState fullScreen message="Redirecting to role setup..." size="xl" />
  }

  if (effectiveView === 'student') {
    return <StudentDashboard />
  }

  if (effectiveView === 'parent') {
    return <ParentDashboard />
  }

  return <TutorDashboard />
}

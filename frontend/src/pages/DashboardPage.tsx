import { useUser } from '@clerk/clerk-react'
import { useNavigate } from 'react-router-dom'
import { useEffect, useMemo } from 'react'

import TutorDashboard from '@/components/TutorDashboard/index'
import StudentDashboard from '@/components/StudentDashboard'
import ParentDashboard from '@/components/ParentDashboard'
import AccessDeniedPage from '@/pages/AccessDeniedPage'
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
  const validClerkRole = isDashboardRole(clerkRole) ? clerkRole : null
  const validBackendRole = isDashboardRole(backendRole) ? backendRole : null
  const validImpersonatedRole = isDashboardRole(impersonatedUser?.role)
    ? impersonatedUser.role
    : null
  const hasRoleMismatch =
    !isImpersonating &&
    isBackendLoaded &&
    Boolean(validBackendRole && validClerkRole && validBackendRole !== validClerkRole)

  const effectiveView = useMemo<DashboardView | null>(() => {
    if (isImpersonating && validImpersonatedRole) {
      return validImpersonatedRole
    }

    if (validBackendRole) {
      return validBackendRole
    }

    if (validClerkRole) {
      return validClerkRole
    }

    return null
  }, [isImpersonating, validBackendRole, validClerkRole, validImpersonatedRole])

  useEffect(() => {
    if (!isLoaded) {
      return
    }

    if (!isBackendLoaded && !validClerkRole) {
      return
    }

    if (!effectiveView && !hasRoleMismatch) {
      navigate('/onboarding/teacher')
    }
  }, [effectiveView, hasRoleMismatch, isBackendLoaded, isLoaded, navigate, validClerkRole])

  if (!isLoaded || (!isBackendLoaded && !validClerkRole)) {
    return <LoadingState fullScreen message="Loading dashboard..." size="xl" />
  }

  if (hasRoleMismatch) {
    return (
      <AccessDeniedPage
        title="Role configuration mismatch"
        message="Your account role is out of sync. Please refresh or contact support if this persists."
        resource="Dashboard"
      />
    )
  }

  if (!effectiveView) {
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

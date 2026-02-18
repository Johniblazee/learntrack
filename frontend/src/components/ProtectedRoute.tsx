import { useUser } from '@clerk/clerk-react'
import { Navigate, useLocation } from 'react-router-dom'
import { ReactNode } from 'react'
import { useUserContext } from '../contexts/UserContext'
import AccessDeniedPage from '../pages/AccessDeniedPage'
import { LoadingState } from '@/components/ui/loading-state'

interface ProtectedRouteProps {
  children: ReactNode
  /** Required role to access this route (optional) */
  requiredRole?: 'tutor' | 'student' | 'parent'
  /** Redirect to this path if access is denied (optional - uses AccessDeniedPage if not set) */
  redirectOnDeny?: string
}

export default function ProtectedRoute({
  children,
  requiredRole,
  redirectOnDeny
}: ProtectedRouteProps) {
  const { isSignedIn, isLoaded } = useUser()
  const { role, isBackendLoaded } = useUserContext()
  const location = useLocation()

  // Loading state
  if (!isLoaded || (isSignedIn && !isBackendLoaded)) {
    return <LoadingState fullScreen className="bg-background" message="Loading..." size="xl" />
  }

  // Not signed in - redirect to sign-in
  if (!isSignedIn) {
    return <Navigate to="/sign-in" state={{ from: location }} replace />
  }

  // Check role if required
  if (requiredRole && role !== requiredRole) {
    // If user has no role, redirect to role setup
    if (!role) {
      return <Navigate to="/role-setup" state={{ from: location }} replace />
    }

    // If redirect path is specified, use it
    if (redirectOnDeny) {
      return <Navigate to={redirectOnDeny} replace />
    }

    // Otherwise show Access Denied page
    return (
      <AccessDeniedPage
        title="Wrong Role"
        message={`This page is only accessible to ${requiredRole}s. You are currently signed in as a ${role}.`}
        resource={location.pathname}
        requiredRole={requiredRole}
      />
    )
  }

  return <>{children}</>
}

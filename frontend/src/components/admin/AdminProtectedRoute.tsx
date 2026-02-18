import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '@clerk/clerk-react'
import { useUserContext } from '../../contexts/UserContext'
import AccessDeniedPage from '../../pages/AccessDeniedPage'
import { LoadingState } from '@/components/ui/loading-state'

interface AdminProtectedRouteProps {
  children: React.ReactNode
  requiredPermission?: string
}

export function AdminProtectedRoute({ children, requiredPermission }: AdminProtectedRouteProps) {
  const { isLoaded, isSignedIn } = useAuth()
  const { isSuperAdmin, hasAdminPermission, isBackendLoaded } = useUserContext()
  const location = useLocation()

  // Show loading while checking auth
  if (!isLoaded || !isBackendLoaded) {
    return <LoadingState fullScreen message="Verifying admin access..." size="xl" />
  }

  // Redirect to sign-in if not authenticated
  if (!isSignedIn) {
    return <Navigate to="/sign-in" state={{ from: location }} replace />
  }

  // Check super admin status
  if (!isSuperAdmin) {
    return (
      <AccessDeniedPage
        title="Admin Access Required"
        message="You don't have permission to access the admin dashboard. This area is restricted to super administrators only."
        resource={location.pathname}
        requiredRole="Super Admin"
      />
    )
  }

  // Check specific permission if required
  if (requiredPermission && !hasAdminPermission(requiredPermission as any)) {
    return (
      <AccessDeniedPage
        title="Insufficient Permissions"
        message={`You don't have the required permission (${requiredPermission}) to access this section.`}
        resource={location.pathname}
        requiredRole={requiredPermission}
      />
    )
  }

  return <>{children}</>
}


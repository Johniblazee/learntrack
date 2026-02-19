import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react'
import { useUser, useAuth } from '@clerk/clerk-react'
import { ApiClient, IMPERSONATION_SESSION_CHANGED_EVENT, setTokenGetter } from '@/lib/api-client'

// User role types matching backend
export type UserRole = 'tutor' | 'student' | 'parent' | 'super_admin'

// Admin permission types matching backend
export type AdminPermission =
  | 'view_all_tenants'
  | 'manage_tenants'
  | 'view_all_users'
  | 'manage_users'
  | 'view_audit_logs'
  | 'manage_system_settings'
  | 'manage_feature_flags'
  | 'impersonate_users'
  | 'export_data'
  | 'delete_tenants'
  | 'suspend_tenants'
  | 'create_tutors'
  | 'reset_passwords'
  | 'manage_billing'
  | 'view_analytics'
  | 'full_access'

// Backend user data structure
export interface BackendUser {
  clerk_id: string
  email: string
  name: string
  role: UserRole
  tutor_id: string
  is_active: boolean
  created_at: string
  updated_at: string
  student_ids?: string[]  // For parents
  is_super_admin?: boolean
  admin_permissions?: AdminPermission[]
}

interface UserContextType {
  // Clerk user data
  clerkUser: ReturnType<typeof useUser>['user']
  isLoaded: boolean
  isSignedIn: boolean

  // Backend user data
  backendUser: BackendUser | null
  isBackendLoaded: boolean
  backendError: string | null

  // Derived properties
  role: UserRole | null
  tutorId: string | null
  studentIds: string[]

  // Permissions
  isTutor: boolean
  isStudent: boolean
  isParent: boolean
  isSuperAdmin: boolean
  adminPermissions: AdminPermission[]

  // Admin permission helpers
  hasAdminPermission: (permission: AdminPermission) => boolean
  hasFullAdminAccess: boolean

  // Actions
  refreshBackendUser: () => Promise<void>
}

const UserContext = createContext<UserContextType | undefined>(undefined)

export function UserProvider({ children }: { children: React.ReactNode }) {
  const { user: clerkUser, isLoaded, isSignedIn } = useUser()
  const { getToken } = useAuth()
  const apiClient = useMemo(() => new ApiClient(() => getToken()), [getToken])

  const [backendUser, setBackendUser] = useState<BackendUser | null>(null)
  const [isBackendLoaded, setIsBackendLoaded] = useState(false)
  const [backendError, setBackendError] = useState<string | null>(null)

  // Initialize the API token getter
  useEffect(() => {
    setTokenGetter(getToken)
  }, [getToken])

  const fetchBackendUser = useCallback(async () => {
    if (!isSignedIn || !clerkUser) {
      setBackendUser(null)
      setIsBackendLoaded(true)
      return
    }

    try {
      setBackendError(null)
      const response = await apiClient.get<BackendUser>('/users/me')

      if (response.data) {
        setBackendUser(response.data)
      } else if (response.status === 404) {
        // User not found in backend - might need role setup
        setBackendUser(null)
      } else {
        throw new Error(`Failed to fetch user: ${response.status}`)
      }
    } catch (error) {
      console.error('Failed to fetch backend user:', error)
      setBackendError(error instanceof Error ? error.message : 'Unknown error')
    } finally {
      setIsBackendLoaded(true)
    }
  }, [apiClient, isSignedIn, clerkUser])

  // Fetch backend user when Clerk user changes
  useEffect(() => {
    if (isLoaded) {
      fetchBackendUser()
    }
  }, [isLoaded, isSignedIn, clerkUser?.id, fetchBackendUser])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const handleImpersonationSessionChanged = () => {
      fetchBackendUser().catch((error) => {
        console.error('Failed to refresh backend user after impersonation change:', error)
      })
    }

    window.addEventListener(IMPERSONATION_SESSION_CHANGED_EVENT, handleImpersonationSessionChanged)
    return () => {
      window.removeEventListener(IMPERSONATION_SESSION_CHANGED_EVENT, handleImpersonationSessionChanged)
    }
  }, [fetchBackendUser])

  // Derive role from backend user or Clerk metadata
  const role = backendUser?.role ||
    (clerkUser?.publicMetadata?.role as UserRole) || null

  const tutorId = backendUser?.tutor_id || null
  const studentIds = backendUser?.student_ids || []

  // Super admin properties
  const isSuperAdmin = backendUser?.is_super_admin ||
    role === 'super_admin' ||
    (clerkUser?.publicMetadata?.is_super_admin as boolean) || false
  const adminPermissions = backendUser?.admin_permissions ||
    (clerkUser?.publicMetadata?.admin_permissions as AdminPermission[]) || []

  const hasFullAdminAccess = isSuperAdmin && adminPermissions.includes('full_access')

  const hasAdminPermission = useCallback((permission: AdminPermission): boolean => {
    if (!isSuperAdmin) return false
    if (adminPermissions.includes('full_access')) return true
    return adminPermissions.includes(permission)
  }, [isSuperAdmin, adminPermissions])

  const value: UserContextType = {
    // Clerk data
    clerkUser,
    isLoaded,
    isSignedIn: isSignedIn ?? false,

    // Backend data
    backendUser,
    isBackendLoaded,
    backendError,

    // Derived
    role,
    tutorId,
    studentIds,

    // Permissions
    isTutor: role === 'tutor',
    isStudent: role === 'student',
    isParent: role === 'parent',
    isSuperAdmin,
    adminPermissions,

    // Admin permission helpers
    hasAdminPermission,
    hasFullAdminAccess,

    // Actions
    refreshBackendUser: fetchBackendUser
  }

  return (
    <UserContext.Provider value={value}>
      {children}
    </UserContext.Provider>
  )
}

export function useUserContext() {
  const context = useContext(UserContext)
  if (context === undefined) {
    throw new Error('useUserContext must be used within a UserProvider')
  }
  return context
}

// Convenience hooks for common use cases
export function useCurrentRole() {
  const { role, isTutor, isStudent, isParent, isSuperAdmin } = useUserContext()
  return { role, isTutor, isStudent, isParent, isSuperAdmin }
}

export function useTutorId() {
  const { tutorId } = useUserContext()
  return tutorId
}

export function useSuperAdmin() {
  const { isSuperAdmin, adminPermissions, hasAdminPermission, hasFullAdminAccess } = useUserContext()
  return { isSuperAdmin, adminPermissions, hasAdminPermission, hasFullAdminAccess }
}

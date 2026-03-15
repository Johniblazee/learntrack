import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react'
import { useUser, useAuth } from '@clerk/clerk-react'
import posthog from '@/lib/posthog'
import { ApiClient, IMPERSONATION_SESSION_CHANGED_EVENT, setTokenGetter } from '@/lib/api-client'

// User role types matching backend
export type UserRole = 'tutor' | 'student' | 'parent' | 'super_admin'

// Admin permission types matching backend
export type AdminPermission =
  | 'view_all_tenants'
  | 'manage_tenants'
  | 'suspend_tenants'
  | 'view_all_users'
  | 'manage_users'
  | 'create_tutors'
  | 'delete_users'
  | 'manage_system_settings'
  | 'manage_ai_providers'
  | 'manage_feature_flags'
  | 'view_analytics'
  | 'export_data'
  | 'view_audit_logs'
  | 'manage_security'
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

// ─── Identity context (stable: role, tutorId, Clerk presence) ────────────────

interface UserIdentityContextType {
  clerkUser: ReturnType<typeof useUser>['user']
  isLoaded: boolean
  isSignedIn: boolean
  backendUser: BackendUser | null
  isBackendLoaded: boolean
  backendError: string | null
  role: UserRole | null
  tutorId: string | null
  studentIds: string[]
  isTutor: boolean
  isStudent: boolean
  isParent: boolean
  refreshBackendUser: () => Promise<void>
}

const UserIdentityContext = createContext<UserIdentityContextType | undefined>(undefined)

// ─── Permissions context (super-admin flags / permissions list) ───────────────

interface UserPermissionsContextType {
  isSuperAdmin: boolean
  adminPermissions: AdminPermission[]
  hasAdminPermission: (permission: AdminPermission) => boolean
  hasFullAdminAccess: boolean
}

const UserPermissionsContext = createContext<UserPermissionsContextType | undefined>(undefined)

// ─── Combined interface (kept for backward-compat with useUserContext()) ──────

interface UserContextType extends UserIdentityContextType, UserPermissionsContextType {}

// ─── Provider ─────────────────────────────────────────────────────────────────

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
      posthog.reset()
      return
    }

    try {
      setBackendError(null)
      const response = await apiClient.get<BackendUser>('/users/me')

      if (response.data) {
        setBackendUser(response.data)
        posthog.identify(response.data.clerk_id, {
          role: response.data.role,
          tutor_id: response.data.tutor_id,
        })
      } else if (response.status === 404) {
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

  useEffect(() => {
    if (isLoaded) {
      fetchBackendUser()
    }
  }, [isLoaded, isSignedIn, clerkUser?.id, fetchBackendUser])

  useEffect(() => {
    if (typeof window === 'undefined') return

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

  // ── Derived identity fields ──────────────────────────────────────────────────

  const role = backendUser?.role || (clerkUser?.publicMetadata?.role as UserRole) || null
  const tutorId = backendUser?.tutor_id || null
  const studentIds = backendUser?.student_ids || []

  // ── Derived permission fields ────────────────────────────────────────────────

  const isSuperAdmin =
    backendUser?.is_super_admin ||
    role === 'super_admin' ||
    (clerkUser?.publicMetadata?.is_super_admin as boolean) ||
    false
  const adminPermissions =
    backendUser?.admin_permissions ||
    (clerkUser?.publicMetadata?.admin_permissions as AdminPermission[]) ||
    []
  const hasFullAdminAccess = isSuperAdmin && adminPermissions.includes('full_access')

  const hasAdminPermission = useCallback(
    (permission: AdminPermission): boolean => {
      if (!isSuperAdmin) return false
      if (adminPermissions.includes('full_access')) return true
      return adminPermissions.includes(permission)
    },
    [isSuperAdmin, adminPermissions],
  )

  // ── Memoize each context value separately so a permission change doesn't
  //    re-render identity consumers and vice-versa (H7). ─────────────────────

  const identityValue = useMemo<UserIdentityContextType>(
    () => ({
      clerkUser,
      isLoaded,
      isSignedIn: isSignedIn ?? false,
      backendUser,
      isBackendLoaded,
      backendError,
      role,
      tutorId,
      studentIds,
      isTutor: role === 'tutor',
      isStudent: role === 'student',
      isParent: role === 'parent',
      refreshBackendUser: fetchBackendUser,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clerkUser, isLoaded, isSignedIn, backendUser, isBackendLoaded, backendError, role, tutorId, studentIds, fetchBackendUser],
  )

  const permissionsValue = useMemo<UserPermissionsContextType>(
    () => ({
      isSuperAdmin,
      adminPermissions,
      hasAdminPermission,
      hasFullAdminAccess,
    }),
    [isSuperAdmin, adminPermissions, hasAdminPermission, hasFullAdminAccess],
  )

  return (
    <UserIdentityContext.Provider value={identityValue}>
      <UserPermissionsContext.Provider value={permissionsValue}>
        {children}
      </UserPermissionsContext.Provider>
    </UserIdentityContext.Provider>
  )
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

/** Full combined context — backward-compatible with existing consumers. */
export function useUserContext(): UserContextType {
  const identity = useContext(UserIdentityContext)
  const permissions = useContext(UserPermissionsContext)
  if (!identity || !permissions) {
    throw new Error('useUserContext must be used within a UserProvider')
  }
  return { ...identity, ...permissions }
}

/** Focused hook — only re-renders when identity fields change. */
export function useUserIdentity(): UserIdentityContextType {
  const context = useContext(UserIdentityContext)
  if (!context) throw new Error('useUserIdentity must be used within a UserProvider')
  return context
}

/** Focused hook — only re-renders when permission fields change. */
export function useUserPermissions(): UserPermissionsContextType {
  const context = useContext(UserPermissionsContext)
  if (!context) throw new Error('useUserPermissions must be used within a UserProvider')
  return context
}

/** Convenience hook for super-admin checks. */
export function useSuperAdmin() {
  return useUserPermissions()
}

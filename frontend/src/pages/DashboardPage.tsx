import { useUser } from '@clerk/clerk-react'
import { useNavigate } from 'react-router-dom'
import { useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import TutorDashboard from '@/components/TutorDashboard/index'
import StudentDashboard from '@/components/StudentDashboard'
import ParentDashboard from '@/components/ParentDashboard'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { LoadingState } from '@/components/ui/loading-state'
import { VIEW_AS_STORAGE_KEY } from '@/lib/api-client'
import { useImpersonation } from '@/contexts/ImpersonationContext'

type DashboardView = 'tutor' | 'student' | 'parent'

const VIEW_LABELS: Record<DashboardView, string> = {
  tutor: 'Tutor',
  student: 'Student',
  parent: 'Parent',
}

const PREVIEW_SWITCHER_USER_ID = 'user_33bbM70rwXsrbn1GWQTGORD9d8T'

function readStoredViewAs(): DashboardView | null {
  if (typeof window === 'undefined') {
    return null
  }

  const value = window.localStorage.getItem(VIEW_AS_STORAGE_KEY)
  if (value === 'tutor' || value === 'student' || value === 'parent') {
    return value
  }

  return null
}

export default function DashboardPage() {
  // ProtectedRoute already ensures user is signed in
  const { isLoaded, user } = useUser()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { isImpersonating, impersonatedUser } = useImpersonation()

  // Get user role from metadata (check both public and unsafe metadata)
  const userRole = (user?.publicMetadata?.role || user?.unsafeMetadata?.role) as string | undefined
  const isSuperAdmin = userRole === 'super_admin' || Boolean(user?.publicMetadata?.is_super_admin || user?.unsafeMetadata?.is_super_admin)
  const isPreviewSwitcherUser = user?.id === PREVIEW_SWITCHER_USER_ID
  const canSwitchAllViews = isSuperAdmin || isPreviewSwitcherUser

  const initialView = useMemo<DashboardView>(() => {
    if (userRole === 'student' || userRole === 'parent' || userRole === 'tutor') {
      return userRole
    }
    return 'tutor'
  }, [userRole])

  const [activeView, setActiveView] = useState<DashboardView>(initialView)
  const impersonatedRole =
    isImpersonating &&
    (impersonatedUser?.role === 'tutor' ||
      impersonatedUser?.role === 'student' ||
      impersonatedUser?.role === 'parent')
      ? impersonatedUser.role
      : null

  useEffect(() => {
    if (!canSwitchAllViews) {
      if (typeof window !== 'undefined') {
        window.localStorage.removeItem(VIEW_AS_STORAGE_KEY)
      }
      setActiveView(initialView)
      return
    }

    if (!isPreviewSwitcherUser) {
      if (typeof window !== 'undefined') {
        window.localStorage.removeItem(VIEW_AS_STORAGE_KEY)
      }
      setActiveView(initialView)
      return
    }

    const storedView = readStoredViewAs()
    setActiveView(storedView ?? initialView)
  }, [canSwitchAllViews, initialView, isPreviewSwitcherUser])

  const handleSwitchView = (view: DashboardView) => {
    if (view === activeView) {
      return
    }

    setActiveView(view)

    if (!isPreviewSwitcherUser || typeof window === 'undefined') {
      return
    }

    window.localStorage.setItem(VIEW_AS_STORAGE_KEY, view)
    queryClient.clear()
  }

  const handleExitViewAs = () => {
    setActiveView(initialView)

    if (!isPreviewSwitcherUser || typeof window === 'undefined') {
      return
    }

    window.localStorage.removeItem(VIEW_AS_STORAGE_KEY)
    queryClient.clear()
  }

  useEffect(() => {
    if (!isLoaded) return

    // Sync role from unsafeMetadata to publicMetadata if needed
    if (user?.unsafeMetadata?.role && !user?.publicMetadata?.role) {
      user.update({
        unsafeMetadata: {
          ...user.unsafeMetadata,
          role: user.unsafeMetadata.role
        }
      }).catch(console.error)
    }

    // Redirect to role setup if no role is set
    if (!userRole) {
      navigate('/role-setup')
    }
  }, [isLoaded, user, userRole, navigate])

  // Loading state while Clerk loads
  if (!isLoaded) {
    return <LoadingState fullScreen message="Loading dashboard..." size="xl" />
  }

  const renderDashboard = () => {
    const view: DashboardView = impersonatedRole || (canSwitchAllViews ? activeView : initialView)
    switch (view) {
      case 'tutor':
        return <TutorDashboard />
      case 'student':
        return <StudentDashboard />
      case 'parent':
        return <ParentDashboard />
    }
  }

  // Show loading while redirecting to role-setup
  if (!userRole) {
    return <LoadingState fullScreen message="Redirecting to role setup..." size="xl" />
  }

  return (
    <>
      {canSwitchAllViews && !isImpersonating && (
        <Card className="fixed top-4 right-4 z-[70] p-2.5 border-border/70 bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/85">
          <div className="flex flex-col gap-2">
            {isPreviewSwitcherUser && (
              <div className="flex items-center justify-between px-1">
                <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  View As
                </span>
                {activeView !== initialView && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-[11px]"
                    onClick={handleExitViewAs}
                  >
                    Exit
                  </Button>
                )}
              </div>
            )}

            <div className="flex items-center gap-2">
            {(['tutor', 'student', 'parent'] as DashboardView[]).map((view) => (
              <Button
                key={view}
                size="sm"
                variant={activeView === view ? 'default' : 'outline'}
                onClick={() => handleSwitchView(view)}
              >
                {VIEW_LABELS[view]}
              </Button>
            ))}
            </div>
          </div>
        </Card>
      )}

      {renderDashboard()}
    </>
  )
}

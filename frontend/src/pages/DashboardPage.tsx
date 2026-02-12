import { useUser } from '@clerk/clerk-react'
import { useNavigate } from 'react-router-dom'
import { useEffect, useMemo, useState } from 'react'
import TutorDashboard from '@/components/TutorDashboard/index'
import StudentDashboard from '@/components/StudentDashboard'
import ParentDashboard from '@/components/ParentDashboard'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

type DashboardView = 'tutor' | 'student' | 'parent'

const VIEW_LABELS: Record<DashboardView, string> = {
  tutor: 'Tutor',
  student: 'Student',
  parent: 'Parent',
}

export default function DashboardPage() {
  // ProtectedRoute already ensures user is signed in
  const { isLoaded, user } = useUser()
  const navigate = useNavigate()

  // Get user role from metadata (check both public and unsafe metadata)
  const userRole = (user?.publicMetadata?.role || user?.unsafeMetadata?.role) as string | undefined
  const isSuperAdmin = userRole === 'super_admin' || Boolean(user?.publicMetadata?.is_super_admin || user?.unsafeMetadata?.is_super_admin)
  const canSwitchAllViews = isSuperAdmin

  const initialView = useMemo<DashboardView>(() => {
    if (userRole === 'student' || userRole === 'parent' || userRole === 'tutor') {
      return userRole
    }
    return 'tutor'
  }, [userRole])

  const [activeView, setActiveView] = useState<DashboardView>(initialView)

  useEffect(() => {
    setActiveView(initialView)
  }, [initialView])

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
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading dashboard...</p>
        </div>
      </div>
    )
  }

  const renderDashboard = () => {
    const view: DashboardView = canSwitchAllViews ? activeView : initialView
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
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-purple-600 mx-auto mb-4"></div>
          <p className="text-muted-foreground">Redirecting to role setup...</p>
        </div>
      </div>
    )
  }

  return (
    <>
      {canSwitchAllViews && (
        <Card className="fixed top-4 right-4 z-[70] p-2 border-border/70 bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/85">
          <div className="flex items-center gap-2">
            {(['tutor', 'student', 'parent'] as DashboardView[]).map((view) => (
              <Button
                key={view}
                size="sm"
                variant={activeView === view ? 'default' : 'outline'}
                onClick={() => setActiveView(view)}
              >
                {VIEW_LABELS[view]}
              </Button>
            ))}
          </div>
        </Card>
      )}

      {renderDashboard()}
    </>
  )
}

import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar"
import { Separator } from "@/components/ui/separator"
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb"
import { useNavigate, useLocation, Routes, Route, Navigate, useSearchParams } from "react-router-dom"
import { useClerk, useUser } from "@clerk/clerk-react"
import { AppSidebar } from "./AppSidebar"
import { DashboardHeaderActions } from "@/components/dashboard/DashboardHeaderActions"
import { OverviewView } from "./views/OverviewView"
import InvitationsView from "./views/InvitationsView"
import GroupsManagementView from "./views/GroupsManagementView"
import StudentManager from "@/components/student-manager"
import QuestionReviewer from "@/components/question-reviewer"
import QuestionBankManager from "@/components/question-bank-manager"
import MaterialManager from "@/components/MaterialManager"
import { OpenCanvasGenerator } from "@/components/question-generator"
import SubjectsView from "./views/SubjectsView"
import SubjectDetailView from "./views/SubjectDetailView"
import ActiveAssignmentsView from "./views/ActiveAssignmentsView"
import CreateAssignmentView from "./views/CreateAssignmentView"
import AssignmentTemplatesView from "./views/AssignmentTemplatesView"
import GradingView from "./views/GradingView"
import ConversationsView from "./views/ConversationsView"
import NotificationsPage from "@/pages/NotificationsPage"
import SettingsPage from "@/pages/SettingsPage"
import StudentDetailsPage from "@/pages/StudentDetailsPage"
import { useDashboardStats } from "@/hooks/useQueries"
import { useUserContext } from "@/contexts/UserContext"
import { useImpersonation } from "@/contexts/ImpersonationContext"

interface TutorDashboardProps {
  onBack?: () => void
}

function MessagesModeRedirect() {
  const [searchParams] = useSearchParams()
  const mode = searchParams.get("mode") === "email" ? "emails" : "chats"

  return <Navigate to={`/dashboard/messages/${mode}`} replace />
}

export default function TutorDashboard({ onBack }: TutorDashboardProps) {
  void onBack
  const { user } = useUser()
  const { signOut } = useClerk()
  const navigate = useNavigate()
  const location = useLocation()
  const { backendUser } = useUserContext()
  const { isImpersonating } = useImpersonation()

  // Use React Query for dashboard stats
  const { data: dashboardStats, isLoading: loading } = useDashboardStats()

  const actorName = user?.fullName || user?.firstName || "Tutor"
  const actorEmail = user?.primaryEmailAddress?.emailAddress || ""
  const impersonatedName =
    backendUser?.name && backendUser.name !== "Unknown User" ? backendUser.name : actorName
  const impersonatedEmail = backendUser?.email || actorEmail
  const displayName = isImpersonating ? impersonatedName : actorName
  const displayEmail = isImpersonating ? impersonatedEmail : actorEmail
  const initials =
    displayName
      .trim()
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((token) => token[0]?.toUpperCase() || "")
      .join("") || "T"
  const showClerkAvatar = !isImpersonating || backendUser?.clerk_id === user?.id

  // Determine active view from URL path
  const getActiveViewFromPath = () => {
    const path = location.pathname.replace('/dashboard', '').replace(/^\//, '')
    if (!path || path === '') return 'overview'

    // Handle dynamic routes
    if (path.startsWith('subjects/')) return 'subjects'
    if (path.startsWith('students/')) return 'all-students'

    // Map paths to view names
    const pathToView: Record<string, string> = {
      'subjects': 'subjects',
      'students': 'all-students',
      'invitations': 'invitations',
      'groups': 'groups',
      'content/generator': 'ai-generator',
      'content/review': 'review-questions',
      'content/bank': 'question-bank',
      'content/materials': 'resources',
      'assignments': 'active-assignments',
      'assignments/create': 'create-new',
      'assignments/templates': 'templates',
      'assignments/grading': 'grading',
      'messages': 'chats',
      'messages/chats': 'chats',
      'messages/emails': 'emails',
      'notifications': 'notifications',
      'settings': 'settings',
    }

    return pathToView[path] || 'overview'
  }

  const activeView = getActiveViewFromPath()

  // Handle view navigation
  const handleViewChange = (view: string) => {
    // Map view names to routes
    const viewToRoute: Record<string, string> = {
      'overview': '/dashboard',
      'subjects': '/dashboard/subjects',
      'all-students': '/dashboard/students',
      'invitations': '/dashboard/invitations',
      'groups': '/dashboard/groups',
      'ai-generator': '/dashboard/content/generator',
      'review-questions': '/dashboard/content/review',
      'question-bank': '/dashboard/content/bank',
      'resources': '/dashboard/content/materials',
      'active-assignments': '/dashboard/assignments',
      'create-new': '/dashboard/assignments/create',
      'templates': '/dashboard/assignments/templates',
      'grading': '/dashboard/assignments/grading',
      'chats': '/dashboard/messages/chats',
      'emails': '/dashboard/messages/emails',
      'notifications': '/dashboard/notifications',
      'settings': '/dashboard/settings',
    }

    const route = viewToRoute[view] || '/dashboard'
    navigate(route)
  }

  const handleOpenSettings = () => {
    navigate('/dashboard/settings')
  }

  const handleSignOut = async () => {
    await signOut()
    navigate('/')
  }

  // Get breadcrumb title and path info
  const getBreadcrumbInfo = () => {
    const path = location.pathname.replace('/dashboard', '').replace(/^\//, '')

    // Check if we're on a subject detail page
    if (path.startsWith('subjects/') && path !== 'subjects') {
      return {
        parent: { title: 'Subjects', path: '/dashboard/subjects' },
        current: 'Subject Details'
      }
    }

    // Check if we're on a student detail page
    if (path.startsWith('students/') && path !== 'students') {
      const studentSlug = path.split('/')[1]
      return {
        parent: { title: 'All Students', path: '/dashboard/students' },
        current: studentSlug.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
      }
    }

    const titles: Record<string, string> = {
      "overview": "Dashboard",
      "subjects": "Subjects",
      "all-students": "All Students",
      "invitations": "Invitations",
      "groups": "Groups",
      "ai-generator": "Question Generator",
      "review-questions": "Review Questions",
      "question-bank": "Question Bank",
      "resources": "Materials",
      "active-assignments": "Active Assignments",
      "create-new": "Create Assignment",
      "templates": "Templates",
        "grading": "Grading",
        "chats": "Conversations",
        "emails": "Emails",
        "notifications": "Notifications",
        "settings": "Settings",
      }

    return {
      parent: null,
      current: titles[activeView] || "Dashboard"
    }
  }

  const breadcrumbInfo = getBreadcrumbInfo()

  return (
    <SidebarProvider>
      <AppSidebar activeView={activeView} onViewChange={handleViewChange} />
      <SidebarInset className="bg-background">
        {/* Header with breadcrumb */}
        <header className="flex h-16 shrink-0 items-center gap-2 border-b bg-card px-4">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 h-4" />
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem className="hidden md:block">
                  <BreadcrumbLink href="#" onClick={() => navigate('/dashboard')}>
                    LearnTrack
                  </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator className="hidden md:block" />
                {breadcrumbInfo.parent ? (
                  <>
                    <BreadcrumbItem className="hidden md:block">
                      <BreadcrumbLink href="#" onClick={() => navigate(breadcrumbInfo.parent!.path)}>
                        {breadcrumbInfo.parent.title}
                      </BreadcrumbLink>
                    </BreadcrumbItem>
                    <BreadcrumbSeparator className="hidden md:block" />
                    <BreadcrumbItem>
                      <BreadcrumbPage>{breadcrumbInfo.current}</BreadcrumbPage>
                    </BreadcrumbItem>
                  </>
                ) : (
                  <BreadcrumbItem>
                    <BreadcrumbPage>{breadcrumbInfo.current}</BreadcrumbPage>
                  </BreadcrumbItem>
                )}
              </BreadcrumbList>
            </Breadcrumb>
          </div>

          <DashboardHeaderActions
            displayName={displayName}
            displayEmail={displayEmail}
            initials={initials}
            avatarUrl={user?.imageUrl}
            showAvatarImage={showClerkAvatar}
            onSettings={handleOpenSettings}
            onSignOut={handleSignOut}
          />

        </header>

        {/* Main Content - Nested Routes */}
        <div className="flex flex-1 flex-col gap-4 p-4 bg-background">
          <Routes>
            {/* Default route - Overview */}
            <Route index element={<OverviewView dashboardStats={dashboardStats} loading={loading} onViewChange={handleViewChange} />} />

            {/* Subjects routes */}
            <Route path="subjects" element={<SubjectsView />} />
            <Route path="subjects/:subjectId" element={<SubjectDetailView />} />

            {/* Students routes */}
            <Route path="students" element={<StudentManager />} />
            <Route path="students/:studentSlug" element={<StudentDetailsPage />} />
            <Route path="invitations" element={<InvitationsView />} />
            <Route path="groups" element={<GroupsManagementView />} />

            {/* Content routes */}
            <Route path="content/generator" element={<OpenCanvasGenerator />} />
            <Route path="content/review" element={<QuestionReviewer />} />
            <Route path="content/bank" element={<QuestionBankManager />} />
            <Route path="content/materials" element={<MaterialManager />} />

            {/* Assignments routes */}
            <Route path="assignments" element={<ActiveAssignmentsView />} />
            <Route path="assignments/create" element={<CreateAssignmentView />} />
            <Route path="assignments/templates" element={<AssignmentTemplatesView />} />
            <Route path="assignments/grading" element={<GradingView />} />

            {/* Messages routes */}
            <Route path="messages" element={<MessagesModeRedirect />} />
            <Route path="messages/chats" element={<ConversationsView routeMode="chats" />} />
            <Route path="messages/emails" element={<ConversationsView routeMode="emails" />} />

            {/* Utility routes */}
            <Route path="notifications" element={<NotificationsPage />} />
            <Route path="settings" element={<SettingsPage />} />

            {/* 404 Catch-all for undefined dashboard routes */}
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}

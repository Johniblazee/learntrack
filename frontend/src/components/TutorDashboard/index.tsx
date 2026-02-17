import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar"
import { Separator } from "@/components/ui/separator"
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb"
import { useNavigate, useLocation, Routes, Route, Navigate } from "react-router-dom"
import { AppSidebar } from "./AppSidebar"
import { OverviewView } from "./views/OverviewView"
import InvitationsView from "./views/InvitationsView"
import GroupsManagementView from "./views/GroupsManagementView"
import StudentManager from "@/components/student-manager"
import IntegratedSubjectsManager from "@/components/integrated-subjects-manager"
import QuestionReviewer from "@/components/question-reviewer"
import QuestionBankManager from "@/components/question-bank-manager"
import MaterialManager from "@/components/MaterialManager"
import { OpenCanvasGenerator } from "@/components/question-generator"
import ActiveAssignmentsView from "./views/ActiveAssignmentsView"
import CreateAssignmentView from "./views/CreateAssignmentView"
import AssignmentTemplatesView from "./views/AssignmentTemplatesView"
import GradingView from "./views/GradingView"
import MessagingView from "./views/MessagingView"
import ConversationsView from "./views/ConversationsView"
import StudentDetailsPage from "@/pages/StudentDetailsPage"
import { useDashboardStats } from "@/hooks/useQueries"

interface TutorDashboardProps {
  onBack?: () => void
}

export default function TutorDashboard({ onBack }: TutorDashboardProps) {
  void onBack
  const navigate = useNavigate()
  const location = useLocation()

  // Use React Query for dashboard stats
  const { data: dashboardStats, isLoading: loading } = useDashboardStats()

  // Determine active view from URL path
  const getActiveViewFromPath = () => {
    const path = location.pathname.replace('/dashboard', '').replace(/^\//, '')
    if (!path || path === '') return 'overview'

    // Handle dynamic routes (e.g., /students/:slug)
    if (path.startsWith('students/')) return 'all-students'

    // Map paths to view names
    const pathToView: Record<string, string> = {
      'students': 'all-students',
      'invitations': 'invitations',
      'groups': 'groups',
      'content/generator': 'ai-generator',
      'content/review': 'review-questions',
      'content/bank': 'question-bank',
      'content/materials': 'resources',
      'content/subjects': 'subjects',
      'assignments': 'active-assignments',
      'assignments/create': 'create-new',
      'assignments/templates': 'templates',
      'assignments/grading': 'grading',
      'messages/chats': 'chats',
      'messages/emails': 'emails',
    }

    return pathToView[path] || 'overview'
  }

  const activeView = getActiveViewFromPath()

  // Handle view navigation
  const handleViewChange = (view: string) => {
    // Map view names to routes
    const viewToRoute: Record<string, string> = {
      'overview': '/dashboard',
      'all-students': '/dashboard/students',
      'invitations': '/dashboard/invitations',
      'groups': '/dashboard/groups',
      'relationships': '/dashboard/relationships',
      'ai-generator': '/dashboard/content/generator',
      'review-questions': '/dashboard/content/review',
      'question-bank': '/dashboard/content/bank',
      'resources': '/dashboard/content/materials',
      'subjects': '/dashboard/content/subjects',
      'active-assignments': '/dashboard/assignments',
      'create-new': '/dashboard/assignments/create',
      'templates': '/dashboard/assignments/templates',
      'grading': '/dashboard/assignments/grading',
      'chats': '/dashboard/messages/chats',
      'emails': '/dashboard/messages/emails',
      'settings': '/settings',
    }

    const route = viewToRoute[view] || '/dashboard'
    navigate(route)
  }

  // Get breadcrumb title and path info
  const getBreadcrumbInfo = () => {
    const path = location.pathname.replace('/dashboard', '').replace(/^\//, '')

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
      "all-students": "All Students",
      "invitations": "Invitations",
      "groups": "Groups",
      "relationships": "Relationships",
      "ai-generator": "Question Generator",
      "review-questions": "Review Questions",
      "question-bank": "Question Bank",
      "resources": "Materials",
      "subjects": "Subjects",
      "active-assignments": "Active Assignments",
      "create-new": "Create Assignment",
      "templates": "Templates",
      "grading": "Grading",
      "chats": "Conversations",
      "emails": "Emails",
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
        </header>

        {/* Main Content - Nested Routes */}
        <div className="flex flex-1 flex-col gap-4 p-4 bg-background">
          <Routes>
            {/* Default route - Overview */}
            <Route index element={<OverviewView dashboardStats={dashboardStats} loading={loading} onViewChange={handleViewChange} />} />

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
            <Route path="content/subjects" element={<IntegratedSubjectsManager />} />

            {/* Assignments routes */}
            <Route path="assignments" element={<ActiveAssignmentsView />} />
            <Route path="assignments/create" element={<CreateAssignmentView />} />
            <Route path="assignments/templates" element={<AssignmentTemplatesView />} />
            <Route path="assignments/grading" element={<GradingView />} />

            {/* Messages routes */}
            <Route path="messages/chats" element={<ConversationsView />} />
            <Route path="messages/emails" element={<MessagingView type="emails" />} />

            {/* 404 Catch-all for undefined dashboard routes */}
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}


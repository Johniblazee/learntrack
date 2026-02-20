import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar"
import { Separator } from "@/components/ui/separator"
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useNavigate, useLocation, Routes, Route, Navigate } from "react-router-dom"
import { Bell, LogOut, Moon, Settings, Sun } from "lucide-react"
import { useClerk, useUser } from "@clerk/clerk-react"
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
import { useDashboardStats, useNotifications, useUnreadNotificationCount } from "@/hooks/useQueries"
import { useTheme } from "@/contexts/ThemeContext"
import { useUserContext } from "@/contexts/UserContext"
import { useImpersonation } from "@/contexts/ImpersonationContext"

interface TutorDashboardProps {
  onBack?: () => void
}

export default function TutorDashboard({ onBack }: TutorDashboardProps) {
  void onBack
  const { user } = useUser()
  const { signOut } = useClerk()
  const navigate = useNavigate()
  const location = useLocation()
  const { theme, toggleTheme } = useTheme()
  const { backendUser } = useUserContext()
  const { isImpersonating } = useImpersonation()

  // Use React Query for dashboard stats
  const { data: dashboardStats, isLoading: loading } = useDashboardStats()
  const { data: notificationResponse } = useNotifications(1, 5)
  const { data: unreadResponse } = useUnreadNotificationCount()

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

  const notifications = Array.isArray(notificationResponse?.items)
    ? notificationResponse.items
    : []
  const unreadCount =
    typeof unreadResponse?.unread_count === "number" ? unreadResponse.unread_count : 0

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

  const handleOpenSettings = () => {
    navigate('/settings')
  }

  const handleSignOut = async () => {
    await signOut()
    navigate('/')
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

          <div className="flex items-center gap-1.5">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="relative">
                  <Bell className="h-4 w-4" />
                  {unreadCount > 0 && (
                    <Badge
                      variant="destructive"
                      className="absolute -top-1 -right-1 h-4 min-w-4 px-1 text-[10px]"
                    >
                      {unreadCount}
                    </Badge>
                  )}
                  <span className="sr-only">Notifications</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" side="bottom" sideOffset={8} className="w-80 rounded-lg">
                <DropdownMenuLabel className="flex items-center justify-between">
                  <span>Notifications</span>
                  <span className="text-xs text-muted-foreground">{unreadCount} unread</span>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  {notifications.length === 0 ? (
                    <DropdownMenuItem disabled>
                      <span className="text-sm text-muted-foreground">No notifications</span>
                    </DropdownMenuItem>
                  ) : (
                    notifications.slice(0, 4).map((notification: any, index: number) => (
                      <DropdownMenuItem
                        key={String(notification?.id ?? notification?._id ?? `tutor-notification-${index}`)}
                      >
                        <div className="flex flex-col gap-1">
                          <span className="font-medium">{notification?.title || 'Notification'}</span>
                          <span className="line-clamp-2 text-xs text-muted-foreground">
                            {notification?.message || 'No details provided'}
                          </span>
                        </div>
                      </DropdownMenuItem>
                    ))
                  )}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>

            <Button variant="ghost" size="icon" onClick={toggleTheme}>
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              <span className="sr-only">Toggle theme</span>
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="h-9 px-2">
                  <Avatar className="h-8 w-8 rounded-lg">
                    {showClerkAvatar && <AvatarImage src={user?.imageUrl} alt={displayName} />}
                    <AvatarFallback className="rounded-lg bg-primary text-primary-foreground">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" side="bottom" sideOffset={8} className="min-w-56 rounded-lg">
                <DropdownMenuLabel className="p-0 font-normal">
                  <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                    <Avatar className="h-8 w-8 rounded-lg">
                      {showClerkAvatar && <AvatarImage src={user?.imageUrl} alt={displayName} />}
                      <AvatarFallback className="rounded-lg bg-primary text-primary-foreground">
                        {initials}
                      </AvatarFallback>
                    </Avatar>
                    <div className="grid flex-1 text-left text-sm leading-tight">
                      <span className="truncate font-semibold">{displayName}</span>
                      <span className="truncate text-xs text-muted-foreground">{displayEmail}</span>
                    </div>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleOpenSettings}>
                  <Settings className="mr-2 h-4 w-4" />
                  Settings
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleSignOut}>
                  <LogOut className="mr-2 h-4 w-4" />
                  Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

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


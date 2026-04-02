import { useEffect, useMemo } from 'react'
import { useClerk, useUser } from '@clerk/clerk-react'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import {
  BookOpen,
  CalendarClock,
  Heart,
  Layers,
  MessageCircle,
  Target,
  TrendingUp,
  Trophy,
  Users,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { DashboardMessagesPage } from '@/components/dashboard/DashboardMessagesPage'
import NotificationsPage from '@/pages/NotificationsPage'
import SettingsPage from '@/pages/SettingsPage'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { PageShell } from '@/components/ui/page-shell'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { DashboardHeaderActions } from '@/components/dashboard/DashboardHeaderActions'
import {
  useParentDashboardStats,
  useParentProgress,
  useUserSettings,
} from '@/hooks/useQueries'
import { useImpersonation } from '@/contexts/ImpersonationContext'
import { useUserContext } from '@/contexts/UserContext'

type ParentTab = 'overview' | 'children' | 'upcoming' | 'messages'

const PARENT_TAB_ROUTES: Record<ParentTab, string> = {
  overview: '/dashboard',
  children: '/dashboard/children',
  upcoming: '/dashboard/upcoming',
  messages: '/dashboard/messages',
}

function getParentTabFromPath(pathname: string): ParentTab {
  const path = pathname.replace('/dashboard', '').replace(/^\/+/, '')
  const [rootSegment] = path.split('/')

  switch (rootSegment) {
    case 'children':
      return 'children'
    case 'upcoming':
      return 'upcoming'
    case 'messages':
      return 'messages'
    default:
      return 'overview'
  }
}

function getParentPageLabel(pathname: string, activeTab: ParentTab): string {
  if (pathname.startsWith('/dashboard/settings')) {
    return 'Settings'
  }
  if (pathname.startsWith('/dashboard/notifications')) {
    return 'Notifications'
  }

  const labels: Record<ParentTab, string> = {
    overview: 'Overview',
    children: 'Children',
    upcoming: 'Upcoming',
    messages: 'Messages',
  }

  return labels[activeTab]
}

export default function ParentDashboard() {
  const { user } = useUser()
  const { backendUser } = useUserContext()
  const { isImpersonating } = useImpersonation()
  const { signOut } = useClerk()
  const location = useLocation()
  const navigate = useNavigate()

  const actorName = user?.fullName || user?.firstName || 'Parent'
  const actorEmail = user?.primaryEmailAddress?.emailAddress || ''
  const impersonatedName =
    backendUser?.name && backendUser.name !== 'Unknown User' ? backendUser.name : actorName
  const impersonatedEmail = backendUser?.email || actorEmail
  const parentName = isImpersonating ? impersonatedName : actorName
  const displayName = parentName
  const displayEmail = isImpersonating ? impersonatedEmail : actorEmail
  const initials =
    displayName
      .trim()
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((token) => token[0]?.toUpperCase() || '')
      .join('') || 'P'
  const showClerkAvatar = !isImpersonating || backendUser?.clerk_id === user?.id

  const {
    data: dashboardStats,
    isLoading: isLoadingStats,
    error: statsError,
  } = useParentDashboardStats()
  const {
    data: parentProgressViews,
    isLoading: isLoadingProgress,
    error: progressError,
  } = useParentProgress()
  const { data: userSettings, isLoading: isLoadingSettings } = useUserSettings()
  const activeTab = useMemo(() => getParentTabFromPath(location.pathname), [location.pathname])
  const currentPageLabel = useMemo(
    () => getParentPageLabel(location.pathname, activeTab),
    [activeTab, location.pathname]
  )

  useEffect(() => {
    if (isLoadingSettings) {
      return
    }

    const isBaseDashboardRoute =
      location.pathname === '/dashboard' || location.pathname === '/dashboard/'

    if (!isBaseDashboardRoute) {
      return
    }

    const preferredTab = String(userSettings?.preferences?.default_parent_tab || '').toLowerCase()
    if (preferredTab === 'overview' || preferredTab === 'children' || preferredTab === 'upcoming' || preferredTab === 'messages') {
      const preferredRoute = PARENT_TAB_ROUTES[preferredTab]
      if (preferredRoute !== PARENT_TAB_ROUTES.overview) {
        navigate(preferredRoute, { replace: true })
      }
    }
  }, [
    isLoadingSettings,
    location.pathname,
    navigate,
    userSettings?.preferences?.default_parent_tab,
  ])

  const children = useMemo(() => dashboardStats?.children || [], [dashboardStats?.children])

  const aggregate = useMemo(() => {
    const totalChildren = children.length
    const totalAssignmentsDue = children.reduce(
      (sum, child) => sum + (child.assignments_due || 0),
      0
    )
    const avgProgress =
      totalChildren > 0
        ? Math.round(
            children.reduce((sum, child) => sum + (child.overall_progress || 0), 0) /
              totalChildren
          )
        : 0

    return {
      totalChildren,
      totalAssignmentsDue,
      avgProgress,
    }
  }, [children])

  const upcomingFromProgress = useMemo(() => {
    if (!Array.isArray(parentProgressViews)) return []

    return parentProgressViews.flatMap((view: any) => {
      const childName = view?.child_name || 'Child'
      const assignments = Array.isArray(view?.upcoming_assignments)
        ? view.upcoming_assignments
        : []

      return assignments.map((assignment: any) => ({
        childName,
        title: assignment?.title || 'Untitled assignment',
        subject: assignment?.subject || 'General',
        dueDate: assignment?.due_date || null,
        isOverdue: Boolean(assignment?.is_overdue),
      }))
    })
  }, [parentProgressViews])

  const statsErrorMessage = statsError instanceof Error ? statsError.message : null
  const progressErrorMessage = progressError instanceof Error ? progressError.message : null

  const renderErrorCard = (title: string, message: string) => {
    return (
      <Card className="border-destructive/30 bg-destructive/5 shadow-sm">
        <CardContent className="space-y-2 p-6">
          <p className="font-semibold text-foreground">{title}</p>
          <p className="text-sm text-muted-foreground">{message}</p>
        </CardContent>
      </Card>
    )
  }

  const formatDueDateLabel = (value: string | null, isOverdue: boolean) => {
    if (!value) {
      return 'TBD'
    }

    const parsed = new Date(value)
    if (Number.isNaN(parsed.getTime())) {
      return value
    }

    const prefix = isOverdue ? 'Overdue ' : 'Due '
    return `${prefix}${parsed.toLocaleDateString([], { month: 'short', day: 'numeric' })}`
  }

  const handleSignOut = async () => {
    await signOut()
  }

  const handleOpenSettings = () => {
    navigate('/dashboard/settings')
  }

  const handleTabChange = (tab: ParentTab) => {
    navigate(PARENT_TAB_ROUTES[tab])
  }

  const navItems: Array<{ label: string; tab: ParentTab; icon: any }> = [
    { label: 'Overview', tab: 'overview', icon: Heart },
    { label: 'Children', tab: 'children', icon: Users },
    { label: 'Upcoming', tab: 'upcoming', icon: CalendarClock },
    { label: 'Messages', tab: 'messages', icon: MessageCircle },
  ]

  const renderOverviewPage = () => {
    if (statsErrorMessage) {
      return renderErrorCard('Unable to load child progress', statsErrorMessage)
    }

    return (
      <Card className="border-0 bg-card shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="h-5 w-5 text-primary" />
            Child Progress Snapshot
          </CardTitle>
          <CardDescription>Quick progress and grade overview by child</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoadingStats ? (
            Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="h-16 w-full" />
            ))
          ) : children.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">No children linked yet</div>
          ) : (
            children.map((child) => (
              <div key={child.id} className="rounded-lg border p-4">
                <div className="mb-2 flex items-center justify-between">
                  <div>
                    <p className="font-medium text-foreground">{child.name}</p>
                    <p className="text-xs text-muted-foreground">Grade {child.grade || 'N/A'}</p>
                  </div>
                  <Badge variant="outline">{child.recent_grade || '--'}</Badge>
                </div>
                <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                  <span>Overall Progress</span>
                  <span>{child.overall_progress || 0}%</span>
                </div>
                <Progress value={child.overall_progress || 0} className="h-2" />
              </div>
            ))
          )}
        </CardContent>
      </Card>
    )
  }

  const renderChildrenPage = () => {
    if (statsErrorMessage) {
      return renderErrorCard('Unable to load child details', statsErrorMessage)
    }

    return (
      <Card className="border-0 bg-card shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            Children Details
          </CardTitle>
          <CardDescription>Current standing and workload per child</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoadingStats ? (
            Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="mb-3 h-20 w-full" />
            ))
          ) : children.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">No children linked yet</div>
          ) : (
            <div className="space-y-4">
              {children.map((child) => (
                <div key={child.id} className="rounded-lg border p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="font-semibold text-foreground">{child.name}</h3>
                      <p className="text-sm text-muted-foreground">Grade {child.grade || 'N/A'}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge>{child.recent_grade || '--'}</Badge>
                      <Badge variant="outline">
                        <BookOpen className="mr-1 h-3 w-3" />
                        {child.assignments_due || 0} due
                      </Badge>
                    </div>
                  </div>
                  <Separator className="my-3" />
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Overall Progress</span>
                    <span className="font-medium text-foreground">
                      {child.overall_progress || 0}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    )
  }

  const renderUpcomingPage = () => {
    if (progressErrorMessage) {
      return renderErrorCard('Unable to load upcoming work', progressErrorMessage)
    }

    return (
      <Card className="border-0 bg-card shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarClock className="h-5 w-5 text-primary" />
            Upcoming Work
          </CardTitle>
          <CardDescription>Assignments that need attention soon</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoadingProgress ? (
            Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="mb-3 h-16 w-full" />
            ))
          ) : upcomingFromProgress.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">No upcoming assignments</div>
          ) : (
            <div className="space-y-3">
              {upcomingFromProgress.map((item, index) => (
                <div
                  key={`${item.childName}-${item.title}-${index}`}
                  className="rounded-lg border p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-foreground">{item.title}</p>
                      <p className="text-sm text-muted-foreground">
                        {item.subject} • {item.childName}
                      </p>
                    </div>
                    <Badge variant={item.isOverdue ? 'destructive' : 'outline'}>
                      {formatDueDateLabel(item.dueDate, item.isOverdue)}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    )
  }

  const renderMessagesPage = () => {
    return (
      <DashboardMessagesPage
        title="Messages"
        description="Stay in touch with your child's teacher in real time."
      />
    )
  }

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon" variant="inset">
        <SidebarContent>
          <SidebarGroup>
            <div className="flex items-center gap-2 px-4 py-6 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-2 group-data-[collapsible=icon]:py-4">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Layers className="h-5 w-5" />
              </div>
              <h1 className="text-xl font-bold tracking-tight text-primary font-display group-data-[collapsible=icon]:hidden">
                LearnTrack
              </h1>
            </div>

            <SidebarGroupContent>
              <SidebarMenu>
                {navItems.map((item) => (
                  <SidebarMenuItem key={item.tab}>
                    <SidebarMenuButton
                      tooltip={item.label}
                      isActive={activeTab === item.tab}
                      onClick={() => handleTabChange(item.tab)}
                    >
                      <item.icon />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

      </Sidebar>

      <SidebarInset className="bg-background">
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
                <BreadcrumbItem>
                  <BreadcrumbPage>{currentPageLabel}</BreadcrumbPage>
                </BreadcrumbItem>
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

        <div className="flex flex-1 flex-col gap-4 bg-background p-4">
          <div className="flex-1 overflow-y-auto">
            <PageShell>
              <div>
                <h1 className="mb-2 text-3xl font-bold text-foreground">Welcome back, {parentName}</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  Track your children&apos;s progress, upcoming work, and outcomes in one place.
                </p>
              </div>

              {statsErrorMessage ? (
                renderErrorCard('Parent dashboard summary unavailable', statsErrorMessage)
              ) : (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <Card className="border-0 bg-card shadow-sm">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                      <CardTitle className="text-sm font-medium">Children</CardTitle>
                      <Users className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                      {isLoadingStats ? (
                        <Skeleton className="h-8 w-16" />
                      ) : (
                        <div className="text-2xl font-bold">{aggregate.totalChildren}</div>
                      )}
                      <p className="text-xs text-muted-foreground">Linked students</p>
                    </CardContent>
                  </Card>

                  <Card className="border-0 bg-card shadow-sm">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                      <CardTitle className="text-sm font-medium">Assignments Due</CardTitle>
                      <CalendarClock className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                      {isLoadingStats ? (
                        <Skeleton className="h-8 w-16" />
                      ) : (
                        <div className="text-2xl font-bold">{aggregate.totalAssignmentsDue}</div>
                      )}
                      <p className="text-xs text-muted-foreground">Across all children</p>
                    </CardContent>
                  </Card>

                  <Card className="border-0 bg-card shadow-sm">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                      <CardTitle className="text-sm font-medium">Completion Progress</CardTitle>
                      <TrendingUp className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                      {isLoadingStats ? (
                        <Skeleton className="h-8 w-24" />
                      ) : (
                        <div className="text-2xl font-bold">{aggregate.avgProgress}%</div>
                      )}
                      <p className="text-xs text-muted-foreground">Overall completion</p>
                    </CardContent>
                  </Card>
                </div>
              )}

              <Tabs value={activeTab} onValueChange={(value) => handleTabChange(value as ParentTab)}>
                <TabsList className="grid w-full grid-cols-4 md:w-[560px]">
                  <TabsTrigger value="overview">Overview</TabsTrigger>
                  <TabsTrigger value="children">Children</TabsTrigger>
                  <TabsTrigger value="upcoming">Upcoming</TabsTrigger>
                  <TabsTrigger value="messages">Messages</TabsTrigger>
                </TabsList>
              </Tabs>

              <Routes>
                <Route index element={renderOverviewPage()} />
                <Route path="children" element={renderChildrenPage()} />
                <Route path="upcoming" element={renderUpcomingPage()} />
                <Route path="messages" element={renderMessagesPage()} />
                <Route path="messages/chats" element={<Navigate to="/dashboard/messages?mode=chat" replace />} />
                <Route path="messages/emails" element={<Navigate to="/dashboard/messages?mode=email" replace />} />
                <Route path="notifications" element={<NotificationsPage />} />
                <Route path="settings" element={<SettingsPage />} />
                <Route path="*" element={<Navigate to="/dashboard" replace />} />
              </Routes>

              <Card className="border-0 bg-card shadow-sm">
                <CardContent className="flex items-center gap-3 p-4 text-sm text-muted-foreground">
                  <Trophy className="h-4 w-4" />
                  Tip: Use the children and upcoming tabs to spot risk early and follow up before deadlines.
                </CardContent>
              </Card>
            </PageShell>
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}

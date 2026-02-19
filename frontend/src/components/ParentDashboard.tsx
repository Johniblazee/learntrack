import { useMemo, useState } from 'react'
import { useClerk, useUser } from '@clerk/clerk-react'
import { useNavigate } from 'react-router-dom'
import {
  BookOpen,
  CalendarClock,
  Heart,
  Layers,
  LogOut,
  Settings,
  Target,
  TrendingUp,
  Trophy,
  Users,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useParentDashboardStats, useParentProgress } from '@/hooks/useQueries'

type ParentTab = 'overview' | 'children' | 'upcoming'

export default function ParentDashboard() {
  const { user } = useUser()
  const { signOut } = useClerk()
  const navigate = useNavigate()

  const parentName = user?.fullName || user?.firstName || 'Parent'
  const [activeTab, setActiveTab] = useState<ParentTab>('overview')

  const { data: dashboardStats, isLoading: isLoadingStats } = useParentDashboardStats()
  const { data: parentProgressViews, isLoading: isLoadingProgress } = useParentProgress()

  const children = dashboardStats?.children || []

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
      }))
    })
  }, [parentProgressViews])

  const handleSignOut = async () => {
    await signOut()
  }

  const handleOpenSettings = () => {
    navigate('/settings')
  }

  const navItems: Array<{ label: string; tab: ParentTab; icon: any }> = [
    { label: 'Overview', tab: 'overview', icon: Heart },
    { label: 'Children', tab: 'children', icon: Users },
    { label: 'Upcoming', tab: 'upcoming', icon: CalendarClock },
  ]

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon" variant="inset">
        <SidebarContent>
          <SidebarGroup>
            <div className="flex items-center gap-2 px-4 py-6 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-2 group-data-[collapsible=icon]:py-4">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Layers className="h-5 w-5" />
              </div>
              <h1 className="text-xl font-bold tracking-tight text-primary font-lufga group-data-[collapsible=icon]:hidden">
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
                      onClick={() => setActiveTab(item.tab)}
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

        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton tooltip="Settings" onClick={handleOpenSettings}>
                <Settings />
                <span>Settings</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton tooltip="Log Out" onClick={handleSignOut}>
                <LogOut />
                <span>Log Out</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
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
                  <BreadcrumbPage>Parent Dashboard</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </div>

        </header>

        <div className="flex flex-1 flex-col gap-4 bg-background p-4">
          <div className="flex-1 overflow-y-auto">
            <div className="mx-auto max-w-7xl space-y-6 px-4 py-4 sm:px-6 sm:py-6">
            <div>
              <h1 className="mb-2 text-3xl font-bold text-foreground">Welcome back, {parentName}</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Track your children&apos;s progress, upcoming work, and outcomes in one place.
              </p>
            </div>

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
                  <CardTitle className="text-sm font-medium">Average Progress</CardTitle>
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

            <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as ParentTab)}>
              <TabsList className="grid w-full grid-cols-3 md:w-[420px]">
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="children">Children</TabsTrigger>
                <TabsTrigger value="upcoming">Upcoming</TabsTrigger>
              </TabsList>

              <TabsContent value="overview" className="mt-4">
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
              </TabsContent>

              <TabsContent value="children" className="mt-4">
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
              </TabsContent>

              <TabsContent value="upcoming" className="mt-4">
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
                              <Badge variant="outline">{item.dueDate || 'TBD'}</Badge>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>

            <Card className="border-0 bg-card shadow-sm">
              <CardContent className="flex items-center gap-3 p-4 text-sm text-muted-foreground">
                <Trophy className="h-4 w-4" />
                Tip: Use the children and upcoming tabs to spot risk early and follow up before deadlines.
              </CardContent>
            </Card>
            </div>
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}

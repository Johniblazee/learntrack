"use client"

import { useMemo, useRef, useState } from "react"
import { useClerk, useUser } from "@clerk/clerk-react"
import { useNavigate } from "react-router-dom"
import {
  BookOpen,
  CheckCircle2,
  Clock3,
  FolderOpen,
  Layers,
  LayoutDashboard,
  LogOut,
  Settings,
  Sparkles,
  TrendingUp,
  Trophy,
  Users,
} from "lucide-react"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
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
} from "@/components/ui/sidebar"
import { Skeleton } from "@/components/ui/skeleton"
import StudentAssignmentWorkspace from "@/components/student-assignment-workspace"
import { useUserContext } from "@/contexts/UserContext"
import {
  useMyAssignments,
  useStudentDashboardStats,
  useStudentProgressAnalytics,
} from "@/hooks/useQueries"
import { cn } from "@/lib/utils"

interface AssignmentCardData {
  id: string
  title: string
  subject: string
  dueDate: Date | null
  questionCount: number
  progress: number
  status: string
}

type StudentNavSection = "dashboard" | "courses" | "assignments" | "grades" | "library"

const MENTOR_PLACEHOLDERS = [
  { name: "Marcus Thorne", role: "Product Designer" },
  { name: "Elena Rodriguez", role: "React Developer" },
]

function toAssignmentCards(items: any[]): AssignmentCardData[] {
  return items.map((item, index) => {
    const questionCount =
      item.question_count ?? item.questionCount ?? item.questions?.length ?? 0
    const completedQuestions =
      item.completed_questions ??
      item.completedQuestions ??
      (String(item.status).toLowerCase() === "completed" ? questionCount : 0)
    const computedProgress =
      questionCount > 0 ? Math.round((completedQuestions / questionCount) * 100) : 0

    const status = String(item.status ?? "pending").toLowerCase()
    const progressFromStatus = status === "completed" ? 100 : status === "active" ? 55 : 0
    const progress = computedProgress > 0 ? computedProgress : progressFromStatus

    return {
      id: String(item.id ?? item._id ?? `assignment-${index}`),
      title: item.title ?? "Untitled Assignment",
      subject:
        item.subject_name ??
        item.subject?.name ??
        item.subject_id?.name ??
        item.subject_id ??
        "General Studies",
      dueDate: item.due_date || item.dueDate ? new Date(item.due_date ?? item.dueDate) : null,
      questionCount,
      progress,
      status,
    }
  })
}

function formatDueDate(date: Date | null): string {
  if (!date) return "No due date"
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

function formatRelativeDueDate(date: Date | null): string {
  if (!date) return "No due date"
  const now = new Date()
  const dayDiff = Math.ceil((date.getTime() - now.getTime()) / 86400000)
  if (dayDiff < 0) return `${Math.abs(dayDiff)} day${Math.abs(dayDiff) > 1 ? "s" : ""} overdue`
  if (dayDiff === 0) return "Due today"
  if (dayDiff === 1) return "Due tomorrow"
  return `Due in ${dayDiff} days`
}

function getStatusBadgeVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "completed") return "default"
  if (status === "active" || status === "in_progress") return "secondary"
  if (status === "overdue" || status === "archived") return "destructive"
  return "outline"
}

function getWeekDays(datesWithTasks: Set<string>) {
  const now = new Date()
  const currentDay = (now.getDay() + 6) % 7
  const monday = new Date(now)
  monday.setDate(now.getDate() - currentDay)

  return Array.from({ length: 7 }).map((_, i) => {
    const date = new Date(monday)
    date.setDate(monday.getDate() + i)
    const key = date.toDateString()
    return {
      date,
      label: date.toLocaleDateString(undefined, { weekday: "short" }),
      isToday: key === now.toDateString(),
      hasTask: datesWithTasks.has(key),
      isWeekend: i >= 5,
    }
  })
}

export default function StudentDashboard() {
  const { user } = useUser()
  const { signOut } = useClerk()
  const navigate = useNavigate()
  const { backendUser } = useUserContext()

  const [searchTerm, setSearchTerm] = useState("")
  const [activeAssignmentId, setActiveAssignmentId] = useState<string | null>(null)
  const [activeNavSection, setActiveNavSection] = useState<StudentNavSection>("dashboard")
  const [showAllAssignments, setShowAllAssignments] = useState(false)

  const contentScrollRef = useRef<HTMLDivElement | null>(null)
  const assignmentsSectionRef = useRef<HTMLElement | null>(null)
  const scheduleSectionRef = useRef<HTMLElement | null>(null)
  const activitySectionRef = useRef<HTMLElement | null>(null)
  const performanceSectionRef = useRef<HTMLElement | null>(null)
  const mentorsSectionRef = useRef<HTMLElement | null>(null)

  const { data: rawAssignments = [], isLoading: assignmentsLoading } = useMyAssignments()
  const { data: dashboardStats, isLoading: statsLoading } = useStudentDashboardStats()
  const { data: progressAnalytics, isLoading: analyticsLoading } = useStudentProgressAnalytics()

  const studentName = backendUser?.name || user?.fullName || user?.firstName || "Student"
  const assignments = useMemo(() => toAssignmentCards(rawAssignments as any[]), [rawAssignments])

  const visibleAssignments = useMemo(() => {
    const query = searchTerm.trim().toLowerCase()
    const sorted = [...assignments].sort((a, b) => {
      const aTime = a.dueDate ? a.dueDate.getTime() : Number.POSITIVE_INFINITY
      const bTime = b.dueDate ? b.dueDate.getTime() : Number.POSITIVE_INFINITY
      return aTime - bTime
    })

    if (!query) return sorted

    return sorted.filter((item) => {
      return (
        item.title.toLowerCase().includes(query) || item.subject.toLowerCase().includes(query)
      )
    })
  }, [assignments, searchTerm])

  const actionableAssignments = visibleAssignments.filter(
    (item) => item.status !== "completed" && item.status !== "archived"
  )
  const workingAssignments = showAllAssignments
    ? actionableAssignments
    : actionableAssignments.slice(0, 3)
  const canExpandAssignments = actionableAssignments.length > 3

  const datesWithTasks = new Set(
    assignments
      .map((item) => item.dueDate)
      .filter((value): value is Date => Boolean(value))
      .map((date) => date.toDateString())
  )

  const weekDays = useMemo(() => getWeekDays(datesWithTasks), [datesWithTasks])

  const gpa = useMemo(() => {
    const avg = Number(dashboardStats?.overall_average ?? 0)
    if (!avg) return "--"
    return Math.min(4, avg / 25).toFixed(2)
  }, [dashboardStats?.overall_average])

  const totalAssignments = dashboardStats?.total_assignments ?? assignments.length
  const completedAssignments = dashboardStats?.completed ?? 0
  const completionRate =
    totalAssignments > 0 ? Math.round((completedAssignments / totalAssignments) * 100) : 0
  const pendingAssignments =
    dashboardStats?.pending ?? Math.max(totalAssignments - completedAssignments, 0)

  const weeklyEvents = useMemo(() => {
    const assignmentEvents = assignments
      .filter((item) => item.dueDate)
      .slice(0, 2)
      .map((item, index) => ({
        time: index === 0 ? "10:00 AM" : "2:30 PM",
        title: item.title,
        context: `${item.subject} - ${formatRelativeDueDate(item.dueDate)}`,
        tone: index === 0 ? "primary" : "danger",
      }))

    if (assignmentEvents.length > 0) return assignmentEvents

    return [
      {
        time: "10:00 AM",
        title: "History of Art Seminar",
        context: "Main Hall - Dr. Sarah Jenkins",
        tone: "primary",
      },
      {
        time: "2:30 PM",
        title: "Quiz: UI Foundations",
        context: "Online Portal - Timed (45 mins)",
        tone: "danger",
      },
    ]
  }, [assignments])

  const recentActivity = useMemo(() => {
    if (progressAnalytics?.recent_submissions?.length) {
      return progressAnalytics.recent_submissions.slice(0, 3).map((item: any) => ({
        title: item.score >= 85 ? "Strong Submission" : "Assignment Submitted",
        detail: `${item.assignment_title || "Assignment"} in ${item.subject || "General"}`,
        stamp: item.submitted_at ? new Date(item.submitted_at).toLocaleDateString() : "Recently",
        tone: item.score >= 85 ? "success" : "primary",
      }))
    }

    return [
      {
        title: "Assignment Submitted",
        detail: "User Persona Study for UI Design 101.",
        stamp: "2 hours ago",
        tone: "success",
      },
      {
        title: "New Grade Posted",
        detail: "You received an A+ in Color Theory Quiz.",
        stamp: "Yesterday",
        tone: "primary",
      },
      {
        title: "Mentor Feedback",
        detail: "Marcus left a comment on your portfolio project.",
        stamp: "3 days ago",
        tone: "info",
      },
    ]
  }, [progressAnalytics?.recent_submissions])

  const scrollToSection = (
    section: StudentNavSection,
    sectionRef?: { current: HTMLElement | null }
  ) => {
    setActiveNavSection(section)

    if (section === "dashboard") {
      contentScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" })
      return
    }

    sectionRef?.current?.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  const resolveSectionRef = (section: StudentNavSection) => {
    switch (section) {
      case "courses":
        return scheduleSectionRef
      case "assignments":
        return assignmentsSectionRef
      case "grades":
        return performanceSectionRef
      case "library":
        return mentorsSectionRef
      default:
        return undefined
    }
  }

  const handleStartAssignment = (assignment: AssignmentCardData) => {
    setActiveNavSection("assignments")
    setActiveAssignmentId(assignment.id)
  }

  const handleResumeLearningSession = () => {
    const nextAssignment =
      actionableAssignments.find((assignment) => assignment.progress > 0) ||
      actionableAssignments[0]

    if (nextAssignment) {
      setActiveNavSection("assignments")
      setActiveAssignmentId(nextAssignment.id)
      return
    }

    scrollToSection("assignments", assignmentsSectionRef)
  }

  const handleToggleAssignmentsView = () => {
    if (!canExpandAssignments) {
      scrollToSection("assignments", assignmentsSectionRef)
      return
    }

    setShowAllAssignments((previous) => !previous)
    scrollToSection("assignments", assignmentsSectionRef)
  }

  const handleOpenSettings = () => {
    navigate("/settings")
  }

  const handleSignOut = async () => {
    await signOut()
  }

  const navItems: Array<{ label: string; section: StudentNavSection; icon: any }> = [
    { label: "Dashboard", section: "dashboard", icon: LayoutDashboard },
    { label: "My Courses", section: "courses", icon: BookOpen },
    { label: "Assignments", section: "assignments", icon: CheckCircle2 },
    { label: "Grades", section: "grades", icon: TrendingUp },
    { label: "Library", section: "library", icon: FolderOpen },
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
                  <SidebarMenuItem key={item.section}>
                    <SidebarMenuButton
                      tooltip={item.label}
                      isActive={activeNavSection === item.section}
                      onClick={() => scrollToSection(item.section, resolveSectionRef(item.section))}
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
                  <BreadcrumbLink href="#" onClick={() => navigate("/dashboard")}>LearnTrack</BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator className="hidden md:block" />
                <BreadcrumbItem>
                  <BreadcrumbPage>Student Dashboard</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </div>

        </header>

        <div className="flex flex-1 flex-col gap-4 bg-background p-4">
          <div ref={contentScrollRef} className="flex-1 overflow-y-auto">
            <div className="mx-auto max-w-7xl space-y-8 px-4 py-4 sm:px-6 sm:py-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h1 className="mb-2 text-3xl font-bold text-foreground">Welcome back, {studentName}</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  {pendingAssignments > 0
                    ? `You have ${pendingAssignments} assignment${pendingAssignments > 1 ? "s" : ""} due soon.`
                    : "You are all caught up. Keep your momentum going."}
                </p>
              </div>

              <div className="flex w-full flex-col gap-3 sm:flex-row lg:w-auto">
                <Input
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  className="sm:w-72"
                  placeholder="Search assignments or subjects"
                />
                <Button
                  className="w-full bg-primary text-primary-foreground hover:bg-primary/90 sm:w-auto"
                  onClick={handleResumeLearningSession}
                  disabled={actionableAssignments.length === 0}
                >
                  <Sparkles className="mr-2 h-4 w-4" />
                  Resume Learning Session
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3 lg:gap-6">
              <Card className="border-0 bg-card shadow-sm">
                <CardContent className="flex items-center justify-between p-5">
                  <div>
                    <p className="text-sm text-muted-foreground">Overall GPA</p>
                    <p className="mt-1 text-3xl font-bold text-primary">
                      {statsLoading ? <Skeleton className="h-8 w-14" /> : gpa}
                    </p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Grade: {dashboardStats?.current_grade || "--"}
                    </p>
                  </div>
                  <div className="rounded-full border-4 border-primary/20 p-3">
                    <Trophy className="h-6 w-6 text-primary" />
                  </div>
                </CardContent>
              </Card>

              <Card className="border-0 bg-card shadow-sm">
                <CardContent className="flex items-center justify-between p-5">
                  <div className="min-w-0">
                    <p className="text-sm text-muted-foreground">Course Completion</p>
                    <p className="mt-1 text-3xl font-bold">
                      {statsLoading ? <Skeleton className="h-8 w-12" /> : `${completionRate}%`}
                    </p>
                    <p className="mt-2 text-xs text-primary">
                      {completedAssignments}/{totalAssignments} assignments completed
                    </p>
                  </div>
                  <div className="rounded-full border-4 border-primary/25 p-3">
                    <CheckCircle2 className="h-6 w-6 text-primary" />
                  </div>
                </CardContent>
              </Card>

              <Card className="border-0 bg-card shadow-sm">
                <CardContent className="flex items-center justify-between p-5">
                  <div>
                    <p className="text-sm text-muted-foreground">Active Workload</p>
                    <p className="mt-1 text-3xl font-bold">
                      {statsLoading ? <Skeleton className="h-8 w-10" /> : pendingAssignments}
                    </p>
                    <p className="mt-2 text-xs text-muted-foreground">Assignments in progress or pending</p>
                  </div>
                  <div className="rounded-full bg-primary/10 p-3">
                    <Clock3 className="h-6 w-6 text-primary" />
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="grid grid-cols-1 gap-8 xl:grid-cols-3">
              <div className="space-y-8 xl:col-span-2">
                <section ref={assignmentsSectionRef}>
                  <div className="mb-4 flex items-center justify-between">
                    <h2 className="text-xl font-semibold">Currently Working On</h2>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-primary"
                      onClick={handleToggleAssignmentsView}
                    >
                      {showAllAssignments && canExpandAssignments ? "Show Less" : "View All"}
                    </Button>
                  </div>

                  <div className="space-y-4">
                    {assignmentsLoading ? (
                      Array.from({ length: 2 }).map((_, index) => (
                        <Card key={index} className="border-0 bg-card shadow-sm">
                          <CardContent className="space-y-3 p-5">
                            <Skeleton className="h-4 w-28" />
                            <Skeleton className="h-5 w-full" />
                            <Skeleton className="h-2 w-full" />
                          </CardContent>
                        </Card>
                      ))
                    ) : workingAssignments.length === 0 ? (
                      <Card className="border-0 bg-card shadow-sm">
                        <CardContent className="p-6 text-center">
                          <BookOpen className="mx-auto mb-2 h-10 w-10 text-muted-foreground/60" />
                          <p className="font-medium">No active assignments</p>
                          <p className="text-sm text-muted-foreground">
                            New assignments from your tutor will appear here.
                          </p>
                        </CardContent>
                      </Card>
                    ) : (
                      workingAssignments.map((assignment) => (
                        <Card
                          key={assignment.id}
                          className="border border-border bg-card transition-shadow hover:shadow-md"
                        >
                          <CardContent className="space-y-4 p-5">
                            <div className="flex items-start justify-between gap-4">
                              <div className="min-w-0">
                                <Badge variant="secondary" className="mb-2">
                                  {assignment.subject}
                                </Badge>
                                <p className="truncate text-lg font-semibold">{assignment.title}</p>
                                <p className="text-sm text-muted-foreground">
                                  {formatRelativeDueDate(assignment.dueDate)} - {formatDueDate(assignment.dueDate)}
                                </p>
                              </div>
                              <div className="text-right">
                                <p className="text-xs font-semibold text-primary">{assignment.progress}% done</p>
                                <p className="text-xs text-muted-foreground">{assignment.questionCount} questions</p>
                              </div>
                            </div>

                            <Progress value={assignment.progress} className="h-2" />

                            <div className="flex items-center justify-between">
                              <Badge variant={getStatusBadgeVariant(assignment.status)}>
                                {assignment.status.replace("_", " ")}
                              </Badge>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleStartAssignment(assignment)}
                              >
                                {assignment.progress > 0 ? "Continue" : "Start"}
                              </Button>
                            </div>
                          </CardContent>
                        </Card>
                      ))
                    )}
                  </div>
                </section>

                <section ref={scheduleSectionRef}>
                  <h2 className="mb-4 text-xl font-semibold">Weekly Schedule</h2>
                  <Card className="border-0 bg-card shadow-sm">
                    <CardContent className="p-5">
                      <div className="grid grid-cols-7 gap-2">
                        {weekDays.map((day) => (
                          <div key={day.label} className="text-center">
                            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                              {day.label}
                            </p>
                            <div
                              className={cn(
                                "relative rounded-lg border px-1 py-2",
                                day.isToday
                                  ? "border-primary bg-primary text-primary-foreground"
                                  : "border-border",
                                day.isWeekend && !day.isToday && "opacity-70"
                              )}
                            >
                              <p className="text-lg font-bold">{day.date.getDate()}</p>
                              {day.isToday && <p className="text-[9px] font-bold uppercase">Today</p>}
                              {day.hasTask && !day.isToday && (
                                <span className="absolute bottom-1 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-primary" />
                              )}
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="mt-6 space-y-3">
                        {weeklyEvents.map((event, index) => (
                          <div
                            key={`${event.title}-${index}`}
                            className={cn(
                              "rounded-lg border-l-4 bg-muted/35 p-3",
                              event.tone === "primary" ? "border-primary" : "border-destructive"
                            )}
                          >
                            <div className="flex items-start gap-4">
                              <p className="w-20 text-sm font-semibold">{event.time}</p>
                              <div>
                                <p className="text-sm font-semibold">{event.title}</p>
                                <p className="text-xs text-muted-foreground">{event.context}</p>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                </section>
              </div>

              <div className="space-y-8">
                <section ref={activitySectionRef}>
                  <h2 className="mb-4 text-xl font-semibold">Recent Activity</h2>
                  <Card className="border-0 bg-card shadow-sm">
                    <CardContent className="p-5">
                      {analyticsLoading ? (
                        <div className="space-y-4">
                          {Array.from({ length: 3 }).map((_, index) => (
                            <div key={index} className="space-y-2">
                              <Skeleton className="h-4 w-36" />
                              <Skeleton className="h-3 w-full" />
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="space-y-5">
                          {recentActivity.map((item, index) => (
                            <div key={`${item.title}-${index}`} className="relative pl-7">
                              <span
                                className={cn(
                                  "absolute left-0 top-1 h-4 w-4 rounded-full",
                                  item.tone === "success" && "bg-success/20",
                                  item.tone === "primary" && "bg-primary/30",
                                  item.tone === "info" && "bg-info/20"
                                )}
                              />
                              <p className="text-sm font-semibold">{item.title}</p>
                              <p className="text-xs text-muted-foreground">{item.detail}</p>
                              <p className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                                {item.stamp}
                              </p>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </section>

                <section ref={mentorsSectionRef}>
                  <h2 className="mb-4 text-xl font-semibold">Top Mentors</h2>
                  <div className="space-y-3">
                    {MENTOR_PLACEHOLDERS.map((mentor) => (
                      <Card key={mentor.name} className="border border-border bg-card transition-shadow hover:shadow-md">
                        <CardContent className="flex items-center gap-4 p-3">
                          <Avatar className="h-11 w-11">
                            <AvatarFallback>
                              {mentor.name
                                .split(" ")
                                .map((part) => part[0])
                                .join("")}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold">{mentor.name}</p>
                            <p className="text-[10px] uppercase tracking-wide text-primary">{mentor.role}</p>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => scrollToSection("assignments", assignmentsSectionRef)}
                          >
                            <Users className="h-4 w-4" />
                          </Button>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </section>

                <section ref={performanceSectionRef}>
                  <Card className="border-0 bg-card shadow-sm">
                    <CardHeader>
                      <CardTitle className="text-lg">Subject Performance</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {analyticsLoading ? (
                        <Skeleton className="h-20 w-full" />
                      ) : progressAnalytics?.subject_performance?.length ? (
                        progressAnalytics.subject_performance
                          .slice(0, 3)
                          .map((subject: any, index: number) => (
                            <div key={`${subject.subject}-${index}`} className="space-y-1">
                              <div className="flex items-center justify-between text-sm">
                                <p className="font-medium">{subject.subject}</p>
                                <p className="text-muted-foreground">{subject.score}%</p>
                              </div>
                              <Progress value={subject.score || 0} className="h-2" />
                            </div>
                          ))
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          Complete assignments to unlock subject analytics.
                        </p>
                      )}
                    </CardContent>
                  </Card>
                </section>
              </div>
            </div>
            </div>
          </div>
        </div>
      </SidebarInset>

      <StudentAssignmentWorkspace
        assignmentId={activeAssignmentId}
        open={Boolean(activeAssignmentId)}
        onOpenChange={(open) => {
          if (!open) {
            setActiveAssignmentId(null)
          }
        }}
      />
    </SidebarProvider>
  )
}

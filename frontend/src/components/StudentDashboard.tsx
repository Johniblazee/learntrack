"use client"

import { useMemo, useState } from "react"
import { useClerk, useUser } from "@clerk/clerk-react"
import {
  Bell,
  BookOpen,
  CheckCircle2,
  Clock3,
  FolderOpen,
  GraduationCap,
  LayoutDashboard,
  LogOut,
  Menu,
  Search,
  Settings,
  Sparkles,
  TrendingUp,
  Trophy,
  Users,
  X,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import StudentAssignmentWorkspace from "@/components/student-assignment-workspace"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { useMyAssignments, useStudentDashboardStats, useStudentProgressAnalytics } from "@/hooks/useQueries"
import { cn } from "@/lib/utils"

interface StudentDashboardProps {
  onBack?: () => void
}

interface AssignmentCardData {
  id: string
  title: string
  subject: string
  dueDate: Date | null
  questionCount: number
  progress: number
  status: string
}

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
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
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

export default function StudentDashboard({ onBack }: StudentDashboardProps) {
  const { user } = useUser()
  const { signOut } = useClerk()

  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState("")
  const [activeAssignmentId, setActiveAssignmentId] = useState<string | null>(null)

  const { data: rawAssignments = [], isLoading: assignmentsLoading } = useMyAssignments()
  const { data: dashboardStats, isLoading: statsLoading } = useStudentDashboardStats()
  const { data: progressAnalytics, isLoading: analyticsLoading } = useStudentProgressAnalytics()

  const studentName = user?.fullName || user?.firstName || "Student"
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
      return item.title.toLowerCase().includes(query) || item.subject.toLowerCase().includes(query)
    })
  }, [assignments, searchTerm])

  const workingAssignments = visibleAssignments
    .filter((item) => item.status !== "completed" && item.status !== "archived")
    .slice(0, 3)

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
  const completionRate = totalAssignments > 0 ? Math.round((completedAssignments / totalAssignments) * 100) : 0
  const pendingAssignments = dashboardStats?.pending ?? Math.max(totalAssignments - completedAssignments, 0)

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

  const handleStartAssignment = (assignment: AssignmentCardData) => {
    setActiveAssignmentId(assignment.id)
  }

  const handleSignOut = async () => {
    await signOut()
  }

  const navItemBase = "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors"

  return (
    <div className="h-screen overflow-hidden bg-background text-foreground animate-in fade-in">
      <div className="flex h-full">
        <div
          className={cn(
            "fixed inset-0 z-40 bg-black/30 transition-opacity lg:hidden",
            sidebarOpen ? "opacity-100" : "pointer-events-none opacity-0"
          )}
          onClick={() => setSidebarOpen(false)}
        />

        <aside
          className={cn(
            "fixed left-0 top-0 z-50 flex h-full w-72 flex-col border-r border-border bg-card transition-transform duration-300 lg:static lg:z-auto lg:w-64 lg:translate-x-0",
            sidebarOpen ? "translate-x-0" : "-translate-x-full"
          )}
        >
          <div className="flex items-center justify-between p-5 lg:justify-start">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <GraduationCap className="h-5 w-5" />
              </div>
              <div>
                <p className="font-lufga text-xl font-bold tracking-tight">LearnTrack</p>
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Student Hub</p>
              </div>
            </div>
            <Button className="lg:hidden" variant="ghost" size="icon" onClick={() => setSidebarOpen(false)}>
              <X className="h-4 w-4" />
            </Button>
          </div>

          <nav className="space-y-1 px-4 py-3">
            <button className={cn(navItemBase, "w-full bg-primary text-primary-foreground")}>
              <LayoutDashboard className="h-4 w-4" />
              Dashboard
            </button>
            <button className={cn(navItemBase, "w-full text-muted-foreground hover:bg-accent hover:text-accent-foreground")}>
              <BookOpen className="h-4 w-4" />
              My Courses
            </button>
            <button className={cn(navItemBase, "w-full text-muted-foreground hover:bg-accent hover:text-accent-foreground")}>
              <CheckCircle2 className="h-4 w-4" />
              Assignments
            </button>
            <button className={cn(navItemBase, "w-full text-muted-foreground hover:bg-accent hover:text-accent-foreground")}>
              <TrendingUp className="h-4 w-4" />
              Grades
            </button>
            <button className={cn(navItemBase, "w-full text-muted-foreground hover:bg-accent hover:text-accent-foreground")}>
              <FolderOpen className="h-4 w-4" />
              Library
            </button>
          </nav>

          <div className="mt-auto p-4">
            <Card className="border-primary/25 bg-primary/10">
              <CardContent className="space-y-3 p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-primary">Pro Plan</p>
                <p className="text-xs text-muted-foreground">Unlock advanced mentorship and personalized exam simulations.</p>
                <Button className="w-full" size="sm">Upgrade Now</Button>
              </CardContent>
            </Card>

            <button
              className="mt-4 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
              onClick={handleSignOut}
            >
              <LogOut className="h-4 w-4" />
              Log Out
            </button>
          </div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          <header className="h-16 border-b border-border/80 bg-background/80 px-4 backdrop-blur-sm sm:px-6 lg:px-8">
            <div className="flex h-full items-center justify-between gap-3">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setSidebarOpen(true)}>
                  <Menu className="h-5 w-5" />
                </Button>
                {onBack && (
                  <Button variant="ghost" size="sm" onClick={onBack}>
                    Back
                  </Button>
                )}
                <div className="relative hidden w-full max-w-md sm:block">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    className="pl-10"
                    placeholder="Search assignments, subjects, resources..."
                  />
                </div>
              </div>

              <div className="flex items-center gap-2 sm:gap-3">
                <Button variant="outline" size="icon" className="relative">
                  <Bell className="h-4 w-4" />
                  {pendingAssignments > 0 && <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-primary" />}
                </Button>
                <Button variant="outline" size="icon">
                  <Settings className="h-4 w-4" />
                </Button>
                <div className="hidden items-center gap-2 sm:flex">
                  <div className="text-right">
                    <p className="text-sm font-semibold leading-none">{studentName}</p>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Student</p>
                  </div>
                  <Avatar className="h-9 w-9 border border-primary/40">
                    <AvatarFallback>{studentName.slice(0, 2).toUpperCase()}</AvatarFallback>
                  </Avatar>
                </div>
              </div>
            </div>
          </header>

          <div className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
            <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
              <div>
                <h1 className="font-lufga text-3xl font-bold tracking-tight">Welcome back, {studentName}</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  {pendingAssignments > 0
                    ? `You have ${pendingAssignments} assignment${pendingAssignments > 1 ? "s" : ""} due soon.`
                    : "You are all caught up. Keep your momentum going."}
                </p>
              </div>
              <Button className="w-full md:w-auto">
                <Sparkles className="mr-2 h-4 w-4" />
                Resume Learning Session
              </Button>
            </div>

            <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-3 lg:gap-6">
              <Card>
                <CardContent className="flex items-center justify-between p-5">
                  <div>
                    <p className="text-sm text-muted-foreground">Overall GPA</p>
                    <p className="mt-1 text-3xl font-bold text-primary">{statsLoading ? <Skeleton className="h-8 w-14" /> : gpa}</p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Grade: {dashboardStats?.current_grade || "--"}
                    </p>
                  </div>
                  <div className="rounded-full border-4 border-primary/20 p-3">
                    <Trophy className="h-6 w-6 text-primary" />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="flex items-center justify-between p-5">
                  <div className="min-w-0">
                    <p className="text-sm text-muted-foreground">Course Completion</p>
                    <p className="mt-1 text-3xl font-bold">{statsLoading ? <Skeleton className="h-8 w-12" /> : `${completionRate}%`}</p>
                    <p className="mt-2 text-xs text-primary">
                      {completedAssignments}/{totalAssignments} assignments completed
                    </p>
                  </div>
                  <div className="rounded-full border-4 border-primary/25 p-3">
                    <CheckCircle2 className="h-6 w-6 text-primary" />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="flex items-center justify-between p-5">
                  <div>
                    <p className="text-sm text-muted-foreground">Active Workload</p>
                    <p className="mt-1 text-3xl font-bold">{statsLoading ? <Skeleton className="h-8 w-10" /> : pendingAssignments}</p>
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
                <section>
                  <div className="mb-4 flex items-center justify-between">
                    <h2 className="font-lufga text-xl font-semibold">Currently Working On</h2>
                    <Button variant="ghost" size="sm" className="text-primary">View All</Button>
                  </div>

                  <div className="space-y-4">
                    {assignmentsLoading ? (
                      Array.from({ length: 2 }).map((_, index) => (
                        <Card key={index}><CardContent className="space-y-3 p-5"><Skeleton className="h-4 w-28" /><Skeleton className="h-5 w-full" /><Skeleton className="h-2 w-full" /></CardContent></Card>
                      ))
                    ) : workingAssignments.length === 0 ? (
                      <Card>
                        <CardContent className="p-6 text-center">
                          <BookOpen className="mx-auto mb-2 h-10 w-10 text-muted-foreground/60" />
                          <p className="font-medium">No active assignments</p>
                          <p className="text-sm text-muted-foreground">New assignments from your tutor will appear here.</p>
                        </CardContent>
                      </Card>
                    ) : (
                      workingAssignments.map((assignment) => (
                        <Card key={assignment.id} className="transition-colors hover:border-primary/50">
                          <CardContent className="space-y-4 p-5">
                            <div className="flex items-start justify-between gap-4">
                              <div className="min-w-0">
                                <Badge variant="secondary" className="mb-2">{assignment.subject}</Badge>
                                <p className="truncate text-lg font-semibold">{assignment.title}</p>
                                <p className="text-sm text-muted-foreground">{formatRelativeDueDate(assignment.dueDate)} - {formatDueDate(assignment.dueDate)}</p>
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
                              <Button size="sm" variant="outline" onClick={() => handleStartAssignment(assignment)}>
                                {assignment.progress > 0 ? "Continue" : "Start"}
                              </Button>
                            </div>
                          </CardContent>
                        </Card>
                      ))
                    )}
                  </div>
                </section>

                <section>
                  <h2 className="mb-4 font-lufga text-xl font-semibold">Weekly Schedule</h2>
                  <Card>
                    <CardContent className="p-5">
                      <div className="grid grid-cols-7 gap-2">
                        {weekDays.map((day) => (
                          <div key={day.label} className="text-center">
                            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{day.label}</p>
                            <div
                              className={cn(
                                "relative rounded-lg border px-1 py-2",
                                day.isToday ? "border-primary bg-primary text-primary-foreground" : "border-border",
                                day.isWeekend && !day.isToday && "opacity-70"
                              )}
                            >
                              <p className="text-lg font-bold">{day.date.getDate()}</p>
                              {day.isToday && <p className="text-[9px] font-bold uppercase">Today</p>}
                              {day.hasTask && !day.isToday && <span className="absolute bottom-1 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-primary" />}
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
                <section>
                  <h2 className="mb-4 font-lufga text-xl font-semibold">Recent Activity</h2>
                  <Card>
                    <CardContent className="p-5">
                      {analyticsLoading ? (
                        <div className="space-y-4">
                          {Array.from({ length: 3 }).map((_, index) => (
                            <div key={index} className="space-y-2"><Skeleton className="h-4 w-36" /><Skeleton className="h-3 w-full" /></div>
                          ))}
                        </div>
                      ) : (
                        <div className="space-y-5">
                          {recentActivity.map((item, index) => (
                            <div key={`${item.title}-${index}`} className="relative pl-7">
                              <span
                                className={cn(
                                  "absolute left-0 top-1 h-4 w-4 rounded-full",
                                  item.tone === "success" && "bg-green-500/30",
                                  item.tone === "primary" && "bg-primary/30",
                                  item.tone === "info" && "bg-blue-500/30"
                                )}
                              />
                              <p className="text-sm font-semibold">{item.title}</p>
                              <p className="text-xs text-muted-foreground">{item.detail}</p>
                              <p className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">{item.stamp}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </section>

                <section>
                  <h2 className="mb-4 font-lufga text-xl font-semibold">Top Mentors</h2>
                  <div className="space-y-3">
                    {MENTOR_PLACEHOLDERS.map((mentor) => (
                      <Card key={mentor.name} className="transition-colors hover:border-primary/60">
                        <CardContent className="flex items-center gap-4 p-3">
                          <Avatar className="h-11 w-11">
                            <AvatarFallback>{mentor.name.split(" ").map((part) => part[0]).join("")}</AvatarFallback>
                          </Avatar>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold">{mentor.name}</p>
                            <p className="text-[10px] uppercase tracking-wide text-primary">{mentor.role}</p>
                          </div>
                          <Button variant="ghost" size="sm">
                            <Users className="h-4 w-4" />
                          </Button>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </section>

                <section>
                  <Card className="bg-gradient-to-br from-primary/20 via-primary/10 to-background">
                    <CardHeader>
                      <CardTitle className="font-lufga text-lg">Subject Performance</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {analyticsLoading ? (
                        <Skeleton className="h-20 w-full" />
                      ) : progressAnalytics?.subject_performance?.length ? (
                        progressAnalytics.subject_performance.slice(0, 3).map((subject: any, index: number) => (
                          <div key={`${subject.subject}-${index}`} className="space-y-1">
                            <div className="flex items-center justify-between text-sm">
                              <p className="font-medium">{subject.subject}</p>
                              <p className="text-muted-foreground">{subject.score}%</p>
                            </div>
                            <Progress value={subject.score || 0} className="h-2" />
                          </div>
                        ))
                      ) : (
                        <p className="text-sm text-muted-foreground">Complete assignments to unlock subject analytics.</p>
                      )}
                    </CardContent>
                  </Card>
                </section>
              </div>
            </div>
          </div>
        </main>
      </div>

      <StudentAssignmentWorkspace
        assignmentId={activeAssignmentId}
        open={Boolean(activeAssignmentId)}
        onOpenChange={(open) => {
          if (!open) {
            setActiveAssignmentId(null)
          }
        }}
      />
    </div>
  )
}

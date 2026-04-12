"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useAuth, useClerk, useUser } from "@clerk/clerk-react"
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom"
import { Layers } from "lucide-react"

import { DashboardMessagesPage } from "@/components/dashboard/DashboardMessagesPage"
import NotificationsPage from "@/pages/NotificationsPage"
import SettingsPage from "@/pages/SettingsPage"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Separator } from "@/components/ui/separator"
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
} from "@/components/ui/sidebar"
import { PageShell } from "@/components/ui/page-shell"
import { DashboardHeaderActions } from "@/components/dashboard/DashboardHeaderActions"
import StudentAssignmentWorkspace from "@/components/student-assignment-workspace"
import { useImpersonation } from "@/contexts/ImpersonationContext"
import { toast } from "@/contexts/ToastContext"
import { useUserContext } from "@/contexts/UserContext"
import {
  type AwardRecord,
  type NotificationItem,
  type StudentActivityRecord,
  type StudentRecentSubmission,
  type StudentSubjectPerformance,
  type StudentWeeklyProgress,
  useAnnouncements,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useMyActivities,
  useMyAssignments,
  useStudentDashboardStats,
  useStudentMaterials,
  useStudentProgressAnalytics,
  useUserSettings,
} from "@/hooks/useQueries"
import { useApiClient } from "@/lib/api-client"

import type {
  AnnouncementSummary,
  AssignmentCardData,
  AssignmentFilter,
  AwardSummary,
  CourseSummary,
  MaterialFilter,
  RecentSubmissionSummary,
  StudentMaterialItem,
  StudentNavSection,
  TimelineItem,
} from "./student-dashboard/types"
import {
  NAV_ITEMS,
  STUDENT_SECTIONS,
  STUDENT_SECTION_ROUTES,
} from "./student-dashboard/constants"
import {
  formatTimestamp,
  getStudentPageLabel,
  getStudentSectionFromPath,
  getWeekDays,
  isProtectedInternalMaterialUrl,
  readableNotificationType,
  resolveMaterialUrl,
  toAssignmentCards,
  toMaterialCards,
} from "./student-dashboard/utils"

import OverviewView from "./student-dashboard/views/OverviewView"
import CoursesView from "./student-dashboard/views/CoursesView"
import AssignmentsView from "./student-dashboard/views/AssignmentsView"
import GradesView from "./student-dashboard/views/GradesView"
import LibraryView from "./student-dashboard/views/LibraryView"

export default function StudentDashboard() {
  const { user } = useUser()
  const { signOut } = useClerk()
  const { getToken } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const client = useApiClient()
  const { backendUser } = useUserContext()
  const { isImpersonating } = useImpersonation()

  const [assignmentSearchTerm, setAssignmentSearchTerm] = useState("")
  const [assignmentFilter, setAssignmentFilter] = useState<AssignmentFilter>("all")
  const [materialSearchTerm, setMaterialSearchTerm] = useState("")
  const [materialFilter, setMaterialFilter] = useState<MaterialFilter>("all")
  const [activeAssignmentId, setActiveAssignmentId] = useState<string | null>(null)

  const contentScrollRef = useRef<HTMLDivElement | null>(null)

  // ── Data hooks ──────────────────────────────────────────────
  const {
    data: rawAssignments = [],
    isLoading: assignmentsLoading,
    error: assignmentsError,
  } = useMyAssignments()
  const {
    data: dashboardStats,
    isLoading: statsLoading,
    error: statsError,
  } = useStudentDashboardStats()
  const {
    data: progressAnalytics,
    isLoading: analyticsLoading,
    error: analyticsError,
  } = useStudentProgressAnalytics()
  const {
    data: announcements = [],
    isLoading: announcementsLoading,
    error: announcementsError,
  } = useAnnouncements()
  const {
    data: activityFeed = [],
    isLoading: activitiesLoading,
    error: activitiesError,
  } = useMyActivities(20)
  const {
    data: materials = [],
    isLoading: materialsLoading,
    error: materialsError,
  } = useStudentMaterials()
  const { data: userSettings, isLoading: settingsLoading } = useUserSettings()
  const markAnnouncementRead = useMarkNotificationRead()
  const markAllAnnouncementsRead = useMarkAllNotificationsRead()

  // ── Identity ────────────────────────────────────────────────
  const actorName = user?.fullName || user?.firstName || "Student"
  const actorEmail = user?.primaryEmailAddress?.emailAddress || ""
  const impersonatedName =
    backendUser?.name && backendUser.name !== "Unknown User" ? backendUser.name : actorName
  const impersonatedEmail = backendUser?.email || actorEmail
  const studentName = isImpersonating ? impersonatedName : actorName
  const displayName = studentName
  const displayEmail = isImpersonating ? impersonatedEmail : actorEmail
  const initials =
    displayName
      .trim()
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((token) => token[0]?.toUpperCase() || "")
      .join("") || "S"
  const showClerkAvatar = !isImpersonating || backendUser?.clerk_id === user?.id

  // ── Preferences ─────────────────────────────────────────────
  const preferences = userSettings?.preferences || {}
  const showWeekendSchedule = preferences.show_weekend_schedule ?? true
  const compactAssignmentCards = preferences.compact_assignment_cards ?? false
  const autoOpenNextAssignment = preferences.auto_open_next_assignment ?? false

  const activeNavSection = useMemo(
    () => getStudentSectionFromPath(location.pathname),
    [location.pathname]
  )
  const currentPageLabel = useMemo(
    () => getStudentPageLabel(location.pathname, activeNavSection),
    [activeNavSection, location.pathname]
  )

  // ── Auto-redirect to preferred tab ──────────────────────────
  useEffect(() => {
    if (settingsLoading) return
    const isBaseDashboardRoute =
      location.pathname === "/dashboard" || location.pathname === "/dashboard/"
    if (!isBaseDashboardRoute) return

    const preferred = preferences.default_student_tab
    if (preferred && STUDENT_SECTIONS.includes(preferred)) {
      const preferredRoute = STUDENT_SECTION_ROUTES[preferred]
      if (preferredRoute !== STUDENT_SECTION_ROUTES.dashboard) {
        navigate(preferredRoute, { replace: true })
      }
    }
  }, [location.pathname, navigate, preferences.default_student_tab, settingsLoading])

  useEffect(() => {
    contentScrollRef.current?.scrollTo({ top: 0, behavior: "auto" })
  }, [activeNavSection])

  // ── Derived data ────────────────────────────────────────────
  const assignments = useMemo(() => toAssignmentCards(rawAssignments), [rawAssignments])

  const actionableAssignments = useMemo(
    () => assignments.filter((item) => item.status !== "completed" && item.status !== "archived"),
    [assignments]
  )

  const dueSoonAssignments = useMemo(() => {
    return actionableAssignments
      .filter((item) => item.dueDate)
      .sort((a, b) => {
        const aTime = a.dueDate ? a.dueDate.getTime() : Number.POSITIVE_INFINITY
        const bTime = b.dueDate ? b.dueDate.getTime() : Number.POSITIVE_INFINITY
        return aTime - bTime
      })
      .slice(0, 4)
  }, [actionableAssignments])

  const overdueAssignments = useMemo(
    () => actionableAssignments.filter((item) => item.status === "overdue"),
    [actionableAssignments]
  )

  const pendingReviewAssignments = useMemo(
    () => assignments.filter((item) => item.rawStatus === "submitted"),
    [assignments]
  )

  const gradedAssignments = useMemo(
    () => assignments.filter((item) => item.rawStatus === "graded"),
    [assignments]
  )

  const filteredAssignments = useMemo(() => {
    const query = assignmentSearchTerm.trim().toLowerCase()
    return assignments
      .filter((assignment) => {
        if (assignmentFilter !== "all" && assignment.status !== assignmentFilter) return false
        if (!query) return true
        return (
          assignment.title.toLowerCase().includes(query) ||
          assignment.subject.toLowerCase().includes(query)
        )
      })
      .sort((a, b) => {
        const aTime = a.dueDate ? a.dueDate.getTime() : Number.POSITIVE_INFINITY
        const bTime = b.dueDate ? b.dueDate.getTime() : Number.POSITIVE_INFINITY
        return aTime - bTime
      })
  }, [assignmentFilter, assignmentSearchTerm, assignments])

  const datesWithTasks = useMemo(() => {
    return new Set(
      assignments
        .map((item) => item.dueDate)
        .filter((value): value is Date => Boolean(value))
        .map((date) => date.toDateString())
    )
  }, [assignments])

  const weekDays = useMemo(
    () => getWeekDays(datesWithTasks, showWeekendSchedule),
    [datesWithTasks, showWeekendSchedule]
  )

  const totalAssignments = dashboardStats?.total_assignments ?? assignments.length
  const completedAssignments = dashboardStats?.completed ?? assignments.filter((a) => a.status === "completed").length
  const pendingAssignments =
    dashboardStats?.pending ?? Math.max(totalAssignments - completedAssignments, 0)
  const completionRate =
    totalAssignments > 0 ? Math.round((completedAssignments / totalAssignments) * 100) : 0
  const averageScore = Number(
    progressAnalytics?.average_score ?? dashboardStats?.overall_average ?? 0
  )
  const gpa =
    averageScore > 0
      ? Math.min(4, Math.max(0, averageScore / 25)).toFixed(2)
      : "--"
  const totalTimeSpent = progressAnalytics?.total_time_spent || 0
  const currentGrade = dashboardStats?.current_grade || null

  const recentSubmissions = useMemo<RecentSubmissionSummary[]>(() => {
    if (!Array.isArray(progressAnalytics?.recent_submissions)) return []
    return progressAnalytics.recent_submissions.map((item: StudentRecentSubmission, index: number) => ({
      id: String(item?.assignment_id || item?.id || index),
      assignmentTitle: String(item?.assignment_title || "Assignment"),
      subject: String(item?.subject || "General"),
      score: typeof item?.score === "number" ? item.score : null,
      submittedAt: typeof item?.submitted_at === "string" ? item.submitted_at : null,
    }))
  }, [progressAnalytics?.recent_submissions])

  const awards = useMemo<AwardSummary[]>(() => {
    if (!Array.isArray(progressAnalytics?.awards)) return []
    return (progressAnalytics.awards as AwardRecord[]).map((award, index) => ({
      id: String(award?.id || `award-${index}`),
      title: String(award?.title || 'Award'),
      description: String(award?.description || 'Released performance milestone'),
      earnedAt: typeof award?.earned_at === 'string' ? award.earned_at : null,
    }))
  }, [progressAnalytics?.awards])

  const activityItems = useMemo<TimelineItem[]>(() => {
    if (!Array.isArray(activityFeed) || activityFeed.length === 0) return []
    return activityFeed.slice(0, 6).map((item: StudentActivityRecord) => {
      const activityType = String(item?.activity_type ?? "activity")
      const title = item?.description || activityType.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")
      const tone: TimelineItem["tone"] =
        activityType.includes("completed") || activityType.includes("submitted")
          ? "success"
          : activityType.includes("material")
            ? "info"
            : "primary"
      return {
        title: String(title),
        detail: item?.related_entity_type
          ? `Related to ${String(item.related_entity_type).replace(/_/g, " ")}`
          : "Learner activity",
        stamp: formatTimestamp(item?.created_at),
        tone,
      }
    })
  }, [activityFeed])

  const announcementItems = useMemo<AnnouncementSummary[]>(() => {
    if (!Array.isArray(announcements)) return []
    return announcements.slice(0, 5).map((item: NotificationItem, index: number) => ({
      id: String(item?.id ?? item?._id ?? `announcement-${index}`),
      notificationId:
        typeof (item?.id ?? item?._id) === "string" ? String(item.id ?? item._id) : null,
      title:
        typeof item?.title === "string" && item.title.trim()
          ? String(item.title)
          : readableNotificationType(item?.notification_type),
      message: String(item?.message ?? "No details provided."),
      stamp: formatTimestamp(item?.created_at),
      isRead: Boolean(item?.is_read),
      actionUrl: typeof item?.action_url === "string" ? item.action_url : null,
    }))
  }, [announcements])

  const unreadAnnouncementCount = useMemo(
    () => announcementItems.filter((item) => !item.isRead).length,
    [announcementItems]
  )

  const courseSummaries = useMemo<CourseSummary[]>(() => {
    const subjectStats = new Map<string, CourseSummary>()
    const scoreLookup = new Map<string, number>()

    const subjectPerformance = Array.isArray(progressAnalytics?.subject_performance)
      ? progressAnalytics.subject_performance
      : []

    subjectPerformance.forEach((entry: StudentSubjectPerformance) => {
      const subject = String(entry?.subject || "General")
      if (!subject) return
      scoreLookup.set(subject.toLowerCase(), Number(entry?.score || 0))
    })

    assignments.forEach((assignment, index) => {
      const key = assignment.subject.toLowerCase()
      const existing = subjectStats.get(key)

      if (!existing) {
        subjectStats.set(key, {
          id: `course-${index}`,
          subject: assignment.subject,
          averageScore: scoreLookup.get(key) ?? 0,
          completionRate: assignment.status === "completed" ? 100 : assignment.progress,
          totalAssignments: 1,
          pendingAssignments: assignment.status === "completed" ? 0 : 1,
          nextDueDate: assignment.status === "completed" ? null : assignment.dueDate,
        })
        return
      }

      existing.totalAssignments += 1
      if (assignment.status !== "completed") {
        existing.pendingAssignments += 1
      }

      const aggregateProgress =
        ((existing.completionRate * (existing.totalAssignments - 1)) + assignment.progress) /
        existing.totalAssignments
      existing.completionRate = Math.round(aggregateProgress)

      if (!existing.nextDueDate && assignment.status !== "completed") {
        existing.nextDueDate = assignment.dueDate
      } else if (
        existing.nextDueDate &&
        assignment.dueDate &&
        assignment.status !== "completed" &&
        assignment.dueDate.getTime() < existing.nextDueDate.getTime()
      ) {
        existing.nextDueDate = assignment.dueDate
      }
    })

    return Array.from(subjectStats.values()).sort((a, b) => a.subject.localeCompare(b.subject))
  }, [assignments, progressAnalytics?.subject_performance])

  const gradeBreakdown = useMemo(() => {
    const subjectPerformance = Array.isArray(progressAnalytics?.subject_performance)
      ? progressAnalytics.subject_performance
      : []
    return subjectPerformance
      .map((entry: StudentSubjectPerformance, index: number) => ({
        id: `${entry?.subject || "subject"}-${index}`,
        subject: String(entry?.subject || "General"),
        score: Number(entry?.score || 0),
        assignments: Number(entry?.assignments || 0),
      }))
      .sort((a: { score: number }, b: { score: number }) => b.score - a.score)
  }, [progressAnalytics?.subject_performance])

  const materialItems = useMemo(() => toMaterialCards(materials), [materials])

  const filteredMaterials = useMemo(() => {
    const query = materialSearchTerm.trim().toLowerCase()
    return materialItems.filter((material) => {
      if (materialFilter !== "all" && material.materialType !== materialFilter) return false
      if (!query) return true
      return (
        material.title.toLowerCase().includes(query) ||
        material.description.toLowerCase().includes(query) ||
        material.topic.toLowerCase().includes(query) ||
        material.subject.toLowerCase().includes(query)
      )
    })
  }, [materialFilter, materialItems, materialSearchTerm])

  const materialCounts = useMemo(() => {
    return materialItems.reduce(
      (acc, material) => {
        acc.total += 1
        if (material.materialType === "pdf") acc.pdf += 1
        if (material.materialType === "video") acc.video += 1
        if (material.materialType === "link") acc.link += 1
        return acc
      },
      { total: 0, pdf: 0, video: 0, link: 0 }
    )
  }, [materialItems])

  const weeklyProgressRows: StudentWeeklyProgress[] = Array.isArray(progressAnalytics?.weekly_progress)
    ? progressAnalytics.weekly_progress
    : []

  const assignmentCardSpacingClass = compactAssignmentCards ? "space-y-3 p-4" : "space-y-4 p-5"
  const assignmentsErrorMessage = assignmentsError instanceof Error ? assignmentsError.message : null
  const statsErrorMessage = statsError instanceof Error ? statsError.message : null
  const analyticsErrorMessage = analyticsError instanceof Error ? analyticsError.message : null
  const announcementsErrorMessage = announcementsError instanceof Error ? announcementsError.message : null
  const activitiesErrorMessage = activitiesError instanceof Error ? activitiesError.message : null
  const materialsErrorMessage = materialsError instanceof Error ? materialsError.message : null

  // ── Handlers ────────────────────────────────────────────────
  const handleSectionChange = (section: StudentNavSection) => {
    navigate(STUDENT_SECTION_ROUTES[section])
  }

  const handleStartAssignment = (assignment: AssignmentCardData) => {
    navigate(STUDENT_SECTION_ROUTES.assignments)
    setActiveAssignmentId(assignment.id)
  }

  const handleOpenSubjectAssignments = (subject: string) => {
    setAssignmentSearchTerm(subject)
    setAssignmentFilter("all")
    handleSectionChange("assignments")
  }

  const handleResumeLearningSession = () => {
    const nextAssignment =
      actionableAssignments.find((assignment) => assignment.progress > 0) ||
      actionableAssignments[0]

    if (nextAssignment && autoOpenNextAssignment) {
      handleStartAssignment(nextAssignment)
      return
    }

    handleSectionChange("assignments")
  }

  const handleOpenMaterial = async (material: StudentMaterialItem) => {
    if (!material.fileUrl) {
      toast.error("Resource file is unavailable")
      return
    }

    try {
      const resolvedUrl = resolveMaterialUrl(material.fileUrl)

      if (isProtectedInternalMaterialUrl(resolvedUrl)) {
        const token = await getToken()
        if (!token) {
          throw new Error("Missing authentication token")
        }

        const response = await fetch(resolvedUrl, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        })

        if (!response.ok) {
          throw new Error("Unable to open this file right now")
        }

        const fileBlob = await response.blob()
        const blobUrl = URL.createObjectURL(fileBlob)
        window.open(blobUrl, "_blank", "noopener,noreferrer")
        window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000)
      } else {
        window.open(resolvedUrl, "_blank", "noopener,noreferrer")
      }

      await client.post(`/materials/${material.id}/download`)
    } catch (error) {
      console.error("Failed to open material:", error)
      toast.error("Could not open this resource")
    }
  }

  const handleAnnouncementSelect = (item: {
    notificationId: string | null
    isRead: boolean
    actionUrl: string | null
  }) => {
    if (item.notificationId && !item.isRead && !markAnnouncementRead.isPending) {
      markAnnouncementRead.mutate(item.notificationId)
    }
    if (item.actionUrl && item.actionUrl.startsWith("/")) {
      navigate(item.actionUrl)
    }
  }

  const handleMarkAllAnnouncementsRead = () => {
    if (unreadAnnouncementCount <= 0 || markAllAnnouncementsRead.isPending) return
    markAllAnnouncementsRead.mutate()
  }

  // ── Render ──────────────────────────────────────────────────
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
                {NAV_ITEMS.map((item) => (
                  <SidebarMenuItem key={item.section}>
                    <SidebarMenuButton
                      tooltip={item.label}
                      isActive={activeNavSection === item.section}
                      onClick={() => handleSectionChange(item.section)}
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
                  <BreadcrumbLink href="#" onClick={() => navigate(STUDENT_SECTION_ROUTES.dashboard)}>LearnTrack</BreadcrumbLink>
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
            onSettings={() => navigate("/dashboard/settings")}
            onSignOut={() => signOut()}
          />
        </header>

        <div className="flex flex-1 flex-col gap-4 bg-background p-4">
          <div ref={contentScrollRef} className="flex-1 overflow-y-auto">
            <PageShell>
              <Routes>
                <Route
                  index
                  element={
                    <OverviewView
                      studentName={studentName}
                      pendingAssignments={pendingAssignments}
                      actionableAssignments={actionableAssignments}
                      dueSoonAssignments={dueSoonAssignments}
                      overdueAssignments={overdueAssignments}
                      awards={awards}
                      activityItems={activityItems}
                      announcementItems={announcementItems}
                      unreadAnnouncementCount={unreadAnnouncementCount}
                      weekDays={weekDays}
                      gpa={gpa}
                      completionRate={completionRate}
                      completedAssignments={completedAssignments}
                      totalAssignments={totalAssignments}
                      averageScore={averageScore}
                      totalTimeSpent={totalTimeSpent}
                      currentGrade={currentGrade}
                      assignmentCardSpacingClass={assignmentCardSpacingClass}
                      statsLoading={statsLoading}
                      analyticsLoading={analyticsLoading}
                      assignmentsLoading={assignmentsLoading}
                      activitiesLoading={activitiesLoading}
                      announcementsLoading={announcementsLoading}
                      statsErrorMessage={statsErrorMessage}
                      analyticsErrorMessage={analyticsErrorMessage}
                      assignmentsErrorMessage={assignmentsErrorMessage}
                      activitiesErrorMessage={activitiesErrorMessage}
                      announcementsErrorMessage={announcementsErrorMessage}
                      markAnnouncementReadPending={markAnnouncementRead.isPending}
                      markAllAnnouncementsReadPending={markAllAnnouncementsRead.isPending}
                      onSectionChange={handleSectionChange}
                      onStartAssignment={handleStartAssignment}
                      onResumeLearningSession={handleResumeLearningSession}
                      onAnnouncementSelect={handleAnnouncementSelect}
                      onMarkAllAnnouncementsRead={handleMarkAllAnnouncementsRead}
                    />
                  }
                />
                <Route
                  path="courses"
                  element={
                    <CoursesView
                      courseSummaries={courseSummaries}
                      assignmentsLoading={assignmentsLoading}
                      assignmentsErrorMessage={assignmentsErrorMessage}
                      onOpenSubjectAssignments={handleOpenSubjectAssignments}
                    />
                  }
                />
                <Route
                  path="assignments"
                  element={
                    <AssignmentsView
                      filteredAssignments={filteredAssignments}
                      totalAssignments={totalAssignments}
                      actionableCount={actionableAssignments.length}
                      overdueCount={overdueAssignments.length}
                      completedAssignments={completedAssignments}
                      assignmentsLoading={assignmentsLoading}
                      assignmentsErrorMessage={assignmentsErrorMessage}
                      assignmentSearchTerm={assignmentSearchTerm}
                      assignmentFilter={assignmentFilter}
                      assignmentCardSpacingClass={assignmentCardSpacingClass}
                      onSearchChange={setAssignmentSearchTerm}
                      onFilterChange={setAssignmentFilter}
                      onStartAssignment={handleStartAssignment}
                      onSectionChange={handleSectionChange}
                    />
                  }
                />
                <Route
                  path="grades"
                  element={
                    <GradesView
                      averageScore={averageScore}
                      completedAssignments={completedAssignments}
                      totalTimeSpent={totalTimeSpent}
                      currentGrade={currentGrade}
                      pendingReviewAssignments={pendingReviewAssignments}
                      gradedAssignments={gradedAssignments}
                      gradeBreakdown={gradeBreakdown}
                      weeklyProgressRows={weeklyProgressRows}
                      recentSubmissions={recentSubmissions}
                      analyticsLoading={analyticsLoading}
                      statsErrorMessage={statsErrorMessage}
                      analyticsErrorMessage={analyticsErrorMessage}
                      onSectionChange={handleSectionChange}
                    />
                  }
                />
                <Route
                  path="library"
                  element={
                    <LibraryView
                      filteredMaterials={filteredMaterials}
                      materialCounts={materialCounts}
                      materialsLoading={materialsLoading}
                      materialsErrorMessage={materialsErrorMessage}
                      materialSearchTerm={materialSearchTerm}
                      materialFilter={materialFilter}
                      onSearchChange={setMaterialSearchTerm}
                      onFilterChange={setMaterialFilter}
                      onOpenMaterial={handleOpenMaterial}
                    />
                  }
                />
                <Route
                  path="messages"
                  element={
                    <DashboardMessagesPage
                      title="Messages"
                      description="Stay in sync with your tutor and family support team."
                    />
                  }
                />
                <Route path="messages/chats" element={<Navigate to="/dashboard/messages?mode=chat" replace />} />
                <Route path="messages/emails" element={<Navigate to="/dashboard/messages?mode=email" replace />} />
                <Route path="notifications" element={<NotificationsPage />} />
                <Route path="settings" element={<SettingsPage />} />
                <Route path="*" element={<Navigate to="/dashboard" replace />} />
              </Routes>
            </PageShell>
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

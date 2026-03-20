"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useAuth, useClerk, useUser } from "@clerk/clerk-react"
import { useNavigate } from "react-router-dom"
import {
  BookOpen,
  CheckCircle2,
  Clock3,
  Download,
  ExternalLink,
  Filter,
  FolderOpen,
  Layers,
  LayoutDashboard,
  Library,
  Search,
  Sparkles,
  TrendingUp,
  Trophy,
} from "lucide-react"

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
import { DashboardHeaderActions } from "@/components/dashboard/DashboardHeaderActions"
import StudentAssignmentWorkspace from "@/components/student-assignment-workspace"
import { useImpersonation } from "@/contexts/ImpersonationContext"
import { toast } from "@/contexts/ToastContext"
import { useUserContext } from "@/contexts/UserContext"
import {
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
import { API_HOST } from "@/lib/config"
import { cn } from "@/lib/utils"

type StudentNavSection = "dashboard" | "courses" | "assignments" | "grades" | "library"
type AssignmentFilter = "all" | "active" | "pending" | "overdue" | "completed"
type MaterialFilter = "all" | "pdf" | "doc" | "video" | "image" | "link" | "other"

type AssignmentStatus = "active" | "pending" | "completed" | "overdue" | "archived"

interface AssignmentCardData {
  id: string
  title: string
  subject: string
  subjectId: string | null
  dueDate: Date | null
  questionCount: number
  progress: number
  status: AssignmentStatus
  rawStatus: string
  score: number | null
  feedback: string | null
  reviewAvailable: boolean
  submittedAt: Date | null
  gradedAt: Date | null
}

interface CourseSummary {
  id: string
  subject: string
  averageScore: number
  completionRate: number
  totalAssignments: number
  pendingAssignments: number
  nextDueDate: Date | null
}

interface StudentMaterialItem {
  id: string
  title: string
  description: string
  materialType: MaterialFilter
  fileUrl: string | null
  fileSize: number | null
  subject: string
  topic: string
  createdAt: Date | null
}

interface TimelineItem {
  title: string
  detail: string
  stamp: string
  tone: "primary" | "success" | "info"
}

const NAV_LABELS: Record<StudentNavSection, string> = {
  dashboard: "Student Dashboard",
  courses: "My Courses",
  assignments: "Assignments",
  grades: "Grades",
  library: "Library",
}

const ASSIGNMENT_FILTER_LABELS: Record<AssignmentFilter, string> = {
  all: "All",
  active: "Active",
  pending: "Pending",
  overdue: "Overdue",
  completed: "Completed",
}

const MATERIAL_FILTER_LABELS: Record<MaterialFilter, string> = {
  all: "All types",
  pdf: "PDF",
  doc: "Docs",
  video: "Video",
  image: "Image",
  link: "Links",
  other: "Other",
}

const NAV_ITEMS: Array<{ label: string; section: StudentNavSection; icon: any }> = [
  { label: "Dashboard", section: "dashboard", icon: LayoutDashboard },
  { label: "My Courses", section: "courses", icon: BookOpen },
  { label: "Assignments", section: "assignments", icon: CheckCircle2 },
  { label: "Grades", section: "grades", icon: TrendingUp },
  { label: "Library", section: "library", icon: FolderOpen },
]

const STUDENT_SECTIONS: StudentNavSection[] = [
  "dashboard",
  "courses",
  "assignments",
  "grades",
  "library",
]

function normalizeAssignmentStatus(rawStatus: string, dueDate: Date | null): AssignmentStatus {
  const normalized = rawStatus.trim().toLowerCase()
  if (normalized === "archived") return "archived"
  if (normalized === "completed" || normalized === "submitted" || normalized === "graded") {
    return "completed"
  }

  if (dueDate && dueDate.getTime() < Date.now()) {
    return "overdue"
  }

  if (normalized === "active" || normalized === "in_progress" || normalized === "published") {
    return "active"
  }

  return "pending"
}

function toAssignmentCards(items: any[]): AssignmentCardData[] {
  return items.map((item, index) => {
    const questionCount = Number(
      item?.question_count ?? item?.questionCount ?? item?.questions?.length ?? 0
    )
    const completedQuestions = Number(
      item?.completed_questions ??
        item?.completedQuestions ??
        (String(item?.status || "").toLowerCase() === "completed" ? questionCount : 0)
    )

    const dueDate = item?.due_date || item?.dueDate ? new Date(item?.due_date ?? item?.dueDate) : null
    const rawStatus = String(item?.status ?? "pending")
    const status = normalizeAssignmentStatus(rawStatus, dueDate)
    const backendProgress = Number(item?.progress_percent ?? item?.progressPercent)
    const computedProgress = questionCount > 0 ? Math.round((completedQuestions / questionCount) * 100) : 0
    const progress = Number.isFinite(backendProgress)
      ? Math.max(0, Math.min(100, backendProgress))
      : Math.max(0, Math.min(100, computedProgress))

    const subjectIdValue = item?.subject_id
    const subjectId =
      typeof subjectIdValue === "string"
        ? subjectIdValue
        : subjectIdValue && typeof subjectIdValue === "object" && typeof subjectIdValue._id === "string"
          ? subjectIdValue._id
          : null

    return {
      id: String(item?.id ?? item?._id ?? `assignment-${index}`),
      title: String(item?.title ?? "Untitled Assignment"),
      subject: String(
        item?.subject_name ??
          item?.subject?.name ??
          item?.subject_id?.name ??
          item?.subject_id ??
          "General Studies"
      ),
      subjectId,
      dueDate,
      questionCount,
      progress,
      status,
      rawStatus,
      score: typeof item?.best_score === "number" ? item.best_score : typeof item?.score === "number" ? item.score : null,
      feedback: typeof item?.feedback === "string" && item.feedback.trim() ? item.feedback : null,
      reviewAvailable: Boolean(item?.review_available),
      submittedAt: item?.submitted_at ? new Date(item.submitted_at) : null,
      gradedAt: item?.graded_at ? new Date(item.graded_at) : null,
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

function getStatusBadgeVariant(status: AssignmentStatus): "default" | "secondary" | "destructive" | "outline" {
  if (status === "completed") return "default"
  if (status === "active") return "secondary"
  if (status === "overdue" || status === "archived") return "destructive"
  return "outline"
}

function getWeekDays(datesWithTasks: Set<string>, includeWeekend: boolean) {
  const now = new Date()
  const currentDay = (now.getDay() + 6) % 7
  const monday = new Date(now)
  monday.setDate(now.getDate() - currentDay)

  const base = Array.from({ length: 7 }).map((_, i) => {
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

  if (includeWeekend) {
    return base
  }

  return base.filter((day) => !day.isWeekend)
}

function formatMinutesToDuration(totalMinutes: number): string {
  if (!totalMinutes || totalMinutes <= 0) return "0m"
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours <= 0) return `${minutes}m`
  if (minutes <= 0) return `${hours}h`
  return `${hours}h ${minutes}m`
}

function toMaterialType(value: string): MaterialFilter {
  const normalized = value.trim().toLowerCase()
  if (
    normalized === "pdf" ||
    normalized === "doc" ||
    normalized === "video" ||
    normalized === "image" ||
    normalized === "link"
  ) {
    return normalized
  }
  return "other"
}

function toMaterialCards(items: any[]): StudentMaterialItem[] {
  return items.map((item, index) => {
    const id = String(item?.id ?? item?._id ?? `material-${index}`)
    const rawType = String(item?.material_type ?? "other")
    const materialType = toMaterialType(rawType)
    const fileSize = typeof item?.file_size === "number" ? item.file_size : null
    const createdAt = item?.created_at ? new Date(item.created_at) : null
    const subject =
      typeof item?.subject_name === "string" && item.subject_name.trim()
        ? item.subject_name
        : typeof item?.subject === "string" && item.subject.trim()
          ? item.subject
          : typeof item?.subject?.name === "string" && item.subject.name.trim()
            ? item.subject.name
            : typeof item?.subject_id === "string" && item.subject_id.trim()
              ? item.subject_id
              : typeof item?.subject_id?.name === "string" && item.subject_id.name.trim()
                ? item.subject_id.name
                : "General"

    return {
      id,
      title: String(item?.title ?? "Untitled Resource"),
      description: String(item?.description ?? "No description available."),
      materialType,
      fileUrl: typeof item?.file_url === "string" && item.file_url.trim() ? item.file_url : null,
      fileSize,
      subject,
      topic: String(item?.topic ?? ""),
      createdAt,
    }
  })
}

function formatBytes(value: number | null): string {
  if (!value || value <= 0) return "-"
  const units = ["B", "KB", "MB", "GB"]
  let size = value
  let unitIndex = 0

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }

  return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[unitIndex]}`
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return "Recently"
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return "Recently"
  return parsed.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

function readableActivityType(activityType: string): string {
  const normalized = activityType.trim().toLowerCase()
  if (!normalized) return "Activity"
  return normalized
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
}

function readableNotificationType(notificationType: string | null | undefined): string {
  const normalized = String(notificationType || "").trim().toLowerCase()
  if (!normalized) return "Announcement"

  const labels: Record<string, string> = {
    assignment_submitted: "Assignment submitted",
    assignment_graded: "Assignment graded",
    question_approved: "Question approved",
    question_rejected: "Question rejected",
    student_joined: "Student joined",
    parent_joined: "Parent joined",
    message_received: "New message",
    assignment_due_soon: "Assignment due soon",
    assignment_overdue: "Assignment overdue",
    invitation_accepted: "Invitation accepted",
    system: "System update",
  }

  return labels[normalized] || readableActivityType(normalized)
}

function resolveMaterialUrl(fileUrl: string): string {
  if (/^https?:\/\//i.test(fileUrl)) {
    return fileUrl
  }
  if (fileUrl.startsWith("/")) {
    return `${API_HOST}${fileUrl}`
  }
  return `${API_HOST}/${fileUrl}`
}

function isProtectedInternalMaterialUrl(url: string): boolean {
  return url.includes("/api/v1/materials/files/")
}

export default function StudentDashboard() {
  const { user } = useUser()
  const { signOut } = useClerk()
  const { getToken } = useAuth()
  const navigate = useNavigate()
  const client = useApiClient()
  const { backendUser } = useUserContext()
  const { isImpersonating } = useImpersonation()

  const [activeNavSection, setActiveNavSection] = useState<StudentNavSection>("dashboard")
  const [hasAppliedPreferredTab, setHasAppliedPreferredTab] = useState(false)
  const [assignmentSearchTerm, setAssignmentSearchTerm] = useState("")
  const [assignmentFilter, setAssignmentFilter] = useState<AssignmentFilter>("all")
  const [materialSearchTerm, setMaterialSearchTerm] = useState("")
  const [materialFilter, setMaterialFilter] = useState<MaterialFilter>("all")
  const [activeAssignmentId, setActiveAssignmentId] = useState<string | null>(null)

  const contentScrollRef = useRef<HTMLDivElement | null>(null)

  const { data: rawAssignments = [], isLoading: assignmentsLoading } = useMyAssignments()
  const { data: dashboardStats, isLoading: statsLoading } = useStudentDashboardStats()
  const { data: progressAnalytics, isLoading: analyticsLoading } = useStudentProgressAnalytics()
  const { data: announcements = [], isLoading: announcementsLoading } = useAnnouncements()
  const { data: activityFeed = [], isLoading: activitiesLoading } = useMyActivities(20)
  const { data: materials = [], isLoading: materialsLoading } = useStudentMaterials()
  const { data: userSettings, isLoading: settingsLoading } = useUserSettings()
  const markAnnouncementRead = useMarkNotificationRead()
  const markAllAnnouncementsRead = useMarkAllNotificationsRead()

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

  const preferences = userSettings?.preferences || {}
  const showWeekendSchedule = preferences.show_weekend_schedule ?? true
  const compactAssignmentCards = preferences.compact_assignment_cards ?? false
  const autoOpenNextAssignment = preferences.auto_open_next_assignment ?? false

  useEffect(() => {
    if (settingsLoading || hasAppliedPreferredTab) {
      return
    }

    const preferred = preferences.default_student_tab
    if (preferred && STUDENT_SECTIONS.includes(preferred)) {
      setActiveNavSection(preferred)
    }

    setHasAppliedPreferredTab(true)
  }, [hasAppliedPreferredTab, preferences.default_student_tab, settingsLoading])

  const assignments = useMemo(
    () => toAssignmentCards(Array.isArray(rawAssignments) ? (rawAssignments as any[]) : []),
    [rawAssignments]
  )

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
        if (assignmentFilter !== "all" && assignment.status !== assignmentFilter) {
          return false
        }

        if (!query) {
          return true
        }

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

  const recentSubmissions = useMemo(() => {
    if (!Array.isArray(progressAnalytics?.recent_submissions)) {
      return []
    }

    return progressAnalytics.recent_submissions.map((item: any, index: number) => ({
      id: String(item?.assignment_id || item?.id || index),
      assignmentTitle: String(item?.assignment_title || "Assignment"),
      subject: String(item?.subject || "General"),
      score: typeof item?.score === "number" ? item.score : null,
      submittedAt: typeof item?.submitted_at === "string" ? item.submitted_at : null,
    }))
  }, [progressAnalytics?.recent_submissions])

  const activityItems = useMemo<TimelineItem[]>(() => {
    if (Array.isArray(activityFeed) && activityFeed.length > 0) {
      return activityFeed.slice(0, 6).map((item: any) => {
        const activityType = String(item?.activity_type ?? "activity")
        const title = item?.description || readableActivityType(activityType)
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
    }

    return []
  }, [activityFeed])

  const announcementItems = useMemo(() => {
    if (!Array.isArray(announcements)) {
      return []
    }

    return announcements.slice(0, 5).map((item: any, index: number) => ({
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
    if (unreadAnnouncementCount <= 0 || markAllAnnouncementsRead.isPending) {
      return
    }

    markAllAnnouncementsRead.mutate()
  }

  const courseSummaries = useMemo<CourseSummary[]>(() => {
    const subjectStats = new Map<string, CourseSummary>()
    const scoreLookup = new Map<string, number>()

    const subjectPerformance = Array.isArray(progressAnalytics?.subject_performance)
      ? progressAnalytics.subject_performance
      : []

    subjectPerformance.forEach((entry: any) => {
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
      .map((entry: any, index: number) => ({
        id: `${entry?.subject || "subject"}-${index}`,
        subject: String(entry?.subject || "General"),
        score: Number(entry?.score || 0),
        assignments: Number(entry?.assignments || 0),
      }))
      .sort((a, b) => b.score - a.score)
  }, [progressAnalytics?.subject_performance])

  const materialItems = useMemo(
    () => toMaterialCards(Array.isArray(materials) ? (materials as any[]) : []),
    [materials]
  )

  const filteredMaterials = useMemo(() => {
    const query = materialSearchTerm.trim().toLowerCase()

    return materialItems.filter((material) => {
      if (materialFilter !== "all" && material.materialType !== materialFilter) {
        return false
      }

      if (!query) {
        return true
      }

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

  const weeklyProgressRows = Array.isArray(progressAnalytics?.weekly_progress)
    ? progressAnalytics.weekly_progress
    : []

  const assignmentCardSpacingClass = compactAssignmentCards ? "space-y-3 p-4" : "space-y-4 p-5"

  const handleSectionChange = (section: StudentNavSection) => {
    setActiveNavSection(section)
    contentScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" })
  }

  const handleStartAssignment = (assignment: AssignmentCardData) => {
    setActiveNavSection("assignments")
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

  const handleOpenSettings = () => {
    navigate("/settings")
  }

  const handleSignOut = async () => {
    await signOut()
  }

  const renderDashboardPage = () => {
    return (
      <div className="space-y-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="mb-2 text-3xl font-bold text-foreground">Welcome back, {studentName}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {pendingAssignments > 0
                ? `You have ${pendingAssignments} assignment${pendingAssignments > 1 ? "s" : ""} requiring attention.`
                : "You're fully caught up. Keep the momentum going."}
            </p>
          </div>

          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <Button
              className="w-full bg-primary text-primary-foreground hover:bg-primary/90 sm:w-auto"
              onClick={handleResumeLearningSession}
              disabled={actionableAssignments.length === 0}
            >
              <Sparkles className="mr-2 h-4 w-4" />
              Resume Learning Session
            </Button>
            <Button variant="outline" onClick={() => handleSectionChange("assignments")}>View Assignments</Button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Card className="border-0 bg-card shadow-sm">
            <CardContent className="flex items-center justify-between p-5">
              <div>
                <p className="text-sm text-muted-foreground">Overall GPA</p>
                <p className="mt-1 text-3xl font-bold text-primary">
                  {statsLoading ? <Skeleton className="h-8 w-14" /> : gpa}
                </p>
                <p className="mt-2 text-xs text-muted-foreground">Current grade: {dashboardStats?.current_grade || "--"}</p>
              </div>
              <div className="rounded-full border-4 border-primary/20 p-3">
                <Trophy className="h-6 w-6 text-primary" />
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 bg-card shadow-sm">
            <CardContent className="flex items-center justify-between p-5">
              <div>
                <p className="text-sm text-muted-foreground">Completion</p>
                <p className="mt-1 text-3xl font-bold">
                  {statsLoading ? <Skeleton className="h-8 w-12" /> : `${completionRate}%`}
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {completedAssignments}/{totalAssignments} assignments completed
                </p>
              </div>
              <div className="rounded-full border-4 border-primary/20 p-3">
                <CheckCircle2 className="h-6 w-6 text-primary" />
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 bg-card shadow-sm">
            <CardContent className="flex items-center justify-between p-5">
              <div>
                <p className="text-sm text-muted-foreground">Pending Work</p>
                <p className="mt-1 text-3xl font-bold">
                  {statsLoading ? <Skeleton className="h-8 w-10" /> : pendingAssignments}
                </p>
                <p className="mt-2 text-xs text-muted-foreground">Not yet submitted</p>
              </div>
              <div className="rounded-full bg-primary/10 p-3">
                <Clock3 className="h-6 w-6 text-primary" />
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 bg-card shadow-sm">
            <CardContent className="flex items-center justify-between p-5">
              <div>
                <p className="text-sm text-muted-foreground">Average Score</p>
                <p className="mt-1 text-3xl font-bold">
                  {analyticsLoading ? <Skeleton className="h-8 w-14" /> : `${Math.round(averageScore || 0)}%`}
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  Study time: {formatMinutesToDuration(progressAnalytics?.total_time_spent || 0)}
                </p>
              </div>
              <div className="rounded-full bg-primary/10 p-3">
                <TrendingUp className="h-6 w-6 text-primary" />
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 gap-8 xl:grid-cols-3">
          <div className="space-y-8 xl:col-span-2">
            <section>
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-xl font-semibold">Due Soon</h2>
                <Button variant="ghost" size="sm" className="text-primary" onClick={() => handleSectionChange("assignments")}>Open all</Button>
              </div>

              {assignmentsLoading ? (
                <Card className="border-0 bg-card shadow-sm">
                  <CardContent className="space-y-3 p-5">
                    <Skeleton className="h-5 w-48" />
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-2/3" />
                  </CardContent>
                </Card>
              ) : dueSoonAssignments.length === 0 ? (
                <Card className="border-0 bg-card shadow-sm">
                  <CardContent className="p-6 text-center">
                    <BookOpen className="mx-auto mb-2 h-10 w-10 text-muted-foreground/60" />
                    <p className="font-medium">No upcoming deadlines</p>
                    <p className="text-sm text-muted-foreground">Your next assignments will appear here automatically.</p>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-4">
                  {dueSoonAssignments.map((assignment) => (
                    <Card key={assignment.id} className="border border-border bg-card shadow-sm">
                      <CardContent className={assignmentCardSpacingClass}>
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0">
                            <Badge variant="secondary" className="mb-2">{assignment.subject}</Badge>
                            <p className="truncate text-lg font-semibold">{assignment.title}</p>
                            <p className="text-sm text-muted-foreground">
                              {formatRelativeDueDate(assignment.dueDate)} - {formatDueDate(assignment.dueDate)}
                            </p>
                          </div>
                          <Badge variant={getStatusBadgeVariant(assignment.status)}>{assignment.status}</Badge>
                        </div>

                        <Progress value={assignment.progress} className="h-2" />

                        <div className="flex items-center justify-between">
                          <p className="text-xs text-muted-foreground">{assignment.questionCount} questions</p>
                          <Button size="sm" variant="outline" onClick={() => handleStartAssignment(assignment)}>
                            {assignment.progress > 0 ? "Continue" : "Start"}
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </section>

            <section>
              <h2 className="mb-4 text-xl font-semibold">Weekly Schedule</h2>
              <Card className="border-0 bg-card shadow-sm">
                <CardContent className="space-y-6 p-5">
                  <div className="grid grid-cols-5 gap-2 sm:grid-cols-7">
                    {weekDays.map((day) => (
                      <div key={`${day.label}-${day.date.toDateString()}`} className="text-center">
                        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{day.label}</p>
                        <div
                          className={cn(
                            "relative rounded-lg border px-1 py-2",
                            day.isToday ? "border-primary bg-primary text-primary-foreground" : "border-border"
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

                  <div className="space-y-3">
                    {overdueAssignments.slice(0, 2).map((assignment) => (
                      <div key={`overdue-${assignment.id}`} className="rounded-lg border-l-4 border-destructive bg-destructive/5 p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold">{assignment.title}</p>
                            <p className="text-xs text-muted-foreground">{assignment.subject} - {formatRelativeDueDate(assignment.dueDate)}</p>
                          </div>
                          <Button size="sm" variant="outline" onClick={() => handleStartAssignment(assignment)}>Open</Button>
                        </div>
                      </div>
                    ))}

                    {overdueAssignments.length === 0 && (
                      <p className="text-sm text-muted-foreground">No overdue work. Keep it up.</p>
                    )}
                  </div>
                </CardContent>
              </Card>
            </section>
          </div>

          <div className="space-y-8">
            <section>
              <h2 className="mb-4 text-xl font-semibold">Recent Activity</h2>
              <Card className="border-0 bg-card shadow-sm">
                <CardContent className="p-5">
                  {activitiesLoading ? (
                    <div className="space-y-4">
                      {Array.from({ length: 3 }).map((_, index) => (
                        <div key={index} className="space-y-2">
                          <Skeleton className="h-4 w-36" />
                          <Skeleton className="h-3 w-full" />
                        </div>
                      ))}
                    </div>
                  ) : activityItems.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No activity yet. Start an assignment to begin tracking progress.</p>
                  ) : (
                    <div className="space-y-5">
                      {activityItems.map((item, index) => (
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
                          <p className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">{item.stamp}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </section>

            <section>
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="text-xl font-semibold">Announcements</h2>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8"
                  disabled={
                    unreadAnnouncementCount <= 0 ||
                    announcementsLoading ||
                    markAllAnnouncementsRead.isPending
                  }
                  onClick={handleMarkAllAnnouncementsRead}
                >
                  {markAllAnnouncementsRead.isPending
                    ? "Marking..."
                    : `Mark all read${
                        unreadAnnouncementCount > 0 ? ` (${unreadAnnouncementCount})` : ""
                      }`}
                </Button>
              </div>
              <Card className="border-0 bg-card shadow-sm">
                <CardContent className="space-y-4 p-5">
                  {announcementsLoading ? (
                    Array.from({ length: 2 }).map((_, index) => (
                      <div key={index} className="space-y-2">
                        <Skeleton className="h-4 w-32" />
                        <Skeleton className="h-3 w-full" />
                      </div>
                    ))
                  ) : announcementItems.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No announcements at the moment.</p>
                  ) : (
                    announcementItems.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className={cn(
                          "w-full rounded-lg border border-border bg-muted/35 p-3 text-left transition-colors hover:bg-muted/60",
                          !item.isRead && "border-primary/40 bg-primary/5"
                        )}
                        onClick={() => handleAnnouncementSelect(item)}
                        disabled={markAnnouncementRead.isPending}
                      >
                        <p className={cn("text-sm", !item.isRead && "font-semibold")}>{item.title}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{item.message}</p>
                        <p className="mt-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                          {item.stamp}
                          {item.isRead ? "" : " • Unread"}
                        </p>
                      </button>
                    ))
                  )}
                </CardContent>
              </Card>
            </section>
          </div>
        </div>
      </div>
    )
  }

  const renderCoursesPage = () => {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-foreground">My Courses</h1>
          <p className="mt-1 text-sm text-muted-foreground">Track each subject and jump directly to the relevant assignments.</p>
        </div>

        {assignmentsLoading ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <Card key={index} className="border-0 bg-card shadow-sm">
                <CardContent className="space-y-3 p-5">
                  <Skeleton className="h-5 w-40" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-2 w-full" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : courseSummaries.length === 0 ? (
          <Card className="border-0 bg-card shadow-sm">
            <CardContent className="p-8 text-center">
              <BookOpen className="mx-auto mb-2 h-10 w-10 text-muted-foreground/60" />
              <p className="font-medium">No courses yet</p>
              <p className="text-sm text-muted-foreground">Once assignments are published, your subjects will appear here.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {courseSummaries.map((course) => (
              <Card key={course.id} className="border border-border bg-card shadow-sm">
                <CardContent className="space-y-4 p-5">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-lg font-semibold">{course.subject}</p>
                      <p className="text-xs text-muted-foreground">
                        {course.totalAssignments} assignment{course.totalAssignments === 1 ? "" : "s"}
                      </p>
                    </div>
                    <Badge variant="outline">{course.averageScore}% avg</Badge>
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span>Completion</span>
                      <span>{course.completionRate}%</span>
                    </div>
                    <Progress value={course.completionRate} className="h-2" />
                  </div>

                  <div className="text-xs text-muted-foreground">
                    <p>Pending: {course.pendingAssignments}</p>
                    <p>Next due: {formatDueDate(course.nextDueDate)}</p>
                  </div>

                  <Button size="sm" variant="outline" onClick={() => handleOpenSubjectAssignments(course.subject)}>
                    View Assignments
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    )
  }

  const renderAssignmentsPage = () => {
    return (
      <div className="space-y-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Assignments</h1>
            <p className="mt-1 text-sm text-muted-foreground">Search, filter, and continue your work from one place.</p>
          </div>

          <div className="flex w-full flex-col gap-2 sm:flex-row lg:w-auto">
            <div className="relative sm:w-72">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={assignmentSearchTerm}
                onChange={(event) => setAssignmentSearchTerm(event.target.value)}
                className="pl-9"
                placeholder="Search assignments"
              />
            </div>
            <div className="relative sm:w-44">
              <Filter className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <select
                value={assignmentFilter}
                onChange={(event) => setAssignmentFilter(event.target.value as AssignmentFilter)}
                className="h-10 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm"
              >
                {Object.entries(ASSIGNMENT_FILTER_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <Card className="border-0 bg-card shadow-sm">
            <CardContent className="p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Total</p>
              <p className="text-2xl font-bold">{totalAssignments}</p>
            </CardContent>
          </Card>
          <Card className="border-0 bg-card shadow-sm">
            <CardContent className="p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Active</p>
              <p className="text-2xl font-bold">{actionableAssignments.length}</p>
            </CardContent>
          </Card>
          <Card className="border-0 bg-card shadow-sm">
            <CardContent className="p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Overdue</p>
              <p className="text-2xl font-bold text-destructive">{overdueAssignments.length}</p>
            </CardContent>
          </Card>
          <Card className="border-0 bg-card shadow-sm">
            <CardContent className="p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Completed</p>
              <p className="text-2xl font-bold">{completedAssignments}</p>
            </CardContent>
          </Card>
        </div>

        {assignmentsLoading ? (
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, index) => (
              <Card key={index} className="border-0 bg-card shadow-sm">
                <CardContent className="space-y-3 p-5">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-5 w-full" />
                  <Skeleton className="h-2 w-full" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : filteredAssignments.length === 0 ? (
          <Card className="border-0 bg-card shadow-sm">
            <CardContent className="p-8 text-center">
              <CheckCircle2 className="mx-auto mb-2 h-10 w-10 text-muted-foreground/60" />
              <p className="font-medium">No assignments match this filter</p>
              <p className="text-sm text-muted-foreground">Try adjusting your search or status filter.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {filteredAssignments.map((assignment) => {
              const canStart = assignment.status !== "completed" && assignment.status !== "archived"
              return (
                <Card key={assignment.id} className="border border-border bg-card shadow-sm">
                  <CardContent className={assignmentCardSpacingClass}>
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <Badge variant="secondary" className="mb-2">{assignment.subject}</Badge>
                        <p className="truncate text-lg font-semibold">{assignment.title}</p>
                        <p className="text-sm text-muted-foreground">
                          {formatRelativeDueDate(assignment.dueDate)} - {formatDueDate(assignment.dueDate)}
                        </p>
                      </div>
                      <Badge variant={getStatusBadgeVariant(assignment.status)}>{assignment.status}</Badge>
                    </div>

                    <Progress value={assignment.progress} className="h-2" />

                    <div className="flex items-center justify-between gap-4">
                      <p className="text-xs text-muted-foreground">
                        {assignment.questionCount} questions • {assignment.progress}% complete
                      </p>
                      {canStart ? (
                        <Button size="sm" variant="outline" onClick={() => handleStartAssignment(assignment)}>
                          {assignment.progress > 0 ? "Continue" : "Start"}
                        </Button>
                      ) : (
                        <Button size="sm" variant="outline" onClick={() => handleSectionChange("grades")}>
                          View Grades
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  const renderGradesPage = () => {
    return (
      <div className="space-y-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Grades & Performance</h1>
            <p className="mt-1 text-sm text-muted-foreground">Track your score trends and identify where to focus next.</p>
          </div>
          <Button variant="outline" onClick={() => handleSectionChange("assignments")}>Review Assignments</Button>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Card className="border-0 bg-card shadow-sm">
            <CardContent className="p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Current Grade</p>
              <p className="text-2xl font-bold">{dashboardStats?.current_grade || "--"}</p>
            </CardContent>
          </Card>
          <Card className="border-0 bg-card shadow-sm">
            <CardContent className="p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Average Score</p>
              <p className="text-2xl font-bold">{Math.round(averageScore || 0)}%</p>
            </CardContent>
          </Card>
          <Card className="border-0 bg-card shadow-sm">
            <CardContent className="p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Completed</p>
              <p className="text-2xl font-bold">{completedAssignments}</p>
            </CardContent>
          </Card>
          <Card className="border-0 bg-card shadow-sm">
            <CardContent className="p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Time Studied</p>
              <p className="text-2xl font-bold">{formatMinutesToDuration(progressAnalytics?.total_time_spent || 0)}</p>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 gap-8 xl:grid-cols-2">
          <Card className="border-0 bg-card shadow-sm xl:col-span-2">
            <CardHeader>
              <CardTitle className="text-lg">Results & Review</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {pendingReviewAssignments.length === 0 && gradedAssignments.length === 0 ? (
                <p className="text-sm text-muted-foreground">Complete and submit assignments to see review updates here.</p>
              ) : (
                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="rounded-lg border border-border p-4">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Awaiting Review</p>
                    <p className="mt-2 text-2xl font-bold">{pendingReviewAssignments.length}</p>
                    <div className="mt-3 space-y-3">
                      {pendingReviewAssignments.slice(0, 3).map((assignment) => (
                        <div key={`pending-${assignment.id}`} className="rounded-md bg-muted/40 p-3">
                          <p className="font-medium">{assignment.title}</p>
                          <p className="text-xs text-muted-foreground">
                            {assignment.subject} • Submitted {formatDueDate(assignment.submittedAt)}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-lg border border-border p-4">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Reviewed Results</p>
                    <p className="mt-2 text-2xl font-bold">{gradedAssignments.length}</p>
                    <div className="mt-3 space-y-3">
                      {gradedAssignments.slice(0, 3).map((assignment) => (
                        <div key={`graded-${assignment.id}`} className="rounded-md bg-muted/40 p-3">
                          <div className="flex items-center justify-between gap-3">
                            <p className="font-medium">{assignment.title}</p>
                            <Badge variant="outline">
                              {assignment.score !== null ? `${Math.round(assignment.score)}%` : "Reviewed"}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {assignment.subject} • Reviewed {formatDueDate(assignment.gradedAt)}
                          </p>
                          {assignment.feedback && (
                            <p className="mt-2 text-sm text-muted-foreground">{assignment.feedback}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-0 bg-card shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg">Subject Performance</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {analyticsLoading ? (
                <Skeleton className="h-24 w-full" />
              ) : gradeBreakdown.length === 0 ? (
                <p className="text-sm text-muted-foreground">Complete assignments to unlock subject insights.</p>
              ) : (
                gradeBreakdown.map((row) => (
                  <div key={row.id} className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <p className="font-medium">{row.subject}</p>
                      <p className="text-muted-foreground">{Math.round(row.score)}%</p>
                    </div>
                    <Progress value={row.score} className="h-2" />
                    <p className="text-xs text-muted-foreground">{row.assignments} graded submission{row.assignments === 1 ? "" : "s"}</p>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card className="border-0 bg-card shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg">Weekly Progress</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {analyticsLoading ? (
                <Skeleton className="h-24 w-full" />
              ) : weeklyProgressRows.length === 0 ? (
                <p className="text-sm text-muted-foreground">Progress trends will appear after submissions are logged.</p>
              ) : (
                weeklyProgressRows.map((row: any, index: number) => {
                  const assigned = Number(row?.assigned || 0)
                  const completed = Number(row?.completed || 0)
                  const ratio = assigned > 0 ? Math.round((completed / assigned) * 100) : 0

                  return (
                    <div key={`${row?.week || "week"}-${index}`} className="rounded-md border border-border p-3">
                      <div className="mb-2 flex items-center justify-between text-sm">
                        <p className="font-medium">{String(row?.week || `Week ${index + 1}`)}</p>
                        <p className="text-muted-foreground">{completed}/{assigned} complete</p>
                      </div>
                      <Progress value={ratio} className="h-2" />
                    </div>
                  )
                })
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="border-0 bg-card shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg">Recent Submissions</CardTitle>
          </CardHeader>
          <CardContent>
            {analyticsLoading ? (
              <Skeleton className="h-20 w-full" />
            ) : recentSubmissions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No submissions yet.</p>
            ) : (
              <div className="space-y-3">
                {recentSubmissions.map((submission) => (
                  <div key={submission.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3">
                    <div>
                      <p className="font-medium">{submission.assignmentTitle}</p>
                      <p className="text-xs text-muted-foreground">{submission.subject} • {formatTimestamp(submission.submittedAt)}</p>
                    </div>
                    <Badge
                      variant="outline"
                      className={cn(
                        submission.score !== null && submission.score >= 85 && "border-success text-success",
                        submission.score !== null && submission.score < 70 && "border-destructive text-destructive"
                      )}
                    >
                      {submission.score !== null ? `${Math.round(submission.score)}%` : "Pending"}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    )
  }

  const renderLibraryPage = () => {
    return (
      <div className="space-y-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Library</h1>
            <p className="mt-1 text-sm text-muted-foreground">Access study resources shared by your tutor.</p>
          </div>

          <div className="flex w-full flex-col gap-2 sm:flex-row lg:w-auto">
            <div className="relative sm:w-72">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={materialSearchTerm}
                onChange={(event) => setMaterialSearchTerm(event.target.value)}
                className="pl-9"
                placeholder="Search resources"
              />
            </div>
            <div className="relative sm:w-40">
              <Filter className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <select
                value={materialFilter}
                onChange={(event) => setMaterialFilter(event.target.value as MaterialFilter)}
                className="h-10 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm"
              >
                {Object.entries(MATERIAL_FILTER_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <Card className="border-0 bg-card shadow-sm">
            <CardContent className="p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Resources</p>
              <p className="text-2xl font-bold">{materialCounts.total}</p>
            </CardContent>
          </Card>
          <Card className="border-0 bg-card shadow-sm">
            <CardContent className="p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">PDF</p>
              <p className="text-2xl font-bold">{materialCounts.pdf}</p>
            </CardContent>
          </Card>
          <Card className="border-0 bg-card shadow-sm">
            <CardContent className="p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Video</p>
              <p className="text-2xl font-bold">{materialCounts.video}</p>
            </CardContent>
          </Card>
          <Card className="border-0 bg-card shadow-sm">
            <CardContent className="p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Links</p>
              <p className="text-2xl font-bold">{materialCounts.link}</p>
            </CardContent>
          </Card>
        </div>

        {materialsLoading ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <Card key={index} className="border-0 bg-card shadow-sm">
                <CardContent className="space-y-3 p-5">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-5 w-full" />
                  <Skeleton className="h-3 w-full" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : filteredMaterials.length === 0 ? (
          <Card className="border-0 bg-card shadow-sm">
            <CardContent className="p-8 text-center">
              <Library className="mx-auto mb-2 h-10 w-10 text-muted-foreground/60" />
              <p className="font-medium">No resources found</p>
              <p className="text-sm text-muted-foreground">Try another search or check back after your tutor shares materials.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {filteredMaterials.map((material) => (
              <Card key={material.id} className="border border-border bg-card shadow-sm">
                <CardContent className="space-y-4 p-5">
                  <div className="flex items-start justify-between gap-2">
                    <Badge variant="outline">{MATERIAL_FILTER_LABELS[material.materialType]}</Badge>
                    <p className="text-xs text-muted-foreground">{formatBytes(material.fileSize)}</p>
                  </div>

                  <div>
                    <p className="line-clamp-2 text-base font-semibold">{material.title}</p>
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{material.description}</p>
                  </div>

                  <div className="text-xs text-muted-foreground">
                    <p>Subject: {material.subject}</p>
                    <p>Topic: {material.topic || "General"}</p>
                    <p>Added: {material.createdAt ? formatDueDate(material.createdAt) : "Recently"}</p>
                  </div>

                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleOpenMaterial(material)}
                    disabled={!material.fileUrl}
                  >
                    {material.fileUrl ? (
                      <>
                        <ExternalLink className="mr-2 h-4 w-4" />
                        Open Resource
                      </>
                    ) : (
                      <>
                        <Download className="mr-2 h-4 w-4" />
                        Unavailable
                      </>
                    )}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    )
  }

  const renderActivePage = () => {
    switch (activeNavSection) {
      case "dashboard":
        return renderDashboardPage()
      case "courses":
        return renderCoursesPage()
      case "assignments":
        return renderAssignmentsPage()
      case "grades":
        return renderGradesPage()
      case "library":
        return renderLibraryPage()
      default:
        return renderDashboardPage()
    }
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
                  <BreadcrumbLink href="#" onClick={() => navigate("/dashboard")}>LearnTrack</BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator className="hidden md:block" />
                <BreadcrumbItem>
                  <BreadcrumbPage>{NAV_LABELS[activeNavSection]}</BreadcrumbPage>
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
          <div ref={contentScrollRef} className="flex-1 overflow-y-auto">
            <div className="mx-auto max-w-7xl space-y-6 px-4 py-4 sm:px-6 sm:py-6">
              {renderActivePage()}
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

import type {
  AssignmentSummaryRecord,
  StudentMaterialRecord,
} from "@/hooks/useQueries"
import { API_HOST } from "@/lib/config"

import type {
  AssignmentCardData,
  AssignmentStatus,
  MaterialFilter,
  StudentMaterialItem,
  StudentNavSection,
} from "./types"
import { NAV_LABELS } from "./constants"

export function getStudentSectionFromPath(pathname: string): StudentNavSection {
  const path = pathname.replace("/dashboard", "").replace(/^\/+/, "")
  const [rootSegment] = path.split("/")

  switch (rootSegment) {
    case "courses":
      return "courses"
    case "assignments":
      return "assignments"
    case "grades":
      return "grades"
    case "library":
      return "library"
    case "messages":
      return "messages"
    default:
      return "dashboard"
  }
}

export function getStudentPageLabel(pathname: string, activeSection: StudentNavSection): string {
  if (pathname.startsWith("/dashboard/settings")) {
    return "Settings"
  }
  if (pathname.startsWith("/dashboard/notifications")) {
    return "Notifications"
  }
  return NAV_LABELS[activeSection]
}

export function normalizeAssignmentStatus(rawStatus: string, dueDate: Date | null): AssignmentStatus {
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

export function parseOptionalDate(value: string | null | undefined): Date | null {
  return value ? new Date(value) : null
}

function resolveAssignmentSubjectLabel(item: AssignmentSummaryRecord): string {
  if (typeof item.subject_name === "string" && item.subject_name.trim()) {
    return item.subject_name
  }
  if (typeof item.subject === "string" && item.subject.trim()) {
    return item.subject
  }
  if (item.subject && typeof item.subject === "object" && typeof item.subject.name === "string" && item.subject.name.trim()) {
    return item.subject.name
  }
  if (typeof item.subject_id === "string" && item.subject_id.trim()) {
    return item.subject_id
  }
  if (item.subject_id && typeof item.subject_id === "object" && typeof item.subject_id.name === "string" && item.subject_id.name.trim()) {
    return item.subject_id.name
  }
  return "General Studies"
}

function resolveMaterialSubjectLabel(item: StudentMaterialRecord): string {
  if (typeof item.subject_name === "string" && item.subject_name.trim()) {
    return item.subject_name
  }
  if (typeof item.subject === "string" && item.subject.trim()) {
    return item.subject
  }
  if (item.subject && typeof item.subject === "object" && typeof item.subject.name === "string" && item.subject.name.trim()) {
    return item.subject.name
  }
  if (typeof item.subject_id === "string" && item.subject_id.trim()) {
    return item.subject_id
  }
  if (item.subject_id && typeof item.subject_id === "object" && typeof item.subject_id.name === "string" && item.subject_id.name.trim()) {
    return item.subject_id.name
  }
  return "General"
}

export function toAssignmentCards(items: AssignmentSummaryRecord[]): AssignmentCardData[] {
  return items.map((item, index) => {
    const questionCount = Number(
      item?.question_count ?? item?.questionCount ?? item?.questions?.length ?? 0
    )
    const completedQuestions = Number(
      item?.completed_questions ??
        item?.completedQuestions ??
        (String(item?.status || "").toLowerCase() === "completed" ? questionCount : 0)
    )

    const dueDate = parseOptionalDate(item?.due_date ?? item?.dueDate)
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
      subject: resolveAssignmentSubjectLabel(item),
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

export function formatDueDate(date: Date | null): string {
  if (!date) return "No due date"
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

export function formatRelativeDueDate(date: Date | null): string {
  if (!date) return "No due date"
  const now = new Date()
  const dayDiff = Math.ceil((date.getTime() - now.getTime()) / 86400000)
  if (dayDiff < 0) return `${Math.abs(dayDiff)} day${Math.abs(dayDiff) > 1 ? "s" : ""} overdue`
  if (dayDiff === 0) return "Due today"
  if (dayDiff === 1) return "Due tomorrow"
  return `Due in ${dayDiff} days`
}

export function getStatusBadgeVariant(status: AssignmentStatus): "default" | "secondary" | "destructive" | "outline" {
  if (status === "completed") return "default"
  if (status === "active") return "secondary"
  if (status === "overdue" || status === "archived") return "destructive"
  return "outline"
}

export function getWeekDays(datesWithTasks: Set<string>, includeWeekend: boolean) {
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

export function formatMinutesToDuration(totalMinutes: number): string {
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

export function toMaterialCards(items: StudentMaterialRecord[]): StudentMaterialItem[] {
  return items.map((item, index) => {
    const id = String(item?.id ?? item?._id ?? `material-${index}`)
    const rawType = String(item?.material_type ?? "other")
    const materialType = toMaterialType(rawType)
    const fileSize = typeof item?.file_size === "number" ? item.file_size : null
    const createdAt = parseOptionalDate(item?.created_at)
    const subject = resolveMaterialSubjectLabel(item)

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

export function formatBytes(value: number | null): string {
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

export function formatTimestamp(value: string | null | undefined): string {
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

export function readableNotificationType(notificationType: string | null | undefined): string {
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

export function resolveMaterialUrl(fileUrl: string): string {
  if (/^https?:\/\//i.test(fileUrl)) {
    return fileUrl
  }
  if (fileUrl.startsWith("/")) {
    return `${API_HOST}${fileUrl}`
  }
  return `${API_HOST}/${fileUrl}`
}

export function isProtectedInternalMaterialUrl(url: string): boolean {
  return url.includes("/api/v1/materials/files/")
}

import type { LucideIcon } from "lucide-react"

export type StudentNavSection =
  | "dashboard"
  | "courses"
  | "assignments"
  | "grades"
  | "library"
  | "messages"

export type AssignmentFilter = "all" | "active" | "pending" | "overdue" | "completed"
export type MaterialFilter = "all" | "pdf" | "doc" | "video" | "image" | "link" | "other"
export type AssignmentStatus = "active" | "pending" | "completed" | "overdue" | "archived"

export interface AssignmentCardData {
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

export interface CourseSummary {
  id: string
  subject: string
  averageScore: number
  completionRate: number
  totalAssignments: number
  pendingAssignments: number
  nextDueDate: Date | null
}

export interface StudentMaterialItem {
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

export interface TimelineItem {
  title: string
  detail: string
  stamp: string
  tone: "primary" | "success" | "info"
}

export interface AnnouncementSummary {
  id: string
  notificationId: string | null
  title: string
  message: string
  stamp: string
  isRead: boolean
  actionUrl: string | null
}

export interface RecentSubmissionSummary {
  id: string
  assignmentTitle: string
  subject: string
  score: number | null
  submittedAt: string | null
}

export interface AwardSummary {
  id: string
  title: string
  description: string
  earnedAt: string | null
}

export interface NavItem {
  label: string
  section: StudentNavSection
  icon: LucideIcon
}

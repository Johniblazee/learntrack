import {
  BookOpen,
  CheckCircle2,
  FolderOpen,
  LayoutDashboard,
  MessageCircle,
  TrendingUp,
} from "lucide-react"

import type {
  AssignmentFilter,
  MaterialFilter,
  NavItem,
  StudentNavSection,
} from "./types"

export const NAV_LABELS: Record<StudentNavSection, string> = {
  dashboard: "Student Dashboard",
  courses: "My Courses",
  assignments: "Assignments",
  grades: "Grades",
  library: "Library",
  messages: "Messages",
}

export const ASSIGNMENT_FILTER_LABELS: Record<AssignmentFilter, string> = {
  all: "All",
  active: "Active",
  pending: "Pending",
  overdue: "Overdue",
  completed: "Completed",
}

export const MATERIAL_FILTER_LABELS: Record<MaterialFilter, string> = {
  all: "All types",
  pdf: "PDF",
  doc: "Docs",
  video: "Video",
  image: "Image",
  link: "Links",
  other: "Other",
}

export const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", section: "dashboard", icon: LayoutDashboard },
  { label: "My Courses", section: "courses", icon: BookOpen },
  { label: "Assignments", section: "assignments", icon: CheckCircle2 },
  { label: "Grades", section: "grades", icon: TrendingUp },
  { label: "Library", section: "library", icon: FolderOpen },
  { label: "Messages", section: "messages", icon: MessageCircle },
]

export const STUDENT_SECTIONS: StudentNavSection[] = [
  "dashboard",
  "courses",
  "assignments",
  "grades",
  "library",
  "messages",
]

export const STUDENT_SECTION_ROUTES: Record<StudentNavSection, string> = {
  dashboard: "/dashboard",
  courses: "/dashboard/courses",
  assignments: "/dashboard/assignments",
  grades: "/dashboard/grades",
  library: "/dashboard/library",
  messages: "/dashboard/messages",
}

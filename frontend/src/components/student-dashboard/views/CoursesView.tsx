import { BookOpen } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"

import type { CourseSummary } from "../types"
import { formatDueDate } from "../utils"

interface CoursesViewProps {
  courseSummaries: CourseSummary[]
  assignmentsLoading: boolean
  assignmentsErrorMessage: string | null
  onOpenSubjectAssignments: (subject: string) => void
}

export default function CoursesView({
  courseSummaries,
  assignmentsLoading,
  assignmentsErrorMessage,
  onOpenSubjectAssignments,
}: CoursesViewProps) {
  if (assignmentsErrorMessage) {
    return (
      <Card className="border-destructive/30 bg-destructive/5 shadow-sm">
        <CardContent className="space-y-2 p-6">
          <p className="font-semibold text-foreground">Unable to load courses</p>
          <p className="text-sm text-muted-foreground">{assignmentsErrorMessage}</p>
        </CardContent>
      </Card>
    )
  }

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

                <Button size="sm" variant="outline" onClick={() => onOpenSubjectAssignments(course.subject)}>
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

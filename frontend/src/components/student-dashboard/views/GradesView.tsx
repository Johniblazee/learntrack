import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import type { StudentWeeklyProgress } from "@/hooks/useQueries"

import type {
  AssignmentCardData,
  RecentSubmissionSummary,
  StudentNavSection,
} from "../types"
import {
  formatDueDate,
  formatMinutesToDuration,
  formatTimestamp,
} from "../utils"

interface GradesViewProps {
  averageScore: number
  completedAssignments: number
  totalTimeSpent: number
  currentGrade: string | null
  pendingReviewAssignments: AssignmentCardData[]
  gradedAssignments: AssignmentCardData[]
  gradeBreakdown: Array<{ id: string; subject: string; score: number; assignments: number }>
  weeklyProgressRows: StudentWeeklyProgress[]
  recentSubmissions: RecentSubmissionSummary[]
  analyticsLoading: boolean
  statsErrorMessage: string | null
  analyticsErrorMessage: string | null
  onSectionChange: (section: StudentNavSection) => void
}

export default function GradesView({
  averageScore,
  completedAssignments,
  totalTimeSpent,
  currentGrade,
  pendingReviewAssignments,
  gradedAssignments,
  gradeBreakdown,
  weeklyProgressRows,
  recentSubmissions,
  analyticsLoading,
  statsErrorMessage,
  analyticsErrorMessage,
  onSectionChange,
}: GradesViewProps) {
  const gradesErrorMessage = statsErrorMessage || analyticsErrorMessage
  if (gradesErrorMessage) {
    return (
      <Card className="border-destructive/30 bg-destructive/5 shadow-sm">
        <CardContent className="space-y-2 p-6">
          <p className="font-semibold text-foreground">Unable to load grades and performance</p>
          <p className="text-sm text-muted-foreground">{gradesErrorMessage}</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Grades & Performance</h1>
          <p className="mt-1 text-sm text-muted-foreground">Track your score trends and identify where to focus next.</p>
        </div>
        <Button variant="outline" onClick={() => onSectionChange("assignments")}>Review Assignments</Button>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card className="border-0 bg-card shadow-sm">
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Current Grade</p>
            <p className="text-2xl font-bold">{currentGrade || "--"}</p>
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
            <p className="text-2xl font-bold">{formatMinutesToDuration(totalTimeSpent)}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-8 xl:grid-cols-2">
        {/* Results & Review */}
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

        {/* Subject Performance */}
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

        {/* Weekly Progress */}
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
              weeklyProgressRows.map((row: StudentWeeklyProgress, index: number) => {
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

      {/* Recent Submissions */}
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

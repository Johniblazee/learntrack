import { BookOpen, CheckCircle2, Clock3, Sparkles, TrendingUp, Trophy } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

import type {
  AnnouncementSummary,
  AssignmentCardData,
  AwardSummary,
  StudentNavSection,
  TimelineItem,
} from "../types"
import {
  formatDueDate,
  formatMinutesToDuration,
  formatRelativeDueDate,
  getStatusBadgeVariant,
} from "../utils"

interface OverviewViewProps {
  studentName: string
  pendingAssignments: number
  actionableAssignments: AssignmentCardData[]
  dueSoonAssignments: AssignmentCardData[]
  overdueAssignments: AssignmentCardData[]
  awards: AwardSummary[]
  activityItems: TimelineItem[]
  announcementItems: AnnouncementSummary[]
  unreadAnnouncementCount: number
  weekDays: Array<{
    date: Date
    label: string
    isToday: boolean
    hasTask: boolean
    isWeekend: boolean
  }>
  gpa: string
  completionRate: number
  completedAssignments: number
  totalAssignments: number
  averageScore: number
  totalTimeSpent: number
  currentGrade: string | null
  assignmentCardSpacingClass: string
  // Loading
  statsLoading: boolean
  analyticsLoading: boolean
  assignmentsLoading: boolean
  activitiesLoading: boolean
  announcementsLoading: boolean
  // Errors
  statsErrorMessage: string | null
  analyticsErrorMessage: string | null
  assignmentsErrorMessage: string | null
  activitiesErrorMessage: string | null
  announcementsErrorMessage: string | null
  // Mutations
  markAnnouncementReadPending: boolean
  markAllAnnouncementsReadPending: boolean
  // Handlers
  onSectionChange: (section: StudentNavSection) => void
  onStartAssignment: (assignment: AssignmentCardData) => void
  onResumeLearningSession: () => void
  onAnnouncementSelect: (item: { notificationId: string | null; isRead: boolean; actionUrl: string | null }) => void
  onMarkAllAnnouncementsRead: () => void
}

function ErrorCard({ title, message }: { title: string; message: string }) {
  return (
    <Card className="border-destructive/30 bg-destructive/5 shadow-sm">
      <CardContent className="space-y-2 p-6">
        <p className="font-semibold text-foreground">{title}</p>
        <p className="text-sm text-muted-foreground">{message}</p>
      </CardContent>
    </Card>
  )
}

export default function OverviewView({
  studentName,
  pendingAssignments,
  actionableAssignments,
  dueSoonAssignments,
  overdueAssignments,
  awards,
  activityItems,
  announcementItems,
  unreadAnnouncementCount,
  weekDays,
  gpa,
  completionRate,
  completedAssignments,
  totalAssignments,
  averageScore,
  totalTimeSpent,
  currentGrade,
  assignmentCardSpacingClass,
  statsLoading,
  analyticsLoading,
  assignmentsLoading,
  activitiesLoading,
  announcementsLoading,
  statsErrorMessage,
  analyticsErrorMessage,
  assignmentsErrorMessage,
  activitiesErrorMessage,
  announcementsErrorMessage,
  markAnnouncementReadPending,
  markAllAnnouncementsReadPending,
  onSectionChange,
  onStartAssignment,
  onResumeLearningSession,
  onAnnouncementSelect,
  onMarkAllAnnouncementsRead,
}: OverviewViewProps) {
  const dashboardInsightError = statsErrorMessage || analyticsErrorMessage

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
            onClick={onResumeLearningSession}
            disabled={actionableAssignments.length === 0}
          >
            <Sparkles className="mr-2 h-4 w-4" />
            Resume Learning Session
          </Button>
          <Button variant="outline" onClick={() => onSectionChange("assignments")}>View Assignments</Button>
        </div>
      </div>

      {dashboardInsightError ? (
        <ErrorCard title="Dashboard insights unavailable" message={dashboardInsightError} />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Card className="border-0 bg-card shadow-sm">
            <CardContent className="flex items-center justify-between p-5">
              <div>
                <p className="text-sm text-muted-foreground">Overall GPA</p>
                <p className="mt-1 text-3xl font-bold text-primary">
                  {statsLoading ? <Skeleton className="h-8 w-14" /> : gpa}
                </p>
                <p className="mt-2 text-xs text-muted-foreground">Current grade: {currentGrade || "--"}</p>
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
                  Study time: {formatMinutesToDuration(totalTimeSpent)}
                </p>
              </div>
              <div className="rounded-full bg-primary/10 p-3">
                <TrendingUp className="h-6 w-6 text-primary" />
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="grid grid-cols-1 gap-8 xl:grid-cols-3">
        <div className="space-y-8 xl:col-span-2">
          {/* Due Soon */}
          <section>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-semibold">Due Soon</h2>
              <Button variant="ghost" size="sm" className="text-primary" onClick={() => onSectionChange("assignments")}>Open all</Button>
            </div>

            {assignmentsErrorMessage ? (
              <ErrorCard title="Unable to load assignments" message={assignmentsErrorMessage} />
            ) : assignmentsLoading ? (
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
                        <Button size="sm" variant="outline" onClick={() => onStartAssignment(assignment)}>
                          {assignment.progress > 0 ? "Continue" : "Start"}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </section>

          {/* Weekly Schedule */}
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
                        <Button size="sm" variant="outline" onClick={() => onStartAssignment(assignment)}>Open</Button>
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
          {/* Awards */}
          <section>
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-xl font-semibold">Awards</h2>
              <Badge variant="outline">{awards.length}</Badge>
            </div>
            <Card className="border-0 bg-card shadow-sm">
              <CardContent className="space-y-4 p-5">
                {analyticsLoading ? (
                  Array.from({ length: 3 }).map((_, index) => (
                    <Skeleton key={index} className="h-16 w-full" />
                  ))
                ) : awards.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Released results will unlock awards and milestones here.</p>
                ) : (
                  awards.map((award) => (
                    <div key={award.id} className="rounded-lg border p-4">
                      <div className="flex items-start gap-3">
                        <div className="rounded-full bg-primary/10 p-2">
                          <Trophy className="h-4 w-4 text-primary" />
                        </div>
                        <div>
                          <p className="font-medium text-foreground">{award.title}</p>
                          <p className="text-sm text-muted-foreground">{award.description}</p>
                          <p className="mt-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                            {award.earnedAt ? `Earned ${award.earnedAt}` : 'Recently earned'}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </section>

          {/* Recent Activity */}
          <section>
            <h2 className="mb-4 text-xl font-semibold">Recent Activity</h2>
            <Card className="border-0 bg-card shadow-sm">
              <CardContent className="p-5">
                {activitiesErrorMessage ? (
                  <ErrorCard title="Unable to load recent activity" message={activitiesErrorMessage} />
                ) : activitiesLoading ? (
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

          {/* Announcements */}
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
                  markAllAnnouncementsReadPending
                }
                onClick={onMarkAllAnnouncementsRead}
              >
                {markAllAnnouncementsReadPending
                  ? "Marking..."
                  : `Mark all read${
                      unreadAnnouncementCount > 0 ? ` (${unreadAnnouncementCount})` : ""
                    }`}
              </Button>
            </div>
            <Card className="border-0 bg-card shadow-sm">
              <CardContent className="space-y-4 p-5">
                {announcementsErrorMessage ? (
                  <ErrorCard title="Unable to load announcements" message={announcementsErrorMessage} />
                ) : announcementsLoading ? (
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
                      onClick={() => onAnnouncementSelect(item)}
                      disabled={markAnnouncementReadPending}
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

import { CheckCircle2, Filter, Search } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"

import type { AssignmentCardData, AssignmentFilter, StudentNavSection } from "../types"
import { ASSIGNMENT_FILTER_LABELS } from "../constants"
import {
  formatDueDate,
  formatRelativeDueDate,
  getStatusBadgeVariant,
} from "../utils"

interface AssignmentsViewProps {
  filteredAssignments: AssignmentCardData[]
  totalAssignments: number
  actionableCount: number
  overdueCount: number
  completedAssignments: number
  assignmentsLoading: boolean
  assignmentsErrorMessage: string | null
  assignmentSearchTerm: string
  assignmentFilter: AssignmentFilter
  assignmentCardSpacingClass: string
  onSearchChange: (value: string) => void
  onFilterChange: (value: AssignmentFilter) => void
  onStartAssignment: (assignment: AssignmentCardData) => void
  onSectionChange: (section: StudentNavSection) => void
}

export default function AssignmentsView({
  filteredAssignments,
  totalAssignments,
  actionableCount,
  overdueCount,
  completedAssignments,
  assignmentsLoading,
  assignmentsErrorMessage,
  assignmentSearchTerm,
  assignmentFilter,
  assignmentCardSpacingClass,
  onSearchChange,
  onFilterChange,
  onStartAssignment,
  onSectionChange,
}: AssignmentsViewProps) {
  if (assignmentsErrorMessage) {
    return (
      <Card className="border-destructive/30 bg-destructive/5 shadow-sm">
        <CardContent className="space-y-2 p-6">
          <p className="font-semibold text-foreground">Unable to load assignments</p>
          <p className="text-sm text-muted-foreground">{assignmentsErrorMessage}</p>
        </CardContent>
      </Card>
    )
  }

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
              onChange={(event) => onSearchChange(event.target.value)}
              className="pl-9"
              placeholder="Search assignments"
            />
          </div>
          <Select value={assignmentFilter} onValueChange={(value) => onFilterChange(value as AssignmentFilter)}>
            <SelectTrigger className="sm:w-44">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(ASSIGNMENT_FILTER_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
            <p className="text-2xl font-bold">{actionableCount}</p>
          </CardContent>
        </Card>
        <Card className="border-0 bg-card shadow-sm">
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Overdue</p>
            <p className="text-2xl font-bold text-destructive">{overdueCount}</p>
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
                      <Button size="sm" variant="outline" onClick={() => onStartAssignment(assignment)}>
                        {assignment.progress > 0 ? "Continue" : "Start"}
                      </Button>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => onSectionChange("grades")}>
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

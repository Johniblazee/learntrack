import { PageShell } from "@/components/ui/page-shell"
import { StatsCards } from "../components/StatsCards"
import { PerformanceChart } from "../components/PerformanceChart"
import { SubjectPerformance } from "../components/SubjectPerformance"
import { AnalyticsSnapshot } from "../components/AnalyticsSnapshot"
import { RecentActivity } from "../components/RecentActivity"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { ArrowRight, CheckSquare, ClipboardList, GraduationCap, Library, Plus } from "lucide-react"
import { useUser } from "@clerk/clerk-react"
import { useUserContext } from "@/contexts/UserContext"
import { useImpersonation } from "@/contexts/ImpersonationContext"
import { useTutorWorkflowSummary } from "@/hooks/useQueries"

interface OverviewViewProps {
  dashboardStats: any
  loading: boolean
  onViewChange: (view: string) => void
}

export function OverviewView({ dashboardStats, loading, onViewChange }: OverviewViewProps) {
  const { user } = useUser()
  const { backendUser } = useUserContext()
  const { isImpersonating } = useImpersonation()
  const actorFirstName = user?.firstName || user?.fullName?.trim()?.split(" ")[0]
  const impersonatedFirstName = backendUser?.name?.trim()?.split(" ")[0]
  const firstName =
    (isImpersonating ? impersonatedFirstName : actorFirstName) ||
    impersonatedFirstName ||
    actorFirstName ||
    "there"
  const { data: workflowSummary, isLoading: workflowLoading } = useTutorWorkflowSummary()

  return (
    <div className="flex-1 overflow-y-auto">
      <PageShell>
        {/* Welcome Section */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-foreground mb-2">
              Welcome back, {firstName}!
            </h1>
            <p className="text-muted-foreground">
              Here's a summary of your classroom activity and student performance.
            </p>
          </div>
          <Button
            onClick={() => onViewChange("create-new")}
            className="bg-primary text-primary-foreground hover:bg-primary/90 flex-shrink-0"
            size="lg"
          >
            <Plus className="h-5 w-5 mr-2" />
            Create New Assignment
          </Button>
        </div>

        {/* Stats Cards */}
        <StatsCards dashboardStats={dashboardStats} loading={loading} />

        <Card className="border border-border bg-card shadow-sm">
          <CardHeader className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <CardTitle>MVP Workflow</CardTitle>
              <CardDescription>
                Use this path for pilot delivery: review questions, publish assignments, grade, then release results.
              </CardDescription>
            </div>
            <Badge variant="secondary" className="w-fit">Templates are optional for MVP</Badge>
          </CardHeader>
          <CardContent className="grid gap-4 xl:grid-cols-3">
            <div className="rounded-lg border border-border p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-foreground">1. Build Questions</p>
                  <p className="mt-1 text-sm text-muted-foreground">Generate drafts or add questions manually, review them, then publish approved questions into the bank.</p>
                </div>
                <CheckSquare className="h-5 w-5 text-primary" />
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {workflowLoading ? (
                  <Skeleton className="h-6 w-40" />
                ) : (
                  <>
                    <Badge variant="outline">{workflowSummary?.pendingReviewQuestions || 0} pending review</Badge>
                    <Badge variant="outline">{workflowSummary?.approvedQuestionsReadyToPublish || 0} approved to publish</Badge>
                  </>
                )}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => onViewChange("ai-generator")}>
                  Generate
                </Button>
                <Button size="sm" variant="outline" onClick={() => onViewChange("review-questions")}>
                  Review Questions
                </Button>
                <Button size="sm" onClick={() => onViewChange("question-bank")}>
                  <Library className="mr-2 h-4 w-4" />
                  Open Question Bank
                </Button>
              </div>
            </div>

            <div className="rounded-lg border border-border p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-foreground">2. Draft And Publish</p>
                  <p className="mt-1 text-sm text-muted-foreground">Turn approved questions into assignment drafts, then publish them only when recipients and rules are correct.</p>
                </div>
                <ClipboardList className="h-5 w-5 text-primary" />
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {workflowLoading ? (
                  <Skeleton className="h-6 w-28" />
                ) : (
                  <Badge variant="outline">{workflowSummary?.draftAssignments || 0} draft assignments</Badge>
                )}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => onViewChange("create-new")}>
                  <Plus className="mr-2 h-4 w-4" />
                  Create Draft
                </Button>
                <Button size="sm" onClick={() => onViewChange("active-assignments")}>
                  Manage Assignments
                </Button>
              </div>
            </div>

            <div className="rounded-lg border border-border p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-foreground">3. Grade And Release</p>
                  <p className="mt-1 text-sm text-muted-foreground">Review submitted work, finalize manual scores, then release results to students and parents.</p>
                </div>
                <GraduationCap className="h-5 w-5 text-primary" />
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {workflowLoading ? (
                  <Skeleton className="h-6 w-40" />
                ) : (
                  <>
                    <Badge variant="outline">{workflowSummary?.submissionsNeedingReview || 0} needing review</Badge>
                    <Badge variant="outline">{workflowSummary?.submissionsReadyToRelease || 0} ready to release</Badge>
                  </>
                )}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button size="sm" onClick={() => onViewChange("grading")}>
                  <ArrowRight className="mr-2 h-4 w-4" />
                  Open Grading Center
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Question Generation Analytics */}
        <AnalyticsSnapshot />

        {/* Charts Section */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <PerformanceChart />
          </div>
          <div className="lg:col-span-1">
            <SubjectPerformance />
          </div>
        </div>

        {/* Recent Activity */}
        <RecentActivity />
      </PageShell>
    </div>
  )
}

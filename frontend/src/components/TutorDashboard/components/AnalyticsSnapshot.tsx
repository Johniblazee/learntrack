import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Sparkles, BarChart3, BookOpen } from "lucide-react"
import { useGenerationStats, useAllGeneratedQuestions } from "@/hooks/useQueries"

export function AnalyticsSnapshot() {
  const { data: generationStats, isLoading: statsLoading } = useGenerationStats()
  const { data: allQuestions, isLoading: questionsLoading } = useAllGeneratedQuestions()

  const isLoading = statsLoading || questionsLoading
  const questions = (allQuestions || []) as Array<{ status?: string; subject?: string }>

  const approvalRate = generationStats
    ? (generationStats.approved_questions + generationStats.rejected_questions) > 0
      ? (generationStats.approved_questions / (generationStats.approved_questions + generationStats.rejected_questions)) * 100
      : 0
    : 0

  const statusBreakdown: Record<string, number> = {}
  for (const q of questions) {
    const s = (q.status || 'pending').toLowerCase()
    statusBreakdown[s] = (statusBreakdown[s] || 0) + 1
  }

  const subjectCounts: Record<string, number> = {}
  for (const q of questions) {
    const s = q.subject || 'Uncategorized'
    subjectCounts[s] = (subjectCounts[s] || 0) + 1
  }
  const topSubjects = Object.entries(subjectCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)

  return (
    <Card className="border-0 shadow-sm bg-card">
      <CardHeader className="border-b border-border">
        <CardTitle className="flex items-center text-foreground">
          <Sparkles className="w-5 h-5 mr-2 text-primary" />
          Question Generation Analytics
        </CardTitle>
        <CardDescription className="text-muted-foreground">
          AI question generation stats, review status breakdown, and top subjects.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-6 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          <Card className="border-0 shadow-sm bg-card">
            <CardContent className="p-5">
              <p className="text-sm text-muted-foreground">Total Generated</p>
              <p className="text-3xl font-bold text-foreground mt-1">
                {isLoading ? <Skeleton className="h-9 w-16" /> : (generationStats?.total_generated ?? questions.length)}
              </p>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm bg-card">
            <CardContent className="p-5">
              <p className="text-sm text-muted-foreground">This Month</p>
              <p className="text-3xl font-bold text-foreground mt-1">
                {isLoading ? <Skeleton className="h-9 w-16" /> : (generationStats?.this_month ?? 0)}
              </p>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm bg-card">
            <CardContent className="p-5">
              <p className="text-sm text-muted-foreground">Approval Rate</p>
              <p className="text-3xl font-bold text-foreground mt-1">
                {isLoading ? <Skeleton className="h-9 w-16" /> : `${approvalRate.toFixed(1)}%`}
              </p>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm bg-card">
            <CardContent className="p-5">
              <p className="text-sm text-muted-foreground">Session Success Rate</p>
              <p className="text-3xl font-bold text-foreground mt-1">
                {isLoading ? <Skeleton className="h-9 w-16" /> : `${generationStats?.success_rate?.toFixed(1) ?? '0.0'}%`}
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <Card className="border-0 shadow-sm bg-card">
            <CardHeader className="border-b border-border">
              <CardTitle className="flex items-center text-foreground">
                <BarChart3 className="w-5 h-5 mr-2 text-primary" />
                Status Breakdown
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              {isLoading ? (
                <div className="space-y-3">
                  {Array.from({ length: 4 }).map((_, index) => (
                    <Skeleton key={index} className="h-10 w-full" />
                  ))}
                </div>
              ) : Object.keys(statusBreakdown).length === 0 ? (
                <p className="text-sm text-muted-foreground">No review activity yet.</p>
              ) : (
                <div className="space-y-3">
                  {Object.entries(statusBreakdown)
                    .sort((a, b) => b[1] - a[1])
                    .map(([status, count]) => (
                      <div key={status} className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
                        <span className="text-sm font-medium capitalize text-foreground">
                          {status.replace('-', ' ')}
                        </span>
                        <Badge variant="secondary">{count}</Badge>
                      </div>
                    ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm bg-card">
            <CardHeader className="border-b border-border">
              <CardTitle className="flex items-center text-foreground">
                <BookOpen className="w-5 h-5 mr-2 text-primary" />
                Top Subjects
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              {isLoading ? (
                <div className="space-y-3">
                  {Array.from({ length: 4 }).map((_, index) => (
                    <Skeleton key={index} className="h-10 w-full" />
                  ))}
                </div>
              ) : topSubjects.length === 0 ? (
                <p className="text-sm text-muted-foreground">No subject data available yet.</p>
              ) : (
                <div className="space-y-3">
                  {topSubjects.map(([subject, count]) => (
                    <div key={subject} className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
                      <span className="text-sm font-medium text-foreground">{subject}</span>
                      <Badge variant="outline" className="border-border">{count} questions</Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </CardContent>
    </Card>
  )
}

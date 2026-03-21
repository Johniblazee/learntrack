import { PageShell } from "@/components/ui/page-shell"
import { StatsCards } from "../components/StatsCards"
import { PerformanceChart } from "../components/PerformanceChart"
import { SubjectPerformance } from "../components/SubjectPerformance"
import { AnalyticsSnapshot } from "../components/AnalyticsSnapshot"
import { RecentActivity } from "../components/RecentActivity"
import { Button } from "@/components/ui/button"
import { Plus } from "lucide-react"
import { useUser } from "@clerk/clerk-react"
import { useUserContext } from "@/contexts/UserContext"
import { useImpersonation } from "@/contexts/ImpersonationContext"

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

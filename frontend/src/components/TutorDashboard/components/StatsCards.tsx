import { Card, CardContent } from "@/components/ui/card"
import { Users, FileText, BarChart3, TrendingUp } from "lucide-react"
import { LucideIcon } from "lucide-react"

interface StatsCardsProps {
  dashboardStats: {
    total_students?: number
    active_assignments?: number
    avg_performance?: number
    engagement_rate?: number
  } | null | undefined
  loading: boolean
  error?: Error | null
}

interface StatCard {
  title: string
  value: string
  subtitle: string
  subtitleColor: string
  icon: LucideIcon
  hasData: boolean
}

export function StatsCards({ dashboardStats, loading, error }: StatsCardsProps) {
  // Check if we have actual data (not just default/empty values)
  const hasData = dashboardStats !== null && dashboardStats !== undefined
  const hasError = !loading && !!error

  const errorSubtitle = hasError ? (error?.message || "Failed to load") : "No data"
  const errorColor = hasError ? "text-destructive" : "text-muted-foreground/50"

  const stats: StatCard[] = [
    {
      title: "Total Students",
      value: hasData && dashboardStats.total_students !== undefined
        ? dashboardStats.total_students.toString()
        : "--",
      subtitle: hasData ? "Active students" : errorSubtitle,
      subtitleColor: hasData ? "text-muted-foreground" : errorColor,
      icon: Users,
      hasData: hasData && dashboardStats.total_students !== undefined
    },
    {
      title: "Active Assignments",
      value: hasData && dashboardStats.active_assignments !== undefined
        ? dashboardStats.active_assignments.toString()
        : "--",
      subtitle: hasData ? "Currently active" : errorSubtitle,
      subtitleColor: hasData ? "text-muted-foreground" : errorColor,
      icon: FileText,
      hasData: hasData && dashboardStats.active_assignments !== undefined
    },
    {
      title: "Average Performance",
      value: hasData && dashboardStats.avg_performance !== undefined
        ? `${dashboardStats.avg_performance}%`
        : "--%",
      subtitle: hasData ? "Class average" : errorSubtitle,
      subtitleColor: hasData ? "text-muted-foreground" : errorColor,
      icon: BarChart3,
      hasData: hasData && dashboardStats.avg_performance !== undefined
    },
    {
      title: "Engagement Rate",
      value: hasData && dashboardStats.engagement_rate !== undefined
        ? `${dashboardStats.engagement_rate}%`
        : "--%",
      subtitle: hasData ? "Last 7 days" : errorSubtitle,
      subtitleColor: hasData ? "text-muted-foreground" : errorColor,
      icon: TrendingUp,
      hasData: hasData && dashboardStats.engagement_rate !== undefined
    }
  ]

  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Card key={index} className="border border-border bg-card">
            <CardContent className="p-6">
              <div className="animate-pulse">
                <div className="h-10 w-10 bg-muted rounded-lg mb-4"></div>
                <div className="h-4 bg-muted rounded w-3/4 mb-2"></div>
                <div className="h-8 bg-muted rounded w-1/2 mb-2"></div>
                <div className="h-3 bg-muted rounded w-2/3"></div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {stats.map((stat, index) => {
        const IconComponent = stat.icon
        return (
          <Card key={index} className="border-0 shadow-sm bg-card">
            <CardContent className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="h-10 w-10 bg-primary/10 rounded-lg flex items-center justify-center flex-shrink-0">
                  <IconComponent className="h-5 w-5 text-primary" />
                </div>
                <p className="text-sm font-medium text-muted-foreground">{stat.title}</p>
              </div>
              <div>
                <p className="text-4xl font-bold text-foreground mb-2">{stat.value}</p>
                <p className={`text-sm font-medium ${stat.subtitleColor}`}>{stat.subtitle}</p>
              </div>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}


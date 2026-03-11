import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Award, TrendingUp, TrendingDown, Users } from "lucide-react"
import { useTopPerformers } from "@/hooks/useQueries"

// Color palette for avatars
const avatarColors = [
  { bgColor: "bg-blue-100", textColor: "text-blue-600" },
  { bgColor: "bg-green-100", textColor: "text-green-600" },
  { bgColor: "bg-purple-100", textColor: "text-purple-600" },
  { bgColor: "bg-orange-100", textColor: "text-orange-600" },
]

export function TopPerformers() {
  const { data: performers, isLoading } = useTopPerformers()

  // Loading state
  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Award className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold text-foreground">Top Performers This Week</h2>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Card key={index} className="border border-border bg-card">
              <CardContent className="p-6">
                <div className="animate-pulse">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="h-10 w-10 bg-muted rounded-full"></div>
                    <div className="flex-1">
                      <div className="h-4 bg-muted rounded w-3/4 mb-2"></div>
                      <div className="h-3 bg-muted rounded w-1/2"></div>
                    </div>
                  </div>
                  <div className="h-8 bg-muted rounded w-1/3"></div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    )
  }

  // Empty state
  if (!performers || performers.length === 0) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Award className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold text-foreground">Top Performers This Week</h2>
          </div>
        </div>
        <Card className="border border-border bg-card">
          <CardContent className="p-8 text-center">
            <Users className="h-12 w-12 text-muted-foreground/50 mx-auto mb-3" />
            <p className="text-muted-foreground">No performance data yet</p>
            <p className="text-sm text-muted-foreground/70 mt-1">
              Top performers will appear here once students complete assignments
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Award className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold text-foreground">Top Performers This Week</h2>
        </div>
        <Button variant="ghost" size="sm" className="text-primary hover:text-primary/80">
          View All
        </Button>
      </div>

      {/* Performer Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {performers.map((performer, index) => {
          const colors = avatarColors[index % avatarColors.length]
          const isUpTrend = performer.trend === "up" || performer.trend?.startsWith("+")
          const isSteadyTrend = performer.trend === "steady"

          return (
            <Card key={index} className="border border-border bg-card hover:shadow-md transition-shadow">
              <CardContent className="p-6">
                <div className="flex items-center gap-3 mb-4">
                  <Avatar className={`h-10 w-10 ${colors.bgColor} dark:bg-opacity-30`}>
                    <AvatarFallback className={colors.textColor}>
                      {performer.avatar || performer.name?.slice(0, 2).toUpperCase() || "??"}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-foreground text-sm truncate">{performer.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{performer.subject}</p>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-3xl font-bold text-foreground">{performer.score}%</span>
                  <Badge
                    variant="outline"
                    className={
                      isUpTrend
                        ? "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-700"
                        : isSteadyTrend
                          ? "bg-slate-50 dark:bg-slate-900/30 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700"
                          : "bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 border-red-200 dark:border-red-700"
                    }
                  >
                    {isUpTrend ? <TrendingUp className="h-3 w-3 mr-1" /> : isSteadyTrend ? null : <TrendingDown className="h-3 w-3 mr-1" />}
                    {performer.trend}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}

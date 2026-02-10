import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { CheckCircle2, UserPlus, FileText, Clock, Activity } from "lucide-react"
import { useRecentActivity } from "@/hooks/useQueries"
import { formatDistanceToNow } from "date-fns"

// Helper to format time
function formatActivityTime(createdAt: string | undefined, time: string | undefined): string {
  if (createdAt) {
    try {
      return formatDistanceToNow(new Date(createdAt), { addSuffix: true })
    } catch {
      return time || "Recently"
    }
  }
  return time || "Recently"
}

// Helper to get icon and colors based on activity type
function getActivityStyle(type: string) {
  switch (type) {
    case "submitted":
    case "completed":
      return {
        Icon: CheckCircle2,
        iconBg: "bg-green-50 dark:bg-green-950/30",
        iconColor: "text-green-600 dark:text-green-400"
      }
    case "enrolled":
    case "joined":
      return {
        Icon: UserPlus,
        iconBg: "bg-blue-50 dark:bg-blue-950/30",
        iconColor: "text-blue-600 dark:text-blue-400"
      }
    default:
      return {
        Icon: FileText,
        iconBg: "bg-gray-50 dark:bg-gray-950/30",
        iconColor: "text-gray-600 dark:text-gray-400"
      }
  }
}

export function RecentActivity() {
  const { data: activities, isLoading } = useRecentActivity(5)

  // Loading state
  if (isLoading) {
    return (
      <Card className="border-0 shadow-sm bg-card">
        <CardHeader>
          <CardTitle className="text-lg font-semibold text-foreground">Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="flex items-start gap-3 animate-pulse">
                <div className="h-10 w-10 bg-muted rounded-full flex-shrink-0"></div>
                <div className="flex-1">
                  <div className="h-4 bg-muted rounded w-3/4 mb-2"></div>
                  <div className="h-3 bg-muted rounded w-1/4"></div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    )
  }

  // Empty state
  if (!activities || activities.length === 0) {
    return (
      <Card className="border-0 shadow-sm bg-card">
        <CardHeader>
          <CardTitle className="text-lg font-semibold text-foreground">Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-6">
            <Activity className="h-12 w-12 text-muted-foreground/50 mx-auto mb-3" />
            <p className="text-muted-foreground">No recent activity</p>
            <p className="text-sm text-muted-foreground/70 mt-1">
              Student activities will appear here
            </p>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="border-0 shadow-sm bg-card">
      <CardHeader>
        <CardTitle className="text-lg font-semibold text-foreground">Recent Activity</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {activities.map((activity, index) => {
            const { Icon, iconBg, iconColor } = getActivityStyle(activity.type)
            const timeDisplay = formatActivityTime(activity.created_at, activity.time)

            return (
              <div key={index} className="flex items-start gap-3">
                <div className={`h-10 w-10 ${iconBg} rounded-full flex items-center justify-center flex-shrink-0`}>
                  <Icon className={`h-5 w-5 ${iconColor}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-foreground">
                    <span className="font-medium">{activity.student}</span> {activity.action}{" "}
                    <span className="text-primary font-medium">{activity.assignment}</span>.
                  </p>
                  <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {timeDisplay}
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}





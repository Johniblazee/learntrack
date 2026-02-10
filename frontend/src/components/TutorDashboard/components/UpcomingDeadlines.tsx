import { useEffect, useState } from 'react'
import { Badge } from "@/components/ui/badge"
import { Clock } from "lucide-react"
import { useApiClient } from "@/lib/api-client"

interface Deadline {
  id: string
  title: string
  subject: string
  dueDate: string  // Will be "Today", "Tomorrow", or "Dec 28" format
  urgency: string  // "high", "medium", "low"
  completed: number
  total: number
}

export function UpcomingDeadlines() {
  const [deadlines, setDeadlines] = useState<Deadline[]>([])
  const [loading, setLoading] = useState(true)
  const client = useApiClient()

  useEffect(() => {
    const fetchDeadlines = async () => {
      try {
        setLoading(true)
        const response = await client.get('/dashboard/upcoming-deadlines?limit=5')

        if (response.error) {
          throw new Error(response.error)
        }

        // Map backend response to frontend format
        const deadlinesData = ((response.data as any[]) || []).map((item: any) => ({
          id: item.id,
          title: item.title,
          subject: item.subject_name || 'General',
          dueDate: item.date_label,  // Backend provides "Today", "Tomorrow", "Dec 28"
          urgency: item.urgency,      // Backend provides "high", "medium", "low"
          completed: item.completion_count || 0,
          total: item.student_count || 0
        }))

        setDeadlines(deadlinesData)
      } catch (err: any) {
        console.error('Failed to fetch deadlines:', err)
        // Don't show error toast to avoid annoying users
      } finally {
        setLoading(false)
      }
    }

    fetchDeadlines()

    // Refresh every 5 minutes to keep dates current
    const interval = setInterval(fetchDeadlines, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [])

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 px-1">
          <div className="h-8 w-8 bg-primary/10 rounded-lg flex items-center justify-center">
            <Clock className="h-4 w-4 text-primary" />
          </div>
          <h3 className="text-sm font-semibold text-foreground">Upcoming Deadlines</h3>
        </div>
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-card border border-border rounded-lg p-3 animate-pulse">
              <div className="h-4 bg-muted rounded w-3/4 mb-2"></div>
              <div className="h-3 bg-muted rounded w-1/2"></div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2 px-1">
        <div className="h-8 w-8 bg-primary/10 rounded-lg flex items-center justify-center">
          <Clock className="h-4 w-4 text-primary" />
        </div>
        <h3 className="text-sm font-semibold text-foreground">Upcoming Deadlines</h3>
      </div>

      {/* Deadline Items */}
      <div className="space-y-2">
        {deadlines.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            No upcoming deadlines
          </p>
        ) : (
          deadlines.map((deadline) => {
            const percentage = deadline.total > 0
              ? Math.round((deadline.completed / deadline.total) * 100)
              : 0
            return (
              <div
                key={deadline.id}
                className="bg-card border border-border rounded-lg p-3 hover:shadow-sm hover:border-primary/20 transition-all cursor-pointer group"
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <p className="font-medium text-foreground text-xs line-clamp-1 group-hover:text-primary transition-colors">
                    {deadline.title}
                  </p>
                  <Badge
                    variant={deadline.urgency === "high" ? "destructive" : "secondary"}
                    className="text-[10px] px-1.5 py-0.5 h-auto shrink-0"
                  >
                    {deadline.dueDate}
                  </Badge>
                </div>
                <p className="text-[10px] text-muted-foreground mb-2">{deadline.subject}</p>
                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-muted-foreground">
                    {deadline.completed}/{deadline.total} completed
                  </span>
                  <span className={`font-medium ${
                    percentage < 50 ? 'text-destructive' :
                    percentage >= 75 ? 'text-emerald-600 dark:text-emerald-400' :
                    'text-amber-600 dark:text-amber-400'
                  }`}>
                    {percentage}%
                  </span>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}


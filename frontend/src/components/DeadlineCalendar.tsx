import { useState, useEffect } from 'react'
import { Calendar } from '@/components/ui/calendar'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useApiClient } from '@/lib/api-client'
import { CalendarDays } from 'lucide-react'

export function DeadlineCalendar() {
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(new Date())
  const [assignments, setAssignments] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const client = useApiClient()

  useEffect(() => {
    const fetchAssignments = async () => {
      try {
        setLoading(true)
        const response = await client.get('/assignments/')
        
        if (response.error) {
          throw new Error(response.error)
        }

        setAssignments((response.data as any[]) || [])
      } catch (err: any) {
        console.error('Failed to fetch assignments:', err)
        // Don't show error toast to avoid annoying users
      } finally {
        setLoading(false)
      }
    }

    fetchAssignments()
    
    // Refresh every 5 minutes
    const interval = setInterval(fetchAssignments, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [])

  // Get assignments for selected date
  const selectedDateAssignments = assignments.filter(assignment => {
    if (!assignment.due_date || !selectedDate) return false
    const dueDate = new Date(assignment.due_date)
    const selected = new Date(selectedDate)
    return dueDate.toDateString() === selected.toDateString()
  })

  // Get dates with deadlines for highlighting
  const datesWithDeadlines = assignments
    .filter(a => a.due_date)
    .map(a => new Date(a.due_date))

  return (
    <Card className="border-0 shadow-sm bg-card">
      <CardHeader>
        <CardTitle className="text-lg font-semibold text-foreground flex items-center gap-2">
          <CalendarDays className="h-5 w-5" />
          Assignment Calendar
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="space-y-4">
            {/* Calendar skeleton */}
            <div className="rounded-md border border-border p-4 animate-pulse">
              {/* Month/Year header skeleton */}
              <div className="flex items-center justify-between mb-4">
                <div className="h-5 w-5 bg-muted rounded"></div>
                <div className="h-5 w-32 bg-muted rounded"></div>
                <div className="h-5 w-5 bg-muted rounded"></div>
              </div>
              {/* Days of week header skeleton */}
              <div className="grid grid-cols-7 gap-1 mb-2">
                {Array.from({ length: 7 }).map((_, i) => (
                  <div key={i} className="h-4 bg-muted rounded mx-auto w-6"></div>
                ))}
              </div>
              {/* Calendar grid skeleton */}
              <div className="grid grid-cols-7 gap-1">
                {Array.from({ length: 35 }).map((_, i) => (
                  <div key={i} className="aspect-square bg-muted rounded-full mx-auto w-8"></div>
                ))}
              </div>
            </div>
            {/* Date details skeleton */}
            <div className="space-y-2">
              <div className="h-4 w-48 bg-muted rounded animate-pulse"></div>
              <div className="p-3 bg-muted/50 rounded-md border border-border animate-pulse">
                <div className="h-4 w-3/4 bg-muted rounded mb-2"></div>
                <div className="h-3 w-1/2 bg-muted rounded"></div>
              </div>
            </div>
          </div>
        ) : (
          <>
            <Calendar
              mode="single"
              selected={selectedDate}
              onSelect={setSelectedDate}
              modifiers={{
                deadline: datesWithDeadlines
              }}
              modifiersClassNames={{
                deadline: 'bg-primary/20 font-bold text-primary'
              }}
              className="rounded-md border border-border"
            />

            {/* Show assignments for selected date */}
            {selectedDate && (
              <div className="space-y-2">
                <h4 className="font-semibold text-sm text-foreground">
                  {selectedDate.toLocaleDateString('en-US', { 
                    weekday: 'long', 
                    year: 'numeric', 
                    month: 'long', 
                    day: 'numeric' 
                  })}
                </h4>
                {selectedDateAssignments.length > 0 ? (
                  <div className="space-y-2">
                    {selectedDateAssignments.map(assignment => (
                      <div key={assignment._id} className="p-3 bg-muted/50 rounded-md border border-border hover:bg-muted transition-colors">
                        <p className="font-medium text-sm text-foreground">{assignment.title}</p>
                        <div className="flex items-center justify-between mt-1">
                          <p className="text-xs text-muted-foreground">
                            {assignment.subject_id?.name || 'General'}
                          </p>
                          <Badge variant="secondary" className="text-xs">
                            {new Date(assignment.due_date).toLocaleTimeString('en-US', { 
                              hour: 'numeric', 
                              minute: '2-digit',
                              hour12: true 
                            })}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-4 bg-muted/30 rounded-md">
                    No assignments due on this date
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}


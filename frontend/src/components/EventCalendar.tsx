import { Calendar, ChevronLeft, ChevronRight } from "lucide-react"
import { useState, useEffect } from "react"
import { useApiClient } from "@/lib/api-client"

interface Event {
  id: string
  title: string
  date: string
  time: string
  type: "assignment" | "meeting" | "deadline"
}

interface EventCalendarProps {
  events?: Event[]
  isLoading?: boolean
}

const EventCalendar = ({ events: propEvents, isLoading: propLoading }: EventCalendarProps) => {
  const [currentDate, setCurrentDate] = useState(new Date())
  const [events, setEvents] = useState<Event[]>([])
  const [loading, setLoading] = useState(true)
  const client = useApiClient()

  useEffect(() => {
    // If events are provided via props, use those
    if (propEvents && propEvents.length > 0) {
      setEvents(propEvents)
      setLoading(false)
      return
    }

    // Otherwise, fetch from backend
    const fetchEvents = async () => {
      try {
        setLoading(true)
        const response = await client.get('/assignments/')

        if (response.error) {
          throw new Error(response.error)
        }

        // Convert assignments to events
        const assignmentEvents: Event[] = ((response.data as any[]) || [])
          .filter((assignment: any) => assignment.due_date)
          .map((assignment: any) => ({
            id: assignment._id,
            title: assignment.title,
            date: new Date(assignment.due_date).toISOString().split('T')[0],
            time: new Date(assignment.due_date).toLocaleTimeString('en-US', {
              hour: 'numeric',
              minute: '2-digit',
              hour12: true
            }),
            type: 'deadline' as const
          }))

        setEvents(assignmentEvents)
      } catch (err: any) {
        console.error('Failed to fetch events:', err)
        // Don't show error toast to avoid annoying users
      } finally {
        setLoading(false)
      }
    }

    fetchEvents()

    // Refresh every 5 minutes
    const interval = setInterval(fetchEvents, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [propEvents])

  const getEventColor = (type: string) => {
    switch (type) {
      case "assignment":
        return "bg-blue-100 dark:bg-blue-900/30 border-l-4 border-blue-500"
      case "meeting":
        return "bg-purple-100 dark:bg-purple-900/30 border-l-4 border-purple-500"
      case "deadline":
        return "bg-amber-100 dark:bg-amber-900/30 border-l-4 border-amber-500"
      default:
        return "bg-gray-100 dark:bg-gray-900/30 border-l-4 border-gray-500"
    }
  }

  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ]

  const navigateMonth = (direction: 'prev' | 'next') => {
    setCurrentDate(prev => {
      const newDate = new Date(prev)
      if (direction === 'prev') {
        newDate.setMonth(prev.getMonth() - 1)
      } else {
        newDate.setMonth(prev.getMonth() + 1)
      }
      return newDate
    })
  }

  // Filter events for current month
  const currentMonthEvents = events.filter(event => {
    const eventDate = new Date(event.date)
    return eventDate.getMonth() === currentDate.getMonth() &&
           eventDate.getFullYear() === currentDate.getFullYear()
  })

  const isLoading = propLoading !== undefined ? propLoading : loading

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      {/* Calendar Header */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold flex items-center gap-2 text-foreground">
          <Calendar className="w-5 h-5" />
          Events
        </h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigateMonth('prev')}
            className="p-1 hover:bg-muted rounded"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-sm font-medium min-w-[120px] text-center text-foreground">
            {monthNames[currentDate.getMonth()]} {currentDate.getFullYear()}
          </span>
          <button
            onClick={() => navigateMonth('next')}
            className="p-1 hover:bg-muted rounded"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Events List */}
      <div className="space-y-3">
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-muted rounded-md p-3 animate-pulse">
                <div className="h-4 bg-muted-foreground/20 rounded w-2/3 mb-2"></div>
                <div className="h-3 bg-muted-foreground/20 rounded w-1/2"></div>
              </div>
            ))}
          </div>
        ) : currentMonthEvents.length > 0 ? (
          currentMonthEvents
            .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
            .map((event) => (
              <div
                key={event.id}
                className={`${getEventColor(event.type)} rounded-md p-3 hover:shadow-sm transition-shadow cursor-pointer`}
              >
                <h3 className="font-medium text-foreground text-sm">{event.title}</h3>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-xs text-muted-foreground">
                    {new Date(event.date).toLocaleDateString()}
                  </span>
                  <span className="text-xs text-muted-foreground">{event.time}</span>
                </div>
              </div>
            ))
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            <Calendar className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No events scheduled for {monthNames[currentDate.getMonth()]}</p>
          </div>
        )}
      </div>
    </div>
  )
}

export default EventCalendar

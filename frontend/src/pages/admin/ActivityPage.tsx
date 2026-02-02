import React, { useEffect, useState, useCallback } from 'react'
import { useAuth } from '@clerk/clerk-react'
import { 
  Activity, 
  RefreshCw, 
  Search, 
  ChevronLeft, 
  ChevronRight, 
  Calendar,
  Filter,
  Clock,
  User,
  FileText,
  CheckCircle,
  XCircle,
  AlertCircle
} from 'lucide-react'
import { API_BASE_URL } from '@/lib/config'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Calendar as CalendarComponent } from '@/components/ui/calendar'
import { format, subDays } from 'date-fns'

interface ActivityLog {
  id: string
  timestamp: string
  user_id: string
  user_email: string
  user_name: string
  action: string
  method: string
  resource: string
  resource_id?: string
  status_code: number
  duration_ms: number
  ip_address: string
  user_agent: string
  tenant_id?: string
  details?: Record<string, any>
}

interface ActivityFilters {
  action?: string
  method?: string
  resource?: string
  user_id?: string
  status_code?: number
  from_date?: Date
  to_date?: Date
}

const methodColors: Record<string, string> = {
  GET: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  POST: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  PUT: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  PATCH: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
  DELETE: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  LOGIN: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
  LOGOUT: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400',
}

const statusColors: Record<string, string> = {
  success: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  error: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  warning: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
}

export function ActivityPage() {
  const { getToken } = useAuth()
  const [activities, setActivities] = useState<ActivityLog[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [perPage] = useState(20)
  const [totalPages, setTotalPages] = useState(1)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filters, setFilters] = useState<ActivityFilters>({})
  const [fromDate, setFromDate] = useState<Date | undefined>(subDays(new Date(), 7))
  const [toDate, setToDate] = useState<Date | undefined>(new Date())

  const fetchActivities = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)
      const token = await getToken()
      
      const params = new URLSearchParams({ 
        page: page.toString(), 
        per_page: perPage.toString(),
        days: '30'
      })
      
      if (filters.action) params.append('action', filters.action)
      if (filters.method) params.append('method', filters.method)
      if (filters.resource) params.append('resource', filters.resource)
      if (filters.user_id) params.append('user_id', filters.user_id)
      if (fromDate) params.append('from_date', fromDate.toISOString())
      if (toDate) params.append('to_date', toDate.toISOString())

      const response = await fetch(`${API_BASE_URL}/admin/activity?${params}`, {
        headers: { 
          'Authorization': `Bearer ${token}`, 
          'Content-Type': 'application/json' 
        }
      })

      if (!response.ok) {
        throw new Error(`Failed to fetch activities: ${response.status}`)
      }

      const data = await response.json()
      setActivities(data.activities || [])
      setTotal(data.total || 0)
      setTotalPages(data.total_pages || 1)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setIsLoading(false)
    }
  }, [getToken, page, perPage, filters, fromDate, toDate])

  useEffect(() => {
    fetchActivities()
  }, [fetchActivities])

  const handleFilterChange = (key: keyof ActivityFilters, value: string | undefined) => {
    setFilters(prev => ({ ...prev, [key]: value }))
    setPage(1)
  }

  const clearFilters = () => {
    setFilters({})
    setFromDate(subDays(new Date(), 7))
    setToDate(new Date())
    setPage(1)
  }

  const getStatusFromCode = (code: number): string => {
    if (code >= 200 && code < 300) return 'success'
    if (code >= 400 && code < 500) return 'warning'
    return 'error'
  }

  const formatDuration = (ms: number): string => {
    if (ms < 1000) return `${ms}ms`
    return `${(ms / 1000).toFixed(2)}s`
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-wrap justify-between items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary/10 rounded-lg">
            <Activity className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Activity</h1>
            <p className="text-muted-foreground">User actions across the system (audit trail). Only authenticated requests are recorded.</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={fetchActivities}
            disabled={isLoading}
            className="flex items-center gap-2"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-4 items-end">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">Action (e.g. GET, POST)</label>
              <Input
                placeholder="Filter by action..."
                value={filters.method || ''}
                onChange={(e) => handleFilterChange('method', e.target.value || undefined)}
                className="w-48"
              />
            </div>
            
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">Resource</label>
              <Input
                placeholder="e.g. users, ai"
                value={filters.resource || ''}
                onChange={(e) => handleFilterChange('resource', e.target.value || undefined)}
                className="w-40"
              />
            </div>
            
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">From date</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className="w-48 justify-start text-left font-normal"
                  >
                    <Calendar className="mr-2 h-4 w-4" />
                    {fromDate ? format(fromDate, 'PPP') : 'From date'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <CalendarComponent
                    mode="single"
                    selected={fromDate}
                    onSelect={setFromDate}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>
            
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">To date</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className="w-48 justify-start text-left font-normal"
                  >
                    <Calendar className="mr-2 h-4 w-4" />
                    {toDate ? format(toDate, 'PPP') : 'To date'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <CalendarComponent
                    mode="single"
                    selected={toDate}
                    onSelect={setToDate}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>
            
            <Button
              onClick={fetchActivities}
              className="flex items-center gap-2"
            >
              <Filter className="w-4 h-4" />
              Apply
            </Button>
            
            <Button
              variant="outline"
              onClick={clearFilters}
            >
              Reset
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Activity Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-muted/50 border-b">
                <tr>
                  <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground text-sm">Time</th>
                  <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground text-sm">User</th>
                  <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground text-sm">Action</th>
                  <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground text-sm">Resource</th>
                  <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground text-sm">Status</th>
                  <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground text-sm">Duration</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {isLoading ? (
                  [...Array(5)].map((_, i) => (
                    <tr key={i}>
                      <td className="p-4"><Skeleton className="h-4 w-24" /></td>
                      <td className="p-4"><Skeleton className="h-4 w-32" /></td>
                      <td className="p-4"><Skeleton className="h-4 w-16" /></td>
                      <td className="p-4"><Skeleton className="h-4 w-28" /></td>
                      <td className="p-4"><Skeleton className="h-4 w-20" /></td>
                      <td className="p-4"><Skeleton className="h-4 w-12" /></td>
                    </tr>
                  ))
                ) : activities.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-8 text-center">
                      <Activity className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                      <p className="text-muted-foreground">No activity recorded yet</p>
                    </td>
                  </tr>
                ) : (
                  activities.map((activity) => (
                    <tr key={activity.id} className="hover:bg-muted/50 transition-colors">
                      <td className="p-4 text-sm">
                        <div className="flex items-center gap-2">
                          <Clock className="w-3 h-3 text-muted-foreground" />
                          {format(new Date(activity.timestamp), 'MMM d, yyyy HH:mm')}
                        </div>
                      </td>
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-xs font-medium">
                            {activity.user_name?.[0] || 'U'}
                          </div>
                          <div className="text-sm">
                            <p className="font-medium">{activity.user_name}</p>
                            <p className="text-xs text-muted-foreground">{activity.user_email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="p-4">
                        <Badge 
                          variant="secondary" 
                          className={methodColors[activity.method] || methodColors.GET}
                        >
                          {activity.method}
                        </Badge>
                      </td>
                      <td className="p-4 text-sm">
                        <div className="flex items-center gap-2">
                          <FileText className="w-3 h-3 text-muted-foreground" />
                          <span className="font-medium">{activity.resource}</span>
                          {activity.resource_id && (
                            <span className="text-xs text-muted-foreground">
                              ({activity.resource_id.slice(0, 8)}...)
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="p-4">
                        <Badge 
                          variant="secondary" 
                          className={statusColors[getStatusFromCode(activity.status_code)]}
                        >
                          {getStatusFromCode(activity.status_code) === 'success' && <CheckCircle className="w-3 h-3 mr-1" />}
                          {getStatusFromCode(activity.status_code) === 'error' && <XCircle className="w-3 h-3 mr-1" />}
                          {getStatusFromCode(activity.status_code) === 'warning' && <AlertCircle className="w-3 h-3 mr-1" />}
                          {activity.status_code}
                        </Badge>
                      </td>
                      <td className="p-4 text-sm text-muted-foreground">
                        {formatDuration(activity.duration_ms)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && !isLoading && (
            <div className="px-6 py-4 border-t flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Showing {(page - 1) * perPage + 1} to {Math.min(page * perPage, total)} of {total}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setPage(p => p - 1)}
                  disabled={page === 1}
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <span className="text-sm">
                  Page {page} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setPage(p => p + 1)}
                  disabled={page === totalPages}
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

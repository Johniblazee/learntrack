import { useEffect, useState, useCallback } from 'react'
import {
  Activity,
  AlertCircle,
  Calendar,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Clock,
  FileText,
  Filter,
  RefreshCw,
  Settings2,
  ShieldCheck,
  XCircle,
} from 'lucide-react'
import { format, subDays } from 'date-fns'

import { toast } from '@/contexts/ToastContext'
import { useApiClient } from '@/lib/api-client'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Calendar as CalendarComponent } from '@/components/ui/calendar'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { LoadingSpinner } from '@/components/ui/loading-state'

interface ActivityLog {
  id?: string
  _id?: string
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
  details?: Record<string, unknown>
}

interface ActivityFilters {
  method?: string
  resource?: string
  user_id?: string
  status_code?: number
  from_date?: Date
  to_date?: Date
}

interface ActivitySummary {
  total_requests: number
  unique_users: number
  avg_response_time_ms: number
  error_rate: number
  top_resources: Array<{ _id?: string; count?: number }>
  top_users: Array<{ _id?: string; count?: number; name?: string }>
}

interface ActivityResponse {
  activities: ActivityLog[]
  total: number
  total_pages: number
}

const methodColors: Record<string, string> = {
  GET: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  POST: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  PUT: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  PATCH: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
  DELETE: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  LOGIN: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
  LOGOUT: 'bg-muted text-muted-foreground',
}

const statusColors: Record<string, string> = {
  success: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  error: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  warning: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
}

export function ActivityPage() {
  const client = useApiClient()
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

  const [summary, setSummary] = useState<ActivitySummary | null>(null)
  const [summaryDays, setSummaryDays] = useState('7')
  const [summaryLoading, setSummaryLoading] = useState(true)
  const [summaryError, setSummaryError] = useState<string | null>(null)

  const [cleanupOpen, setCleanupOpen] = useState(false)
  const [cleanupDays, setCleanupDays] = useState('30')
  const [cleanupLoading, setCleanupLoading] = useState(false)
  const [setupLoading, setSetupLoading] = useState(false)

  const fetchActivities = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)

      const params = new URLSearchParams({
        page: page.toString(),
        per_page: perPage.toString(),
        days: '30',
      })

      if (filters.method) params.append('method', filters.method)
      if (filters.resource) params.append('resource', filters.resource)
      if (filters.user_id) params.append('user_id', filters.user_id)
      if (fromDate) params.append('from_date', fromDate.toISOString())
      if (toDate) params.append('to_date', toDate.toISOString())

      const response = await client.get<ActivityResponse>(`/admin/activity?${params}`)
      if (response.error) {
        throw new Error(response.error)
      }

      const data = response.data
      if (!data) {
        throw new Error('No activity data returned')
      }

      setActivities(data.activities || [])
      setTotal(data.total || 0)
      setTotalPages(data.total_pages || 1)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setIsLoading(false)
    }
  }, [client, page, perPage, filters, fromDate, toDate])

  const fetchSummary = useCallback(async (days: number) => {
    try {
      setSummaryLoading(true)
      setSummaryError(null)

      const response = await client.get<ActivitySummary>(`/admin/activity/summary?days=${days}`)
      if (response.error) {
        throw new Error(response.error)
      }

      if (!response.data) {
        throw new Error('No summary data returned')
      }

      setSummary(response.data)
    } catch (err) {
      setSummaryError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setSummaryLoading(false)
    }
  }, [client])

  useEffect(() => {
    fetchActivities()
  }, [fetchActivities])

  useEffect(() => {
    fetchSummary(Number(summaryDays))
  }, [fetchSummary, summaryDays])

  const handleFilterChange = (key: keyof ActivityFilters, value: string | undefined) => {
    setFilters((prev) => ({ ...prev, [key]: value }))
    setPage(1)
  }

  const clearFilters = () => {
    setFilters({})
    setFromDate(subDays(new Date(), 7))
    setToDate(new Date())
    setPage(1)
  }

  const handleCleanup = async () => {
    const days = Number(cleanupDays)
    if (!days || Number.isNaN(days) || days < 7) {
      toast.error('Retention period must be at least 7 days')
      return
    }

    try {
      setCleanupLoading(true)
      const response = await client.post<{ message?: string }>(
        `/admin/activity/cleanup?retention_days=${days}`
      )
      if (response.error) {
        throw new Error(response.error)
      }

      toast.success(response.data?.message || 'Audit log cleanup completed')
      setCleanupOpen(false)
      fetchActivities()
      fetchSummary(Number(summaryDays))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to cleanup audit logs')
    } finally {
      setCleanupLoading(false)
    }
  }

  const handleSetupIndex = async () => {
    try {
      setSetupLoading(true)
      const response = await client.post<{ message?: string }>(`/admin/activity/setup-index`)
      if (response.error) {
        throw new Error(response.error)
      }

      toast.success(response.data?.message || 'TTL index created successfully')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to setup audit log index')
    } finally {
      setSetupLoading(false)
    }
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

  const formatPercent = (value: number) => `${value.toFixed(1)}%`

  const isRefreshing = isLoading || summaryLoading

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap justify-between items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary/10 rounded-lg">
            <Activity className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Activity</h1>
            <p className="text-muted-foreground">
              User actions across the system (audit trail). Only authenticated requests are recorded.
            </p>
          </div>
        </div>
        <Button variant="outline" onClick={() => { fetchActivities(); fetchSummary(Number(summaryDays)) }} disabled={isRefreshing}>
          {isRefreshing ? <LoadingSpinner size="sm" className="text-foreground" /> : <RefreshCw className="w-4 h-4" />}
          Refresh
        </Button>
      </div>

      {(error || summaryError) && (
        <Alert variant="destructive">
          <AlertTitle>Unable to load activity data</AlertTitle>
          <AlertDescription>{error || summaryError}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>Audit Summary</CardTitle>
            <CardDescription>Snapshot of activity for the selected period.</CardDescription>
          </div>
          <Select value={summaryDays} onValueChange={setSummaryDays}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Select range" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="14">Last 14 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent>
          {summaryLoading ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} className="h-24 w-full" />
              ))}
            </div>
          ) : summary ? (
            <div className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-lg border border-border p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Total Requests</p>
                  <p className="mt-2 text-2xl font-semibold text-foreground">{summary.total_requests}</p>
                </div>
                <div className="rounded-lg border border-border p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Unique Users</p>
                  <p className="mt-2 text-2xl font-semibold text-foreground">{summary.unique_users}</p>
                </div>
                <div className="rounded-lg border border-border p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Avg Response Time</p>
                  <p className="mt-2 text-2xl font-semibold text-foreground">{formatDuration(summary.avg_response_time_ms)}</p>
                </div>
                <div className="rounded-lg border border-border p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Error Rate</p>
                  <p className="mt-2 text-2xl font-semibold text-foreground">{formatPercent(summary.error_rate)}</p>
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-lg border border-border p-4">
                  <h4 className="text-sm font-semibold text-foreground mb-3">Top Resources</h4>
                  {summary.top_resources.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No resources recorded yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {summary.top_resources.map((resource, index) => (
                        <div key={`${resource._id}-${index}`} className="flex items-center justify-between text-sm">
                          <span className="font-medium text-foreground">{resource._id || 'Unknown'}</span>
                          <Badge variant="outline">{resource.count || 0}</Badge>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="rounded-lg border border-border p-4">
                  <h4 className="text-sm font-semibold text-foreground mb-3">Top Users</h4>
                  {summary.top_users.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No user activity recorded yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {summary.top_users.map((user, index) => (
                        <div key={`${user._id}-${index}`} className="flex items-center justify-between text-sm">
                          <span className="font-medium text-foreground">{user.name || user._id || 'Unknown user'}</span>
                          <Badge variant="outline">{user.count || 0}</Badge>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No summary data available.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings2 className="w-5 h-5 text-primary" />
            Audit Log Maintenance
          </CardTitle>
          <CardDescription>Manage TTL setup and retention cleanup for audit logs.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <ShieldCheck className="w-4 h-4" />
            Use TTL index for automatic 30-day cleanup. Manual cleanup can override retention.
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setCleanupOpen(true)}>
              Cleanup Logs
            </Button>
            <Button variant="outline" onClick={handleSetupIndex} disabled={setupLoading}>
              {setupLoading ? 'Setting up...' : 'Setup TTL Index'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-4 items-end">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">Action (e.g. GET, POST)</label>
              <Input
                placeholder="Filter by action..."
                value={filters.method || ''}
                onChange={(event) => handleFilterChange('method', event.target.value || undefined)}
                className="w-48"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">Resource</label>
              <Input
                placeholder="e.g. users, ai"
                value={filters.resource || ''}
                onChange={(event) => handleFilterChange('resource', event.target.value || undefined)}
                className="w-40"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">From date</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-48 justify-start text-left font-normal">
                    <Calendar className="mr-2 h-4 w-4" />
                    {fromDate ? format(fromDate, 'PPP') : 'From date'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <CalendarComponent mode="single" selected={fromDate} onSelect={setFromDate} initialFocus />
                </PopoverContent>
              </Popover>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">To date</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-48 justify-start text-left font-normal">
                    <Calendar className="mr-2 h-4 w-4" />
                    {toDate ? format(toDate, 'PPP') : 'To date'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <CalendarComponent mode="single" selected={toDate} onSelect={setToDate} initialFocus />
                </PopoverContent>
              </Popover>
            </div>

            <Button onClick={fetchActivities} className="flex items-center gap-2">
              <Filter className="w-4 h-4" />
              Apply
            </Button>

            <Button variant="outline" onClick={clearFilters}>
              Reset
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Resource</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Duration</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                [...Array(5)].map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-12" /></TableCell>
                  </TableRow>
                ))
              ) : activities.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="p-8 text-center">
                    <Activity className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                    <p className="text-muted-foreground">No activity recorded yet</p>
                  </TableCell>
                </TableRow>
              ) : (
                activities.map((activity) => {
                  const activityKey = activity.id || activity._id || `${activity.user_id}-${activity.timestamp}`
                  return (
                    <TableRow key={activityKey}>
                      <TableCell className="text-sm">
                        <div className="flex items-center gap-2">
                          <Clock className="w-3 h-3 text-muted-foreground" />
                          {format(new Date(activity.timestamp), 'MMM d, yyyy HH:mm')}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-xs font-medium">
                            {activity.user_name?.[0] || 'U'}
                          </div>
                          <div className="text-sm">
                            <p className="font-medium">{activity.user_name}</p>
                            <p className="text-xs text-muted-foreground">{activity.user_email}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className={methodColors[activity.method] || methodColors.GET}>
                          {activity.method}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        <div className="flex items-center gap-2">
                          <FileText className="w-3 h-3 text-muted-foreground" />
                          <span className="font-medium">{activity.resource}</span>
                          {activity.resource_id && (
                            <span className="text-xs text-muted-foreground">
                              ({activity.resource_id.slice(0, 8)}...)
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className={statusColors[getStatusFromCode(activity.status_code)]}>
                          {getStatusFromCode(activity.status_code) === 'success' && <CheckCircle className="w-3 h-3 mr-1" />}
                          {getStatusFromCode(activity.status_code) === 'error' && <XCircle className="w-3 h-3 mr-1" />}
                          {getStatusFromCode(activity.status_code) === 'warning' && <AlertCircle className="w-3 h-3 mr-1" />}
                          {activity.status_code}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{formatDuration(activity.duration_ms)}</TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>

          {totalPages > 1 && !isLoading && (
            <div className="px-6 py-4 border-t flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Showing {(page - 1) * perPage + 1} to {Math.min(page * perPage, total)} of {total}
              </p>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="icon" onClick={() => setPage((current) => current - 1)} disabled={page === 1}>
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <span className="text-sm">Page {page} of {totalPages}</span>
                <Button variant="outline" size="icon" onClick={() => setPage((current) => current + 1)} disabled={page === totalPages}>
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={cleanupOpen} onOpenChange={setCleanupOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Cleanup Audit Logs</DialogTitle>
            <DialogDescription>Remove audit logs older than the retention period.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground" htmlFor="cleanup-days">Retention days</label>
            <Input
              id="cleanup-days"
              type="number"
              min={7}
              value={cleanupDays}
              onChange={(event) => setCleanupDays(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">Minimum 7 days. This action cannot be undone.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCleanupOpen(false)} disabled={cleanupLoading}>
              Cancel
            </Button>
            <Button onClick={handleCleanup} disabled={cleanupLoading}>
              {cleanupLoading ? 'Cleaning...' : 'Run Cleanup'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

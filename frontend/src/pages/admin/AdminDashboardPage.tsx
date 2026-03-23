import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AdminMetrics } from '../../components/admin/AdminMetrics'
import { Activity, AlertTriangle, DollarSign, RefreshCw, Server, Sparkles } from 'lucide-react'
import { useApiClient } from '@/lib/api-client'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { LoadingSpinner } from '@/components/ui/loading-state'

interface SystemMetrics {
  total_tutors: number
  total_students: number
  total_parents: number
  total_users: number
  active_tutors: number
  active_students: number
  active_parents: number
  total_questions: number
  total_assignments: number
  total_subjects: number
  total_materials: number
  database_size_mb: number
  storage_used_mb: number
  questions_generated_today: number
  assignments_created_today: number
  logins_today: number
  metrics_updated_at: string
}

interface UsageTotals {
  total_tenants: number
  tenants_with_usage: number
  total_requests: number
  total_tokens: number
  total_cost_usd: number
  average_cost_per_request_usd: number
}

interface UsageByProvider {
  provider: string
  request_count: number
  total_tokens: number
  total_cost_usd: number
}

interface UsageByOperation {
  operation: string
  request_count: number
  total_tokens: number
  total_cost_usd: number
}

interface TopTenantUsage {
  tenant_id: string
  tenant_name: string
  tenant_email?: string
  request_count: number
  total_tokens: number
  total_cost_usd: number
  last_request_at?: string
}

interface QuotaHealth {
  total_quotas: number
  active_quotas: number
  tenants_near_or_over_limit: number
  tenants_over_daily_limit: number
  tenants_over_monthly_limit: number
}

interface AdminUsageSummary {
  period_days: number
  period_start: string
  period_end: string
  generated_at: string
  totals: UsageTotals
  usage_by_provider: UsageByProvider[]
  usage_by_operation: UsageByOperation[]
  top_tenants: TopTenantUsage[]
  quota_health: QuotaHealth
}

interface AdminHealth {
  status: string
  database: string
  admin_user: string
  timestamp: string
}

interface AdminAuditLog {
  id?: string
  _id?: string
  admin_email: string
  action: string
  target_type: string
  target_id?: string
  timestamp: string
  details?: Record<string, unknown>
}

interface AuditLogListResponse {
  logs: AdminAuditLog[]
  total: number
  page: number
  per_page: number
}

const numberFormatter = new Intl.NumberFormat()
const compactNumberFormatter = new Intl.NumberFormat(undefined, {
  notation: 'compact',
  maximumFractionDigits: 1,
})
const currencyFormatter = new Intl.NumberFormat(undefined, {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
})

function formatNumber(value: number): string {
  return numberFormatter.format(value)
}

function formatCompactNumber(value: number): string {
  return compactNumberFormatter.format(value)
}

function formatCurrency(value: number): string {
  return currencyFormatter.format(value)
}

function formatDateTime(value?: string): string {
  if (!value) return 'N/A'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'N/A'
  return date.toLocaleString()
}

function formatAuditAction(value: string): string {
  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

export function AdminDashboardPage() {
  const client = useApiClient()
  const navigate = useNavigate()
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null)
  const [usageSummary, setUsageSummary] = useState<AdminUsageSummary | null>(null)
  const [usageWindowDays, setUsageWindowDays] = useState('30')
  const [isLoading, setIsLoading] = useState(true)
  const [isUsageLoading, setIsUsageLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [usageError, setUsageError] = useState<string | null>(null)
  const [health, setHealth] = useState<AdminHealth | null>(null)
  const [healthLoading, setHealthLoading] = useState(true)
  const [healthError, setHealthError] = useState<string | null>(null)
  const [auditLogs, setAuditLogs] = useState<AdminAuditLog[]>([])
  const [auditLoading, setAuditLoading] = useState(true)
  const [auditError, setAuditError] = useState<string | null>(null)

  const fetchMetrics = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)
      const response = await client.get<SystemMetrics>('/admin/dashboard/metrics')
      if (response.error) {
        throw new Error(response.error)
      }

      setMetrics(response.data || null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setIsLoading(false)
    }
  }, [client])

  const fetchUsageSummary = useCallback(async (days: number) => {
    try {
      setIsUsageLoading(true)
      setUsageError(null)

      const response = await client.get<AdminUsageSummary>(
        `/cost-tracking/admin/usage-summary?days=${days}`
      )

      if (response.error) {
        throw new Error(response.error)
      }

      setUsageSummary(response.data || null)
    } catch (err) {
      setUsageError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setIsUsageLoading(false)
    }
  }, [client])

  const fetchHealth = useCallback(async () => {
    try {
      setHealthLoading(true)
      setHealthError(null)

      const response = await client.get<AdminHealth>('/admin/dashboard/health')
      if (response.error) {
        throw new Error(response.error)
      }

      setHealth(response.data || null)
    } catch (err) {
      setHealthError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setHealthLoading(false)
    }
  }, [client])

  const fetchAuditLogs = useCallback(async () => {
    try {
      setAuditLoading(true)
      setAuditError(null)

      const response = await client.get<AuditLogListResponse>('/admin/dashboard/audit-logs?page=1&per_page=5')
      if (response.error) {
        throw new Error(response.error)
      }

      setAuditLogs(response.data?.logs || [])
    } catch (err) {
      setAuditError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setAuditLoading(false)
    }
  }, [client])

  const refreshAll = useCallback(async () => {
    const days = Number(usageWindowDays)
    await Promise.all([fetchMetrics(), fetchUsageSummary(days), fetchAuditLogs(), fetchHealth()])
  }, [fetchMetrics, fetchUsageSummary, fetchAuditLogs, fetchHealth, usageWindowDays])

  useEffect(() => {
    fetchMetrics()
  }, [fetchMetrics])

  useEffect(() => {
    fetchUsageSummary(Number(usageWindowDays))
  }, [fetchUsageSummary, usageWindowDays])

  useEffect(() => {
    fetchAuditLogs()
  }, [fetchAuditLogs])

  useEffect(() => {
    fetchHealth()
  }, [fetchHealth])

  const isRefreshing = isLoading || isUsageLoading || auditLoading || healthLoading
  const healthStatus = health?.status || (healthError ? 'degraded' : 'unknown')
  const healthBannerClass =
    healthStatus === 'healthy'
      ? 'bg-primary'
      : healthStatus === 'degraded'
        ? 'bg-amber-500'
        : 'bg-muted'
  const healthTextClass = healthStatus === 'unknown' ? 'text-foreground' : 'text-white'
  const healthSubTextClass = healthStatus === 'unknown' ? 'text-muted-foreground' : 'text-white/80'

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Dashboard Overview</h1>
          <p className="text-muted-foreground mt-1">
            System-wide metrics and statistics
          </p>
        </div>
        <Button
          onClick={refreshAll}
          disabled={isRefreshing}
          className="flex items-center gap-2"
        >
          {isRefreshing ? (
            <LoadingSpinner size="sm" className="text-primary-foreground" />
          ) : (
            <RefreshCw className="w-4 h-4" />
          )}
          Refresh
        </Button>
      </div>

      <div className={`${healthBannerClass} rounded-xl p-6 ${healthTextClass}`}>
        <div className="flex flex-wrap items-center gap-4">
          <div className="p-3 bg-white/20 rounded-lg">
            <Activity className="w-8 h-8" />
          </div>
          <div>
            <h2 className="text-xl font-semibold">
              System Status: {healthStatus.charAt(0).toUpperCase() + healthStatus.slice(1)}
            </h2>
            {health ? (
              <p className={healthSubTextClass}>
                Database: {health.database} • Checked {formatDateTime(health.timestamp)}
              </p>
            ) : healthError ? (
              <p className={healthSubTextClass}>Health check failed: {healthError}</p>
            ) : (
              <p className={healthSubTextClass}>Health status unavailable</p>
            )}
          </div>
        </div>
      </div>

      {/* Metrics Grid */}
      <AdminMetrics metrics={metrics} isLoading={isLoading} error={error} />

      {/* AI Usage Summary */}
      <Card className="border border-border">
        <CardHeader className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              AI Usage Summary
            </CardTitle>
            <CardDescription>
              Cross-tenant usage analytics from the cost tracking service.
            </CardDescription>
          </div>
          <Select value={usageWindowDays} onValueChange={setUsageWindowDays}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Select period" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
              <SelectItem value="365">Last 365 days</SelectItem>
            </SelectContent>
          </Select>
        </CardHeader>

        <CardContent className="space-y-6">
          {isUsageLoading && !usageSummary ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {Array.from({ length: 4 }).map((_, index) => (
                  <Skeleton key={index} className="h-24 w-full" />
                ))}
              </div>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <Skeleton className="h-56 w-full" />
                <Skeleton className="h-56 w-full" />
              </div>
              <Skeleton className="h-60 w-full" />
            </div>
          ) : usageError ? (
            <Alert variant="destructive">
              <AlertTitle>Failed to load AI usage summary</AlertTitle>
              <AlertDescription>{usageError}</AlertDescription>
            </Alert>
          ) : usageSummary ? (
            <div className="space-y-6">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-xl border border-border p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Total Cost</p>
                  <p className="mt-2 text-2xl font-bold text-foreground">{formatCurrency(usageSummary.totals.total_cost_usd)}</p>
                  <p className="mt-1 text-xs text-muted-foreground">Avg/request: {formatCurrency(usageSummary.totals.average_cost_per_request_usd)}</p>
                </div>

                <div className="rounded-xl border border-border p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Total Requests</p>
                  <p className="mt-2 text-2xl font-bold text-foreground">{formatNumber(usageSummary.totals.total_requests)}</p>
                  <p className="mt-1 text-xs text-muted-foreground">Tokens: {formatCompactNumber(usageSummary.totals.total_tokens)}</p>
                </div>

                <div className="rounded-xl border border-border p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Tenants with Usage</p>
                  <p className="mt-2 text-2xl font-bold text-foreground">{formatNumber(usageSummary.totals.tenants_with_usage)}</p>
                  <p className="mt-1 text-xs text-muted-foreground">of {formatNumber(usageSummary.totals.total_tenants)} total tenants</p>
                </div>

                <div className="rounded-xl border border-border p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Quota Risk</p>
                  <p className="mt-2 text-2xl font-bold text-foreground">{formatNumber(usageSummary.quota_health.tenants_near_or_over_limit)}</p>
                  <p className="mt-1 text-xs text-muted-foreground">tenants near/over configured threshold</p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <div className="rounded-xl border border-border p-4">
                  <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                    <DollarSign className="h-4 w-4 text-primary" />
                    Usage by Provider
                  </h4>
                  <div className="space-y-3">
                    {usageSummary.usage_by_provider.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No provider usage found for this period.</p>
                    ) : (
                      usageSummary.usage_by_provider.slice(0, 6).map((provider, index) => (
                        <div key={`${provider.provider}-${index}`} className="flex items-center justify-between gap-3 text-sm">
                          <div>
                            <p className="font-medium text-foreground">{provider.provider}</p>
                            <p className="text-xs text-muted-foreground">{formatNumber(provider.request_count)} requests</p>
                          </div>
                          <div className="text-right">
                            <p className="font-semibold text-foreground">{formatCurrency(provider.total_cost_usd)}</p>
                            <p className="text-xs text-muted-foreground">{formatCompactNumber(provider.total_tokens)} tokens</p>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="rounded-xl border border-border p-4">
                  <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                    <Server className="h-4 w-4 text-primary" />
                    Usage by Operation
                  </h4>
                  <div className="space-y-3">
                    {usageSummary.usage_by_operation.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No operation usage found for this period.</p>
                    ) : (
                      usageSummary.usage_by_operation.slice(0, 6).map((operation, index) => (
                        <div key={`${operation.operation}-${index}`} className="flex items-center justify-between gap-3 text-sm">
                          <div>
                            <p className="font-medium text-foreground">{operation.operation}</p>
                            <p className="text-xs text-muted-foreground">{formatNumber(operation.request_count)} requests</p>
                          </div>
                          <div className="text-right">
                            <p className="font-semibold text-foreground">{formatCurrency(operation.total_cost_usd)}</p>
                            <p className="text-xs text-muted-foreground">{formatCompactNumber(operation.total_tokens)} tokens</p>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-border p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h4 className="text-sm font-semibold text-foreground">Top Tenant Usage</h4>
                  <Badge variant="outline">Top {Math.min(usageSummary.top_tenants.length, 10)}</Badge>
                </div>

                {usageSummary.top_tenants.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No tenant usage found for this period.</p>
                ) : (
                  <div className="space-y-3">
                    {usageSummary.top_tenants.slice(0, 8).map((tenant) => (
                      <div key={tenant.tenant_id} className="rounded-lg border border-border p-3">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <p className="font-medium text-foreground">{tenant.tenant_name}</p>
                            <p className="text-xs text-muted-foreground">{tenant.tenant_email || tenant.tenant_id}</p>
                          </div>
                          <div className="text-left sm:text-right">
                            <p className="font-semibold text-foreground">{formatCurrency(tenant.total_cost_usd)}</p>
                            <p className="text-xs text-muted-foreground">{formatNumber(tenant.request_count)} requests | {formatCompactNumber(tenant.total_tokens)} tokens</p>
                            <p className="text-[11px] text-muted-foreground">Last request: {formatDateTime(tenant.last_request_at)}</p>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="mt-2"
                              onClick={() => navigate(`/admin/tenants/${tenant.tenant_id}`)}
                            >
                              View Tenant
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-border p-4">
                <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                  Quota Health
                </h4>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded-lg bg-muted/40 p-3">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Total Quotas</p>
                    <p className="mt-1 text-lg font-semibold">{formatNumber(usageSummary.quota_health.total_quotas)}</p>
                  </div>
                  <div className="rounded-lg bg-muted/40 p-3">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Active Quotas</p>
                    <p className="mt-1 text-lg font-semibold">{formatNumber(usageSummary.quota_health.active_quotas)}</p>
                  </div>
                  <div className="rounded-lg bg-muted/40 p-3">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Over Daily Limit</p>
                    <p className="mt-1 text-lg font-semibold text-amber-600">{formatNumber(usageSummary.quota_health.tenants_over_daily_limit)}</p>
                  </div>
                  <div className="rounded-lg bg-muted/40 p-3">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Over Monthly Limit</p>
                    <p className="mt-1 text-lg font-semibold text-red-600">{formatNumber(usageSummary.quota_health.tenants_over_monthly_limit)}</p>
                  </div>
                </div>
              </div>

              <p className="text-xs text-muted-foreground">
                Usage summary updated: {formatDateTime(usageSummary.generated_at)}
              </p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card className="border border-border">
        <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>Recent Admin Activity</CardTitle>
            <CardDescription>Latest admin actions across tenants and users.</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => navigate('/admin/activity')}>
            View Audit Logs
          </Button>
        </CardHeader>
        <CardContent>
          {auditLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} className="h-14 w-full" />
              ))}
            </div>
          ) : auditError ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
              {auditError}
            </div>
          ) : auditLogs.length === 0 ? (
            <div className="text-center py-6 text-muted-foreground">
              <Activity className="w-10 h-10 mx-auto mb-3 opacity-50" />
              <p>No admin activity yet.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {auditLogs.map((log) => {
                const logId = log.id || log._id || `${log.admin_email}-${log.timestamp}`
                return (
                  <div key={logId} className="flex flex-col gap-2 rounded-lg border border-border p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-medium text-foreground">{formatAuditAction(log.action)}</p>
                    <p className="text-xs text-muted-foreground">{log.admin_email}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="outline">{log.target_type}</Badge>
                    {log.target_id && (
                      <span className="text-xs" title={log.target_id}>
                        {(log.details?.email as string) || log.target_id}
                      </span>
                    )}
                    <span className="text-xs">{formatDateTime(log.timestamp)}</span>
                  </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}


import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  BookOpen,
  Building2,
  ClipboardList,
  Clock,
  Cpu,
  FileQuestion,
  GraduationCap,
  HardDrive,
  RefreshCw,
  Search,
  Sparkles,
  UserRound,
  Users,
} from 'lucide-react'

import { useSuperAdmin } from '@/contexts/UserContext'
import { toast } from '@/contexts/ToastContext'
import { useApiClient } from '@/lib/api-client'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

interface TenantUsageSummary {
  period_days: number
  total_requests: number
  total_tokens: number
  total_cost_usd: number
  last_request_at?: string | null
  top_provider?: string | null
  top_model?: string | null
}

interface TenantQuotaSummary {
  tier: string
  is_active: boolean
  daily_limit_usd: number
  daily_usage_usd: number
  monthly_limit_usd: number
  monthly_usage_usd: number
  alert_threshold: number
  near_limit: boolean
  over_limit: boolean
}

interface TenantDetails {
  _id: string
  clerk_id: string
  email: string
  name: string
  status: 'active' | 'suspended' | 'pending' | 'trial' | 'expired'
  created_at: string
  updated_at: string
  last_login?: string
  students_count: number
  parents_count: number
  active_students_count: number
  active_parents_count: number
  subjects_count: number
  questions_count: number
  assignments_count: number
  materials_count: number
  pending_invitations_count: number
  subscription_tier?: string
  storage_used_mb?: number
  storage_limit_mb?: number
  usage_summary?: TenantUsageSummary | null
  quota_summary?: TenantQuotaSummary | null
}

interface TenantStudentSummary {
  _id: string
  clerk_id: string
  name: string
  email: string
  status: string
  is_active: boolean
  grade?: string | null
  parents_count: number
  total_assignments: number
  completed_assignments: number
  completion_rate: number
  average_score: number
  last_login?: string | null
  created_at?: string | null
  updated_at?: string | null
}

interface TenantStudentListResponse {
  students: TenantStudentSummary[]
  total: number
  page: number
  per_page: number
  total_pages: number
}

interface TenantParentSummary {
  _id: string
  clerk_id: string
  name: string
  email: string
  status: string
  is_active: boolean
  children_count: number
  child_names: string[]
  last_login?: string | null
  created_at?: string | null
  updated_at?: string | null
}

interface TenantParentListResponse {
  parents: TenantParentSummary[]
  total: number
  page: number
  per_page: number
  total_pages: number
}

const statusVariant: Record<TenantDetails['status'], string> = {
  active: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  suspended: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  trial: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  expired: 'bg-muted text-muted-foreground',
}

function formatDate(value?: string | null): string {
  if (!value) return 'N/A'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'N/A'
  return date.toLocaleString()
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: value >= 100 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value || 0)
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat('en-US').format(value || 0)
}

function formatCompactInteger(value: number): string {
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value || 0)
}

function formatPercent(value: number): string {
  return `${Math.round(value)}%`
}

function getQuotaPercent(usage: number, limit: number): number {
  if (!limit || limit <= 0) return 0
  return Math.min(100, Math.round((usage / limit) * 100))
}

function MemberStatusBadge({ status, isActive }: { status: string; isActive: boolean }) {
  if (!isActive) {
    return <Badge variant="outline">Inactive</Badge>
  }

  const normalized = status.toLowerCase()
  if (normalized === 'active') {
    return <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">Active</Badge>
  }

  return <Badge variant="outline">{status}</Badge>
}

function MemberPagination({
  page,
  totalPages,
  itemLabel,
  onPrevious,
  onNext,
}: {
  page: number
  totalPages: number
  itemLabel: string
  onPrevious: () => void
  onNext: () => void
}) {
  return (
    <div className="flex flex-col gap-3 border-t border-border pt-4 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
      <p>
        Page {totalPages === 0 ? 0 : page} of {totalPages} {itemLabel}
      </p>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={onPrevious} disabled={page <= 1 || totalPages === 0}>
          Previous
        </Button>
        <Button variant="outline" size="sm" onClick={onNext} disabled={page >= totalPages || totalPages === 0}>
          Next
        </Button>
      </div>
    </div>
  )
}

export function TenantDetailsPage() {
  const { tenantId } = useParams<{ tenantId: string }>()
  const client = useApiClient()
  const navigate = useNavigate()
  const { hasAdminPermission, hasFullAdminAccess } = useSuperAdmin()
  const canSuspendTenants = hasFullAdminAccess || hasAdminPermission('suspend_tenants')
  const canManageTenants = hasFullAdminAccess || hasAdminPermission('manage_tenants')
  const canManageAIProviders = hasFullAdminAccess || hasAdminPermission('manage_ai_providers')

  const [tenant, setTenant] = useState<TenantDetails | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionDialog, setActionDialog] = useState<'suspend' | 'activate' | null>(null)
  const [actionReason, setActionReason] = useState('')
  const [notifyUsers, setNotifyUsers] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)

  const [students, setStudents] = useState<TenantStudentSummary[]>([])
  const [studentsTotal, setStudentsTotal] = useState(0)
  const [studentsPage, setStudentsPage] = useState(1)
  const [studentsPerPage] = useState(10)
  const [studentsTotalPages, setStudentsTotalPages] = useState(1)
  const [studentsLoading, setStudentsLoading] = useState(true)
  const [studentsError, setStudentsError] = useState<string | null>(null)
  const [studentSearchInput, setStudentSearchInput] = useState('')
  const [studentSearch, setStudentSearch] = useState('')

  const [parents, setParents] = useState<TenantParentSummary[]>([])
  const [parentsTotal, setParentsTotal] = useState(0)
  const [parentsPage, setParentsPage] = useState(1)
  const [parentsPerPage] = useState(10)
  const [parentsTotalPages, setParentsTotalPages] = useState(1)
  const [parentsLoading, setParentsLoading] = useState(true)
  const [parentsError, setParentsError] = useState<string | null>(null)
  const [parentSearchInput, setParentSearchInput] = useState('')
  const [parentSearch, setParentSearch] = useState('')

  const fetchTenantDetails = useCallback(async () => {
    if (!tenantId) {
      setError('Missing tenant id')
      setIsLoading(false)
      return
    }

    try {
      setIsLoading(true)
      setError(null)

      const response = await client.get<TenantDetails>(`/admin/tenants/${tenantId}`)
      if (response.error) {
        throw new Error(response.error)
      }

      setTenant(response.data || null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setIsLoading(false)
    }
  }, [client, tenantId])

  const fetchStudents = useCallback(async () => {
    if (!tenantId) {
      return
    }

    try {
      setStudentsLoading(true)
      setStudentsError(null)

      const params = new URLSearchParams({
        page: studentsPage.toString(),
        per_page: studentsPerPage.toString(),
      })
      if (studentSearch) params.append('search', studentSearch)

      const response = await client.get<TenantStudentListResponse>(
        `/admin/tenants/${tenantId}/students?${params}`
      )
      if (response.error) {
        throw new Error(response.error)
      }

      setStudents(response.data?.students || [])
      setStudentsTotal(response.data?.total || 0)
      setStudentsTotalPages(response.data?.total_pages || 0)
    } catch (err) {
      setStudentsError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setStudentsLoading(false)
    }
  }, [client, tenantId, studentSearch, studentsPage, studentsPerPage])

  const fetchParents = useCallback(async () => {
    if (!tenantId) {
      return
    }

    try {
      setParentsLoading(true)
      setParentsError(null)

      const params = new URLSearchParams({
        page: parentsPage.toString(),
        per_page: parentsPerPage.toString(),
      })
      if (parentSearch) params.append('search', parentSearch)

      const response = await client.get<TenantParentListResponse>(
        `/admin/tenants/${tenantId}/parents?${params}`
      )
      if (response.error) {
        throw new Error(response.error)
      }

      setParents(response.data?.parents || [])
      setParentsTotal(response.data?.total || 0)
      setParentsTotalPages(response.data?.total_pages || 0)
    } catch (err) {
      setParentsError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setParentsLoading(false)
    }
  }, [client, parentSearch, parentsPage, parentsPerPage, tenantId])

  useEffect(() => {
    fetchTenantDetails()
  }, [fetchTenantDetails])

  useEffect(() => {
    fetchStudents()
  }, [fetchStudents])

  useEffect(() => {
    fetchParents()
  }, [fetchParents])

  const handleStudentSearch = (event: FormEvent) => {
    event.preventDefault()
    setStudentsPage(1)
    setStudentSearch(studentSearchInput.trim())
  }

  const handleParentSearch = (event: FormEvent) => {
    event.preventDefault()
    setParentsPage(1)
    setParentSearch(parentSearchInput.trim())
  }

  const refreshWorkspace = async () => {
    await Promise.all([fetchTenantDetails(), fetchStudents(), fetchParents()])
  }

  const openTenantActionDialog = (type: 'suspend' | 'activate') => {
    if (type === 'suspend' && !canSuspendTenants) {
      toast.error('You do not have permission to suspend tenants.')
      return
    }
    if (type === 'activate' && !canManageTenants) {
      toast.error('You do not have permission to activate tenants.')
      return
    }

    setActionReason('')
    setNotifyUsers(true)
    setActionDialog(type)
  }

  const handleConfirmTenantAction = async () => {
    if (!tenant || !actionDialog) {
      return
    }

    if (actionDialog === 'suspend' && !actionReason.trim()) {
      toast.error('Suspension reason is required.')
      return
    }

    try {
      setActionLoading(true)
      const endpoint = actionDialog === 'suspend'
        ? `/admin/tenants/${tenant.clerk_id}/suspend`
        : `/admin/tenants/${tenant.clerk_id}/activate`
      const payload = actionDialog === 'suspend'
        ? { reason: actionReason.trim(), notify_users: notifyUsers }
        : { reason: actionReason.trim() || undefined, notify_users: notifyUsers }

      const response = await client.post(endpoint, payload)
      if (response.error) {
        throw new Error(response.error)
      }

      toast.success(
        actionDialog === 'suspend'
          ? 'Tenant suspended successfully.'
          : 'Tenant activated successfully.'
      )
      setActionDialog(null)
      fetchTenantDetails()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update tenant status')
    } finally {
      setActionLoading(false)
    }
  }

  const storageUsed = tenant?.storage_used_mb ?? 0
  const storageLimit = tenant?.storage_limit_mb ?? 500
  const storagePercent = useMemo(() => {
    if (!storageLimit || storageLimit <= 0) return 0
    return Math.min(100, Math.round((storageUsed / storageLimit) * 100))
  }, [storageLimit, storageUsed])

  const monthlyQuotaPercent = getQuotaPercent(
    tenant?.quota_summary?.monthly_usage_usd ?? 0,
    tenant?.quota_summary?.monthly_limit_usd ?? 0,
  )
  const dailyQuotaPercent = getQuotaPercent(
    tenant?.quota_summary?.daily_usage_usd ?? 0,
    tenant?.quota_summary?.daily_limit_usd ?? 0,
  )

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Skeleton className="h-72 w-full lg:col-span-2" />
          <Skeleton className="h-72 w-full" />
        </div>
        <Skeleton className="h-56 w-full" />
        <Skeleton className="h-[480px] w-full" />
      </div>
    )
  }

  if (error || !tenant) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={() => navigate('/admin/tenants')}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Tenants
          </Button>
        </div>
        <Alert variant="destructive">
          <AlertTitle>Failed to load tenant details</AlertTitle>
          <AlertDescription>{error || 'Tenant not found'}</AlertDescription>
        </Alert>
        <Button onClick={fetchTenantDetails}>Retry</Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={() => navigate('/admin/tenants')}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-foreground">{tenant.name}</h1>
            <p className="text-sm text-muted-foreground">Tutor tenant owner • {tenant.email}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge className={statusVariant[tenant.status]}>{tenant.status}</Badge>
          <Button variant="outline" onClick={refreshWorkspace}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
          {canManageAIProviders && (
            <Button
              variant="outline"
              onClick={() => navigate(`/admin/tenants/${tenant.clerk_id}/ai-config`)}
            >
              <Cpu className="mr-2 h-4 w-4" />
              AI Config
            </Button>
          )}
          {tenant.status === 'active' ? (
            canSuspendTenants && (
              <Button variant="destructive" onClick={() => openTenantActionDialog('suspend')}>
                Suspend Tenant
              </Button>
            )
          ) : (
            canManageTenants && (
              <Button variant="outline" onClick={() => openTenantActionDialog('activate')}>
                Activate Tenant
              </Button>
            )
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-primary" />
              Tenant Overview
            </CardTitle>
            <CardDescription>
              Tutor-backed tenant profile, membership health, and operational details.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Tenant ID</p>
              <p className="mt-1 text-sm font-medium text-foreground">{tenant.clerk_id}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Subscription</p>
              <p className="mt-1 text-sm font-medium text-foreground">{tenant.subscription_tier || 'free'}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Created</p>
              <p className="mt-1 text-sm font-medium text-foreground">{formatDate(tenant.created_at)}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Updated</p>
              <p className="mt-1 text-sm font-medium text-foreground">{formatDate(tenant.updated_at)}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Last Login</p>
              <p className="mt-1 text-sm font-medium text-foreground">{formatDate(tenant.last_login)}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Pending Invitations</p>
              <p className="mt-1 text-sm font-medium text-foreground">{formatInteger(tenant.pending_invitations_count)}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Active Students</p>
              <p className="mt-1 text-sm font-medium text-foreground">{formatInteger(tenant.active_students_count)}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Active Parents</p>
              <p className="mt-1 text-sm font-medium text-foreground">{formatInteger(tenant.active_parents_count)}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Materials</p>
              <p className="mt-1 text-sm font-medium text-foreground">{formatInteger(tenant.materials_count)}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              AI + Storage Snapshot
            </CardTitle>
            <CardDescription>
              Current storage utilization and last 30-day AI footprint for this tenant.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Storage Used</span>
                <span className="font-medium text-foreground">{storageUsed.toFixed(2)} MB</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Storage Limit</span>
                <span className="font-medium text-foreground">{storageLimit.toFixed(2)} MB</span>
              </div>
              <Progress value={storagePercent} className="h-2" />
              <p className="text-xs text-muted-foreground">{storagePercent}% of allocated storage used</p>
            </div>

            <div className="border-t border-border pt-5">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                <Cpu className="h-4 w-4 text-primary" />
                Last {tenant.usage_summary?.period_days ?? 30} Days of AI Usage
              </div>
              <div className="space-y-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Requests</span>
                  <span className="font-medium text-foreground">{formatInteger(tenant.usage_summary?.total_requests ?? 0)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Tokens</span>
                  <span className="font-medium text-foreground">{formatCompactInteger(tenant.usage_summary?.total_tokens ?? 0)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Estimated Spend</span>
                  <span className="font-medium text-foreground">{formatCurrency(tenant.usage_summary?.total_cost_usd ?? 0)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Top Provider</span>
                  <span className="font-medium text-foreground">{tenant.usage_summary?.top_provider || 'N/A'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Top Model</span>
                  <span className="font-medium text-foreground">{tenant.usage_summary?.top_model || 'N/A'}</span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-muted-foreground">Last Request</span>
                  <span className="text-right font-medium text-foreground">{formatDate(tenant.usage_summary?.last_request_at)}</span>
                </div>
              </div>
            </div>

            <div className="border-t border-border pt-5">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                <Clock className="h-4 w-4 text-primary" />
                Quota Status
              </div>
              {tenant.quota_summary ? (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{tenant.quota_summary.tier}</Badge>
                    {tenant.quota_summary.over_limit ? (
                      <Badge className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">Over Limit</Badge>
                    ) : tenant.quota_summary.near_limit ? (
                      <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">Near Limit</Badge>
                    ) : (
                      <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">Healthy</Badge>
                    )}
                    {!tenant.quota_summary.is_active && <Badge variant="outline">Inactive Quota</Badge>}
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>Daily Usage</span>
                      <span>
                        {formatCurrency(tenant.quota_summary.daily_usage_usd)} / {formatCurrency(tenant.quota_summary.daily_limit_usd)}
                      </span>
                    </div>
                    <Progress value={dailyQuotaPercent} className="h-2" />
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>Monthly Usage</span>
                      <span>
                        {formatCurrency(tenant.quota_summary.monthly_usage_usd)} / {formatCurrency(tenant.quota_summary.monthly_limit_usd)}
                      </span>
                    </div>
                    <Progress value={monthlyQuotaPercent} className="h-2" />
                  </div>

                  <p className="text-xs text-muted-foreground">
                    Alert threshold: {formatPercent((tenant.quota_summary.alert_threshold || 0) * 100)}
                  </p>
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-border bg-muted/30 p-4 text-sm text-muted-foreground">
                  No quota is configured for this tenant yet.
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Workspace Snapshot</CardTitle>
          <CardDescription>
            Core operational counts for the tutor tenant and everyone under it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-7">
            <div className="rounded-lg border border-border p-4">
              <div className="flex items-center justify-between">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Students</p>
                <GraduationCap className="h-4 w-4 text-primary" />
              </div>
              <p className="mt-2 text-2xl font-bold">{formatInteger(tenant.students_count)}</p>
            </div>

            <div className="rounded-lg border border-border p-4">
              <div className="flex items-center justify-between">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Parents</p>
                <UserRound className="h-4 w-4 text-primary" />
              </div>
              <p className="mt-2 text-2xl font-bold">{formatInteger(tenant.parents_count)}</p>
            </div>

            <div className="rounded-lg border border-border p-4">
              <div className="flex items-center justify-between">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Subjects</p>
                <BookOpen className="h-4 w-4 text-primary" />
              </div>
              <p className="mt-2 text-2xl font-bold">{formatInteger(tenant.subjects_count)}</p>
            </div>

            <div className="rounded-lg border border-border p-4">
              <div className="flex items-center justify-between">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Questions</p>
                <FileQuestion className="h-4 w-4 text-primary" />
              </div>
              <p className="mt-2 text-2xl font-bold">{formatInteger(tenant.questions_count)}</p>
            </div>

            <div className="rounded-lg border border-border p-4">
              <div className="flex items-center justify-between">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Assignments</p>
                <ClipboardList className="h-4 w-4 text-primary" />
              </div>
              <p className="mt-2 text-2xl font-bold">{formatInteger(tenant.assignments_count)}</p>
            </div>

            <div className="rounded-lg border border-border p-4">
              <div className="flex items-center justify-between">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Materials</p>
                <HardDrive className="h-4 w-4 text-primary" />
              </div>
              <p className="mt-2 text-2xl font-bold">{formatInteger(tenant.materials_count)}</p>
            </div>

            <div className="rounded-lg border border-border p-4">
              <div className="flex items-center justify-between">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Pending Invites</p>
                <Users className="h-4 w-4 text-primary" />
              </div>
              <p className="mt-2 text-2xl font-bold">{formatInteger(tenant.pending_invitations_count)}</p>
            </div>
          </div>

          <div className="mt-6 flex items-center gap-2 text-xs text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            Last updated {formatDate(tenant.updated_at)}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tenant Members</CardTitle>
          <CardDescription>
            Review the students and parents that belong to this tutor-backed tenant.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="students" className="space-y-6">
            <TabsList>
              <TabsTrigger value="students">Students ({formatInteger(studentsTotal)})</TabsTrigger>
              <TabsTrigger value="parents">Parents ({formatInteger(parentsTotal)})</TabsTrigger>
            </TabsList>

            <TabsContent value="students" className="space-y-4">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <p className="text-sm font-medium text-foreground">Student roster</p>
                  <p className="text-sm text-muted-foreground">
                    {formatInteger(studentsTotal)} students currently belong to this tutor tenant.
                  </p>
                </div>
                <form onSubmit={handleStudentSearch} className="flex w-full flex-col gap-2 sm:flex-row lg:max-w-xl">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={studentSearchInput}
                      onChange={(event) => setStudentSearchInput(event.target.value)}
                      placeholder="Search students by name, email, or grade"
                      className="pl-9"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <Button type="submit" variant="outline">Search</Button>
                    {studentSearch && (
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => {
                          setStudentSearchInput('')
                          setStudentSearch('')
                          setStudentsPage(1)
                        }}
                      >
                        Clear
                      </Button>
                    )}
                  </div>
                </form>
              </div>

              {studentsError && (
                <Alert variant="destructive">
                  <AlertTitle>Unable to load students</AlertTitle>
                  <AlertDescription>{studentsError}</AlertDescription>
                </Alert>
              )}

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Student</TableHead>
                    <TableHead>Grade</TableHead>
                    <TableHead>Parents</TableHead>
                    <TableHead>Completion</TableHead>
                    <TableHead>Score</TableHead>
                    <TableHead>Last Activity</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {studentsLoading ? (
                    Array.from({ length: 5 }).map((_, index) => (
                      <TableRow key={index}>
                        <TableCell><Skeleton className="h-10 w-40" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-12" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                      </TableRow>
                    ))
                  ) : students.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="py-12 text-center text-muted-foreground">
                        <GraduationCap className="mx-auto mb-3 h-10 w-10 opacity-50" />
                        <p>No students found for this tenant.</p>
                      </TableCell>
                    </TableRow>
                  ) : (
                    students.map((student) => (
                      <TableRow key={student.clerk_id || student._id}>
                        <TableCell>
                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="font-medium text-foreground">{student.name}</p>
                              <MemberStatusBadge status={student.status} isActive={student.is_active} />
                            </div>
                            <p className="text-sm text-muted-foreground">{student.email || 'No email'}</p>
                          </div>
                        </TableCell>
                        <TableCell>{student.grade || 'N/A'}</TableCell>
                        <TableCell>{formatInteger(student.parents_count)}</TableCell>
                        <TableCell>
                          <div className="space-y-1">
                            <p className="font-medium text-foreground">{formatPercent(student.completion_rate || 0)}</p>
                            <p className="text-xs text-muted-foreground">
                              {formatInteger(student.completed_assignments)} of {formatInteger(student.total_assignments)} assignments
                            </p>
                          </div>
                        </TableCell>
                        <TableCell>{student.average_score ? `${Math.round(student.average_score)}%` : 'N/A'}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{formatDate(student.last_login || student.updated_at || student.created_at)}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>

              <MemberPagination
                page={studentsPage}
                totalPages={studentsTotalPages}
                itemLabel="student pages"
                onPrevious={() => setStudentsPage((current) => Math.max(1, current - 1))}
                onNext={() => setStudentsPage((current) => Math.min(studentsTotalPages, current + 1))}
              />
            </TabsContent>

            <TabsContent value="parents" className="space-y-4">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <p className="text-sm font-medium text-foreground">Parent roster</p>
                  <p className="text-sm text-muted-foreground">
                    {formatInteger(parentsTotal)} parents currently belong to this tutor tenant.
                  </p>
                </div>
                <form onSubmit={handleParentSearch} className="flex w-full flex-col gap-2 sm:flex-row lg:max-w-xl">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={parentSearchInput}
                      onChange={(event) => setParentSearchInput(event.target.value)}
                      placeholder="Search parents by name or email"
                      className="pl-9"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <Button type="submit" variant="outline">Search</Button>
                    {parentSearch && (
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => {
                          setParentSearchInput('')
                          setParentSearch('')
                          setParentsPage(1)
                        }}
                      >
                        Clear
                      </Button>
                    )}
                  </div>
                </form>
              </div>

              {parentsError && (
                <Alert variant="destructive">
                  <AlertTitle>Unable to load parents</AlertTitle>
                  <AlertDescription>{parentsError}</AlertDescription>
                </Alert>
              )}

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Parent</TableHead>
                    <TableHead>Linked Students</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Last Login</TableHead>
                    <TableHead>Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {parentsLoading ? (
                    Array.from({ length: 5 }).map((_, index) => (
                      <TableRow key={index}>
                        <TableCell><Skeleton className="h-10 w-40" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                      </TableRow>
                    ))
                  ) : parents.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="py-12 text-center text-muted-foreground">
                        <UserRound className="mx-auto mb-3 h-10 w-10 opacity-50" />
                        <p>No parents found for this tenant.</p>
                      </TableCell>
                    </TableRow>
                  ) : (
                    parents.map((parent) => (
                      <TableRow key={parent.clerk_id || parent._id}>
                        <TableCell>
                          <div className="space-y-1">
                            <p className="font-medium text-foreground">{parent.name}</p>
                            <p className="text-sm text-muted-foreground">{parent.email || 'No email'}</p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="space-y-1">
                            <p className="font-medium text-foreground">{formatInteger(parent.children_count)}</p>
                            <p className="text-xs text-muted-foreground">
                              {parent.child_names.length > 0 ? parent.child_names.join(', ') : 'No linked students'}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <MemberStatusBadge status={parent.status} isActive={parent.is_active} />
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{formatDate(parent.last_login || parent.updated_at)}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{formatDate(parent.created_at)}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>

              <MemberPagination
                page={parentsPage}
                totalPages={parentsTotalPages}
                itemLabel="parent pages"
                onPrevious={() => setParentsPage((current) => Math.max(1, current - 1))}
                onNext={() => setParentsPage((current) => Math.min(parentsTotalPages, current + 1))}
              />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Dialog open={Boolean(actionDialog)} onOpenChange={(open) => !open && setActionDialog(null)}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>
              {actionDialog === 'suspend' ? 'Suspend Tenant' : 'Activate Tenant'}
            </DialogTitle>
            <DialogDescription>
              {actionDialog === 'suspend'
                ? 'Suspending a tenant blocks access for the tutor and everyone linked under that tutor.'
                : 'Reactivating a tenant restores access for the tutor and linked members.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
              <p className="font-medium text-foreground">{tenant.name}</p>
              <p className="text-muted-foreground">{tenant.email}</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="tenant-detail-reason">
                Reason {actionDialog === 'suspend' ? '(required)' : '(optional)'}
              </Label>
              <Input
                id="tenant-detail-reason"
                value={actionReason}
                onChange={(event) => setActionReason(event.target.value)}
                placeholder={actionDialog === 'suspend' ? 'Provide a suspension reason' : 'Optional note'}
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <div>
                <p className="text-sm font-medium text-foreground">Notify users</p>
                <p className="text-xs text-muted-foreground">Send an email notification to affected users.</p>
              </div>
              <Switch checked={notifyUsers} onCheckedChange={setNotifyUsers} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setActionDialog(null)} disabled={actionLoading}>
              Cancel
            </Button>
            <Button onClick={handleConfirmTenantAction} disabled={actionLoading}>
              {actionLoading
                ? 'Updating...'
                : actionDialog === 'suspend'
                  ? 'Suspend Tenant'
                  : 'Activate Tenant'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

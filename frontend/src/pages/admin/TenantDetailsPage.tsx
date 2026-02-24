import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  BookOpen,
  Building2,
  ClipboardList,
  Clock,
  Cpu,
  FileQuestion,
  HardDrive,
  Users,
} from 'lucide-react'

import { useSuperAdmin } from '@/contexts/UserContext'
import { toast } from '@/contexts/ToastContext'
import { useApiClient } from '@/lib/api-client'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
  subjects_count: number
  questions_count: number
  assignments_count: number
  subscription_tier?: string
  storage_used_mb?: number
  storage_limit_mb?: number
}

const statusVariant: Record<TenantDetails['status'], string> = {
  active: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  suspended: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  trial: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  expired: 'bg-muted text-muted-foreground',
}

function formatDate(value?: string): string {
  if (!value) return 'N/A'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'N/A'
  return date.toLocaleString()
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

  useEffect(() => {
    fetchTenantDetails()
  }, [fetchTenantDetails])

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

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Skeleton className="h-60 w-full lg:col-span-2" />
          <Skeleton className="h-60 w-full" />
        </div>
        <Skeleton className="h-48 w-full" />
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
            <p className="text-sm text-muted-foreground">{tenant.email}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge className={statusVariant[tenant.status]}>{tenant.status}</Badge>
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
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
            <div className="sm:col-span-2">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Last Login</p>
              <p className="mt-1 text-sm font-medium text-foreground">{formatDate(tenant.last_login)}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <HardDrive className="h-5 w-5 text-primary" />
              Storage Usage
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Used</span>
              <span className="font-medium text-foreground">{storageUsed.toFixed(2)} MB</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Limit</span>
              <span className="font-medium text-foreground">{storageLimit.toFixed(2)} MB</span>
            </div>
            <Progress value={storagePercent} className="h-2" />
            <p className="text-xs text-muted-foreground">{storagePercent}% of total storage used</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Tenant Activity Stats</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <div className="rounded-lg border border-border p-4">
              <div className="flex items-center justify-between">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Students</p>
                <Users className="h-4 w-4 text-primary" />
              </div>
              <p className="mt-2 text-2xl font-bold">{tenant.students_count}</p>
            </div>

            <div className="rounded-lg border border-border p-4">
              <div className="flex items-center justify-between">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Parents</p>
                <Users className="h-4 w-4 text-primary" />
              </div>
              <p className="mt-2 text-2xl font-bold">{tenant.parents_count}</p>
            </div>

            <div className="rounded-lg border border-border p-4">
              <div className="flex items-center justify-between">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Subjects</p>
                <BookOpen className="h-4 w-4 text-primary" />
              </div>
              <p className="mt-2 text-2xl font-bold">{tenant.subjects_count}</p>
            </div>

            <div className="rounded-lg border border-border p-4">
              <div className="flex items-center justify-between">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Questions</p>
                <FileQuestion className="h-4 w-4 text-primary" />
              </div>
              <p className="mt-2 text-2xl font-bold">{tenant.questions_count}</p>
            </div>

            <div className="rounded-lg border border-border p-4">
              <div className="flex items-center justify-between">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Assignments</p>
                <ClipboardList className="h-4 w-4 text-primary" />
              </div>
              <p className="mt-2 text-2xl font-bold">{tenant.assignments_count}</p>
            </div>
          </div>

          <div className="mt-6 flex items-center gap-2 text-xs text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            Last updated {formatDate(tenant.updated_at)}
          </div>
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
                ? 'Suspending a tenant blocks access for all associated users.'
                : 'Reactivating a tenant restores access for all associated users.'}
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

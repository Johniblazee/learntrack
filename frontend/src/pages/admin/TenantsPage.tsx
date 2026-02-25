import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Building2 } from 'lucide-react'

import { BatchOperationsPanel, BatchOperationType } from '../../components/admin/BatchOperationsPanel'
import { TenantList } from '../../components/admin/TenantList'
import { useSuperAdmin } from '@/contexts/UserContext'
import { toast } from '@/contexts/ToastContext'
import { useApiClient } from '@/lib/api-client'
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
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'

interface TenantInfo {
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
}

export function TenantsPage() {
  const client = useApiClient()
  const navigate = useNavigate()
  const { hasAdminPermission, hasFullAdminAccess } = useSuperAdmin()
  const canSuspendTenants = hasFullAdminAccess || hasAdminPermission('suspend_tenants')
  const canManageTenants = hasFullAdminAccess || hasAdminPermission('manage_tenants')
  const canManageAIProviders = hasFullAdminAccess || hasAdminPermission('manage_ai_providers')

  const [tenants, setTenants] = useState<TenantInfo[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [perPage] = useState(20)
  const [totalPages, setTotalPages] = useState(1)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [isBatchLoading, setIsBatchLoading] = useState(false)
  const [actionDialog, setActionDialog] = useState<{
    type: 'suspend' | 'activate'
    tenant: TenantInfo
  } | null>(null)
  const [actionReason, setActionReason] = useState('')
  const [notifyUsers, setNotifyUsers] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)

  const fetchTenants = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)
      
      const params = new URLSearchParams({
        page: page.toString(),
        per_page: perPage.toString(),
      })
      if (searchQuery) params.append('search', searchQuery)
      if (statusFilter) params.append('status_filter', statusFilter)

      const response = await client.get<{ tenants: TenantInfo[]; total: number; total_pages: number }>(
        `/admin/tenants/?${params}`
      )

      if (response.error) {
        throw new Error(response.error)
      }

      const data = response.data
      setTenants(data?.tenants || [])
      setTotal(data?.total || 0)
      setTotalPages(data?.total_pages || 1)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setIsLoading(false)
    }
  }, [client, page, perPage, searchQuery, statusFilter])

  useEffect(() => {
    fetchTenants()
  }, [fetchTenants])

  const openTenantActionDialog = (type: 'suspend' | 'activate', tenant: TenantInfo) => {
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
    setActionDialog({ type, tenant })
  }

  const handleConfirmTenantAction = async () => {
    if (!actionDialog) return

    if (actionDialog.type === 'suspend' && !actionReason.trim()) {
      toast.error('Suspension reason is required.')
      return
    }

    try {
      setActionLoading(true)
      const endpoint = actionDialog.type === 'suspend'
        ? `/admin/tenants/${actionDialog.tenant.clerk_id}/suspend`
        : `/admin/tenants/${actionDialog.tenant.clerk_id}/activate`

      const payload = actionDialog.type === 'suspend'
        ? { reason: actionReason.trim(), notify_users: notifyUsers }
        : { reason: actionReason.trim() || undefined, notify_users: notifyUsers }

      const response = await client.post(endpoint, payload)
      if (response.error) {
        throw new Error(response.error)
      }

      toast.success(
        actionDialog.type === 'suspend'
          ? 'Tenant suspended successfully.'
          : 'Tenant activated successfully.'
      )
      setActionDialog(null)
      fetchTenants()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update tenant status')
    } finally {
      setActionLoading(false)
    }
  }

  const toggleSelection = (tenantId: string) => {
    if (!canSuspendTenants) {
      return
    }

    setSelectedIds(prev =>
      prev.includes(tenantId)
        ? prev.filter(id => id !== tenantId)
        : [...prev, tenantId]
    )
  }

  const selectAll = () => {
    if (!canSuspendTenants) {
      return
    }
    setSelectedIds(tenants.map(t => t.clerk_id))
  }

  const clearSelection = () => {
    setSelectedIds([])
  }

  const handleBatchOperation = async (operation: BatchOperationType, reason?: string) => {
    if (!canSuspendTenants) {
      toast.error('You do not have permission to manage tenant status.')
      return
    }

    try {
      setIsBatchLoading(true)

      // Map frontend operation to backend operation
      const backendOperation = operation === 'deactivate' ? 'suspend' : operation

      const response = await client.post<{ message?: string }>(`/admin/tenants/batch`, {
        tenant_ids: selectedIds,
        operation: backendOperation,
        reason: reason,
        notify_users: true,
      })

      if (response.error) {
        throw new Error(response.error)
      }

      toast.success(response.data?.message || 'Batch operation completed')

      setSelectedIds([])
      fetchTenants()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Batch operation failed')
    } finally {
      setIsBatchLoading(false)
    }
  }

  return (
    <>
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary/10 rounded-lg">
            <Building2 className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Tenant Management</h1>
            <p className="text-muted-foreground">Manage all tutors and their accounts</p>
          </div>
        </div>
      </div>

      {/* Batch Operations Panel */}
      {canSuspendTenants && (
        <BatchOperationsPanel
          selectedIds={selectedIds}
          totalItems={tenants.length}
          onSelectAll={selectAll}
          onClearSelection={clearSelection}
          onBatchOperation={handleBatchOperation}
          isLoading={isBatchLoading}
          entityType="tenants"
        />
      )}

      {/* Tenant List */}
      <TenantList
        tenants={tenants}
        total={total}
        page={page}
        perPage={perPage}
        totalPages={totalPages}
        isLoading={isLoading}
        error={error}
        onPageChange={setPage}
        onSearch={(query) => { setSearchQuery(query); setPage(1) }}
        onStatusFilter={(status) => { setStatusFilter(status); setPage(1) }}
        statusFilter={statusFilter}
        onViewTenant={(id) => navigate(`/admin/tenants/${id}`)}
        onSuspendTenant={(id) => {
          const tenant = tenants.find((item) => item.clerk_id === id)
          if (tenant) openTenantActionDialog('suspend', tenant)
        }}
        onActivateTenant={(id) => {
          const tenant = tenants.find((item) => item.clerk_id === id)
          if (tenant) openTenantActionDialog('activate', tenant)
        }}
        selectedIds={canSuspendTenants ? selectedIds : []}
        onToggleSelection={canSuspendTenants ? toggleSelection : undefined}
        canManageTenants={canManageTenants}
        canSuspendTenants={canSuspendTenants}
        canManageAIProviders={canManageAIProviders}
      />
    </div>
    <Dialog open={Boolean(actionDialog)} onOpenChange={(open) => !open && setActionDialog(null)}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>
            {actionDialog?.type === 'suspend' ? 'Suspend Tenant' : 'Activate Tenant'}
          </DialogTitle>
          <DialogDescription>
            {actionDialog?.type === 'suspend'
              ? 'Suspending a tenant blocks access for all associated users.'
              : 'Reactivating a tenant restores access for all associated users.'}
          </DialogDescription>
        </DialogHeader>

        {actionDialog && (
          <div className="space-y-4">
            <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
              <p className="font-medium text-foreground">{actionDialog.tenant.name}</p>
              <p className="text-muted-foreground">{actionDialog.tenant.email}</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="tenant-action-reason">
                Reason {actionDialog.type === 'suspend' ? '(required)' : '(optional)'}
              </Label>
              <Input
                id="tenant-action-reason"
                value={actionReason}
                onChange={(event) => setActionReason(event.target.value)}
                placeholder={actionDialog.type === 'suspend' ? 'Provide a suspension reason' : 'Optional note'}
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
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => setActionDialog(null)} disabled={actionLoading}>
            Cancel
          </Button>
          <Button onClick={handleConfirmTenantAction} disabled={actionLoading}>
            {actionLoading ? 'Updating...' : actionDialog?.type === 'suspend' ? 'Suspend Tenant' : 'Activate Tenant'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  )
}


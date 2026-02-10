import { useEffect, useState, useCallback } from 'react'
import { useAuth } from '@clerk/clerk-react'
import { useNavigate } from 'react-router-dom'
import { TenantList } from '../../components/admin/TenantList'
import { Building2 } from 'lucide-react'
import { BatchOperationsPanel, BatchOperationType } from '../../components/admin/BatchOperationsPanel'
import { API_BASE_URL } from '@/lib/config'

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
  const { getToken } = useAuth()
  const navigate = useNavigate()
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

  const fetchTenants = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)
      const token = await getToken()
      
      const params = new URLSearchParams({
        page: page.toString(),
        per_page: perPage.toString(),
      })
      if (searchQuery) params.append('search', searchQuery)
      if (statusFilter) params.append('status_filter', statusFilter)

      const response = await fetch(`${API_BASE_URL}/admin/tenants/?${params}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      })

      if (!response.ok) {
        throw new Error(`Failed to fetch tenants: ${response.status}`)
      }

      const data = await response.json()
      setTenants(data.tenants)
      setTotal(data.total)
      setTotalPages(data.total_pages)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setIsLoading(false)
    }
  }, [getToken, page, perPage, searchQuery, statusFilter])

  useEffect(() => {
    fetchTenants()
  }, [fetchTenants])

  const handleSuspendTenant = async (tenantId: string) => {
    const reason = prompt('Enter suspension reason:')
    if (!reason) return

    try {
      const token = await getToken()
      const response = await fetch(`${API_BASE_URL}/admin/tenants/${tenantId}/suspend`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ reason, notify_users: true })
      })

      if (!response.ok) throw new Error('Failed to suspend tenant')
      fetchTenants()
    } catch (err) {
      alert('Failed to suspend tenant')
    }
  }

  const handleActivateTenant = async (tenantId: string) => {
    try {
      const token = await getToken()
      const response = await fetch(`${API_BASE_URL}/admin/tenants/${tenantId}/activate`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ notify_users: true })
      })

      if (!response.ok) throw new Error('Failed to activate tenant')
      fetchTenants()
    } catch (err) {
      alert('Failed to activate tenant')
    }
  }

  const toggleSelection = (tenantId: string) => {
    setSelectedIds(prev =>
      prev.includes(tenantId)
        ? prev.filter(id => id !== tenantId)
        : [...prev, tenantId]
    )
  }

  const selectAll = () => {
    setSelectedIds(tenants.map(t => t.clerk_id))
  }

  const clearSelection = () => {
    setSelectedIds([])
  }

  const handleBatchOperation = async (operation: BatchOperationType, reason?: string) => {
    try {
      setIsBatchLoading(true)
      const token = await getToken()

      // Map frontend operation to backend operation
      const backendOperation = operation === 'deactivate' ? 'suspend' : operation

      const response = await fetch(`${API_BASE_URL}/admin/tenants/batch`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          tenant_ids: selectedIds,
          operation: backendOperation,
          reason: reason,
          notify_users: true
        })
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.detail || `Failed: ${response.status}`)
      }

      const result = await response.json()
      alert(`${result.message}`)

      setSelectedIds([])
      fetchTenants()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Batch operation failed')
    } finally {
      setIsBatchLoading(false)
    }
  }

  return (
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
      <BatchOperationsPanel
        selectedIds={selectedIds}
        totalItems={tenants.length}
        onSelectAll={selectAll}
        onClearSelection={clearSelection}
        onBatchOperation={handleBatchOperation}
        isLoading={isBatchLoading}
        entityType="tenants"
      />

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
        onViewTenant={(id) => navigate(`/admin/tenants/${id}`)}
        onSuspendTenant={handleSuspendTenant}
        onActivateTenant={handleActivateTenant}
        selectedIds={selectedIds}
        onToggleSelection={toggleSelection}
      />
    </div>
  )
}


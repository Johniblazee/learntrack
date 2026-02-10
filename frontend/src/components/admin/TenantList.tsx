import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Building2,
  Search,
  MoreVertical,
  Eye,
  Ban,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Users,
  FileQuestion,
  Cpu
} from 'lucide-react'
import { SelectCheckbox } from './BatchOperationsPanel'

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

interface TenantListProps {
  tenants: TenantInfo[]
  total: number
  page: number
  perPage: number
  totalPages: number
  isLoading: boolean
  error: string | null
  onPageChange: (page: number) => void
  onSearch: (query: string) => void
  onStatusFilter: (status: string | null) => void
  onViewTenant: (tenantId: string) => void
  onSuspendTenant: (tenantId: string) => void
  onActivateTenant: (tenantId: string) => void
  selectedIds?: string[]
  onToggleSelection?: (tenantId: string) => void
}

const statusColors = {
  active: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  suspended: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  trial: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  expired: 'bg-muted text-muted-foreground',
}

export function TenantList({
  tenants, total, page, perPage, totalPages, isLoading, error,
  onPageChange, onSearch, onStatusFilter, onViewTenant, onSuspendTenant, onActivateTenant,
  selectedIds = [], onToggleSelection
}: TenantListProps) {
  const navigate = useNavigate()
  const [searchQuery, setSearchQuery] = useState('')
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    onSearch(searchQuery)
  }

  if (error) {
    return (
      <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-6">
        <p className="text-red-600 dark:text-red-400">Failed to load tenants: {error}</p>
      </div>
    )
  }

  return (
    <div className="bg-card rounded-xl shadow-sm border border-border">
      {/* Header */}
      <div className="p-6 border-b border-border">
        <div className="flex flex-col sm:flex-row gap-4 justify-between">
          <form onSubmit={handleSearch} className="flex-1 max-w-md">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search tenants..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-border rounded-lg bg-card text-foreground focus:ring-2 focus:ring-primary/40 focus:border-transparent"
              />
            </div>
          </form>
          <select
            onChange={(e) => onStatusFilter(e.target.value || null)}
            className="px-4 py-2 border border-border rounded-lg bg-card text-foreground"
          >
            <option value="">All Statuses</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
            <option value="pending">Pending</option>
            <option value="trial">Trial</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-muted/40">
            <tr>
              {onToggleSelection && <th className="w-12 px-4 py-3"></th>}
              <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Tenant</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Status</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Users</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Content</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Last Login</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading ? (
              [...Array(5)].map((_, i) => (
                <tr key={i} className="animate-pulse">
                  {onToggleSelection && <td className="px-4 py-4"><div className="h-5 w-5 bg-muted rounded"></div></td>}
                  <td className="px-6 py-4"><div className="h-4 bg-muted rounded w-32"></div></td>
                  <td className="px-6 py-4"><div className="h-4 bg-muted rounded w-16"></div></td>
                  <td className="px-6 py-4"><div className="h-4 bg-muted rounded w-12"></div></td>
                  <td className="px-6 py-4"><div className="h-4 bg-muted rounded w-12"></div></td>
                  <td className="px-6 py-4"><div className="h-4 bg-muted rounded w-24"></div></td>
                  <td className="px-6 py-4"><div className="h-4 bg-muted rounded w-8 ml-auto"></div></td>
                </tr>
              ))
            ) : tenants.length === 0 ? (
              <tr>
                <td colSpan={onToggleSelection ? 7 : 6} className="px-6 py-12 text-center text-muted-foreground">
                  <Building2 className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>No tenants found</p>
                </td>
              </tr>
            ) : (
              tenants.map((tenant) => (
                <tr key={tenant._id} className={`hover:bg-muted/50 transition-colors ${selectedIds.includes(tenant.clerk_id) ? 'bg-primary/10' : ''}`}>
                  {onToggleSelection && (
                    <td className="px-4 py-4">
                      <SelectCheckbox
                        checked={selectedIds.includes(tenant.clerk_id)}
                        onChange={() => onToggleSelection(tenant.clerk_id)}
                      />
                    </td>
                  )}
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                        <Building2 className="w-5 h-5 text-primary" />
                      </div>
                      <div>
                        <p className="font-medium text-foreground">{tenant.name}</p>
                        <p className="text-sm text-muted-foreground">{tenant.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${statusColors[tenant.status]}`}>
                      {tenant.status}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-1 text-sm text-muted-foreground">
                      <Users className="w-4 h-4" />
                      <span>{tenant.students_count + tenant.parents_count}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-1 text-sm text-muted-foreground">
                      <FileQuestion className="w-4 h-4" />
                      <span>{tenant.questions_count}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-muted-foreground">
                    {tenant.last_login ? new Date(tenant.last_login).toLocaleDateString() : 'Never'}
                  </td>
                  <td className="px-6 py-4 text-right relative">
                    <button onClick={() => setOpenMenuId(openMenuId === tenant._id ? null : tenant._id)} className="p-1 hover:bg-muted rounded">
                      <MoreVertical className="w-5 h-5 text-muted-foreground" />
                    </button>
                    {openMenuId === tenant._id && (
                      <div className="absolute right-6 top-full mt-1 w-48 bg-card rounded-lg shadow-lg border border-border z-10">
                        <button onClick={() => { onViewTenant(tenant.clerk_id); setOpenMenuId(null) }} className="w-full flex items-center gap-2 px-4 py-2 text-sm text-foreground hover:bg-muted">
                          <Eye className="w-4 h-4" /> View Details
                        </button>
                        <button onClick={() => { navigate(`/admin/tenants/${tenant.clerk_id}/ai-config`); setOpenMenuId(null) }} className="w-full flex items-center gap-2 px-4 py-2 text-sm text-primary hover:bg-primary/10">
                          <Cpu className="w-4 h-4" /> AI Config
                        </button>
                        {tenant.status === 'active' ? (
                          <button onClick={() => { onSuspendTenant(tenant.clerk_id); setOpenMenuId(null) }} className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20">
                            <Ban className="w-4 h-4" /> Suspend
                          </button>
                        ) : (
                          <button onClick={() => { onActivateTenant(tenant.clerk_id); setOpenMenuId(null) }} className="w-full flex items-center gap-2 px-4 py-2 text-sm text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20">
                            <CheckCircle className="w-4 h-4" /> Activate
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="px-6 py-4 border-t border-border flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Showing {(page - 1) * perPage + 1} to {Math.min(page * perPage, total)} of {total} tenants
          </p>
          <div className="flex items-center gap-2">
            <button onClick={() => onPageChange(page - 1)} disabled={page === 1} className="p-2 rounded-lg border border-border disabled:opacity-50 disabled:cursor-not-allowed hover:bg-muted">
              <ChevronLeft className="w-5 h-5" />
            </button>
            <span className="text-sm text-foreground">Page {page} of {totalPages}</span>
            <button onClick={() => onPageChange(page + 1)} disabled={page === totalPages} className="p-2 rounded-lg border border-border disabled:opacity-50 disabled:cursor-not-allowed hover:bg-muted">
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}


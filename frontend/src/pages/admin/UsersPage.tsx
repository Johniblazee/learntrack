import { useEffect, useState, useCallback } from 'react'
import { useAuth } from '@clerk/clerk-react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Users, Search, ChevronLeft, ChevronRight, MoreVertical, Eye, Edit, Shield, UserCheck } from 'lucide-react'
import { useImpersonation } from '../../contexts/ImpersonationContext'
import { BatchOperationsPanel, SelectCheckbox, BatchOperationType } from '../../components/admin/BatchOperationsPanel'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { API_BASE_URL } from '@/lib/config'

interface AdminUserInfo {
  id: string
  clerk_id: string
  email: string
  name: string
  role: string
  tutor_id?: string
  is_active: boolean
  is_super_admin: boolean
  created_at: string
  updated_at?: string
  last_login?: string
}

const roleColors: Record<string, string> = {
  tutor: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
  student: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  parent: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  super_admin: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
}

export function UsersPage() {
  const { getToken } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { startImpersonation, isLoading: isImpersonating } = useImpersonation()
  const [users, setUsers] = useState<AdminUserInfo[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [perPage] = useState(20)
  const [totalPages, setTotalPages] = useState(1)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  void error
  const [searchQuery, setSearchQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState<string>('')
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [impersonationTarget, setImpersonationTarget] = useState<AdminUserInfo | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [isBatchLoading, setIsBatchLoading] = useState(false)

  const handleOpenImpersonationDialog = (user: AdminUserInfo) => {
    if (user.is_super_admin) {
      alert('Cannot impersonate super admin users')
      return
    }

    setOpenMenuId(null)
    setImpersonationTarget(user)
  }

  const handleImpersonate = async () => {
    if (!impersonationTarget) {
      return
    }

    if (impersonationTarget.is_super_admin) {
      setImpersonationTarget(null)
      alert('Cannot impersonate super admin users')
      return
    }

    try {
      await startImpersonation(impersonationTarget.clerk_id)
      queryClient.clear()
      setImpersonationTarget(null)
      navigate('/dashboard')
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to start impersonation')
    }
  }

  const fetchUsers = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)
      const token = await getToken()
      
      const params = new URLSearchParams({ page: page.toString(), per_page: perPage.toString() })
      if (searchQuery) params.append('search', searchQuery)
      if (roleFilter) params.append('role_filter', roleFilter)

      const response = await fetch(`${API_BASE_URL}/admin/users/?${params}`, {
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
      })

      if (!response.ok) throw new Error(`Failed to fetch users: ${response.status}`)

      const data = await response.json()
      setUsers(data.users)
      setTotal(data.total)
      setTotalPages(data.total_pages)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setIsLoading(false)
    }
  }, [getToken, page, perPage, searchQuery, roleFilter])

  useEffect(() => { fetchUsers() }, [fetchUsers])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setPage(1)
    fetchUsers()
  }

  const toggleSelection = (userId: string) => {
    setSelectedIds(prev =>
      prev.includes(userId)
        ? prev.filter(id => id !== userId)
        : [...prev, userId]
    )
  }

  const selectAll = () => {
    const selectableUsers = users.filter(u => !u.is_super_admin)
    setSelectedIds(selectableUsers.map(u => u.clerk_id))
  }

  const clearSelection = () => {
    setSelectedIds([])
  }

  const handleBatchOperation = async (operation: BatchOperationType, reason?: string) => {
    try {
      setIsBatchLoading(true)
      const token = await getToken()

      const response = await fetch(`${API_BASE_URL}/admin/users/batch`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          user_ids: selectedIds,
          operation: operation,
          reason: reason,
          notify_users: false
        })
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.detail || `Failed: ${response.status}`)
      }

      const result = await response.json()
      alert(`${result.message}`)

      setSelectedIds([])
      fetchUsers()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Batch operation failed')
    } finally {
      setIsBatchLoading(false)
    }
  }

  return (
    <>
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-primary/10 rounded-lg">
          <Users className="w-6 h-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">User Management</h1>
          <p className="text-muted-foreground">Manage all users across tenants</p>
        </div>
      </div>

      {/* Batch Operations Panel */}
      <BatchOperationsPanel
        selectedIds={selectedIds}
        totalItems={users.filter(u => !u.is_super_admin).length}
        onSelectAll={selectAll}
        onClearSelection={clearSelection}
        onBatchOperation={handleBatchOperation}
        isLoading={isBatchLoading}
        entityType="users"
      />

      <div className="bg-card rounded-xl shadow-sm border border-border">
        <div className="p-6 border-b border-border">
          <div className="flex flex-col sm:flex-row gap-4 justify-between">
            <form onSubmit={handleSearch} className="flex-1 max-w-md">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                <input type="text" placeholder="Search users..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-border rounded-lg bg-card text-foreground focus:ring-2 focus:ring-primary/40" />
              </div>
            </form>
            <select value={roleFilter} onChange={(e) => { setRoleFilter(e.target.value); setPage(1) }}
              className="px-4 py-2 border border-border rounded-lg bg-card text-foreground">
              <option value="">All Roles</option>
              <option value="tutor">Tutors</option>
              <option value="student">Students</option>
              <option value="parent">Parents</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-muted/40">
              <tr>
                <th className="w-12 px-4 py-3"></th>
                <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase">User</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Role</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Created</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-muted-foreground uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading ? [...Array(5)].map((_, i) => (
                <tr key={i} className="animate-pulse">
                  <td className="px-4 py-4"><div className="h-5 w-5 bg-muted rounded"></div></td>
                  <td className="px-6 py-4"><div className="h-4 bg-muted rounded w-32"></div></td>
                  <td className="px-6 py-4"><div className="h-4 bg-muted rounded w-16"></div></td>
                  <td className="px-6 py-4"><div className="h-4 bg-muted rounded w-16"></div></td>
                  <td className="px-6 py-4"><div className="h-4 bg-muted rounded w-24"></div></td>
                  <td className="px-6 py-4"><div className="h-4 bg-muted rounded w-8 ml-auto"></div></td>
                </tr>
              )) : users.length === 0 ? (
                <tr><td colSpan={6} className="px-6 py-12 text-center text-muted-foreground"><Users className="w-12 h-12 mx-auto mb-4 opacity-50" /><p>No users found</p></td></tr>
              ) : users.map((user) => (
                <tr key={user.id} className={`hover:bg-muted/50 ${selectedIds.includes(user.clerk_id) ? 'bg-primary/10' : ''}`}>
                  <td className="px-4 py-4">
                    <SelectCheckbox
                      checked={selectedIds.includes(user.clerk_id)}
                      onChange={() => toggleSelection(user.clerk_id)}
                      disabled={user.is_super_admin}
                    />
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center text-sm font-medium">{user.name?.[0] || 'U'}</div>
                      <div>
                        <p className="font-medium text-foreground flex items-center gap-2">{user.name}{user.is_super_admin && <Shield className="w-4 h-4 text-red-500" />}</p>
                        <p className="text-sm text-muted-foreground">{user.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4"><span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${roleColors[user.role] || roleColors.tutor}`}>{user.role}</span></td>
                  <td className="px-6 py-4"><span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${user.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>{user.is_active ? 'Active' : 'Inactive'}</span></td>
                  <td className="px-6 py-4 text-sm text-muted-foreground">{new Date(user.created_at).toLocaleDateString()}</td>
                  <td className="px-6 py-4 text-right relative">
                    <button onClick={() => setOpenMenuId(openMenuId === user.id ? null : user.id)} className="p-1 hover:bg-muted rounded"><MoreVertical className="w-5 h-5 text-muted-foreground" /></button>
                    {openMenuId === user.id && (
                      <div className="absolute right-6 top-full mt-1 w-48 bg-card rounded-lg shadow-lg border border-border z-10">
                        <button onClick={() => setOpenMenuId(null)} className="w-full flex items-center gap-2 px-4 py-2 text-sm text-foreground hover:bg-muted rounded-t-lg"><Eye className="w-4 h-4" /> View</button>
                        <button onClick={() => setOpenMenuId(null)} className="w-full flex items-center gap-2 px-4 py-2 text-sm text-foreground hover:bg-muted"><Edit className="w-4 h-4" /> Edit</button>
                        {!user.is_super_admin && (
                          <button
                            onClick={() => handleOpenImpersonationDialog(user)}
                            disabled={isImpersonating}
                            className="w-full flex items-center gap-2 px-4 py-2 text-sm text-orange-600 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-900/20 rounded-b-lg disabled:opacity-50"
                          >
                            <UserCheck className="w-4 h-4" />
                            Act as User
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="px-6 py-4 border-t border-border flex items-center justify-between">
            <p className="text-sm text-muted-foreground">Showing {(page - 1) * perPage + 1} to {Math.min(page * perPage, total)} of {total}</p>
            <div className="flex items-center gap-2">
              <button onClick={() => setPage(p => p - 1)} disabled={page === 1} className="p-2 rounded-lg border border-border disabled:opacity-50"><ChevronLeft className="w-5 h-5" /></button>
              <span className="text-sm">Page {page} of {totalPages}</span>
              <button onClick={() => setPage(p => p + 1)} disabled={page === totalPages} className="p-2 rounded-lg border border-border disabled:opacity-50"><ChevronRight className="w-5 h-5" /></button>
            </div>
          </div>
        )}
      </div>
    </div>
    <Dialog open={Boolean(impersonationTarget)} onOpenChange={(open) => {
      if (!open) {
        setImpersonationTarget(null)
      }
    }}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Act as User</DialogTitle>
          <DialogDescription>
            You are about to enter this user account and see LearnTrack exactly as they see it.
          </DialogDescription>
        </DialogHeader>

        {impersonationTarget && (
          <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm space-y-1">
            <p className="font-medium text-foreground">{impersonationTarget.name}</p>
            <p className="text-muted-foreground">{impersonationTarget.email}</p>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Role: {impersonationTarget.role}
            </p>
          </div>
        )}

        <DialogFooter>
          <button
            type="button"
            onClick={() => setImpersonationTarget(null)}
            disabled={isImpersonating}
            className="px-4 py-2 text-sm border border-border rounded-lg hover:bg-muted disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleImpersonate}
            disabled={isImpersonating || !impersonationTarget}
            className="px-4 py-2 text-sm rounded-lg bg-[#5c4a38] text-white hover:bg-[#4a3c2e] disabled:opacity-50"
          >
            {isImpersonating ? 'Starting...' : 'Proceed as User'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  )
}


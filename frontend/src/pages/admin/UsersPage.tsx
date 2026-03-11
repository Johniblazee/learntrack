import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  ChevronLeft,
  ChevronRight,
  Edit,
  Eye,
  MoreVertical,
  Plus,
  Search,
  Shield,
  UserCheck,
  Users,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { BatchOperationType, BatchOperationsPanel, SelectCheckbox } from '../../components/admin/BatchOperationsPanel'
import { useImpersonation } from '../../contexts/ImpersonationContext'
import { type AdminPermission, useSuperAdmin } from '@/contexts/UserContext'
import { toast } from '@/contexts/ToastContext'
import { useApiClient } from '@/lib/api-client'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

interface AdminUserInfo {
  id: string
  clerk_id: string
  email: string
  name: string
  role: string
  tutor_id?: string
  is_active: boolean
  is_super_admin: boolean
  admin_permissions?: AdminPermission[]
  created_at: string
  updated_at?: string
  last_login?: string
}

interface AdminUserListResponse {
  users: AdminUserInfo[]
  total: number
  total_pages: number
}

interface UserEditForm {
  name: string
  is_active: boolean
  is_super_admin: boolean
  admin_permissions: AdminPermission[]
}

interface CreateTutorForm {
  email: string
  name: string
  clerk_id: string
  is_super_admin: boolean
  admin_permissions: AdminPermission[]
}

const ADMIN_PERMISSION_OPTIONS: Array<{
  value: AdminPermission
  label: string
  description: string
}> = [
  {
    value: 'full_access',
    label: 'Full access',
    description: 'Grant every admin permission automatically.',
  },
  {
    value: 'view_all_tenants',
    label: 'View tenants',
    description: 'See all tenant accounts and summaries.',
  },
  {
    value: 'manage_tenants',
    label: 'Manage tenants',
    description: 'Update tenant details and plans.',
  },
  {
    value: 'suspend_tenants',
    label: 'Suspend tenants',
    description: 'Suspend or reactivate tenant access.',
  },
  {
    value: 'view_all_users',
    label: 'View users',
    description: 'Access user directories and profiles.',
  },
  {
    value: 'manage_users',
    label: 'Manage users',
    description: 'Edit user details and status.',
  },
  {
    value: 'create_tutors',
    label: 'Create tutors',
    description: 'Provision new tutor accounts.',
  },
  {
    value: 'delete_users',
    label: 'Delete users',
    description: 'Remove user accounts permanently.',
  },
  {
    value: 'manage_system_settings',
    label: 'System settings',
    description: 'Update global configuration values.',
  },
  {
    value: 'manage_ai_providers',
    label: 'AI providers',
    description: 'Manage AI provider integrations.',
  },
  {
    value: 'manage_feature_flags',
    label: 'Feature flags',
    description: 'Toggle feature flags and rollouts.',
  },
  {
    value: 'view_analytics',
    label: 'View analytics',
    description: 'Access analytics dashboards.',
  },
  {
    value: 'export_data',
    label: 'Export data',
    description: 'Download reports and exports.',
  },
  {
    value: 'view_audit_logs',
    label: 'View audit logs',
    description: 'Review security and audit activity.',
  },
  {
    value: 'manage_security',
    label: 'Manage security',
    description: 'Change security-related settings.',
  },
]

const roleColors: Record<string, string> = {
  tutor: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
  student: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  parent: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  super_admin: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
}

const statusColors: Record<'active' | 'inactive', string> = {
  active: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400',
  inactive: 'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-400',
}

const formatRole = (role: string) =>
  role
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())

const formatDate = (value?: string) => (value ? new Date(value).toLocaleString() : '—')

const getUserIdentifier = (user: AdminUserInfo) => user.clerk_id || user.id

const buildEditForm = (user: AdminUserInfo): UserEditForm => ({
  name: user.name ?? '',
  is_active: user.is_active ?? true,
  is_super_admin: user.is_super_admin ?? false,
  admin_permissions: user.admin_permissions ?? [],
})

const initialCreateForm: CreateTutorForm = {
  email: '',
  name: '',
  clerk_id: '',
  is_super_admin: false,
  admin_permissions: [],
}

const togglePermission = (
  permissions: AdminPermission[],
  value: AdminPermission
): AdminPermission[] => {
  if (value === 'full_access') {
    return permissions.includes('full_access') ? [] : ['full_access']
  }

  const withoutFullAccess = permissions.filter((permission) => permission !== 'full_access')
  if (withoutFullAccess.includes(value)) {
    return withoutFullAccess.filter((permission) => permission !== value)
  }

  return [...withoutFullAccess, value]
}

export function UsersPage() {
  const client = useApiClient()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { startImpersonation, isLoading: isImpersonating } = useImpersonation()
  const { hasAdminPermission, hasFullAdminAccess } = useSuperAdmin()

  const canManageUsers = hasFullAdminAccess || hasAdminPermission('manage_users')
  const canCreateTutors = hasFullAdminAccess || hasAdminPermission('create_tutors')

  const [users, setUsers] = useState<AdminUserInfo[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [perPage] = useState(20)
  const [totalPages, setTotalPages] = useState(1)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState<string>('')
  const [impersonationTarget, setImpersonationTarget] = useState<AdminUserInfo | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [isBatchLoading, setIsBatchLoading] = useState(false)

  const [viewOpen, setViewOpen] = useState(false)
  const [viewLoading, setViewLoading] = useState(false)
  const [viewUser, setViewUser] = useState<AdminUserInfo | null>(null)

  const [editOpen, setEditOpen] = useState(false)
  const [editLoading, setEditLoading] = useState(false)
  const [editSaving, setEditSaving] = useState(false)
  const [editUser, setEditUser] = useState<AdminUserInfo | null>(null)
  const [editForm, setEditForm] = useState<UserEditForm | null>(null)

  const [createOpen, setCreateOpen] = useState(false)
  const [createSaving, setCreateSaving] = useState(false)
  const [createForm, setCreateForm] = useState<CreateTutorForm>(initialCreateForm)

  const fetchUsers = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)

      const params = new URLSearchParams({ page: page.toString(), per_page: perPage.toString() })
      if (searchQuery) params.append('search', searchQuery)
      if (roleFilter) params.append('role_filter', roleFilter)

      const response = await client.get<AdminUserListResponse>(`/admin/users/?${params}`)
      if (response.error) {
        throw new Error(response.error)
      }

      const data = response.data
      if (!data) {
        throw new Error('No user data returned')
      }

      setUsers(data.users)
      setTotal(data.total)
      setTotalPages(data.total_pages)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setIsLoading(false)
    }
  }, [client, page, perPage, searchQuery, roleFilter])

  useEffect(() => {
    fetchUsers()
  }, [fetchUsers])

  const loadUserDetails = useCallback(
    async (user: AdminUserInfo) => {
      const userId = getUserIdentifier(user)
      const response = await client.get<AdminUserInfo>(`/admin/users/${userId}`)
      if (response.error) {
        throw new Error(response.error)
      }
      if (!response.data) {
        throw new Error('No user details returned')
      }
      return response.data
    },
    [client]
  )

  const handleSearch = (event: FormEvent) => {
    event.preventDefault()
    setPage(1)
    fetchUsers()
  }

  const toggleSelection = (userId: string) => {
    if (!canManageUsers) {
      return
    }

    setSelectedIds((prev) =>
      prev.includes(userId)
        ? prev.filter((id) => id !== userId)
        : [...prev, userId]
    )
  }

  const selectAll = () => {
    if (!canManageUsers) {
      return
    }

    const selectableUsers = users.filter((user) => !user.is_super_admin)
    setSelectedIds(selectableUsers.map((user) => user.clerk_id))
  }

  const clearSelection = () => {
    setSelectedIds([])
  }

  const handleBatchOperation = async (operation: BatchOperationType, reason?: string) => {
    if (!canManageUsers) {
      toast.error('You do not have permission to manage users.')
      return
    }

    try {
      setIsBatchLoading(true)
      const response = await client.post<{ message?: string }>(`/admin/users/batch`, {
        user_ids: selectedIds,
        operation: operation,
        reason: reason,
        notify_users: false,
      })

      if (response.error) {
        throw new Error(response.error)
      }

      toast.success(response.data?.message || 'Batch operation completed')
      setSelectedIds([])
      fetchUsers()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Batch operation failed')
    } finally {
      setIsBatchLoading(false)
    }
  }

  const handleOpenImpersonationDialog = (user: AdminUserInfo) => {
    if (user.is_super_admin) {
      toast.error('Cannot impersonate super admin users')
      return
    }

    setImpersonationTarget(user)
  }

  const handleImpersonate = async () => {
    if (!impersonationTarget) {
      return
    }

    if (impersonationTarget.is_super_admin) {
      setImpersonationTarget(null)
      toast.error('Cannot impersonate super admin users')
      return
    }

    try {
      await startImpersonation(impersonationTarget.clerk_id)
      queryClient.clear()
      setImpersonationTarget(null)
      navigate('/dashboard')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to start impersonation')
    }
  }

  const openViewDialog = async (user: AdminUserInfo) => {
    setViewOpen(true)
    setViewLoading(true)
    setViewUser(user)

    try {
      const details = await loadUserDetails(user)
      setViewUser(details)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load user details')
    } finally {
      setViewLoading(false)
    }
  }

  const openEditDialog = async (user: AdminUserInfo) => {
    if (!canManageUsers) {
      toast.error('You do not have permission to edit users.')
      return
    }

    setEditOpen(true)
    setEditLoading(true)
    setEditUser(user)
    setEditForm(buildEditForm(user))

    try {
      const details = await loadUserDetails(user)
      setEditUser(details)
      setEditForm(buildEditForm(details))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load user details')
    } finally {
      setEditLoading(false)
    }
  }

  const closeEditDialog = () => {
    if (editSaving) {
      return
    }
    setEditOpen(false)
    setEditUser(null)
    setEditForm(null)
    setEditLoading(false)
  }

  const handleEditSubmit = async () => {
    if (!editForm || !editUser) {
      return
    }

    if (!editForm.name.trim()) {
      toast.error('Name is required')
      return
    }

    try {
      setEditSaving(true)
      const payload = {
        name: editForm.name.trim(),
        is_active: editForm.is_active,
        is_super_admin: editForm.is_super_admin,
        admin_permissions: editForm.is_super_admin ? editForm.admin_permissions : [],
      }

      const response = await client.patch(`/admin/users/${getUserIdentifier(editUser)}`, payload)
      if (response.error) {
        throw new Error(response.error)
      }

      toast.success('User updated successfully')
      closeEditDialog()
      fetchUsers()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update user')
    } finally {
      setEditSaving(false)
    }
  }

  const openCreateDialog = () => {
    setCreateForm(initialCreateForm)
    setCreateOpen(true)
  }

  const closeCreateDialog = () => {
    if (createSaving) {
      return
    }
    setCreateOpen(false)
    setCreateForm(initialCreateForm)
  }

  const handleCreateTutor = async () => {
    if (!createForm.email.trim() || !createForm.name.trim() || !createForm.clerk_id.trim()) {
      toast.error('Name, email, and Clerk ID are required')
      return
    }

    try {
      setCreateSaving(true)
      const payload = {
        email: createForm.email.trim(),
        name: createForm.name.trim(),
        clerk_id: createForm.clerk_id.trim(),
        is_super_admin: createForm.is_super_admin,
        admin_permissions: createForm.is_super_admin ? createForm.admin_permissions : [],
      }

      const response = await client.post(`/admin/users/tutors`, payload)
      if (response.error) {
        throw new Error(response.error)
      }

      toast.success('Tutor created successfully')
      closeCreateDialog()
      fetchUsers()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create tutor')
    } finally {
      setCreateSaving(false)
    }
  }

  return (
    <>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/10 rounded-lg">
              <Users className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground">User Management</h1>
              <p className="text-muted-foreground">Manage all users across tenants</p>
            </div>
          </div>
          {canCreateTutors && (
            <Button onClick={openCreateDialog} className="gap-2">
              <Plus className="w-4 h-4" />
              New Tutor
            </Button>
          )}
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertTitle>Unable to load users</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {canManageUsers && (
          <BatchOperationsPanel
            selectedIds={selectedIds}
            totalItems={users.filter((user) => !user.is_super_admin).length}
            onSelectAll={selectAll}
            onClearSelection={clearSelection}
            onBatchOperation={handleBatchOperation}
            isLoading={isBatchLoading}
            entityType="users"
          />
        )}

        <div className="bg-card rounded-xl shadow-sm border border-border">
          <div className="p-6 border-b border-border">
            <div className="flex flex-col sm:flex-row gap-4 justify-between">
              <form onSubmit={handleSearch} className="flex-1 max-w-md">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                  <Input
                    type="text"
                    placeholder="Search users..."
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    className="pl-10"
                  />
                </div>
              </form>
              <Select
                value={roleFilter || 'all'}
                onValueChange={(value) => {
                  setRoleFilter(value === 'all' ? '' : value)
                  setPage(1)
                }}
              >
                <SelectTrigger className="sm:w-[180px]">
                  <SelectValue placeholder="All roles" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Roles</SelectItem>
                  <SelectItem value="tutor">Tutors</SelectItem>
                  <SelectItem value="student">Students</SelectItem>
                  <SelectItem value="parent">Parents</SelectItem>
                  <SelectItem value="super_admin">Super Admins</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12"></TableHead>
                <TableHead>User</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                [...Array(5)].map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-5 w-5" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-40" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="h-4 w-8 ml-auto" /></TableCell>
                  </TableRow>
                ))
              ) : users.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-12 text-center text-muted-foreground">
                    <Users className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p>No users found</p>
                  </TableCell>
                </TableRow>
              ) : (
                users.map((user) => (
                  <TableRow
                    key={user.id}
                    data-state={selectedIds.includes(user.clerk_id) ? 'selected' : undefined}
                  >
                    <TableCell>
                      <SelectCheckbox
                        checked={selectedIds.includes(user.clerk_id)}
                        onChange={() => toggleSelection(user.clerk_id)}
                        disabled={!canManageUsers || user.is_super_admin}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center text-sm font-medium">
                          {user.name?.[0] || 'U'}
                        </div>
                        <div>
                          <p className="font-medium text-foreground flex items-center gap-2">
                            {user.name || 'Unnamed User'}
                            {user.is_super_admin && <Shield className="w-4 h-4 text-red-500" />}
                          </p>
                          <p className="text-sm text-muted-foreground">{user.email}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge className={roleColors[user.role] || roleColors.tutor}>
                        {formatRole(user.role)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge className={user.is_active ? statusColors.active : statusColors.inactive}>
                        {user.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(user.created_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreVertical className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openViewDialog(user)}>
                            <Eye className="w-4 h-4" /> View
                          </DropdownMenuItem>
                          {canManageUsers && (
                            <DropdownMenuItem onClick={() => openEditDialog(user)}>
                              <Edit className="w-4 h-4" /> Edit
                            </DropdownMenuItem>
                          )}
                          {!user.is_super_admin && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={() => handleOpenImpersonationDialog(user)}
                                disabled={isImpersonating}
                                className="text-amber-600 focus:text-amber-600"
                              >
                                <UserCheck className="w-4 h-4" /> Act as User
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>

          {totalPages > 1 && (
            <div className="px-6 py-4 border-t border-border flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Showing {(page - 1) * perPage + 1} to {Math.min(page * perPage, total)} of {total}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setPage((current) => current - 1)}
                  disabled={page === 1}
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <span className="text-sm">Page {page} of {totalPages}</span>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setPage((current) => current + 1)}
                  disabled={page === totalPages}
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      <Dialog
        open={viewOpen}
        onOpenChange={(open) => {
          if (!open) {
            setViewOpen(false)
            setViewUser(null)
            setViewLoading(false)
          }
        }}
      >
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>User Details</DialogTitle>
            <DialogDescription>Review account details before taking action.</DialogDescription>
          </DialogHeader>
          {viewLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          ) : viewUser ? (
            <div className="space-y-5">
              <div className="rounded-lg border border-border p-4 space-y-3">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-lg font-semibold text-foreground">{viewUser.name || 'Unnamed User'}</p>
                    <p className="text-sm text-muted-foreground">{viewUser.email}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge className={roleColors[viewUser.role] || roleColors.tutor}>
                      {formatRole(viewUser.role)}
                    </Badge>
                    {viewUser.is_super_admin && (
                      <Badge variant="destructive">Super Admin</Badge>
                    )}
                  </div>
                </div>
                <div className="grid gap-3 text-sm sm:grid-cols-2">
                  <div>
                    <p className="text-muted-foreground">Status</p>
                    <p className="font-medium">{viewUser.is_active ? 'Active' : 'Inactive'}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Clerk ID</p>
                    <p className="font-medium break-all">{viewUser.clerk_id}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Created</p>
                    <p className="font-medium">{formatDate(viewUser.created_at)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Last login</p>
                    <p className="font-medium">{formatDate(viewUser.last_login)}</p>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium text-foreground">Admin permissions</p>
                {viewUser.admin_permissions && viewUser.admin_permissions.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {viewUser.admin_permissions.map((permission) => (
                      <Badge key={permission} variant="outline">
                        {permission.replace(/_/g, ' ')}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No admin permissions assigned.</p>
                )}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No user selected.</p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editOpen} onOpenChange={(open) => !open && closeEditDialog()}>
        <DialogContent className="sm:max-w-[640px]">
          <DialogHeader>
            <DialogTitle>Edit User</DialogTitle>
            <DialogDescription>Update user status and permissions.</DialogDescription>
          </DialogHeader>
          {editLoading || !editForm || !editUser ? (
            <div className="space-y-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : (
            <div className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="edit-name">Full name</Label>
                  <Input
                    id="edit-name"
                    value={editForm.name}
                    onChange={(event) => setEditForm({ ...editForm, name: event.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Email</Label>
                  <Input value={editUser.email} readOnly className="bg-muted/40" />
                </div>
                <div className="space-y-2">
                  <Label>Clerk ID</Label>
                  <Input value={editUser.clerk_id} readOnly className="bg-muted/40" />
                </div>
                <div className="space-y-2">
                  <Label>Role</Label>
                  <Input value={formatRole(editUser.role)} readOnly className="bg-muted/40" />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex items-center justify-between rounded-lg border border-border p-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">Active account</p>
                    <p className="text-xs text-muted-foreground">Disable to block sign-in.</p>
                  </div>
                  <Switch
                    checked={editForm.is_active}
                    onCheckedChange={(checked) => setEditForm({ ...editForm, is_active: checked })}
                  />
                </div>
                <div className="flex items-center justify-between rounded-lg border border-border p-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">Super admin</p>
                    <p className="text-xs text-muted-foreground">Grant access to the admin panel.</p>
                  </div>
                  <Switch
                    checked={editForm.is_super_admin}
                    onCheckedChange={(checked) =>
                      setEditForm({
                        ...editForm,
                        is_super_admin: checked,
                        admin_permissions: checked ? editForm.admin_permissions : [],
                      })
                    }
                  />
                </div>
              </div>

              <div className="space-y-3">
                <div>
                  <p className="text-sm font-medium text-foreground">Admin permissions</p>
                  <p className="text-xs text-muted-foreground">
                    Enable super admin to adjust granular permissions.
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {ADMIN_PERMISSION_OPTIONS.map((permission) => {
                    const isFullAccess = editForm.admin_permissions.includes('full_access')
                    const isChecked = editForm.admin_permissions.includes(permission.value)
                    const isDisabled = !editForm.is_super_admin || (isFullAccess && permission.value !== 'full_access')

                    return (
                      <label
                        key={permission.value}
                        className="flex items-start gap-3 rounded-lg border border-border p-3 text-sm"
                      >
                        <Checkbox
                          checked={isChecked}
                          disabled={isDisabled}
                          onCheckedChange={() =>
                            setEditForm({
                              ...editForm,
                              admin_permissions: togglePermission(editForm.admin_permissions, permission.value),
                            })
                          }
                        />
                        <span className="space-y-1">
                          <span className="font-medium text-foreground block">{permission.label}</span>
                          <span className="text-xs text-muted-foreground block">{permission.description}</span>
                        </span>
                      </label>
                    )
                  })}
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={closeEditDialog} disabled={editSaving}>
              Cancel
            </Button>
            <Button onClick={handleEditSubmit} disabled={editSaving || editLoading || !editForm}>
              {editSaving ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={createOpen} onOpenChange={(open) => !open && closeCreateDialog()}>
        <DialogContent className="sm:max-w-[640px]">
          <DialogHeader>
            <DialogTitle>Create Tutor</DialogTitle>
            <DialogDescription>Add a new tutor account with optional admin access.</DialogDescription>
          </DialogHeader>
          <div className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="create-name">Full name</Label>
                <Input
                  id="create-name"
                  value={createForm.name}
                  onChange={(event) => setCreateForm({ ...createForm, name: event.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="create-email">Email</Label>
                <Input
                  id="create-email"
                  type="email"
                  value={createForm.email}
                  onChange={(event) => setCreateForm({ ...createForm, email: event.target.value })}
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="create-clerk">Clerk ID</Label>
                <Input
                  id="create-clerk"
                  value={createForm.clerk_id}
                  onChange={(event) => setCreateForm({ ...createForm, clerk_id: event.target.value })}
                />
              </div>
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <div>
                <p className="text-sm font-medium text-foreground">Grant super admin access</p>
                <p className="text-xs text-muted-foreground">Add permissions for admin tools.</p>
              </div>
              <Switch
                checked={createForm.is_super_admin}
                onCheckedChange={(checked) =>
                  setCreateForm({
                    ...createForm,
                    is_super_admin: checked,
                    admin_permissions: checked ? createForm.admin_permissions : [],
                  })
                }
              />
            </div>

            <div className="space-y-3">
              <div>
                <p className="text-sm font-medium text-foreground">Admin permissions</p>
                <p className="text-xs text-muted-foreground">Visible only when super admin is enabled.</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {ADMIN_PERMISSION_OPTIONS.map((permission) => {
                  const isFullAccess = createForm.admin_permissions.includes('full_access')
                  const isChecked = createForm.admin_permissions.includes(permission.value)
                  const isDisabled = !createForm.is_super_admin || (isFullAccess && permission.value !== 'full_access')

                  return (
                    <label
                      key={permission.value}
                      className="flex items-start gap-3 rounded-lg border border-border p-3 text-sm"
                    >
                      <Checkbox
                        checked={isChecked}
                        disabled={isDisabled}
                        onCheckedChange={() =>
                          setCreateForm({
                            ...createForm,
                            admin_permissions: togglePermission(createForm.admin_permissions, permission.value),
                          })
                        }
                      />
                      <span className="space-y-1">
                        <span className="font-medium text-foreground block">{permission.label}</span>
                        <span className="text-xs text-muted-foreground block">{permission.description}</span>
                      </span>
                    </label>
                  )
                })}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeCreateDialog} disabled={createSaving}>
              Cancel
            </Button>
            <Button onClick={handleCreateTutor} disabled={createSaving}>
              {createSaving ? 'Creating...' : 'Create Tutor'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(impersonationTarget)}
        onOpenChange={(open) => {
          if (!open) {
            setImpersonationTarget(null)
          }
        }}
      >
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
            <Button variant="outline" onClick={() => setImpersonationTarget(null)} disabled={isImpersonating}>
              Cancel
            </Button>
            <Button onClick={handleImpersonate} disabled={isImpersonating || !impersonationTarget}>
              {isImpersonating ? 'Starting...' : 'Proceed as User'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

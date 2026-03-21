import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Ban,
  Building2,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Cpu,
  Eye,
  FileQuestion,
  MoreVertical,
  Search,
  Users,
} from 'lucide-react'

import { Checkbox } from '@/components/ui/checkbox'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

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
  statusFilter?: string | null
  canManageTenants?: boolean
  canSuspendTenants?: boolean
  canManageAIProviders?: boolean
}

const statusColors: Record<TenantInfo['status'], string> = {
  active: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  suspended: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  trial: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  expired: 'bg-muted text-muted-foreground',
}

const formatStatusLabel = (status: TenantInfo['status']) =>
  status.charAt(0).toUpperCase() + status.slice(1)

export function TenantList({
  tenants,
  total,
  page,
  perPage,
  totalPages,
  isLoading,
  error,
  onPageChange,
  onSearch,
  onStatusFilter,
  onViewTenant,
  onSuspendTenant,
  onActivateTenant,
  selectedIds = [],
  onToggleSelection,
  statusFilter,
  canManageTenants = false,
  canSuspendTenants = false,
  canManageAIProviders = false,
}: TenantListProps) {
  const navigate = useNavigate()
  const [searchQuery, setSearchQuery] = useState('')

  const handleSearch = (event: React.FormEvent) => {
    event.preventDefault()
    onSearch(searchQuery)
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Failed to load tenants</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="bg-card rounded-xl shadow-sm border border-border">
      <div className="p-6 border-b border-border">
        <div className="flex flex-col sm:flex-row gap-4 justify-between">
          <form onSubmit={handleSearch} className="flex-1 max-w-md">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Search tenants..."
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                className="pl-10"
              />
            </div>
          </form>
          <Select
            value={statusFilter || 'all'}
            onValueChange={(value) => onStatusFilter(value === 'all' ? null : value)}
          >
            <SelectTrigger className="sm:w-[180px]">
              <SelectValue placeholder="All Statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="suspended">Suspended</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="trial">Trial</SelectItem>
              <SelectItem value="expired">Expired</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            {onToggleSelection && <TableHead className="w-12"></TableHead>}
            <TableHead>Tenant</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Users</TableHead>
            <TableHead>Content</TableHead>
            <TableHead>Last Login</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            [...Array(5)].map((_, i) => (
              <TableRow key={i}>
                {onToggleSelection && (
                  <TableCell>
                    <Skeleton className="h-5 w-5" />
                  </TableCell>
                )}
                <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                <TableCell><Skeleton className="h-4 w-12" /></TableCell>
                <TableCell><Skeleton className="h-4 w-12" /></TableCell>
                <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                <TableCell className="text-right"><Skeleton className="h-4 w-8 ml-auto" /></TableCell>
              </TableRow>
            ))
          ) : tenants.length === 0 ? (
            <TableRow>
              <TableCell colSpan={onToggleSelection ? 7 : 6} className="py-12 text-center text-muted-foreground">
                <Building2 className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>No tenants found</p>
              </TableCell>
            </TableRow>
          ) : (
            tenants.map((tenant) => (
              <TableRow key={tenant._id} data-state={selectedIds.includes(tenant.clerk_id) ? 'selected' : undefined}>
                {onToggleSelection && (
                  <TableCell>
                    <Checkbox
                      checked={selectedIds.includes(tenant.clerk_id)}
                      onCheckedChange={() => onToggleSelection(tenant.clerk_id)}
                      disabled={!canSuspendTenants}
                    />
                  </TableCell>
                )}
                <TableCell>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                      <Building2 className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium text-foreground">{tenant.name}</p>
                      <p className="text-sm text-muted-foreground">{tenant.email}</p>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge className={statusColors[tenant.status]}>
                    {formatStatusLabel(tenant.status)}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1 text-sm text-muted-foreground">
                    <Users className="w-4 h-4" />
                    <span>{tenant.students_count + tenant.parents_count}</span>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1 text-sm text-muted-foreground">
                    <FileQuestion className="w-4 h-4" />
                    <span>{tenant.questions_count}</span>
                  </div>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {tenant.last_login ? new Date(tenant.last_login).toLocaleDateString() : 'Never'}
                </TableCell>
                <TableCell className="text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon">
                        <MoreVertical className="w-4 h-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => onViewTenant(tenant.clerk_id)}>
                        <Eye className="w-4 h-4" /> View Details
                      </DropdownMenuItem>
                      {canManageAIProviders && (
                        <DropdownMenuItem onClick={() => navigate(`/admin/tenants/${tenant.clerk_id}/ai-config`)}>
                          <Cpu className="w-4 h-4" /> AI Config
                        </DropdownMenuItem>
                      )}
                      {(canSuspendTenants || canManageTenants) && <DropdownMenuSeparator />}
                      {tenant.status === 'active' ? (
                        canSuspendTenants && (
                          <DropdownMenuItem
                            onClick={() => onSuspendTenant(tenant.clerk_id)}
                            className="text-red-600 focus:text-red-600"
                          >
                            <Ban className="w-4 h-4" /> Suspend
                          </DropdownMenuItem>
                        )
                      ) : (
                        canManageTenants && (
                          <DropdownMenuItem
                            onClick={() => onActivateTenant(tenant.clerk_id)}
                            className="text-green-600 focus:text-green-600"
                          >
                            <CheckCircle className="w-4 h-4" /> Activate
                          </DropdownMenuItem>
                        )
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
            Showing {(page - 1) * perPage + 1} to {Math.min(page * perPage, total)} of {total} tenants
          </p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={() => onPageChange(page - 1)} disabled={page === 1}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span className="text-sm text-foreground">Page {page} of {totalPages}</span>
            <Button variant="outline" size="icon" onClick={() => onPageChange(page + 1)} disabled={page === totalPages}>
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

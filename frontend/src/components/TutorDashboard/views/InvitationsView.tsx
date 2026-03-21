import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { StatsCard } from '@/components/ui/stats-card'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Plus, RefreshCw, Search, Mail, CheckCircle, XCircle, Clock, Send } from 'lucide-react'
import InviteUserModal from '@/components/InviteUserModal'
import { useApiClient } from '@/lib/api-client'
import { toast } from '@/contexts/ToastContext'
import { formatDistanceToNow } from 'date-fns'
import { cn } from '@/lib/utils'
import { LoadingSpinner } from '@/components/ui/loading-state'

interface Invitation {
  id: string
  invitee_email: string
  invitee_name?: string
  role: 'student' | 'parent'
  status: 'pending' | 'accepted' | 'expired' | 'revoked' | 'rejected'
  token: string
  message?: string
  student_ids: string[]
  created_at: string
  expires_at: string
  accepted_at?: string
}

interface InvitationStats {
  total: number
  pending: number
  accepted: number
  expired: number
  revoked: number
  rejected: number
}

export default function InvitationsView() {
  const client = useApiClient()
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [stats, setStats] = useState<InvitationStats>({
    total: 0,
    pending: 0,
    accepted: 0,
    expired: 0,
    revoked: 0,
    rejected: 0
  })
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState("")
  const [refreshing, setRefreshing] = useState(false)
  const [revokingId, setRevokingId] = useState<string | null>(null)
  const [resendingId, setResendingId] = useState<string | null>(null)

  const loadInvitations = useCallback(async () => {
    try {
      setLoading(true)
      const response = await client.get('/invitations/')

      if (response.error) throw new Error(response.error)

      const data = response.data
      setInvitations(data.invitations || [])
      setStats({
        total: data.total || 0,
        pending: data.pending || 0,
        accepted: data.accepted || 0,
        expired: data.expired || 0,
        revoked: data.revoked || 0,
        rejected: data.rejected || 0
      })
    } catch (error) {
      console.error('Failed to load invitations:', error)
      toast.error('Failed to load invitations')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [client])

  useEffect(() => {
    loadInvitations()
  }, [loadInvitations])

  const handleRefresh = () => {
    setRefreshing(true)
    loadInvitations()
  }

  const handleInviteSuccess = () => {
    loadInvitations()
  }

  const handleResend = async (invitationId: string) => {
    if (resendingId === invitationId) return

    try {
      setResendingId(invitationId)
      const response = await client.post(`/invitations/${invitationId}/resend`)

      if (response.error) throw new Error(response.error)

      toast.success('Invitation resent successfully')
      loadInvitations()
    } catch (error) {
      console.error('Failed to resend invitation:', error)
      toast.error('Failed to resend invitation')
    } finally {
      setResendingId(null)
    }
  }

  const handleRevoke = async (invitationId: string) => {
    if (revokingId === invitationId) return

    try {
      setRevokingId(invitationId)
      const response = await client.delete(`/invitations/${invitationId}`)

      if (response.error) throw new Error(response.error)

      toast.success('Invitation revoked successfully')
      loadInvitations()
    } catch (error) {
      console.error('Failed to revoke invitation:', error)
      toast.error('Failed to revoke invitation')
    } finally {
      setRevokingId(null)
    }
  }

  // Filter invitations by search term
  const filteredInvitations = invitations.filter(invitation => {
    const searchLower = searchTerm.toLowerCase()
    return invitation.invitee_email.toLowerCase().includes(searchLower)
  })

  const getRelativeTime = (dateString: string) => {
    try {
      return formatDistanceToNow(new Date(dateString), { addSuffix: true })
    } catch {
      return 'Unknown'
    }
  }

  const getStatusConfig = (status: string) => {
    switch (status) {
      case 'pending':
        return {
          icon: Clock,
          label: 'Pending',
          color: 'text-amber-600 dark:text-amber-400',
          bgColor: 'bg-amber-50 dark:bg-amber-950/30',
          borderColor: 'border-amber-200 dark:border-amber-800',
          dotColor: 'bg-amber-500'
        }
      case 'accepted':
        return {
          icon: CheckCircle,
          label: 'Accepted',
          color: 'text-emerald-600 dark:text-emerald-400',
          bgColor: 'bg-emerald-50 dark:bg-emerald-950/30',
          borderColor: 'border-emerald-200 dark:border-emerald-800',
          dotColor: 'bg-emerald-500'
        }
      case 'expired':
        return {
          icon: Clock,
          label: 'Expired',
          color: 'text-muted-foreground',
          bgColor: 'bg-muted',
          borderColor: 'border-border',
          dotColor: 'bg-muted-foreground'
        }
      case 'revoked':
        return {
          icon: XCircle,
          label: 'Revoked',
          color: 'text-red-600 dark:text-red-400',
          bgColor: 'bg-red-50 dark:bg-red-950/30',
          borderColor: 'border-red-200 dark:border-red-800',
          dotColor: 'bg-red-500'
        }
      case 'rejected':
        return {
          icon: XCircle,
          label: 'Rejected',
          color: 'text-rose-600 dark:text-rose-400',
          bgColor: 'bg-rose-50 dark:bg-rose-950/30',
          borderColor: 'border-rose-200 dark:border-rose-800',
          dotColor: 'bg-rose-500'
        }
      default:
        return {
          icon: Clock,
          label: status,
          color: 'text-muted-foreground',
          bgColor: 'bg-muted',
          borderColor: 'border-border',
          dotColor: 'bg-muted-foreground'
        }
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/10 rounded-lg">
              <Mail className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground">
                Manage Invitations
              </h1>
            </div>
            <Button
              onClick={handleRefresh}
              variant="ghost"
              size="icon"
              disabled={refreshing}
              className="h-8 w-8"
            >
              {refreshing ? (
                <LoadingSpinner size="sm" className="text-foreground" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
            </Button>
          </div>
          <p className="text-sm text-muted-foreground mt-2 ml-12">
            Send and track invitations for students and parents to join your class.
          </p>
        </div>
        <Button
          onClick={() => setShowInviteModal(true)}
          className="bg-[#5c4a38] hover:bg-[#4a3a2a] text-white"
        >
          <Plus className="w-4 h-4 mr-2" />
          Send New Invitation
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatsCard
          label="Pending"
          value={stats.pending}
          icon={Clock}
          iconColor="text-amber-600"
          iconClassName="bg-amber-50"
          className="border shadow-sm"
        />
        <StatsCard
          label="Accepted"
          value={stats.accepted}
          icon={CheckCircle}
          iconColor="text-emerald-600"
          iconClassName="bg-emerald-50"
          className="border shadow-sm"
        />
        <StatsCard
          label="Expired"
          value={stats.expired}
          icon={Clock}
          iconColor="text-muted-foreground"
          iconClassName="bg-muted"
          className="border shadow-sm"
        />
        <StatsCard
          label="Rejected"
          value={stats.rejected}
          icon={XCircle}
          iconColor="text-rose-600"
          iconClassName="bg-rose-50"
          className="border shadow-sm"
        />
      </div>

      {/* Search Bar */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
          <Input
            placeholder="Search by email address..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10 bg-background"
          />
        </div>
      </div>

      {/* Invitations Table */}
      <Card className="border shadow-sm">
        <CardContent className="p-0">
          <div className="overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50 border-b">
                  <TableHead className="w-[35%] font-semibold">Email</TableHead>
                  <TableHead className="w-[15%] font-semibold">Role</TableHead>
                  <TableHead className="w-[15%] font-semibold">Status</TableHead>
                  <TableHead className="w-[20%] font-semibold">Date Sent</TableHead>
                  <TableHead className="w-[15%] font-semibold text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 5 }).map((_, index) => (
                    <TableRow key={index} className="border-b last:border-0">
                      <TableCell>
                        <div className="h-4 bg-muted rounded w-48 animate-pulse"></div>
                      </TableCell>
                      <TableCell>
                        <div className="h-4 bg-muted rounded w-20 animate-pulse"></div>
                      </TableCell>
                      <TableCell>
                        <div className="h-6 bg-muted rounded w-24 animate-pulse"></div>
                      </TableCell>
                      <TableCell>
                        <div className="h-4 bg-muted rounded w-32 animate-pulse"></div>
                      </TableCell>
                      <TableCell>
                        <div className="h-8 bg-muted rounded w-24 animate-pulse ml-auto"></div>
                      </TableCell>
                    </TableRow>
                  ))
                ) : filteredInvitations.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-16">
                      <div className="flex flex-col items-center gap-3">
                        <div className="p-4 bg-muted rounded-full">
                          <Send className="w-8 h-8 text-muted-foreground" />
                        </div>
                        <p className="text-muted-foreground font-medium">
                          No invitations found
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {searchTerm ? 'Try adjusting your search' : 'Send your first invitation to get started'}
                        </p>
                        {!searchTerm && (
                          <Button
                            onClick={() => setShowInviteModal(true)}
                            variant="outline"
                            className="mt-2"
                          >
                            <Plus className="w-4 h-4 mr-2" />
                            Send Invitation
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredInvitations.map((invitation) => {
                    const statusConfig = getStatusConfig(invitation.status)
                    const StatusIcon = statusConfig.icon
                    
                    return (
                      <TableRow 
                        key={invitation.id} 
                        className="border-b last:border-0 hover:bg-muted/30 transition-colors"
                      >
                        <TableCell className="font-medium">
                          <div className="flex flex-col">
                            <span className="text-foreground">{invitation.invitee_email}</span>
                            {invitation.invitee_name && (
                              <span className="text-sm text-muted-foreground">
                                {invitation.invitee_name}
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge 
                            variant="outline" 
                            className="capitalize font-normal"
                          >
                            {invitation.role}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className={cn(
                            "inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium border",
                            statusConfig.bgColor,
                            statusConfig.borderColor,
                            statusConfig.color
                          )}>
                            <div className={cn("w-2 h-2 rounded-full", statusConfig.dotColor)} />
                            <StatusIcon className="w-3.5 h-3.5" />
                            <span>{statusConfig.label}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {getRelativeTime(invitation.created_at)}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            {invitation.status === 'pending' && (
                              <>
                                <Button
                                  onClick={() => handleResend(invitation.id)}
                                  variant="outline"
                                  size="sm"
                                  disabled={resendingId === invitation.id || revokingId === invitation.id}
                                  className="h-8 text-[#5c4a38] border-[#5c4a38]/20 hover:bg-[#5c4a38]/10"
                                >
                                  {resendingId === invitation.id ? (
                                    <LoadingSpinner size="sm" className="mr-1.5 text-current" />
                                  ) : (
                                    <Send className="w-3.5 h-3.5 mr-1.5" />
                                  )}
                                  {resendingId === invitation.id ? 'Sending...' : 'Resend'}
                                </Button>
                                <Button
                                  onClick={() => handleRevoke(invitation.id)}
                                  variant="outline"
                                  size="sm"
                                  disabled={resendingId === invitation.id || revokingId === invitation.id}
                                  className="h-8 text-red-600 border-red-200 hover:bg-red-50"
                                >
                                  {revokingId === invitation.id ? (
                                    <LoadingSpinner size="sm" className="mr-1.5 text-current" />
                                  ) : (
                                    <XCircle className="w-3.5 h-3.5 mr-1.5" />
                                  )}
                                  {revokingId === invitation.id ? 'Revoking...' : 'Revoke'}
                                </Button>
                              </>
                            )}
                            {invitation.status !== 'pending' && (
                              <span className="text-sm text-muted-foreground">
                                {invitation.status === 'accepted' && invitation.accepted_at && (
                                  <>Accepted {getRelativeTime(invitation.accepted_at)}</>
                                )}
                                {invitation.status !== 'accepted' && (
                                  <span className="capitalize">{invitation.status}</span>
                                )}
                              </span>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Invite Modal */}
      <InviteUserModal
        open={showInviteModal}
        onOpenChange={setShowInviteModal}
        onSuccess={handleInviteSuccess}
      />
    </div>
  )
}

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { toast } from '@/contexts/ToastContext'
import {
  Mail,
  UserPlus,
  Clock,
  CheckCircle,
  XCircle,
  Ban,
  Trash2,
  RefreshCw,
  Loader2,
  Copy,
  Eye,
  Edit
} from 'lucide-react'
import { useApiClient } from '@/lib/api-client'
import { format } from 'date-fns'
import InviteUserModal from './InviteUserModal'
import InvitationDetailsModal from './InvitationDetailsModal'

interface Invitation {
  id: string
  invitee_email: string
  invitee_name?: string
  role: 'student' | 'parent'
  status: 'pending' | 'accepted' | 'expired' | 'revoked'
  token: string
  message?: string
  student_ids: string[]
  created_at: string
  expires_at: string
  accepted_at?: string
}

interface InvitationsListProps {
  refreshTrigger?: number
  onInviteClick?: () => void
}

export default function InvitationsList({ refreshTrigger, onInviteClick }: InvitationsListProps) {
  const client = useApiClient()
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState({
    total: 0,
    pending: 0,
    accepted: 0,
    expired: 0,
    revoked: 0
  })
  const [filter, setFilter] = useState<string>('all')
  const [selectedInvitation, setSelectedInvitation] = useState<Invitation | null>(null)
  const [showDetailsModal, setShowDetailsModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [editingInvitation, setEditingInvitation] = useState<Invitation | null>(null)

  const loadInvitations = useCallback(async () => {
    try {
      setLoading(true)
      const endpoint = filter === 'all'
        ? '/invitations/'
        : `/invitations/?status_filter=${filter}`

      const response = await client.get(endpoint)

      if (response.error) throw new Error(response.error)

      const data = response.data
      setInvitations(data.invitations || [])
      setStats({
        total: data.total || 0,
        pending: data.pending || 0,
        accepted: data.accepted || 0,
        expired: data.expired || 0,
        revoked: data.revoked || 0
      })
    } catch (error) {
      console.error('Failed to load invitations:', error)
      toast.error('Failed to load invitations')
    } finally {
      setLoading(false)
    }
  }, [client, filter])

  useEffect(() => {
    loadInvitations()
  }, [loadInvitations, refreshTrigger])

  const handleRevoke = async (invitationId: string) => {
    try {
      const response = await client.delete(`/invitations/${invitationId}`)

      if (response.error) throw new Error(response.error)

      toast.success('Invitation revoked')
      loadInvitations()
    } catch (error) {
      console.error('Failed to revoke invitation:', error)
      toast.error('Failed to revoke invitation')
    }
  }

  const copyInvitationLink = (token: string) => {
    const link = `${window.location.origin}/accept-invitation/${token}`
    navigator.clipboard.writeText(link)
    toast.success('Invitation link copied to clipboard')
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200"><Clock className="w-3 h-3 mr-1" />Pending</Badge>
      case 'accepted':
        return <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"><CheckCircle className="w-3 h-3 mr-1" />Accepted</Badge>
      case 'expired':
        return <Badge className="bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200"><XCircle className="w-3 h-3 mr-1" />Expired</Badge>
      case 'revoked':
        return <Badge className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"><Ban className="w-3 h-3 mr-1" />Revoked</Badge>
      default:
        return <Badge>{status}</Badge>
    }
  }

  const getRoleBadge = (role: string) => {
    return role === 'student' 
      ? <Badge variant="outline" className="border-blue-300 text-blue-700 dark:border-blue-700 dark:text-blue-300">Student</Badge>
      : <Badge variant="outline" className="border-purple-300 text-purple-700 dark:border-purple-700 dark:text-purple-300">Parent</Badge>
  }

  const handleEdit = (invitation: Invitation) => {
    setEditingInvitation(invitation)
    setShowEditModal(true)
  }

  const handleView = (invitation: Invitation) => {
    setSelectedInvitation(invitation)
    setShowDetailsModal(true)
  }

  return (
    <>
      <Card className="border border-slate-200 dark:border-slate-700 shadow-sm bg-white dark:bg-slate-900">
        <CardHeader className="border-b border-slate-200 dark:border-slate-700 pb-4">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-slate-900 dark:text-white text-lg">
                <Mail className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                Invitations
              </CardTitle>
              <CardDescription className="text-slate-600 dark:text-slate-400 text-sm mt-1">
                Manage invitations sent to students and parents
              </CardDescription>
            </div>
            <Button
              onClick={loadInvitations}
              variant="ghost"
              size="sm"
              className="text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
            >
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>
        </CardHeader>

      <CardContent className="p-6">
        {/* Stats */}
        <div className="grid grid-cols-5 gap-4 mb-6">
          <button
            onClick={() => setFilter('all')}
            className={`p-4 rounded-lg border text-center transition-all ${
              filter === 'all'
                ? 'border-purple-300 bg-purple-100 dark:border-purple-700 dark:bg-purple-900'
                : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-slate-300 dark:hover:border-slate-600'
            }`}
          >
            <div className="text-3xl font-bold text-slate-900 dark:text-white">{stats.total}</div>
            <div className="text-xs text-slate-600 dark:text-slate-400 mt-1">Total</div>
          </button>
          <button
            onClick={() => setFilter('pending')}
            className={`p-4 rounded-lg border text-center transition-all ${
              filter === 'pending'
                ? 'border-amber-300 bg-amber-100 dark:border-amber-700 dark:bg-amber-900'
                : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-slate-300 dark:hover:border-slate-600'
            }`}
          >
            <div className="text-3xl font-bold text-amber-700 dark:text-amber-300">{stats.pending}</div>
            <div className="text-xs text-slate-600 dark:text-slate-400 mt-1">Pending</div>
          </button>
          <button
            onClick={() => setFilter('accepted')}
            className={`p-4 rounded-lg border text-center transition-all ${
              filter === 'accepted'
                ? 'border-green-300 bg-green-100 dark:border-green-700 dark:bg-green-900'
                : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-slate-300 dark:hover:border-slate-600'
            }`}
          >
            <div className="text-3xl font-bold text-green-700 dark:text-green-300">{stats.accepted}</div>
            <div className="text-xs text-slate-600 dark:text-slate-400 mt-1">Accepted</div>
          </button>
          <button
            onClick={() => setFilter('expired')}
            className={`p-4 rounded-lg border text-center transition-all ${
              filter === 'expired'
                ? 'border-slate-400 bg-slate-200 dark:border-slate-600 dark:bg-slate-700'
                : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-slate-300 dark:hover:border-slate-600'
            }`}
          >
            <div className="text-3xl font-bold text-slate-700 dark:text-slate-300">{stats.expired}</div>
            <div className="text-xs text-slate-600 dark:text-slate-400 mt-1">Expired</div>
          </button>
          <button
            onClick={() => setFilter('revoked')}
            className={`p-4 rounded-lg border text-center transition-all ${
              filter === 'revoked'
                ? 'border-red-300 bg-red-100 dark:border-red-700 dark:bg-red-900'
                : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-slate-300 dark:hover:border-slate-600'
            }`}
          >
            <div className="text-3xl font-bold text-red-700 dark:text-red-300">{stats.revoked}</div>
            <div className="text-xs text-slate-600 dark:text-slate-400 mt-1">Revoked</div>
          </button>
        </div>

        {/* Invitations List */}
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
          </div>
        ) : invitations.length === 0 ? (
          <div className="text-center py-16">
            <UserPlus className="w-16 h-16 mx-auto mb-4 text-slate-300 dark:text-slate-700" />
            <p className="text-slate-500 dark:text-slate-400 text-sm">No invitations found</p>
          </div>
        ) : (
          <div className="space-y-2">
            {invitations.map((invitation) => (
              <div
                key={invitation.id}
                className="p-4 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-1">
                      <h4 className="font-medium text-slate-900 dark:text-white">
                        {invitation.invitee_name || invitation.invitee_email}
                      </h4>
                      {getStatusBadge(invitation.status)}
                      {getRoleBadge(invitation.role)}
                    </div>
                    <p className="text-sm text-slate-600 dark:text-slate-400">
                      {invitation.invitee_email}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-500 mt-1">
                      Sent {format(new Date(invitation.created_at), 'MMM d, yyyy')} •
                      Expires {format(new Date(invitation.expires_at), 'MMM d, yyyy')}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      onClick={() => handleView(invitation)}
                      variant="ghost"
                      size="sm"
                      className="text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                    >
                      <Eye className="w-4 h-4" />
                    </Button>
                    {invitation.status === 'pending' && (
                      <>
                        <Button
                          onClick={() => handleEdit(invitation)}
                          variant="ghost"
                          size="sm"
                          className="text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                        >
                          <Edit className="w-4 h-4" />
                        </Button>
                        <Button
                          onClick={() => copyInvitationLink(invitation.token)}
                          variant="ghost"
                          size="sm"
                          className="text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                        >
                          <Copy className="w-4 h-4" />
                        </Button>
                        <Button
                          onClick={() => handleRevoke(invitation.id)}
                          variant="ghost"
                          size="sm"
                          className="text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>

    {/* Modals */}
    {showDetailsModal && selectedInvitation && (
      <InvitationDetailsModal
        invitation={selectedInvitation}
        open={showDetailsModal}
        onOpenChange={setShowDetailsModal}
      />
    )}

    {showEditModal && editingInvitation && (
      <InviteUserModal
        open={showEditModal}
        onOpenChange={setShowEditModal}
        onSuccess={loadInvitations}
        editMode={true}
        invitation={editingInvitation}
      />
    )}
    </>
  )
}


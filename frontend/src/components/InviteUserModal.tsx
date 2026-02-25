import { useState, useEffect } from 'react'
import { useQueryClient, useMutation } from '@tanstack/react-query'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { LoadingSpinner } from '@/components/ui/loading-state'
import { toast } from '@/contexts/ToastContext'
import { UserPlus, Mail, MessageSquare, Users } from 'lucide-react'
import { useApiClient } from '@/lib/api-client'
import { useStudents } from '@/hooks/useQueries'

interface Invitation {
  id: string
  invitee_email: string
  invitee_name?: string
  role: 'student' | 'parent'
  message?: string
  student_ids: string[]
}

interface InviteUserModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
  editMode?: boolean
  invitation?: Invitation
  role?: 'student' | 'parent'
}

export default function InviteUserModal({ open, onOpenChange, onSuccess, editMode = false, invitation, role }: InviteUserModalProps) {
  const client = useApiClient()
  const queryClient = useQueryClient()
  const [formData, setFormData] = useState({
    invitee_email: '',
    invitee_name: '',
    role: role || 'student',
    message: '',
    student_ids: [] as string[]
  })

  const { data: studentsData, isLoading: loadingStudents } = useStudents(1, 200)
  const students = (studentsData?.items || []).map((s: any) => ({
    id: s._id || s.id,
    clerk_id: s.clerk_id,
    name: s.name,
    email: s.email,
  }))

  // Populate form when editing
  useEffect(() => {
    if (editMode && invitation) {
      setFormData({
        invitee_email: invitation.invitee_email,
        invitee_name: invitation.invitee_name || '',
        role: invitation.role,
        message: invitation.message || '',
        student_ids: invitation.student_ids || []
      })
    } else if (!open) {
      // Reset form when modal closes
      setFormData({
        invitee_email: '',
        invitee_name: '',
        role: 'student',
        message: '',
        student_ids: []
      })
    }
  }, [editMode, invitation, open])

  const createInvitationMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const response = await client.post('/invitations/', data)
      if (response.error) throw new Error(response.error)
      return response.data
    },
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: ['invitations'] })
      toast.success('Invitation sent!', {
        description: `An invitation has been sent to ${variables.invitee_email}`
      })
      onOpenChange(false)
      onSuccess?.()
    },
    onError: (error: any) => {
      toast.error('Failed to send invitation', {
        description: error.message || 'Please try again later'
      })
    },
  })

  const resendInvitationMutation = useMutation({
    mutationFn: async ({ invitationId, data }: { invitationId: string; data: typeof formData }) => {
      const response = await client.post(`/invitations/${invitationId}/resend`, data)
      if (response.error) throw new Error(response.error)
      return response.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invitations'] })
      toast.success('Invitation updated!', {
        description: `The invitation has been updated`
      })
      onOpenChange(false)
      onSuccess?.()
    },
    onError: (error: any) => {
      toast.error('Failed to update invitation', {
        description: error.message || 'Please try again later'
      })
    },
  })

  const loading = createInvitationMutation.isPending || resendInvitationMutation.isPending

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (editMode && invitation) {
      resendInvitationMutation.mutate({ invitationId: invitation.id, data: formData })
    } else {
      createInvitationMutation.mutate(formData)
    }
  }

  const toggleStudent = (studentId: string) => {
    setFormData(prev => ({
      ...prev,
      student_ids: prev.student_ids.includes(studentId)
        ? prev.student_ids.filter(id => id !== studentId)
        : [...prev.student_ids, studentId]
    }))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto bg-card border-border">
        <DialogHeader className="space-y-3">
          <DialogTitle className="flex items-center gap-2 text-2xl font-bold text-foreground">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <UserPlus className="w-5 h-5 text-primary" />
            </div>
            {editMode ? 'Edit Invitation' : 'Invite User'}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground text-base">
            {editMode ? 'Update invitation details' : 'Send an invitation to a student or parent to join your account'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6 mt-6">
          {/* Role Selection */}
          <div className="space-y-2">
            <Label htmlFor="role" className="text-sm font-medium text-foreground">
              Role <span className="text-destructive">*</span>
            </Label>
            <Select
              value={formData.role}
              onValueChange={(value: 'student' | 'parent') => setFormData({ ...formData, role: value, student_ids: [] })}
              disabled={editMode}
            >
              <SelectTrigger className="bg-background border-border h-11">
                <SelectValue placeholder="Select role" />
              </SelectTrigger>
              <SelectContent className="bg-card border-border">
                <SelectItem value="student">Student</SelectItem>
                <SelectItem value="parent">Parent</SelectItem>
              </SelectContent>
            </Select>
            {editMode && (
              <p className="text-xs text-muted-foreground">Role cannot be changed after invitation is sent</p>
            )}
          </div>

          {/* Email */}
          <div className="space-y-2">
            <Label htmlFor="email" className="text-sm font-medium text-foreground">
              Email Address <span className="text-destructive">*</span>
            </Label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                id="email"
                type="email"
                placeholder="user@example.com"
                value={formData.invitee_email}
                onChange={(e) => setFormData({ ...formData, invitee_email: e.target.value })}
                className="pl-10 bg-background border-border h-11"
                required
              />
            </div>
          </div>

          {/* Name */}
          <div className="space-y-2">
            <Label htmlFor="name" className="text-sm font-medium text-foreground">
              Name <span className="text-muted-foreground text-xs font-normal">(Optional)</span>
            </Label>
            <Input
              id="name"
              type="text"
              placeholder="John Doe"
              value={formData.invitee_name}
              onChange={(e) => setFormData({ ...formData, invitee_name: e.target.value })}
              className="bg-background border-border h-11"
            />
          </div>

          {/* Student Selection for Parents */}
          {formData.role === 'parent' && (
            <div className="space-y-3">
              <div>
                <Label className="text-sm font-medium text-foreground flex items-center gap-2">
                  <Users className="w-4 h-4 text-primary" />
                  Link to Students <span className="text-muted-foreground text-xs font-normal">(Optional)</span>
                </Label>
                <p className="text-xs text-muted-foreground mt-1">
                  Select which students this parent should be linked to
                </p>
              </div>
              {loadingStudents ? (
                <div className="flex items-center justify-center py-8 bg-muted/30 rounded-lg border border-border">
                  <LoadingSpinner size="md" />
                </div>
              ) : students.length === 0 ? (
                <div className="py-8 bg-muted/30 rounded-lg border border-border">
                  <p className="text-sm text-muted-foreground text-center">
                    No students found. Add students first before inviting parents.
                  </p>
                </div>
              ) : (
                <div className="border border-border rounded-lg p-4 max-h-[200px] overflow-y-auto space-y-3 bg-muted/20">
                  {students.map((student) => (
                    <div key={student.id} className="flex items-start space-x-3 p-2 rounded-md hover:bg-muted/50 transition-colors">
                      <Checkbox
                        id={`student-${student.id}`}
                        checked={formData.student_ids.includes(student.id)}
                        onCheckedChange={() => toggleStudent(student.id)}
                        className="mt-0.5 border-border data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                      />
                      <label
                        htmlFor={`student-${student.id}`}
                        className="text-sm text-foreground cursor-pointer flex-1 leading-relaxed"
                      >
                        <div className="font-medium">{student.name}</div>
                        <div className="text-xs text-muted-foreground">{student.email}</div>
                      </label>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Custom Message */}
          <div className="space-y-2">
            <Label htmlFor="message" className="text-sm font-medium text-foreground flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-primary" />
              Custom Message <span className="text-muted-foreground text-xs font-normal">(Optional)</span>
            </Label>
            <Textarea
              id="message"
              placeholder="Add a personal message to the invitation..."
              value={formData.message}
              onChange={(e) => setFormData({ ...formData, message: e.target.value })}
              className="bg-background border-border min-h-[100px] resize-none"
              rows={4}
            />
          </div>

          {/* Action Buttons */}
          <div className="flex justify-end gap-3 pt-6 border-t border-border">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading}
              className="border-border hover:bg-muted h-11 px-6"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={loading || !formData.invitee_email}
              className="bg-primary text-primary-foreground hover:bg-primary/90 h-11 px-6"
            >
              {loading ? (
                <>
                  <LoadingSpinner size="sm" className="mr-2 text-primary-foreground" />
                  {editMode ? 'Updating...' : 'Sending...'}
                </>
              ) : (
                <>
                  <Mail className="w-4 h-4 mr-2" />
                  {editMode ? 'Update Invitation' : 'Send Invitation'}
                </>
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { LoadingButtonContent, LoadingSpinner } from '@/components/ui/loading-state'
import { toast } from '@/contexts/ToastContext'
import { UserPlus, Mail, MessageSquare, Users } from 'lucide-react'
import { useAuth } from '@clerk/clerk-react'

interface Student {
  id: string
  clerk_id: string
  name: string
  email: string
}

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
  role?: 'student' | 'parent'  // Add role prop for pre-selecting role
}

export default function InviteUserModal({ open, onOpenChange, onSuccess, editMode = false, invitation, role }: InviteUserModalProps) {
  const { getToken } = useAuth()
  const [loading, setLoading] = useState(false)
  const [students, setStudents] = useState<Student[]>([])
  const [loadingStudents, setLoadingStudents] = useState(false)
  const [formData, setFormData] = useState({
    invitee_email: '',
    invitee_name: '',
    role: role || 'student',  // Use role prop if provided
    message: '',
    student_ids: [] as string[]
  })

  // Load students when modal opens and role is parent
  useEffect(() => {
    if (open && formData.role === 'parent') {
      loadStudents()
    }
  }, [open, formData.role])

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

  const loadStudents = async () => {
    try {
      setLoadingStudents(true)
      const token = await getToken()
      const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api/v1'

      const response = await fetch(`${API_BASE}/students/`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })

      if (!response.ok) throw new Error('Failed to load students')

      const data = await response.json()
      setStudents(data.students || [])
    } catch (error) {
      console.error('Failed to load students:', error)
      toast.error('Failed to load students')
    } finally {
      setLoadingStudents(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      const token = await getToken()
      const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api/v1'

      if (editMode && invitation) {
        // Update invitation (re-send with new details)
        const response = await fetch(`${API_BASE}/invitations/${invitation.id}/resend`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify(formData)
        })

        if (!response.ok) {
          const error = await response.json()
          throw new Error(error.detail || 'Failed to update invitation')
        }

        toast.success('Invitation updated!', {
          description: `The invitation has been updated`
        })
      } else {
        // Create new invitation
        const response = await fetch(`${API_BASE}/invitations/`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify(formData)
        })

        if (!response.ok) {
          const error = await response.json()
          throw new Error(error.detail || 'Failed to send invitation')
        }

        toast.success('Invitation sent!', {
          description: `An invitation has been sent to ${formData.invitee_email}`
        })
      }

      onOpenChange(false)
      onSuccess?.()
    } catch (error: any) {
      console.error('Failed to send invitation:', error)
      toast.error(editMode ? 'Failed to update invitation' : 'Failed to send invitation', {
        description: error.message || 'Please try again later'
      })
    } finally {
      setLoading(false)
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
                <LoadingButtonContent label={editMode ? 'Updating...' : 'Sending...'} />
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


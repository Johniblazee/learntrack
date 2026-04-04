import { useEffect, useState } from 'react'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/contexts/ToastContext'
import { LoadingSpinner } from '@/components/ui/loading-state'
import { useApiClient } from '@/lib/api-client'

interface CreateStudentModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
}

const EMPTY_FORM = {
  name: '',
  email: '',
  grade: '',
  phone: '',
  parentName: '',
  parentEmail: '',
  notes: '',
}

export function CreateStudentModal({
  open,
  onOpenChange,
  onSuccess,
}: CreateStudentModalProps) {
  const client = useApiClient()
  const [formData, setFormData] = useState(EMPTY_FORM)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) {
      setFormData(EMPTY_FORM)
    }
  }, [open])

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()

    const name = formData.name.trim()
    const email = formData.email.trim().toLowerCase()
    if (!name || !email) {
      toast.error('Name and email are required')
      return
    }

    try {
      setLoading(true)
      const response = await client.post('/students/', {
        name,
        email,
        grade: formData.grade.trim() || undefined,
        phone: formData.phone.trim() || undefined,
        parentName: formData.parentName.trim() || undefined,
        parentEmail: formData.parentEmail.trim().toLowerCase() || undefined,
        notes: formData.notes.trim() || undefined,
      })

      if (response.error) {
        throw new Error(response.error)
      }

      toast.success('Student created', {
        description: `${name} was added as a provisioned student. Invite them to claim their account.`,
      })
      onOpenChange(false)
      onSuccess?.()
    } catch (error) {
      console.error('Failed to create student:', error)
      toast.error('Failed to create student', {
        description:
          error instanceof Error
            ? error.message
            : 'Please try again or contact support if the issue persists.',
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Create Student</DialogTitle>
          <DialogDescription>
            Create a student record now. They will appear as unclaimed until they sign in and claim the account.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="create-student-name">Full Name</Label>
              <Input
                id="create-student-name"
                value={formData.name}
                onChange={(event) => setFormData((previous) => ({ ...previous, name: event.target.value }))}
                placeholder="Student name"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="create-student-email">Email</Label>
              <Input
                id="create-student-email"
                type="email"
                value={formData.email}
                onChange={(event) => setFormData((previous) => ({ ...previous, email: event.target.value }))}
                placeholder="student@example.com"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="create-student-grade">Grade</Label>
              <Input
                id="create-student-grade"
                value={formData.grade}
                onChange={(event) => setFormData((previous) => ({ ...previous, grade: event.target.value }))}
                placeholder="e.g. Grade 8"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="create-student-phone">Phone</Label>
              <Input
                id="create-student-phone"
                value={formData.phone}
                onChange={(event) => setFormData((previous) => ({ ...previous, phone: event.target.value }))}
                placeholder="Optional"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="create-student-parent-name">Parent Name</Label>
              <Input
                id="create-student-parent-name"
                value={formData.parentName}
                onChange={(event) => setFormData((previous) => ({ ...previous, parentName: event.target.value }))}
                placeholder="Optional"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="create-student-parent-email">Parent Email</Label>
              <Input
                id="create-student-parent-email"
                type="email"
                value={formData.parentEmail}
                onChange={(event) => setFormData((previous) => ({ ...previous, parentEmail: event.target.value }))}
                placeholder="Optional"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="create-student-notes">Notes</Label>
            <Textarea
              id="create-student-notes"
              value={formData.notes}
              onChange={(event) => setFormData((previous) => ({ ...previous, notes: event.target.value }))}
              placeholder="Optional notes about this student"
              rows={4}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading || !formData.name.trim() || !formData.email.trim()}>
              {loading ? (
                <>
                  <LoadingSpinner size="sm" className="mr-2 text-primary-foreground" />
                  Creating...
                </>
              ) : (
                'Create Student'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

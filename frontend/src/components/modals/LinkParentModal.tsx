import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { UserPlus } from 'lucide-react'
import { toast } from '@/contexts/ToastContext'
import { useApiClient } from '@/lib/api-client'

interface Student {
  _id?: string
  id?: string
  clerk_id?: string
  name: string
}

interface LinkParentModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  students: Student[]
  onParentLinked?: () => void
}

export function LinkParentModal({
  open,
  onOpenChange,
  students,
  onParentLinked
}: LinkParentModalProps) {
  const client = useApiClient()
  const [parentEmail, setParentEmail] = useState('')
  const [parentName, setParentName] = useState('')
  const [selectedStudentId, setSelectedStudentId] = useState('')
  const [loading, setLoading] = useState(false)

  const resolveStudentId = (student: Student): string => {
    return String(student.clerk_id || student.id || student._id || '')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!parentEmail.trim() || !parentName.trim() || !selectedStudentId) return

    try {
      setLoading(true)
      const response = await client.post(`/students/${selectedStudentId}/parents`, {
        parent_email: parentEmail.trim(),
        parent_name: parentName.trim(),
      })

      if (response.error) {
        throw new Error(response.error)
      }

      toast.success('Parent linked successfully', {
        description: response.data?.message || `${parentName.trim()} is now linked.`
      })

      // Reset form
      setParentEmail('')
      setParentName('')
      setSelectedStudentId('')
      onOpenChange(false)
      onParentLinked?.()
    } catch (error) {
      console.error('Failed to link parent:', error)
      const description =
        error instanceof Error
          ? error.message
          : 'Please try again or contact support if the issue persists.'
      toast.error('Failed to link parent', {
        description
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-primary" />
            Link Parent to Student
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="parent-name">Parent Name *</Label>
            <Input
              id="parent-name"
              placeholder="Enter parent's full name"
              value={parentName}
              onChange={(e) => setParentName(e.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="parent-email">Parent Email *</Label>
            <Input
              id="parent-email"
              type="email"
              placeholder="parent@example.com"
              value={parentEmail}
              onChange={(e) => setParentEmail(e.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="student-select">Link to Student *</Label>
            <Select value={selectedStudentId} onValueChange={setSelectedStudentId}>
              <SelectTrigger id="student-select">
                <SelectValue placeholder="Select a student" />
              </SelectTrigger>
              <SelectContent>
                {students.map((student) => (
                  <SelectItem
                    key={resolveStudentId(student)}
                    value={resolveStudentId(student)}
                  >
                    {student.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="bg-muted/50 p-3 rounded-lg">
            <p className="text-sm text-muted-foreground">
              An invitation will be sent to the parent's email address. Once they accept, 
              they will be linked to the selected student and can view their progress.
            </p>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button 
              type="submit" 
              disabled={loading || !parentEmail.trim() || !parentName.trim() || !selectedStudentId}
            >
              {loading ? 'Sending Invitation...' : 'Send Invitation'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

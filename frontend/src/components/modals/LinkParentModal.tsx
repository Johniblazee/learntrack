import { useEffect, useMemo, useState } from 'react'
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
import { Search, UserPlus } from 'lucide-react'
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
  const [studentSearchTerm, setStudentSearchTerm] = useState('')
  const [availableStudents, setAvailableStudents] = useState<Student[]>(students)
  const [loading, setLoading] = useState(false)
  const [loadingStudents, setLoadingStudents] = useState(false)

  const resolveStudentId = (student: Student): string => {
    return String(student.clerk_id || student.id || student._id || '')
  }

  useEffect(() => {
    setAvailableStudents(students)
  }, [students])

  useEffect(() => {
    const loadAllStudents = async () => {
      if (!open) {
        return
      }

      try {
        setLoadingStudents(true)
        const collectedStudents: Student[] = []
        let page = 1
        let hasNext = true

        while (hasNext) {
          const response = await client.get(`/students?page=${page}&per_page=100`)
          if (response.error) {
            throw new Error(response.error)
          }

          const pageItems = (response.data?.items || []) as Student[]
          collectedStudents.push(...pageItems)
          hasNext = Boolean(response.data?.meta?.has_next)
          page += 1
        }

        setAvailableStudents(collectedStudents)
      } catch (error) {
        console.error('Failed to load students for parent linking:', error)
        setAvailableStudents(students)
      } finally {
        setLoadingStudents(false)
      }
    }

    void loadAllStudents()
  }, [client, open, students])

  useEffect(() => {
    if (!open) {
      setStudentSearchTerm('')
    }
  }, [open])

  const filteredStudents = useMemo(() => {
    const term = studentSearchTerm.trim().toLowerCase()
    if (!term) {
      return availableStudents
    }

    return availableStudents.filter((student) =>
      student.name.toLowerCase().includes(term)
    )
  }, [availableStudents, studentSearchTerm])

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
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={studentSearchTerm}
                onChange={(e) => setStudentSearchTerm(e.target.value)}
                placeholder="Search students..."
                className="pl-9"
              />
            </div>
            <Select value={selectedStudentId} onValueChange={setSelectedStudentId}>
              <SelectTrigger id="student-select">
                <SelectValue placeholder={loadingStudents ? 'Loading students...' : 'Select a student'} />
              </SelectTrigger>
              <SelectContent>
                {filteredStudents.map((student) => (
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

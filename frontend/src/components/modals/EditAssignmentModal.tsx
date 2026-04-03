import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Edit } from 'lucide-react'
import { toast } from '@/contexts/ToastContext'
import { useApiClient } from '@/lib/api-client'

interface Assignment {
  _id: string
  title: string
  description?: string
  due_date?: string | null
  time_limit?: number | null
  max_attempts?: number | null
  shuffle_questions?: boolean
  show_results_immediately?: boolean
  status?: 'draft' | 'scheduled' | 'published' | 'active' | 'completed' | 'archived'
}

interface EditAssignmentModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  assignment: Assignment | null
  onAssignmentUpdated?: () => void
}

export function EditAssignmentModal({
  open,
  onOpenChange,
  assignment,
  onAssignmentUpdated
}: EditAssignmentModalProps) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [timeLimit, setTimeLimit] = useState('')
  const [maxAttempts, setMaxAttempts] = useState('1')
  const [shuffleQuestions, setShuffleQuestions] = useState(false)
  const [showResultsImmediately, setShowResultsImmediately] = useState(true)
  const [status, setStatus] = useState<Assignment['status']>('published')
  const [loading, setLoading] = useState(false)
  const client = useApiClient()

  useEffect(() => {
    if (assignment) {
      setTitle(assignment.title)
      setDescription(assignment.description || '')
      setDueDate(assignment.due_date?.split('T')[0] || '') // Format for date input
      setTimeLimit(assignment.time_limit?.toString() || '')
      setMaxAttempts(String(assignment.max_attempts || 1))
      setShuffleQuestions(assignment.shuffle_questions || false)
      setShowResultsImmediately(assignment.show_results_immediately ?? true)
      setStatus(assignment.status || 'published')
    }
  }, [assignment])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!title.trim() || !assignment) return

    try {
      setLoading(true)

      const updateData = {
        title,
        description: description || undefined,
        due_date: dueDate ? new Date(dueDate).toISOString() : undefined,
        time_limit: timeLimit ? parseInt(timeLimit, 10) : undefined,
        max_attempts: Math.max(parseInt(maxAttempts, 10) || 1, 1),
        shuffle_questions: shuffleQuestions,
        show_results_immediately: showResultsImmediately,
        status,
      }

      const response = await client.put(`/assignments/${assignment._id}`, updateData)

      if (response.error) {
        throw new Error(response.error)
      }

      toast.success('Assignment updated successfully!', {
        description: `Changes to "${title}" have been saved.`
      })

      onOpenChange(false)
      onAssignmentUpdated?.()
    } catch (error: any) {
      console.error('Failed to update assignment:', error)
      toast.error('Failed to update assignment', {
        description: error.message || 'Please try again.'
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Edit className="h-5 w-5 text-primary" />
            Edit Assignment
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-title">Title *</Label>
            <Input
              id="edit-title"
              placeholder="Assignment title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-description">Description</Label>
            <Textarea
              id="edit-description"
              placeholder="Assignment description..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="edit-due-date">Due Date</Label>
              <Input
                id="edit-due-date"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-time-limit">Time Limit (minutes)</Label>
              <Input
                id="edit-time-limit"
                type="number"
                min="1"
                placeholder="60"
                value={timeLimit}
                onChange={(e) => setTimeLimit(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="edit-max-attempts">Max Attempts</Label>
              <Input
                id="edit-max-attempts"
                type="number"
                min="1"
                placeholder="1"
                value={maxAttempts}
                onChange={(e) => setMaxAttempts(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-status">Status</Label>
              <Select
                value={status}
                onValueChange={(value) => setStatus(value as Assignment['status'])}
              >
                <SelectTrigger id="edit-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="scheduled">Scheduled</SelectItem>
                  <SelectItem value="published">Published</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="archived">Archived</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-3">
            <Label>Settings</Label>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label htmlFor="edit-show-results" className="font-normal">
                  Show Results Immediately
                </Label>
                <Switch
                  id="edit-show-results"
                  checked={showResultsImmediately}
                  onCheckedChange={setShowResultsImmediately}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="edit-shuffle" className="font-normal">
                  Shuffle Questions
                </Label>
                <Switch
                  id="edit-shuffle"
                  checked={shuffleQuestions}
                  onCheckedChange={setShuffleQuestions}
                />
              </div>
            </div>
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
            <Button type="submit" disabled={loading || !title.trim()}>
              {loading ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

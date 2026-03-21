import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Calendar, Clock, Users, FileText, CheckCircle } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'

interface Assignment {
  _id: string
  title: string
  description?: string
  subject_id: {
    _id: string
    name: string
  }
  due_date: string
  duration_minutes?: number
  total_points: number
  passing_score: number
  status: 'draft' | 'published' | 'archived'
  assigned_to: Array<{
    type: 'student' | 'group'
    id: string
  }>
  question_ids: string[]
  settings: {
    allow_retakes: boolean
    shuffle_questions: boolean
    show_correct_answers: boolean
  }
  created_at: string
  updated_at: string
}

interface ViewAssignmentModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  assignment: Assignment | null
}

export function ViewAssignmentModal({
  open,
  onOpenChange,
  assignment
}: ViewAssignmentModalProps) {
  if (!assignment) return null

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'published': return 'bg-green-500/10 text-green-600 dark:text-green-400 border-0'
      case 'draft': return 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-0'
      case 'archived': return 'bg-muted text-muted-foreground border-0'
      default: return 'bg-muted text-muted-foreground border-0'
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-start justify-between">
            <DialogTitle className="flex items-center gap-2 flex-1">
              <FileText className="h-5 w-5 text-primary" />
              {assignment.title}
            </DialogTitle>
            <Badge className={getStatusColor(assignment.status)}>
              {assignment.status.charAt(0).toUpperCase() + assignment.status.slice(1)}
            </Badge>
          </div>
        </DialogHeader>

        <div className="space-y-4">
          {/* Description */}
          {assignment.description && (
            <div>
              <h3 className="text-sm font-semibold text-foreground mb-2">Description</h3>
              <p className="text-sm text-muted-foreground">{assignment.description}</p>
            </div>
          )}

          <Separator />

          {/* Assignment Details */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-xs text-muted-foreground">Due Date</p>
                  <p className="font-medium text-foreground">
                    {formatDistanceToNow(new Date(assignment.due_date), { addSuffix: true })}
                  </p>
                </div>
              </div>

              {assignment.duration_minutes && (
                <div className="flex items-center gap-2 text-sm">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-xs text-muted-foreground">Duration</p>
                    <p className="font-medium text-foreground">{assignment.duration_minutes} minutes</p>
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2 text-sm">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-xs text-muted-foreground">Questions</p>
                  <p className="font-medium text-foreground">{assignment.question_ids.length}</p>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm">
                <Users className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-xs text-muted-foreground">Assigned To</p>
                  <p className="font-medium text-foreground">
                    {assignment.assigned_to.length} {assignment.assigned_to.length === 1 ? 'recipient' : 'recipients'}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 text-sm">
                <CheckCircle className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-xs text-muted-foreground">Passing Score</p>
                  <p className="font-medium text-foreground">{assignment.passing_score}%</p>
                </div>
              </div>

              <div>
                <p className="text-xs text-muted-foreground mb-1">Subject</p>
                <Badge variant="secondary">{assignment.subject_id.name}</Badge>
              </div>
            </div>
          </div>

          <Separator />

          {/* Settings */}
          <div>
            <h3 className="text-sm font-semibold text-foreground mb-3">Settings</h3>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Allow Retakes</span>
                <Badge variant={assignment.settings.allow_retakes ? "default" : "secondary"}>
                  {assignment.settings.allow_retakes ? 'Yes' : 'No'}
                </Badge>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Shuffle Questions</span>
                <Badge variant={assignment.settings.shuffle_questions ? "default" : "secondary"}>
                  {assignment.settings.shuffle_questions ? 'Yes' : 'No'}
                </Badge>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}


import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Calendar, Clock, Users, FileText, CheckCircle } from 'lucide-react'
import { format, formatDistanceToNow } from 'date-fns'

interface Assignment {
  _id: string
  title: string
  description?: string
  subject_id?: string | {
    _id?: string
    id?: string
    name?: string
  }
  due_date?: string | null
  time_limit?: number | null
  total_points: number
  status: 'draft' | 'scheduled' | 'published' | 'active' | 'completed' | 'archived'
  student_ids?: string[]
  group_ids?: string[]
  questions?: Array<{
    question_id: string
  }>
  max_attempts?: number | null
  shuffle_questions?: boolean
  show_results_immediately?: boolean
  created_at?: string
  updated_at?: string
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
      case 'active':
      case 'published': return 'bg-green-500/10 text-green-600 dark:text-green-400 border-0'
      case 'scheduled': return 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-0'
      case 'completed': return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-0'
      case 'draft': return 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-0'
      case 'archived': return 'bg-muted text-muted-foreground border-0'
      default: return 'bg-muted text-muted-foreground border-0'
    }
  }

  const subjectName =
    typeof assignment.subject_id === 'object'
      ? assignment.subject_id?.name || 'Unknown'
      : assignment.subject_id || 'Unknown'
  const studentCount = Array.isArray(assignment.student_ids) ? assignment.student_ids.length : 0
  const groupCount = Array.isArray(assignment.group_ids) ? assignment.group_ids.length : 0
  const questionCount = Array.isArray(assignment.questions) ? assignment.questions.length : 0

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
                    {assignment.due_date
                      ? `${format(new Date(assignment.due_date), 'MMM d, yyyy')} (${formatDistanceToNow(new Date(assignment.due_date), { addSuffix: true })})`
                      : 'No due date'}
                  </p>
                </div>
              </div>

              {assignment.time_limit && (
                <div className="flex items-center gap-2 text-sm">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-xs text-muted-foreground">Time Limit</p>
                    <p className="font-medium text-foreground">{assignment.time_limit} minutes</p>
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2 text-sm">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-xs text-muted-foreground">Questions</p>
                  <p className="font-medium text-foreground">{questionCount}</p>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm">
                <Users className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-xs text-muted-foreground">Assigned Students</p>
                  <p className="font-medium text-foreground">
                    {studentCount} {studentCount === 1 ? 'student' : 'students'}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 text-sm">
                <CheckCircle className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-xs text-muted-foreground">Groups</p>
                  <p className="font-medium text-foreground">{groupCount}</p>
                </div>
              </div>

              <div>
                <p className="text-xs text-muted-foreground mb-1">Subject</p>
                <Badge variant="secondary">{subjectName}</Badge>
              </div>
            </div>
          </div>

          <Separator />

          {/* Settings */}
          <div>
            <h3 className="text-sm font-semibold text-foreground mb-3">Settings</h3>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Max Attempts</span>
                <Badge variant="secondary">
                  {assignment.max_attempts || 1}
                </Badge>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Shuffle Questions</span>
                <Badge variant={assignment.shuffle_questions ? "default" : "secondary"}>
                  {assignment.shuffle_questions ? 'Yes' : 'No'}
                </Badge>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Show Results Immediately</span>
                <Badge variant={assignment.show_results_immediately ? "default" : "secondary"}>
                  {assignment.show_results_immediately ? 'Yes' : 'No'}
                </Badge>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

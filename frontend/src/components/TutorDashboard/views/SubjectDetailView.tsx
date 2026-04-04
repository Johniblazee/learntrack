import { useState, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Plus,
  X,
  FileText,
  HelpCircle,
  Users,
  Calendar,
  ArrowLeft,
  BookOpen,
} from 'lucide-react'
import { toast } from '@/contexts/ToastContext'
import { LoadingSpinner } from '@/components/ui/loading-state'
import {
  useSubjectStats,
  useAddTopic,
  useRemoveTopic,
  useAssignments,
} from '@/hooks/useQueries'
import { cn } from '@/lib/utils'

interface SubjectStats {
  _id?: string
  id?: string
  name: string
  description?: string
  topics?: string[]
  question_count?: number
  total_questions?: number
  active_assignments?: number
  total_students?: number
  created_at?: string
}

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  published: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  scheduled: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  draft: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400',
  completed: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
  archived: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
}

export default function SubjectDetailView() {
  const { subjectId } = useParams<{ subjectId: string }>()
  const navigate = useNavigate()
  const { data: statsData, isLoading } = useSubjectStats(subjectId)
  const addTopic = useAddTopic()
  const removeTopic = useRemoveTopic()

  const { data: assignmentsData } = useAssignments(1, 50, { subjectId })

  const [newTopic, setNewTopic] = useState('')

  const subject = statsData as SubjectStats | undefined
  const assignments = useMemo(() => {
    if (!assignmentsData) return []
    const items = Array.isArray(assignmentsData)
      ? assignmentsData
      : (assignmentsData as any)?.items || []
    return items as any[]
  }, [assignmentsData])

  const handleAddTopic = async () => {
    const topic = newTopic.trim()
    if (!topic || !subjectId) return
    try {
      await addTopic.mutateAsync({ subjectId, topic })
      toast.success(`Topic "${topic}" added`)
      setNewTopic('')
    } catch (err: any) {
      toast.error('Failed to add topic', { description: err.message })
    }
  }

  const handleRemoveTopic = async (topic: string) => {
    if (!subjectId) return
    try {
      await removeTopic.mutateAsync({ subjectId, topic })
      toast.success(`Topic "${topic}" removed`)
    } catch (err: any) {
      toast.error('Cannot remove topic', { description: err.message })
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  if (!subject) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <BookOpen className="h-12 w-12 text-muted-foreground/50 mb-4" />
        <h3 className="text-lg font-semibold">Subject not found</h3>
        <Button variant="outline" className="mt-4" onClick={() => navigate('/dashboard/subjects')}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Subjects
        </Button>
      </div>
    )
  }

  const totalQuestions = subject.total_questions ?? subject.question_count ?? 0
  const activeAssignments = subject.active_assignments ?? 0
  const totalStudents = subject.total_students ?? 0

  return (
    <div className="space-y-6">
      {/* Back + Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/dashboard/subjects')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{subject.name}</h1>
            {subject.description && (
              <p className="text-sm text-muted-foreground mt-0.5">{subject.description}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() =>
              navigate(`/dashboard/content/bank?subjectId=${subjectId}`)
            }
          >
            <HelpCircle className="mr-2 h-4 w-4" />
            Question Bank
          </Button>
          <Button
            onClick={() =>
              navigate(`/dashboard/assignments/create?subjectId=${subjectId}`)
            }
          >
            <FileText className="mr-2 h-4 w-4" />
            Create Assignment
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="flex items-center gap-3 p-5">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <HelpCircle className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold">{totalQuestions}</p>
              <p className="text-xs text-muted-foreground">Questions</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-5">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <FileText className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold">{activeAssignments}</p>
              <p className="text-xs text-muted-foreground">Active Assignments</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-5">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <Users className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold">{totalStudents}</p>
              <p className="text-xs text-muted-foreground">Students</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Topics Section */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Topics</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Add topic input */}
          <div className="flex items-center gap-2">
            <Input
              placeholder="New topic name..."
              value={newTopic}
              onChange={(e) => setNewTopic(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAddTopic()
              }}
              className="max-w-xs"
            />
            <Button
              size="sm"
              onClick={handleAddTopic}
              disabled={addTopic.isPending || !newTopic.trim()}
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Add
            </Button>
          </div>

          {/* Topic badges */}
          {subject.topics && subject.topics.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {subject.topics.map((topic) => (
                <Badge
                  key={topic}
                  variant="secondary"
                  className="gap-1.5 pr-1.5 text-sm"
                >
                  {topic}
                  <button
                    onClick={() => handleRemoveTopic(topic)}
                    className="ml-0.5 rounded-full p-0.5 hover:bg-destructive/20 hover:text-destructive transition-colors"
                    disabled={removeTopic.isPending}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No topics yet. Add topics to categorise questions within this subject.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Assignments Table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Assignments</CardTitle>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              navigate(`/dashboard/assignments/create?subjectId=${subjectId}`)
            }
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            New Assignment
          </Button>
        </CardHeader>
        <CardContent>
          {assignments.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              No assignments yet for this subject.
            </p>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Title</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Due Date</TableHead>
                    <TableHead className="text-right">Students</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {assignments.map((a: any) => {
                    const id = a._id || a.id
                    const status = a.status || 'draft'
                    const dueDate = a.due_date
                      ? new Date(a.due_date).toLocaleDateString()
                      : '-'
                    const studentCount = a.student_ids?.length ?? 0
                    return (
                      <TableRow key={id}>
                        <TableCell className="font-medium">{a.title}</TableCell>
                        <TableCell>
                          <Badge
                            variant="secondary"
                            className={cn(
                              'text-xs capitalize',
                              STATUS_COLORS[status] || ''
                            )}
                          >
                            {status}
                          </Badge>
                        </TableCell>
                        <TableCell className="flex items-center gap-1.5 text-sm text-muted-foreground">
                          <Calendar className="h-3.5 w-3.5" />
                          {dueDate}
                        </TableCell>
                        <TableCell className="text-right">{studentCount}</TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

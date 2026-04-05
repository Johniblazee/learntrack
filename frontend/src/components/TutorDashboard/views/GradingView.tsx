import { useState, useEffect } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Textarea } from '@/components/ui/textarea'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { FilterToolbar } from '@/components/ui/filter-toolbar'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Search, CheckCircle, Clock, AlertCircle, Eye, FileText } from 'lucide-react'
import { useApiClient } from '@/lib/api-client'
import { toast } from '@/contexts/ToastContext'
import { formatDistanceToNow } from 'date-fns'

interface Submission {
  _id: string
  assignment_id: {
    _id: string
    title: string
    subject_id: {
      name: string
    }
  }
  student_id: {
    _id: string
    clerk_id: string
    name: string
    email: string
  }
  answers: Array<{
    question_id: string
    question_text?: string
    question_type?: string
    answer?: string
    selected_options?: string[]
    answer_type?: 'correct' | 'incorrect' | 'partial' | 'unanswered'
    points_earned?: number
    points_possible?: number
    auto_points_earned?: number
    manual_points_earned?: number | null
    final_points_earned?: number
    requires_manual_review?: boolean
    review_comment?: string | null
    reviewed_at?: string | null
  }>
  score?: number
  status: 'pending' | 'graded'
  submitted_at: string
  graded_at?: string
  results_released_at?: string | null
  feedback?: string
  pending_manual_review_count?: number
}

interface AnswerReviewState {
  manualPoints: string
  reviewComment: string
}

const parseManualPoints = (value: string | number | null | undefined) => {
  if (value === null || value === undefined || value === '') {
    return null
  }

  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export default function GradingView() {
  const client = useApiClient()
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [selectedSubmission, setSelectedSubmission] = useState<Submission | null>(null)
  const [gradeModalOpen, setGradeModalOpen] = useState(false)
  const [grading, setGrading] = useState(false)
  const [releasing, setReleasing] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [answerReviews, setAnswerReviews] = useState<Record<string, AnswerReviewState>>({})

  const loadSubmissions = async () => {
    try {
      setLoading(true)
      const response = await client.get('/progress/submissions')

      if (response.error) throw new Error(response.error)

      setSubmissions(response.data || [])
    } catch (error) {
      console.error('Failed to load submissions:', error)
      toast.error('Failed to load submissions')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadSubmissions()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleGrade = async () => {
    if (!selectedSubmission) return

    try {
      setGrading(true)
      const answerReviewsPayload = selectedSubmission.answers
        .filter((answer) => answer.requires_manual_review)
        .map((answer) => {
          const reviewState = answerReviews[answer.question_id]
          const manualPoints = parseManualPoints(reviewState?.manualPoints ?? answer.manual_points_earned)

          return {
            question_id: answer.question_id,
            manual_points_earned: manualPoints ?? 0,
            review_comment: reviewState?.reviewComment?.trim() || undefined,
          }
        })

      const response = await client.put(`/progress/submissions/${selectedSubmission._id}/grade`, {
        feedback: feedback.trim() || undefined,
        answer_reviews: answerReviewsPayload,
      })

      if (response.error) throw new Error(response.error)

      toast.success('Submission graded successfully')
      setGradeModalOpen(false)
      setSelectedSubmission(null)
      setFeedback('')
      setAnswerReviews({})
      loadSubmissions()
    } catch (error) {
      console.error('Failed to grade submission:', error)
      toast.error('Failed to grade submission')
    } finally {
      setGrading(false)
    }
  }

  const openGradeModal = (submission: Submission) => {
    setSelectedSubmission(submission)
    setFeedback(submission.feedback || '')
    setAnswerReviews(
      submission.answers.reduce<Record<string, AnswerReviewState>>((accumulator, answer) => {
        if (!answer.requires_manual_review) {
          return accumulator
        }

        accumulator[answer.question_id] = {
          manualPoints:
            answer.manual_points_earned !== undefined && answer.manual_points_earned !== null
              ? String(answer.manual_points_earned)
              : '',
          reviewComment: answer.review_comment || '',
        }
        return accumulator
      }, {}),
    )
    setGradeModalOpen(true)
  }

  const handleReleaseResults = async () => {
    if (!selectedSubmission) return

    try {
      setReleasing(true)
      const response = await client.post(`/progress/submissions/${selectedSubmission._id}/release`, {})
      if (response.error) throw new Error(response.error)

      toast.success('Results released to the student')
      setGradeModalOpen(false)
      setSelectedSubmission(null)
      loadSubmissions()
    } catch (error) {
      console.error('Failed to release results:', error)
      toast.error('Failed to release results')
    } finally {
      setReleasing(false)
    }
  }

  const getAnswerLabel = (submissionAnswer: Submission['answers'][number]) => {
    return submissionAnswer.answer?.trim() || submissionAnswer.selected_options?.join(', ') || 'No response'
  }

  const getDerivedScore = (submission: Submission | null) => {
    if (!submission) {
      return null
    }

    const totalPointsPossible = submission.answers.reduce(
      (sum, answer) => sum + Number(answer.points_possible ?? 0),
      0,
    )

    if (totalPointsPossible <= 0) {
      return submission.score ?? null
    }

    const earnedPoints = submission.answers.reduce((sum, answer) => {
      if (answer.requires_manual_review) {
        const reviewState = answerReviews[answer.question_id]
        const manualPoints = parseManualPoints(reviewState?.manualPoints ?? answer.manual_points_earned ?? answer.final_points_earned)
        return sum + (manualPoints ?? 0)
      }

      return sum + Number(answer.final_points_earned ?? answer.points_earned ?? 0)
    }, 0)

    return Math.round((earnedPoints / totalPointsPossible) * 10000) / 100
  }

  const filteredSubmissions = submissions.filter(submission => {
    const matchesSearch = 
      submission.student_id.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      submission.assignment_id.title.toLowerCase().includes(searchTerm.toLowerCase())
    const matchesStatus = statusFilter === 'all' || submission.status === statusFilter
    return matchesSearch && matchesStatus
  })

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-0'
      case 'graded': return 'bg-green-500/10 text-green-600 dark:text-green-400 border-0'
      case 'reviewed': return 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-0'
      default: return 'bg-muted text-muted-foreground border-0'
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'pending': return <Clock className="h-4 w-4" />
      case 'graded': return <CheckCircle className="h-4 w-4" />
      case 'reviewed': return <Eye className="h-4 w-4" />
      default: return <AlertCircle className="h-4 w-4" />
    }
  }

  const requiredManualReviewAnswers = selectedSubmission?.answers.filter((answer) => answer.requires_manual_review) || []
  const missingManualReviews = requiredManualReviewAnswers.filter((answer) => {
    const reviewState = answerReviews[answer.question_id]
    const manualPoints = parseManualPoints(reviewState?.manualPoints ?? answer.manual_points_earned)
    return manualPoints === null
  })
  const derivedScore = getDerivedScore(selectedSubmission)
  const resultsReleased = Boolean(selectedSubmission?.results_released_at)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Grading Center</h1>
          <p className="text-muted-foreground mt-1">
            Review and grade student submissions
          </p>
        </div>
      </div>

      {/* Filters */}
      <FilterToolbar>
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
          <Input
            placeholder="Search by student or assignment..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10 bg-muted/50"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="All Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="graded">Graded</SelectItem>
          </SelectContent>
        </Select>
      </FilterToolbar>

      {/* Submissions Table */}
      <Card className="border-0 shadow-sm bg-card">
        <CardContent className="p-0">
          <div className="rounded-lg border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead>Student</TableHead>
                  <TableHead>Assignment</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Submitted</TableHead>
                  <TableHead>Score</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 5 }).map((_, index) => (
                    <TableRow key={index}>
                      <TableCell>
                        <div className="h-4 bg-muted rounded w-32 animate-pulse"></div>
                      </TableCell>
                      <TableCell>
                        <div className="h-4 bg-muted rounded w-48 animate-pulse"></div>
                      </TableCell>
                      <TableCell>
                        <div className="h-4 bg-muted rounded w-24 animate-pulse"></div>
                      </TableCell>
                      <TableCell>
                        <div className="h-4 bg-muted rounded w-32 animate-pulse"></div>
                      </TableCell>
                      <TableCell>
                        <div className="h-4 bg-muted rounded w-16 animate-pulse"></div>
                      </TableCell>
                      <TableCell>
                        <div className="h-6 bg-muted rounded w-20 animate-pulse"></div>
                      </TableCell>
                      <TableCell>
                        <div className="h-8 bg-muted rounded w-24 animate-pulse ml-auto"></div>
                      </TableCell>
                    </TableRow>
                  ))
                ) : filteredSubmissions.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-12">
                      <div className="flex flex-col items-center gap-2">
                        <FileText className="h-12 w-12 text-muted-foreground/50" />
                        <p className="text-muted-foreground font-medium">
                          {searchTerm || statusFilter !== 'all'
                            ? 'No submissions found matching your filters'
                            : 'No submissions to grade yet'}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          Submissions will appear here when students complete assignments
                        </p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredSubmissions.map((submission) => (
                    (() => {
                      const statusLabel = submission.status === 'pending' && (submission.pending_manual_review_count || 0) > 0
                        ? 'Needs Review'
                        : submission.status === 'graded' && !submission.results_released_at
                          ? 'Ready to Release'
                          : submission.status.charAt(0).toUpperCase() + submission.status.slice(1)

                      return (
                    <TableRow key={submission._id} className="hover:bg-muted/30 transition-colors">
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Avatar className="h-8 w-8">
                            <AvatarFallback className="text-xs">
                              {submission.student_id.name.split(' ').map(n => n[0]).join('').toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <span className="font-medium text-foreground">
                            {submission.student_id.name}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="font-medium text-foreground">
                        {submission.assignment_id.title}
                      </TableCell>
                      <TableCell className="text-foreground">
                        {submission.assignment_id.subject_id?.name || 'General'}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDistanceToNow(new Date(submission.submitted_at), { addSuffix: true })}
                      </TableCell>
                      <TableCell className="text-foreground font-semibold">
                        {submission.score !== undefined ? `${submission.score}%` : submission.pending_manual_review_count ? 'Pending review' : '-'}
                      </TableCell>
                      <TableCell>
                        <Badge className={getStatusColor(submission.status)}>
                          <span className="flex items-center gap-1">
                            {getStatusIcon(submission.status)}
                            {statusLabel}
                          </span>
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          onClick={() => openGradeModal(submission)}
                          variant="outline"
                          size="sm"
                          className="h-8"
                        >
                          {submission.status === 'pending' ? 'Grade' : submission.results_released_at ? 'View' : 'Review & Release'}
                        </Button>
                      </TableCell>
                    </TableRow>
                      )
                    })()
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Grade Modal */}
      <Dialog open={gradeModalOpen} onOpenChange={setGradeModalOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{selectedSubmission?.status === 'pending' ? 'Grade Submission' : 'Review Submission'}</DialogTitle>
          </DialogHeader>
          {selectedSubmission && (
            <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Student</p>
                    <p className="font-medium">{selectedSubmission.student_id.name}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Assignment</p>
                  <p className="font-medium">{selectedSubmission.assignment_id.title}</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div className="rounded-lg border border-border p-4">
                    <p className="text-sm text-muted-foreground">Manual Review</p>
                    <p className="mt-1 text-2xl font-semibold text-foreground">
                      {requiredManualReviewAnswers.length - missingManualReviews.length}/{requiredManualReviewAnswers.length}
                    </p>
                  </div>
                  <div className="rounded-lg border border-border p-4">
                    <p className="text-sm text-muted-foreground">Derived Score</p>
                    <p className="mt-1 text-2xl font-semibold text-foreground">
                      {derivedScore !== null ? `${Math.round(derivedScore)}%` : 'Pending'}
                    </p>
                  </div>
                  <div className="rounded-lg border border-border p-4">
                    <p className="text-sm text-muted-foreground">Submission Status</p>
                    <p className="mt-1 text-2xl font-semibold text-foreground">
                      {resultsReleased
                        ? 'Released'
                        : selectedSubmission.status === 'graded'
                          ? 'Ready to Release'
                          : 'Pending Review'}
                    </p>
                  </div>
                </div>

              <div className="rounded-lg border border-border p-4">
                <p className="text-sm font-medium text-foreground">Answer Review</p>
                <div className="mt-3 space-y-3">
                  {selectedSubmission.answers.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No answers were submitted.</p>
                  ) : (
                    selectedSubmission.answers.map((answer, index) => {
                      const answerLabel = getAnswerLabel(answer)
                      const answerType = answer.answer_type || 'unanswered'
                      const answerTone =
                        answerType === 'correct'
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : answerType === 'incorrect'
                            ? 'text-red-600 dark:text-red-400'
                            : answerType === 'partial'
                              ? 'text-amber-600 dark:text-amber-400'
                              : 'text-muted-foreground'

                        return (
                          <div key={`${answer.question_id}-${index}`} className="rounded-md bg-muted/40 p-3">
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <p className="text-sm font-medium text-foreground">Question {index + 1}</p>
                                {answer.question_type && (
                                  <p className="text-xs text-muted-foreground capitalize">{answer.question_type.replace(/-/g, ' ')}</p>
                                )}
                              </div>
                              <Badge variant="outline" className={answerTone}>
                                {answerType.replace('_', ' ')}
                              </Badge>
                            </div>
                            {answer.question_text && (
                              <p className="mt-2 text-sm font-medium text-foreground">{answer.question_text}</p>
                            )}
                            <p className="mt-2 text-sm text-foreground">{answerLabel}</p>
                            <div className="mt-2 space-y-2">
                              <p className="text-xs text-muted-foreground">
                                Auto score: {Number(answer.auto_points_earned ?? answer.final_points_earned ?? answer.points_earned ?? 0)} / {Number(answer.points_possible ?? 0)} points
                              </p>

                              {answer.requires_manual_review ? (
                                <div className="grid gap-3 rounded-md border border-border bg-card p-3 md:grid-cols-[140px_1fr]">
                                  <div>
                                    <label className="text-xs font-medium text-muted-foreground">Manual score</label>
                                    <Input
                                      type="number"
                                      min="0"
                                      max={String(answer.points_possible ?? 0)}
                                      step="0.1"
                                      value={answerReviews[answer.question_id]?.manualPoints ?? ''}
                                      onChange={(event) =>
                                        setAnswerReviews((previous) => ({
                                          ...previous,
                                          [answer.question_id]: {
                                            manualPoints: event.target.value,
                                            reviewComment: previous[answer.question_id]?.reviewComment || '',
                                          },
                                        }))
                                      }
                                      className="mt-1"
                                    />
                                  </div>
                                  <div>
                                    <label className="text-xs font-medium text-muted-foreground">Review note</label>
                                    <Textarea
                                      value={answerReviews[answer.question_id]?.reviewComment ?? ''}
                                      onChange={(event) =>
                                        setAnswerReviews((previous) => ({
                                          ...previous,
                                          [answer.question_id]: {
                                            manualPoints: previous[answer.question_id]?.manualPoints || '',
                                            reviewComment: event.target.value,
                                          },
                                        }))
                                      }
                                      placeholder="Explain the scoring for this response..."
                                      className="mt-1 min-h-[90px]"
                                    />
                                  </div>
                                </div>
                              ) : (
                                <p className="text-xs text-muted-foreground">
                                  Final score: {Number(answer.final_points_earned ?? answer.points_earned ?? 0)} / {Number(answer.points_possible ?? 0)} points
                                </p>
                              )}
                            </div>
                          </div>
                        )
                      })
                  )}
                </div>
              </div>

              <div>
                <label className="text-sm font-medium">Feedback</label>
                <Textarea
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  placeholder="Provide feedback to the student..."
                  className="mt-1 min-h-[120px]"
                />
              </div>

              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => setGradeModalOpen(false)}
                  disabled={grading}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleGrade}
                  disabled={grading || missingManualReviews.length > 0}
                >
                  {grading ? 'Saving...' : selectedSubmission.status === 'pending' ? 'Finalize Review' : 'Update Review'}
                </Button>
                {selectedSubmission.status === 'graded' && !resultsReleased && (
                  <Button onClick={handleReleaseResults} disabled={releasing}>
                    {releasing ? 'Releasing...' : 'Release Results'}
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}



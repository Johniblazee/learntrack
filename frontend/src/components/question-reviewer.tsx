import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '@clerk/clerk-react'
import { useNavigate } from 'react-router-dom'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { CheckCircle, XCircle, Eye, ThumbsUp, ThumbsDown, Search, BookOpen, Flag, RefreshCw, ArrowRight, Edit } from "lucide-react"
import { Input } from "@/components/ui/input"
import { toast } from '@/contexts/ToastContext'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Checkbox } from '@/components/ui/checkbox'
import { API_BASE_URL } from '@/lib/config'
import { DIFFICULTIES, DIFFICULTY_LABELS } from '@/lib/constants'
import { useSubjects } from '@/hooks/useQueries'
import type { Question, GenerationStats, ReviewStats, SubjectRecord } from './question-review/types'
import { mapQuestionFromApi } from './question-review/mappers'
import QuestionCard from './question-review/QuestionCard'
import ReviewStatsCards from './question-review/ReviewStatsCards'
import EditQuestionDialog from './question-review/EditQuestionDialog'
import BulkRevisionDialog from './question-review/BulkRevisionDialog'

// ---------------------------------------------------------------------------
// Data fetching helper
// ---------------------------------------------------------------------------

const fetchQuestionsCollection = async (
  token: string,
  path: string,
): Promise<Question[]> => {
  const results: Question[] = []
  let page = 1
  let total = 0
  let hasMore = true

  while (hasMore) {
    const separator = path.includes('?') ? '&' : '?'
    const response = await fetch(`${API_BASE_URL}${path}${separator}page=${page}&per_page=100`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      throw new Error('Failed to fetch questions')
    }

    const data = await response.json()
    const items = data?.items || (Array.isArray(data) ? data : [])
    results.push(...items.map(mapQuestionFromApi))
    total = Number(data?.total || results.length)
    hasMore = items.length > 0 && results.length < total
    page += 1
  }

  return results
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function QuestionReviewer() {
  const { getToken } = useAuth()
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState("review")
  const [searchTerm, setSearchTerm] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")
  const [subjectFilter, setSubjectFilter] = useState("all")
  const [difficultyFilter, setDifficultyFilter] = useState("all")
  const [questions, setQuestions] = useState<Question[]>([])
  const [approvedQuestions, setApprovedQuestions] = useState<Question[]>([])
  const [rejectedQuestions, setRejectedQuestions] = useState<Question[]>([])
  const [analyticsQuestions, setAnalyticsQuestions] = useState<Question[]>([])
  const [loading, setLoading] = useState(false)
  const [approvedLoading, setApprovedLoading] = useState(false)
  const [rejectedLoading, setRejectedLoading] = useState(false)
  const [selectedQuestions, setSelectedQuestions] = useState<Set<string>>(new Set())
  const [selectedApprovedQuestions, setSelectedApprovedQuestions] = useState<Set<string>>(new Set())
  const [generationStats, setGenerationStats] = useState<GenerationStats | null>(null)
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [isSavingEdit, setIsSavingEdit] = useState(false)
  const [bulkRevisionDialogOpen, setBulkRevisionDialogOpen] = useState(false)
  const [bulkRevisionNotes, setBulkRevisionNotes] = useState('')
  const [editingQuestion, setEditingQuestion] = useState<Question | null>(null)
  const [editForm, setEditForm] = useState({
    question_text: '',
    options_text: '',
    correct_answer: '',
    explanation: '',
  })

  const { data: subjectsData } = useSubjects()
  const subjects = useMemo<SubjectRecord[]>(() => {
    if (Array.isArray(subjectsData)) {
      return subjectsData as SubjectRecord[]
    }
    return ((subjectsData as { items?: SubjectRecord[] } | undefined)?.items || []) as SubjectRecord[]
  }, [subjectsData])

  const subjectIdByName = useMemo(() => {
    return new Map(
      subjects
        .map((subject) => {
          const subjectId = String(subject._id || subject.id || '').trim()
          const subjectName = String(subject.name || '').trim()
          if (!subjectId || !subjectName) return null
          return [subjectName.toLowerCase(), subjectId] as const
        })
        .filter(Boolean) as Array<readonly [string, string]>
    )
  }, [subjects])

  // -----------------------------------------------------------------------
  // Fetch
  // -----------------------------------------------------------------------

  const fetchPendingQuestions = async () => {
    try {
      setLoading(true)
      const token = await getToken()
      if (!token) throw new Error('Authentication token is unavailable')
      setQuestions(await fetchQuestionsCollection(token, '/question-generator/pending-questions'))
    } catch (error) {
      console.error('Error fetching pending questions:', error)
      toast.error('Error loading questions')
    } finally {
      setLoading(false)
    }
  }

  const fetchApprovedQuestions = async () => {
    try {
      setApprovedLoading(true)
      const token = await getToken()
      if (!token) throw new Error('Authentication token is unavailable')
      setApprovedQuestions(await fetchQuestionsCollection(token, '/question-generator/all-questions?status=approved'))
    } catch (error) {
      console.error('Error fetching approved questions:', error)
      toast.error('Error loading approved questions')
    } finally {
      setApprovedLoading(false)
    }
  }

  const fetchRejectedQuestions = async () => {
    try {
      setRejectedLoading(true)
      const token = await getToken()
      if (!token) throw new Error('Authentication token is unavailable')
      setRejectedQuestions(await fetchQuestionsCollection(token, '/question-generator/all-questions?status=rejected'))
    } catch (error) {
      console.error('Error fetching rejected questions:', error)
      toast.error('Error loading rejected questions')
    } finally {
      setRejectedLoading(false)
    }
  }

  const fetchAnalyticsData = async () => {
    try {
      const token = await getToken()
      if (!token) throw new Error('Authentication token is unavailable')
      const [statsResponse, allQuestions] = await Promise.all([
        fetch(`${API_BASE_URL}/question-generator/stats`, {
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        }),
        fetchQuestionsCollection(token, '/question-generator/all-questions'),
      ])
      if (statsResponse.ok) setGenerationStats(await statsResponse.json())
      setAnalyticsQuestions(allQuestions)
    } catch (error) {
      console.error('Error fetching analytics data:', error)
    }
  }

  useEffect(() => { fetchPendingQuestions(); fetchAnalyticsData() }, [])
  useEffect(() => {
    if (activeTab === 'approved' && approvedQuestions.length === 0) fetchApprovedQuestions()
    if (activeTab === 'rejected' && rejectedQuestions.length === 0) fetchRejectedQuestions()
  }, [activeTab])
  useEffect(() => { setSelectedQuestions(new Set()); setSelectedApprovedQuestions(new Set()) }, [activeTab])

  // -----------------------------------------------------------------------
  // Actions
  // -----------------------------------------------------------------------

  const handleApprove = async (questionId: string, options?: { silent?: boolean }): Promise<boolean> => {
    try {
      const question = questions.find(q => q.id === questionId || q.question_id === questionId)
      if (!question?.session_id) {
        if (!options?.silent) toast.error('Session ID not found for this question')
        return false
      }

      const token = await getToken()
      const response = await fetch(
        `${API_BASE_URL}/question-generator/sessions/${question.session_id}/questions/${questionId}/approve`,
        { method: 'POST', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' } },
      )

      if (response.ok) {
        if (!options?.silent) toast.success('Question approved', { description: 'The question is approved and ready to publish to your question bank.' })
        setApprovedQuestions((prev) => [{ ...question, status: 'approved' as const }, ...prev.filter((q) => q.id !== question.id)])
        setQuestions((prev) => prev.filter((q) => q.id !== questionId))
        setSelectedQuestions((prev) => { const next = new Set(prev); next.delete(questionId); return next })
        setGenerationStats((prev) => prev ? { ...prev, approved_questions: prev.approved_questions + 1 } : prev)
        return true
      }
      throw new Error(await response.text() || 'Failed to approve question')
    } catch (error: unknown) {
      console.error('Error approving question:', error)
      if (!options?.silent) toast.error('Failed to approve question', { description: error instanceof Error ? error.message : 'Please try again later' })
      return false
    }
  }

  const handleReject = async (questionId: string, reason?: string, options?: { silent?: boolean }): Promise<boolean> => {
    try {
      const question = questions.find(q => q.id === questionId || q.question_id === questionId)
      if (!question?.session_id) {
        if (!options?.silent) toast.error('Session ID not found for this question')
        return false
      }

      const token = await getToken()
      const response = await fetch(
        `${API_BASE_URL}/question-generator/sessions/${question.session_id}/questions/${questionId}/reject${reason ? `?reason=${encodeURIComponent(reason)}` : ''}`,
        { method: 'POST', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' } },
      )

      if (response.ok) {
        if (!options?.silent) toast.success('Question rejected', { description: 'The question has been rejected' })
        setRejectedQuestions((prev) => [{ ...question, status: 'rejected' as const, reviewComments: reason, rejectionReason: reason }, ...prev.filter((q) => q.id !== question.id)])
        setQuestions((prev) => prev.filter((q) => q.id !== questionId))
        setSelectedQuestions((prev) => { const next = new Set(prev); next.delete(questionId); return next })
        setGenerationStats((prev) => prev ? { ...prev, rejected_questions: prev.rejected_questions + 1 } : prev)
        return true
      }
      throw new Error(await response.text() || 'Failed to reject question')
    } catch (error: unknown) {
      console.error('Error rejecting question:', error)
      if (!options?.silent) toast.error('Failed to reject question', { description: error instanceof Error ? error.message : 'Please try again later' })
      return false
    }
  }

  const handleRequestRevision = async (questionId: string, notes: string, options?: { silent?: boolean }): Promise<boolean> => {
    try {
      const question = questions.find(q => q.id === questionId || q.question_id === questionId)
      if (!question?.session_id) {
        if (!options?.silent) toast.error('Session ID not found for this question')
        return false
      }

      const token = await getToken()
      const response = await fetch(
        `${API_BASE_URL}/question-generator/sessions/${question.session_id}/questions/${questionId}/request-revision?notes=${encodeURIComponent(notes)}`,
        { method: 'POST', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' } },
      )

      if (response.ok) {
        setQuestions((prev) => prev.map((item) => item.id === questionId ? { ...item, status: 'pending', reviewComments: notes } : item))
        if (!options?.silent) toast.success('Revision requested', { description: 'The draft stays in the review queue with your notes attached.' })
        return true
      }
      throw new Error(await response.text() || 'Failed to request revision')
    } catch (error) {
      console.error('Error requesting revision:', error)
      if (!options?.silent) toast.error('Failed to request revision')
      return false
    }
  }

  const resolveSubjectIdForQuestion = (question: Question) => {
    const candidate = String(question.subject || '').trim().toLowerCase()
    return subjectIdByName.get(candidate) || null
  }

  const handlePublishApprovedQuestion = async (question: Question, options?: { silent?: boolean }): Promise<string | null> => {
    if (!question.session_id) { if (!options?.silent) toast.error('Session ID not found for this question'); return null }
    const subjectId = resolveSubjectIdForQuestion(question)
    if (!subjectId) { if (!options?.silent) toast.error('Select or fix the subject before publishing this question.'); return null }

    try {
      const token = await getToken()
      const response = await fetch(
        `${API_BASE_URL}/question-generator/sessions/${question.session_id}/save-to-question-bank`,
        {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ question_ids: [question.id], subject_id: subjectId, topic: question.topic || undefined }),
        },
      )

      if (!response.ok) {
        let detail = 'Failed to publish question'
        try { const payload = await response.json(); if (typeof payload?.detail === 'string' && payload.detail.trim()) detail = payload.detail } catch { /* ignore */ }
        throw new Error(detail)
      }

      const data = await response.json() as { published_items?: Record<string, string> }
      const publishedQuestionId = data.published_items?.[question.id]
      const publishedAt = new Date().toISOString()

      if (publishedQuestionId) {
        setApprovedQuestions((prev) => prev.map((item) => item.id === question.id ? { ...item, publishedQuestionId, publishedAt } : item))
      }
      if (!options?.silent) {
        toast.success(question.publishedQuestionId ? 'Question bank entry updated' : 'Question published', {
          description: question.publishedQuestionId
            ? 'The existing question bank entry has been synced with this approved draft.'
            : 'The approved draft is now available in your question bank.',
        })
      }
      return publishedQuestionId || question.publishedQuestionId || null
    } catch (error: unknown) {
      console.error('Failed to publish approved question:', error)
      if (!options?.silent) toast.error('Failed to publish question', { description: error instanceof Error ? error.message : 'Please try again later' })
      return null
    }
  }

  const handleCreateAssignmentFromApproved = async (questionsToUse: Question[]) => {
    if (questionsToUse.length === 0) { toast.error('Select at least one approved question'); return }
    try {
      const publishResults = await Promise.all(questionsToUse.map((q) => handlePublishApprovedQuestion(q, { silent: true })))
      const publishedQuestionIds = publishResults.filter(Boolean) as string[]
      if (publishedQuestionIds.length === 0) { toast.error('No approved questions could be published to the question bank'); return }

      const uniqueTopics = Array.from(new Set(questionsToUse.map((q) => String(q.topic || '').trim()).filter(Boolean)))
      const uniqueSubjectIds = Array.from(new Set(questionsToUse.map((q) => resolveSubjectIdForQuestion(q) || '').filter(Boolean)))

      navigate('/dashboard/assignments/create', {
        state: {
          questionBankIds: publishedQuestionIds,
          prefillTitle: questionsToUse.length === 1 ? `${questionsToUse[0].topic || 'Question'} Assignment` : `Assignment from ${questionsToUse.length} approved questions`,
          prefillTopic: uniqueTopics.length === 1 ? uniqueTopics[0] : '',
          prefillSubjectId: uniqueSubjectIds.length === 1 ? uniqueSubjectIds[0] : '',
          workflowSource: { label: 'Question Review', description: `${publishedQuestionIds.length} approved question${publishedQuestionIds.length === 1 ? '' : 's'} were published to the question bank and loaded here.` },
        },
      })
    } catch (error) {
      console.error('Failed to prepare approved questions for assignment creation:', error)
      toast.error('Failed to prepare approved questions for assignment creation')
    }
  }

  const openEditDialog = (question: Question) => {
    setEditingQuestion(question)
    setEditForm({ question_text: question.text, options_text: (question.options || []).join('\n'), correct_answer: question.correctAnswer, explanation: question.explanation })
    setEditDialogOpen(true)
  }

  const handleSaveEdit = async () => {
    if (!editingQuestion) return
    if (!editingQuestion.session_id) { toast.error('Cannot edit this question because session metadata is missing.'); return }
    const questionText = editForm.question_text.trim()
    if (!questionText) { toast.error('Question text is required'); return }

    const options = editForm.options_text.split('\n').map((o) => o.trim()).filter(Boolean)
    const payload: { question_text: string; options?: string[]; correct_answer?: string; explanation?: string } = {
      question_text: questionText, explanation: editForm.explanation.trim(), correct_answer: editForm.correct_answer.trim(),
    }
    if (options.length > 0) payload.options = options

    try {
      setIsSavingEdit(true)
      const token = await getToken()
      const response = await fetch(
        `${API_BASE_URL}/question-generator/sessions/${editingQuestion.session_id}/questions/${editingQuestion.id}`,
        { method: 'PUT', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) },
      )
      if (!response.ok) throw new Error('Failed to update question')

      const updatedQuestion: Question = {
        ...editingQuestion, text: questionText, question_text: questionText,
        options: options.length > 0 ? options : editingQuestion.options,
        correctAnswer: editForm.correct_answer.trim(), correct_answer: editForm.correct_answer.trim(),
        explanation: editForm.explanation.trim(), status: 'pending',
        reviewComments: undefined, rejectionReason: undefined,
        publishedQuestionId: editingQuestion.publishedQuestionId, publishedAt: editingQuestion.publishedAt,
      }

      setQuestions((prev) => {
        const exists = prev.some((q) => q.id === updatedQuestion.id)
        return exists ? prev.map((q) => q.id === updatedQuestion.id ? updatedQuestion : q) : [updatedQuestion, ...prev]
      })
      setApprovedQuestions((prev) => prev.filter((q) => q.id !== updatedQuestion.id))
      if (editingQuestion.status === 'approved') {
        setGenerationStats((prev) => prev ? { ...prev, approved_questions: Math.max(prev.approved_questions - 1, 0) } : prev)
      }
      toast.success('Question updated and moved back into the review queue')
      setEditDialogOpen(false)
      setEditingQuestion(null)
    } catch (error: unknown) {
      console.error('Failed to update question:', error)
      toast.error('Failed to update question', { description: error instanceof Error ? error.message : 'Please try again later' })
    } finally {
      setIsSavingEdit(false)
    }
  }

  // -----------------------------------------------------------------------
  // Bulk actions
  // -----------------------------------------------------------------------

  const handleBulkApprove = async () => {
    const results = await Promise.all(Array.from(selectedQuestions).map((id) => handleApprove(id, { silent: true })))
    const ok = results.filter(Boolean).length
    const fail = results.length - ok
    if (ok > 0) { toast.success(fail > 0 ? `Approved ${ok} questions, ${fail} failed` : `Approved ${ok} questions`); setSelectedQuestions(new Set()) }
    else if (fail > 0) toast.error('Failed to approve selected questions')
  }

  const handleBulkReject = async () => {
    const results = await Promise.all(Array.from(selectedQuestions).map((id) => handleReject(id, undefined, { silent: true })))
    const ok = results.filter(Boolean).length
    const fail = results.length - ok
    if (ok > 0) { toast.success(fail > 0 ? `Rejected ${ok} questions, ${fail} failed` : `Rejected ${ok} questions`); setSelectedQuestions(new Set()) }
    else if (fail > 0) toast.error('Failed to reject selected questions')
  }

  const handleBulkRequestRevision = async () => {
    const notes = bulkRevisionNotes.trim()
    if (!notes) { toast.error('Revision notes are required'); return }
    const results = await Promise.all(Array.from(selectedQuestions).map((id) => handleRequestRevision(id, notes, { silent: true })))
    const ok = results.filter(Boolean).length
    const fail = results.length - ok
    if (ok > 0) { toast.success(fail > 0 ? `Requested revision for ${ok} questions, ${fail} failed` : `Requested revision for ${ok} questions`); setSelectedQuestions(new Set()); setBulkRevisionDialogOpen(false); setBulkRevisionNotes('') }
    else if (fail > 0) toast.error('Failed to request revision for selected questions')
  }

  const handleBulkPublishApproved = async () => {
    const selection = approvedQuestions.filter((q) => selectedApprovedQuestions.has(q.id))
    const results = await Promise.all(selection.map((q) => handlePublishApprovedQuestion(q, { silent: true })))
    const ok = results.filter(Boolean).length
    const fail = results.length - ok
    if (ok > 0) { toast.success(fail > 0 ? `Published or synced ${ok} questions, ${fail} failed` : `Published or synced ${ok} questions`); setSelectedApprovedQuestions(new Set()) }
    else if (fail > 0) toast.error('Failed to publish selected approved questions')
  }

  // -----------------------------------------------------------------------
  // Derived state
  // -----------------------------------------------------------------------

  const pendingCount = questions.filter((q) => q.status === 'pending').length
  const approvedCount = generationStats?.approved_questions ?? approvedQuestions.length
  const rejectedCount = generationStats?.rejected_questions ?? analyticsQuestions.filter((q) => q.status === 'rejected').length
  const totalGeneratedCount = generationStats?.total_generated ?? (pendingCount + approvedCount + rejectedCount)
  const ratings = analyticsQuestions.filter((q) => q.rating).map((q) => q.rating || 0)
  const reviewStats: ReviewStats = {
    totalQuestions: totalGeneratedCount,
    pendingReview: pendingCount,
    approved: approvedCount,
    rejected: rejectedCount,
    averageRating: ratings.length ? ratings.reduce((sum, v) => sum + v, 0) / ratings.length : 0,
  }

  const filteredQuestions = questions.filter((q) => {
    const matchesSearch = q.text.toLowerCase().includes(searchTerm.toLowerCase()) || q.subject.toLowerCase().includes(searchTerm.toLowerCase()) || q.topic.toLowerCase().includes(searchTerm.toLowerCase()) || q.tags.some(tag => tag.toLowerCase().includes(searchTerm.toLowerCase()))
    const matchesStatus = statusFilter === "all" || q.status === statusFilter
    const matchesSubject = subjectFilter === "all" || q.subject === subjectFilter
    const matchesDifficulty = difficultyFilter === "all" || q.difficulty.toLowerCase() === difficultyFilter
    return matchesSearch && matchesStatus && matchesSubject && matchesDifficulty
  })

  const filteredApprovedQuestions = approvedQuestions.filter((q) => {
    const matchesSearch = q.text.toLowerCase().includes(searchTerm.toLowerCase()) || q.subject.toLowerCase().includes(searchTerm.toLowerCase()) || q.topic.toLowerCase().includes(searchTerm.toLowerCase())
    return matchesSearch && (subjectFilter === 'all' || q.subject === subjectFilter)
  })

  const filteredRejectedQuestions = rejectedQuestions.filter((q) => {
    const matchesSearch = q.text.toLowerCase().includes(searchTerm.toLowerCase()) || q.subject.toLowerCase().includes(searchTerm.toLowerCase()) || q.topic.toLowerCase().includes(searchTerm.toLowerCase())
    return matchesSearch && (subjectFilter === 'all' || q.subject === subjectFilter)
  })

  // -----------------------------------------------------------------------
  // Skeleton for loading state
  // -----------------------------------------------------------------------

  const renderLoadingSkeleton = (count = 3) => (
    <div className="space-y-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-lg border border-border p-4 space-y-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      ))}
    </div>
  )

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground">Review Questions</h1>
          <p className="text-sm sm:text-base text-muted-foreground mt-1">Review and approve AI-generated questions for quality assurance</p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchPendingQuestions} disabled={loading} className="flex items-center gap-2 self-start sm:self-auto">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      <ReviewStatsCards stats={reviewStats} />

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4 sm:space-y-6">
        <TabsList className="bg-muted/30 border border-border p-1 h-auto w-full grid grid-cols-3 gap-1">
          {['review', 'approved', 'rejected'].map((tab) => (
            <TabsTrigger
              key={tab}
              value={tab}
              className="px-4 py-2.5 text-xs sm:text-sm font-medium rounded-md transition-all data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm data-[state=inactive]:text-muted-foreground data-[state=inactive]:hover:text-foreground data-[state=inactive]:hover:bg-muted/50"
            >
              {tab === 'review' ? 'Review Queue' : tab.charAt(0).toUpperCase() + tab.slice(1)}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* Review Queue Tab */}
        <TabsContent value="review" className="space-y-4 sm:space-y-6">
          {/* Filters */}
          <Card className="border-border shadow-sm bg-card">
            <CardContent className="p-3 sm:p-4">
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="flex-1">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
                    <Input placeholder="Search questions..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-10 bg-background border-border h-9 sm:h-10 text-sm" />
                  </div>
                </div>
                <div className="grid grid-cols-3 sm:flex gap-3">
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="w-full sm:w-[150px] h-9 sm:h-10 border-border text-sm"><SelectValue placeholder="Status" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Status</SelectItem>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="approved">Approved</SelectItem>
                      <SelectItem value="rejected">Rejected</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={subjectFilter} onValueChange={setSubjectFilter}>
                    <SelectTrigger className="w-full sm:w-[150px] h-9 sm:h-10 border-border text-sm"><SelectValue placeholder="Subject" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Subjects</SelectItem>
                      {subjects.map((s) => {
                        const id = String(s._id || s.id || '').trim()
                        const name = String(s.name || '').trim()
                        return id && name ? <SelectItem key={id} value={name}>{name}</SelectItem> : null
                      })}
                    </SelectContent>
                  </Select>
                  <Select value={difficultyFilter} onValueChange={setDifficultyFilter}>
                    <SelectTrigger className="w-full sm:w-[150px] h-9 sm:h-10 border-border text-sm"><SelectValue placeholder="Difficulty" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Levels</SelectItem>
                      {Object.values(DIFFICULTIES).map(d => <SelectItem key={d} value={d}>{DIFFICULTY_LABELS[d]}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Question list */}
          <Card className="border-border shadow-sm bg-card overflow-visible">
            <CardHeader className="border-b border-border">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center text-foreground">
                  <Eye className="w-5 h-5 mr-2 text-primary flex-shrink-0" />
                  Questions for Review ({filteredQuestions.length})
                </CardTitle>
                {!loading && filteredQuestions.length > 0 && (
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <Checkbox
                        checked={(() => {
                          const pending = filteredQuestions.filter((q) => q.status === 'pending')
                          const all = pending.length > 0 && pending.every((q) => selectedQuestions.has(q.id))
                          const some = pending.some((q) => selectedQuestions.has(q.id)) && !all
                          return all ? true : some ? "indeterminate" : false
                        })()}
                        onCheckedChange={(checked) => {
                          const ids = filteredQuestions.filter((q) => q.status === 'pending').map((q) => q.id)
                          setSelectedQuestions(checked ? new Set(ids) : new Set())
                        }}
                      />
                      <span className="text-sm text-muted-foreground">{selectedQuestions.size > 0 ? `${selectedQuestions.size} selected` : 'Select all pending'}</span>
                    </label>
                    {selectedQuestions.size > 0 && (
                      <div className="flex items-center gap-2">
                        <Button size="sm" onClick={handleBulkApprove} className="bg-green-600 hover:bg-green-700 text-white h-8"><ThumbsUp className="w-3.5 h-3.5 mr-1.5" />Approve {selectedQuestions.size}</Button>
                        <Button size="sm" variant="outline" onClick={handleBulkReject} className="h-8 text-red-600 dark:text-red-500"><ThumbsDown className="w-3.5 h-3.5 mr-1.5" />Reject {selectedQuestions.size}</Button>
                        <Button size="sm" variant="outline" onClick={() => setBulkRevisionDialogOpen(true)} className="h-8"><Flag className="w-3.5 h-3.5 mr-1.5" />Request Revision</Button>
                        <Button size="sm" variant="ghost" onClick={() => setSelectedQuestions(new Set())} className="h-8 text-muted-foreground">Clear</Button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-6">
              {loading ? renderLoadingSkeleton() : filteredQuestions.length === 0 ? (
                <div className="text-center py-12">
                  <CheckCircle className="w-16 h-16 mx-auto text-primary mb-4" />
                  <p className="text-xl font-semibold text-foreground">All caught up!</p>
                  <p className="text-muted-foreground mt-2">No pending questions to review.</p>
                </div>
              ) : (
                <div className="space-y-6">
                  {filteredQuestions.map((q) => (
                    <QuestionCard
                      key={q.id}
                      question={q}
                      selectable={q.status === 'pending'}
                      selected={selectedQuestions.has(q.id)}
                      onToggleSelect={() => { const next = new Set(selectedQuestions); if (next.has(q.id)) next.delete(q.id); else next.add(q.id); setSelectedQuestions(next) }}
                      actions={q.status === 'pending' ? (
                        <div className="flex items-center gap-3 flex-wrap">
                          <Button onClick={() => handleApprove(q.id)} className="bg-green-600 hover:bg-green-700 text-white"><ThumbsUp className="w-4 h-4 mr-2" />Approve</Button>
                          <Button variant="outline" onClick={() => handleRequestRevision(q.id, 'Please revise')} className="border-border hover:bg-muted"><Flag className="w-4 h-4 mr-2" />Request Revision</Button>
                          <Button variant="outline" onClick={() => handleReject(q.id)} className="border-border hover:bg-red-50 dark:hover:bg-red-950/30 text-red-600 dark:text-red-500"><ThumbsDown className="w-4 h-4 mr-2" />Reject</Button>
                          <div className="flex-1" />
                          <Button variant="outline" className="border-border" onClick={() => openEditDialog(q)}><Edit className="w-4 h-4 mr-2" />Edit</Button>
                        </div>
                      ) : undefined}
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Approved Tab */}
        <TabsContent value="approved" className="space-y-6">
          <Card className="border-border shadow-sm bg-card">
            <CardHeader className="border-b border-border">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <CardTitle className="flex items-center text-foreground"><CheckCircle className="w-5 h-5 mr-2 text-green-600 dark:text-green-500" />Approved Questions ({filteredApprovedQuestions.length})</CardTitle>
                  <CardDescription className="text-muted-foreground">Approved drafts are ready to publish into the reusable question bank.</CardDescription>
                </div>
                {filteredApprovedQuestions.length > 0 && (
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <Checkbox
                        checked={(() => {
                          const all = filteredApprovedQuestions.length > 0 && filteredApprovedQuestions.every((q) => selectedApprovedQuestions.has(q.id))
                          const some = filteredApprovedQuestions.some((q) => selectedApprovedQuestions.has(q.id)) && !all
                          return all ? true : some ? 'indeterminate' : false
                        })()}
                        onCheckedChange={(checked) => setSelectedApprovedQuestions(checked ? new Set(filteredApprovedQuestions.map((q) => q.id)) : new Set())}
                      />
                      <span className="text-sm text-muted-foreground">{selectedApprovedQuestions.size > 0 ? `${selectedApprovedQuestions.size} selected` : 'Select approved'}</span>
                    </label>
                    {selectedApprovedQuestions.size > 0 && (
                      <div className="flex items-center gap-2">
                        <Button size="sm" onClick={handleBulkPublishApproved} className="h-8"><BookOpen className="w-3.5 h-3.5 mr-1.5" />Publish or Sync</Button>
                        <Button size="sm" variant="ghost" onClick={() => setSelectedApprovedQuestions(new Set())} className="h-8 text-muted-foreground">Clear</Button>
                        <Button size="sm" variant="outline" onClick={() => void handleCreateAssignmentFromApproved(approvedQuestions.filter((q) => selectedApprovedQuestions.has(q.id)))} className="h-8"><ArrowRight className="w-3.5 h-3.5 mr-1.5" />Publish & Create Assignment</Button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-8">
              {approvedLoading ? renderLoadingSkeleton() : filteredApprovedQuestions.length === 0 ? (
                <div className="text-center py-8">
                  <div className="w-16 h-16 rounded-full bg-green-50 dark:bg-green-950/30 flex items-center justify-center mx-auto mb-4"><CheckCircle className="w-8 h-8 text-green-600 dark:text-green-500" /></div>
                  <p className="text-muted-foreground">No approved questions found.</p>
                </div>
              ) : (
                <div className="space-y-6">
                  {filteredApprovedQuestions.map((q) => (
                    <QuestionCard
                      key={q.id}
                      question={q}
                      selectable
                      selected={selectedApprovedQuestions.has(q.id)}
                      onToggleSelect={() => { const next = new Set(selectedApprovedQuestions); if (next.has(q.id)) next.delete(q.id); else next.add(q.id); setSelectedApprovedQuestions(next) }}
                      showPublishStatus
                      showCreatedDate
                      actions={(
                        <div className="flex items-center justify-end gap-3">
                          <Button variant="outline" onClick={() => void handleCreateAssignmentFromApproved([q])}><ArrowRight className="w-4 h-4 mr-2" />Create Assignment</Button>
                          <Button onClick={() => void handlePublishApprovedQuestion(q)} className="bg-primary hover:bg-primary/90"><BookOpen className="w-4 h-4 mr-2" />{q.publishedQuestionId ? 'Update Question Bank Entry' : 'Publish to Question Bank'}</Button>
                        </div>
                      )}
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Rejected Tab */}
        <TabsContent value="rejected" className="space-y-6">
          <Card className="border-border shadow-sm bg-card">
            <CardHeader className="border-b border-border">
              <CardTitle className="flex items-center text-foreground"><XCircle className="w-5 h-5 mr-2 text-red-600 dark:text-red-500" />Rejected Questions ({filteredRejectedQuestions.length})</CardTitle>
              <CardDescription className="text-muted-foreground">Questions marked as rejected during review.</CardDescription>
            </CardHeader>
            <CardContent className="p-8">
              {rejectedLoading ? renderLoadingSkeleton() : filteredRejectedQuestions.length === 0 ? (
                <div className="text-center py-8">
                  <div className="w-16 h-16 rounded-full bg-red-50 dark:bg-red-950/30 flex items-center justify-center mx-auto mb-4"><XCircle className="w-8 h-8 text-red-600 dark:text-red-500" /></div>
                  <p className="text-muted-foreground">No rejected questions found.</p>
                </div>
              ) : (
                <div className="space-y-6">
                  {filteredRejectedQuestions.map((q) => (
                    <QuestionCard key={q.id} question={q} showCreatedDate reviewCommentStyle="error" />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <BulkRevisionDialog open={bulkRevisionDialogOpen} onOpenChange={setBulkRevisionDialogOpen} notes={bulkRevisionNotes} onNotesChange={setBulkRevisionNotes} onSubmit={handleBulkRequestRevision} />
      <EditQuestionDialog open={editDialogOpen} onOpenChange={setEditDialogOpen} form={editForm} onFormChange={setEditForm} onSave={handleSaveEdit} saving={isSavingEdit} />
    </div>
  )
}

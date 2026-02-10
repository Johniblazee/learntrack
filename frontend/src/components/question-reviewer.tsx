import { useState, useEffect } from 'react'
import { useAuth } from '@clerk/clerk-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { CheckCircle, XCircle, AlertTriangle, Eye, Edit, ThumbsUp, ThumbsDown, Star, Search, BookOpen, BarChart3, MessageSquare, Flag, Clock } from "lucide-react"
import { Input } from "@/components/ui/input"
import { toast } from '@/contexts/ToastContext'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { MathText } from '@/components/ui/math-text'
import { API_BASE_URL } from '@/lib/config'

interface Question {
  id: string
  question_id?: string  // From generation API
  session_id?: string   // Session this question belongs to
  text: string
  question_text?: string  // From generation API
  type: string
  difficulty: string
  blooms_level?: string
  subject: string
  topic: string
  options?: string[]
  correctAnswer: string
  correct_answer?: string  // From generation API
  explanation: string
  points: number
  tags: string[]
  status: 'pending' | 'approved' | 'rejected' | 'needs-revision' | 'PENDING' | 'APPROVED' | 'REJECTED'
  createdBy: string
  createdAt: string
  session_created_at?: string  // From generation API
  reviewedBy?: string
  reviewedAt?: string
  reviewComments?: string
  rating?: number
  usageCount: number
  successRate: number
}

interface ReviewStats {
  totalQuestions: number
  pendingReview: number
  approved: number
  rejected: number
  averageRating: number
}

export default function QuestionReviewer() {
  const { getToken } = useAuth()
  const [activeTab, setActiveTab] = useState("review")
  const [searchTerm, setSearchTerm] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")
  const [subjectFilter, setSubjectFilter] = useState("all")
  const [questions, setQuestions] = useState<Question[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedQuestions, setSelectedQuestions] = useState<Set<string>>(new Set())

  // Fetch pending questions from backend
  useEffect(() => {
    fetchPendingQuestions()
  }, [])

  const fetchPendingQuestions = async () => {
    try {
      setLoading(true)
      const token = await getToken()
      const response = await fetch(`${API_BASE_URL}/question-generator/pending-questions`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      })

      if (response.ok) {
        const data = await response.json()
        // Handle paginated response: { items: [...], total, page, per_page }
        const items = data?.items || (Array.isArray(data) ? data : [])
        // Map the API response to our Question interface
        const mappedQuestions = items.map((q: any) => ({
          id: q.question_id || q.id,
          question_id: q.question_id,
          session_id: q.session_id,
          text: q.question_text || q.text,
          question_text: q.question_text,
          type: q.type,
          difficulty: q.difficulty,
          blooms_level: q.blooms_level,
          subject: q.subject || 'Generated',
          topic: q.session_prompt || 'AI Generated',
          options: q.options,
          correctAnswer: q.correct_answer || q.correctAnswer,
          correct_answer: q.correct_answer,
          explanation: q.explanation || '',
          points: 1,
          tags: q.tags || [],
          status: q.status?.toLowerCase() || 'pending',
          createdBy: 'AI Generator',
          createdAt: q.session_created_at || new Date().toISOString(),
          usageCount: 0,
          successRate: 0
        }))
        setQuestions(mappedQuestions)
      } else {
        console.error('Failed to fetch pending questions')
        toast.error('Failed to load pending questions')
      }
    } catch (error) {
      console.error('Error fetching pending questions:', error)
      toast.error('Error loading questions')
    } finally {
      setLoading(false)
    }
  }

  const handleApprove = async (questionId: string) => {
    try {
      // Find the question to get its session_id
      const question = questions.find(q => q.id === questionId || q.question_id === questionId)
      const sessionId = question?.session_id

      if (!sessionId) {
        toast.error('Session ID not found for this question')
        return
      }

      const token = await getToken()
      const response = await fetch(
        `${API_BASE_URL}/question-generator/sessions/${sessionId}/questions/${questionId}/approve`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        }
      )

      if (response.ok) {
        toast.success('Question approved', {
          description: 'The question has been approved and added to your question bank'
        })
        // Remove from pending list
        setQuestions(questions.filter(q => q.id !== questionId))
      } else {
        throw new Error('Failed to approve question')
      }
    } catch (error: any) {
      console.error('Error approving question:', error)
      toast.error('Failed to approve question', {
        description: error.message || 'Please try again later'
      })
    }
  }

  const handleReject = async (questionId: string) => {
    try {
      // Find the question to get its session_id
      const question = questions.find(q => q.id === questionId || q.question_id === questionId)
      const sessionId = question?.session_id

      if (!sessionId) {
        toast.error('Session ID not found for this question')
        return
      }

      const token = await getToken()
      const response = await fetch(
        `${API_BASE_URL}/question-generator/sessions/${sessionId}/questions/${questionId}/reject`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        }
      )

      if (response.ok) {
        toast.success('Question rejected', {
          description: 'The question has been rejected'
        })
        // Remove from pending list
        setQuestions(questions.filter(q => q.id !== questionId))
      } else {
        throw new Error('Failed to reject question')
      }
    } catch (error: any) {
      console.error('Error rejecting question:', error)
      toast.error('Failed to reject question', {
        description: error.message || 'Please try again later'
      })
    }
  }

  const handleRequestRevision = async (questionId: string, notes: string) => {
    try {
      const token = await getToken()
      const response = await fetch(
        `${API_BASE_URL}/questions/${questionId}/request-revision?notes=${encodeURIComponent(notes)}`,
        {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        }
      )

      if (response.ok) {
        console.log('Revision requested for question:', questionId)
        // Optionally refresh the list
        fetchPendingQuestions()
      } else {
        console.error('Failed to request revision')
      }
    } catch (error) {
      console.error('Error requesting revision:', error)
    }
  }

  const handleBulkApprove = async () => {
    try {
      const questionIds = Array.from(selectedQuestions)
      let successCount = 0

      // Approve each question individually using the session-based endpoint
      for (const questionId of questionIds) {
        const question = questions.find(q => q.id === questionId || q.question_id === questionId)
        if (question?.session_id) {
          try {
            await handleApprove(questionId)
            successCount++
          } catch (e) {
            console.error(`Failed to approve question ${questionId}`, e)
          }
        }
      }

      if (successCount > 0) {
        toast.success(`Approved ${successCount} questions`)
        setSelectedQuestions(new Set())
      }
    } catch (error) {
      console.error('Error bulk approving questions:', error)
      toast.error('Failed to bulk approve questions')
    }
  }

  const toggleQuestionSelection = (questionId: string) => {
    const newSelection = new Set(selectedQuestions)
    if (newSelection.has(questionId)) {
      newSelection.delete(questionId)
    } else {
      newSelection.add(questionId)
    }
    setSelectedQuestions(newSelection)
  }

  // Review statistics
  const reviewStats: ReviewStats = {
    totalQuestions: questions.length,
    pendingReview: questions.filter(q => q.status === 'pending').length,
    approved: questions.filter(q => q.status === 'approved').length,
    rejected: questions.filter(q => q.status === 'rejected').length,
    averageRating: questions.filter(q => q.rating).reduce((acc, q) => acc + (q.rating || 0), 0) / (questions.filter(q => q.rating).length || 1)
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'approved':
        return 'bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-400'
      case 'rejected':
        return 'bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400'
      case 'pending':
        return 'bg-yellow-50 text-yellow-700 dark:bg-yellow-950/30 dark:text-yellow-400'
      case 'needs-revision':
        return 'bg-orange-50 text-orange-700 dark:bg-orange-950/30 dark:text-orange-400'
      default:
        return 'bg-muted text-muted-foreground'
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'approved':
        return <CheckCircle className="w-4 h-4" />
      case 'rejected':
        return <XCircle className="w-4 h-4" />
      case 'pending':
        return <Clock className="w-4 h-4" />
      case 'needs-revision':
        return <AlertTriangle className="w-4 h-4" />
      default:
        return <Clock className="w-4 h-4" />
    }
  }

  const getDifficultyColor = (difficulty: string) => {
    switch (difficulty) {
      case 'beginner':
        return 'bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-400'
      case 'intermediate':
        return 'bg-yellow-50 text-yellow-700 dark:bg-yellow-950/30 dark:text-yellow-400'
      case 'advanced':
        return 'bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400'
      default:
        return 'bg-muted text-muted-foreground'
    }
  }

  const renderStars = (rating: number) => {
    return Array.from({ length: 5 }, (_, i) => (
      <Star
        key={i}
        className={`w-4 h-4 ${i < rating ? 'text-primary fill-current' : 'text-muted-foreground/30'}`}
      />
    ))
  }

  // Use actual questions from API
  const filteredQuestions = questions.filter(question => {
    const matchesSearch = question.text.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         question.subject.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         question.topic.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         question.tags.some(tag => tag.toLowerCase().includes(searchTerm.toLowerCase()))
    const matchesStatus = statusFilter === "all" || question.status === statusFilter
    const matchesSubject = subjectFilter === "all" || question.subject === subjectFilter

    return matchesSearch && matchesStatus && matchesSubject
  })

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground">
            Review Questions
          </h1>
          <p className="text-sm sm:text-base text-muted-foreground mt-1">
            Review and approve AI-generated questions for quality assurance
          </p>
        </div>
        {selectedQuestions.size > 0 && (
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">
              {selectedQuestions.size} selected
            </span>
            <Button
              onClick={handleBulkApprove}
              size="sm"
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              <ThumbsUp className="w-4 h-4 mr-2" />
              Approve Selected
            </Button>
          </div>
        )}
      </div>

      {/* Stats Cards - Responsive grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
        <Card className="border-0 shadow-sm bg-card">
          <CardContent className="p-4 sm:p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                <BookOpen className="w-5 h-5 sm:w-6 sm:h-6 text-primary" />
              </div>
              <div className="min-w-0">
                <p className="text-muted-foreground text-xs sm:text-sm font-medium truncate">
                  Total Questions
                </p>
                <p className="text-2xl sm:text-3xl font-bold text-foreground">
                  {reviewStats.totalQuestions}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm bg-card">
          <CardContent className="p-4 sm:p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-lg bg-yellow-500/10 flex items-center justify-center flex-shrink-0">
                <Clock className="w-5 h-5 sm:w-6 sm:h-6 text-yellow-600 dark:text-yellow-500" />
              </div>
              <div className="min-w-0">
                <p className="text-muted-foreground text-xs sm:text-sm font-medium truncate">
                  Pending Review
                </p>
                <p className="text-2xl sm:text-3xl font-bold text-foreground">
                  {reviewStats.pendingReview}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm bg-card">
          <CardContent className="p-4 sm:p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-lg bg-green-500/10 flex items-center justify-center flex-shrink-0">
                <CheckCircle className="w-5 h-5 sm:w-6 sm:h-6 text-green-600 dark:text-green-500" />
              </div>
              <div className="min-w-0">
                <p className="text-muted-foreground text-xs sm:text-sm font-medium truncate">
                  Approved
                </p>
                <p className="text-2xl sm:text-3xl font-bold text-foreground">
                  {reviewStats.approved}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm bg-card">
          <CardContent className="p-4 sm:p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-lg bg-red-500/10 flex items-center justify-center flex-shrink-0">
                <XCircle className="w-5 h-5 sm:w-6 sm:h-6 text-red-600 dark:text-red-500" />
              </div>
              <div className="min-w-0">
                <p className="text-muted-foreground text-xs sm:text-sm font-medium truncate">
                  Rejected
                </p>
                <p className="text-2xl sm:text-3xl font-bold text-foreground">
                  {reviewStats.rejected}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm bg-card col-span-2 sm:col-span-1">
          <CardContent className="p-4 sm:p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Star className="w-5 h-5 sm:w-6 sm:h-6 text-primary" />
              </div>
              <div className="min-w-0">
                <p className="text-muted-foreground text-xs sm:text-sm font-medium truncate">
                  Avg. Rating
                </p>
                <p className="text-2xl sm:text-3xl font-bold text-foreground">
                  {reviewStats.averageRating.toFixed(1)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Content */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4 sm:space-y-6">
        <TabsList className="bg-muted/30 border border-border p-1 h-auto w-full grid grid-cols-3 gap-1">
          <TabsTrigger
            value="review"
            className="px-4 py-2.5 text-xs sm:text-sm font-medium rounded-md transition-all data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm data-[state=inactive]:text-muted-foreground data-[state=inactive]:hover:text-foreground data-[state=inactive]:hover:bg-muted/50"
          >
            Review Queue
          </TabsTrigger>
          <TabsTrigger
            value="approved"
            className="px-4 py-2.5 text-xs sm:text-sm font-medium rounded-md transition-all data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm data-[state=inactive]:text-muted-foreground data-[state=inactive]:hover:text-foreground data-[state=inactive]:hover:bg-muted/50"
          >
            Approved
          </TabsTrigger>
          <TabsTrigger
            value="analytics"
            className="px-4 py-2.5 text-xs sm:text-sm font-medium rounded-md transition-all data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm data-[state=inactive]:text-muted-foreground data-[state=inactive]:hover:text-foreground data-[state=inactive]:hover:bg-muted/50"
          >
            Analytics
          </TabsTrigger>
        </TabsList>

        {/* Review Queue Tab */}
        <TabsContent value="review" className="space-y-4 sm:space-y-6">
          {/* Filters and Search */}
          <Card className="border-border shadow-sm bg-card">
            <CardContent className="p-3 sm:p-4">
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="flex-1">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
                    <Input
                      placeholder="Search questions..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-10 bg-background border-border h-9 sm:h-10 text-sm"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:flex gap-3">
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="w-full sm:w-[150px] h-9 sm:h-10 border-border text-sm">
                      <SelectValue placeholder="Status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Status</SelectItem>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="approved">Approved</SelectItem>
                      <SelectItem value="rejected">Rejected</SelectItem>
                      <SelectItem value="needs-revision">Needs Revision</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={subjectFilter} onValueChange={setSubjectFilter}>
                    <SelectTrigger className="w-full sm:w-[150px] h-9 sm:h-10 border-border text-sm">
                      <SelectValue placeholder="Subject" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Subjects</SelectItem>
                      <SelectItem value="Mathematics">Mathematics</SelectItem>
                      <SelectItem value="Physics">Physics</SelectItem>
                      <SelectItem value="Chemistry">Chemistry</SelectItem>
                      <SelectItem value="Biology">Biology</SelectItem>
                      <SelectItem value="Geography">Geography</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Questions List */}
          <Card className="border-border shadow-sm bg-card overflow-visible">
            <CardHeader className="border-b border-border">
              <CardTitle className="flex items-center text-foreground">
                <Eye className="w-5 h-5 mr-2 text-primary flex-shrink-0" />
                Questions for Review ({filteredQuestions.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              {loading ? (
                /* Question Card Skeletons */
                <div className="space-y-6">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Card key={i} className="border-border overflow-hidden">
                      <CardContent className="p-0">
                        {/* Header skeleton */}
                        <div className="flex items-center justify-between gap-4 px-6 py-4 bg-muted/30 border-b border-border">
                          <div className="flex items-center gap-3">
                            <Skeleton className="h-5 w-5 rounded" />
                            <Skeleton className="h-6 w-20 rounded-full" />
                            <Skeleton className="h-6 w-16 rounded-full" />
                            <Skeleton className="h-6 w-24 rounded-full" />
                          </div>
                          <div className="flex items-center gap-3">
                            <Skeleton className="h-4 w-12" />
                            <div className="flex gap-1">
                              {Array.from({ length: 5 }).map((_, j) => (
                                <Skeleton key={j} className="h-4 w-4" />
                              ))}
                            </div>
                          </div>
                        </div>
                        {/* Question text skeleton */}
                        <div className="px-6 py-6 space-y-2">
                          <Skeleton className="h-5 w-full" />
                          <Skeleton className="h-5 w-4/5" />
                          <Skeleton className="h-5 w-3/5" />
                        </div>
                        {/* Options skeleton */}
                        <div className="px-6 pb-6">
                          <Skeleton className="h-4 w-32 mb-3" />
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {Array.from({ length: 4 }).map((_, k) => (
                              <div key={k} className="p-4 rounded-lg border-2 border-border">
                                <div className="flex items-start gap-3">
                                  <Skeleton className="h-6 w-6 shrink-0" />
                                  <Skeleton className="h-4 w-full" />
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                        {/* Action buttons skeleton */}
                        <div className="flex items-center justify-between gap-4 px-6 py-4 bg-muted/20 border-t border-border">
                          <div className="flex items-center gap-2">
                            <Skeleton className="h-4 w-4" />
                            <Skeleton className="h-4 w-24" />
                            <Skeleton className="h-4 w-20" />
                          </div>
                          <div className="flex items-center gap-2">
                            <Skeleton className="h-9 w-24 rounded-md" />
                            <Skeleton className="h-9 w-24 rounded-md" />
                            <Skeleton className="h-9 w-9 rounded-md" />
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              ) : filteredQuestions.length === 0 ? (
                <div className="text-center py-12">
                  <CheckCircle className="w-16 h-16 mx-auto text-primary mb-4" />
                  <p className="text-xl font-semibold text-foreground">All caught up!</p>
                  <p className="text-muted-foreground mt-2">No pending questions to review.</p>
                </div>
              ) : (
                <div className="space-y-6">
                  {filteredQuestions.map((question) => (
                    <Card key={question.id} className="border-border hover:shadow-lg transition-all duration-200 overflow-hidden">
                      <CardContent className="p-0">
                        {/* Header with metadata */}
                        <div className="flex items-center justify-between gap-4 px-6 py-4 bg-muted/30 border-b border-border">
                          <div className="flex items-center gap-3 flex-wrap">
                            {question.status === 'pending' && (
                              <input
                                type="checkbox"
                                checked={selectedQuestions.has(question.id)}
                                onChange={() => toggleQuestionSelection(question.id)}
                                className="w-5 h-5 accent-primary rounded focus:ring-primary"
                              />
                            )}
                            <Badge className={`border-0 ${getStatusColor(question.status)}`}>
                              <div className="flex items-center gap-1">
                                {getStatusIcon(question.status)}
                                <span className="capitalize">{question.status.replace('-', ' ')}</span>
                              </div>
                            </Badge>
                            <Badge className={getDifficultyColor(question.difficulty)}>
                              <span className="capitalize">{question.difficulty}</span>
                            </Badge>
                            <Badge variant="outline" className="border-border bg-background">
                              {question.type}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-sm font-medium text-muted-foreground">{question.points} pts</span>
                            {question.rating && (
                              <div className="flex items-center gap-1">
                                {renderStars(question.rating)}
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Question text - most prominent */}
                        <div className="px-6 py-6">
                          <div className="text-lg font-medium text-foreground leading-relaxed">
                            <MathText className="text-lg">{question.text}</MathText>
                          </div>
                        </div>

                        {/* Options */}
                        {question.options && (
                          <div className="px-6 pb-6">
                            <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                              Answer Options
                            </h4>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              {question.options.map((option, optIndex) => (
                                <div
                                  key={optIndex}
                                  className={`p-4 rounded-lg border-2 transition-all ${
                                    option === question.correctAnswer
                                      ? 'bg-green-50 dark:bg-green-950/30 border-green-500 dark:border-green-700'
                                      : 'bg-background border-border hover:border-muted-foreground/30'
                                  }`}
                                >
                                  <div className="flex items-start gap-3">
                                    <span className="font-bold text-foreground text-lg flex-shrink-0">
                                      {String.fromCharCode(65 + optIndex)}.
                                    </span>
                                    <span className="text-foreground flex-1">
                                      <MathText className="text-inherit">{option}</MathText>
                                    </span>
                                    {option === question.correctAnswer && (
                                      <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-500 flex-shrink-0" />
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Info section */}
                        <div className="px-6 pb-6">
                          <div className="bg-muted/50 rounded-lg p-4 grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div>
                              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                                Subject & Topic
                              </p>
                              <p className="text-sm font-medium text-foreground">
                                {question.subject} - {question.topic}
                              </p>
                            </div>
                            <div>
                              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                                Correct Answer
                              </p>
                              <div className="text-sm font-semibold text-green-700 dark:text-green-400">
                                <MathText className="text-inherit text-sm">{question.correctAnswer}</MathText>
                              </div>
                            </div>
                            <div>
                              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                                Created By
                              </p>
                              <p className="text-sm font-medium text-foreground">
                                {question.createdBy}
                              </p>
                            </div>
                          </div>
                        </div>

                        {/* Explanation */}
                        <div className="px-6 pb-6">
                          <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                            Explanation
                          </h4>
                          <div className="bg-primary/5 border-l-4 border-primary rounded-r-lg p-4">
                            <div className="text-foreground leading-relaxed">
                              <MathText className="text-inherit">{question.explanation}</MathText>
                            </div>
                          </div>
                        </div>

                        {/* Tags */}
                        {question.tags.length > 0 && (
                          <div className="px-6 pb-6">
                            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                              Tags
                            </h4>
                            <div className="flex flex-wrap gap-2">
                              {question.tags.map((tag, tagIndex) => (
                                <Badge
                                  key={tagIndex}
                                  variant="secondary"
                                  className="text-xs bg-primary/10 text-primary border-0 font-medium"
                                >
                                  {tag}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Review Comments */}
                        {question.reviewComments && (
                          <div className="px-6 pb-6">
                            <div className="bg-yellow-50 dark:bg-yellow-950/30 p-4 rounded-lg border-2 border-yellow-200 dark:border-yellow-800">
                              <h4 className="font-semibold text-foreground mb-2 flex items-center">
                                <MessageSquare className="w-4 h-4 mr-2 text-yellow-600 dark:text-yellow-500" />
                                Review Comments
                              </h4>
                              <p className="text-foreground text-sm leading-relaxed">{question.reviewComments}</p>
                              {question.reviewedBy && (
                                <p className="text-xs text-muted-foreground mt-3 pt-3 border-t border-yellow-200 dark:border-yellow-800">
                                  Reviewed by {question.reviewedBy} • {question.reviewedAt && new Date(question.reviewedAt).toLocaleDateString()}
                                </p>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Action buttons */}
                        {question.status === 'pending' && (
                          <div className="px-6 py-4 bg-muted/20 border-t border-border">
                            <div className="flex items-center gap-3 flex-wrap">
                              <Button
                                onClick={() => handleApprove(question.id)}
                                className="bg-green-600 hover:bg-green-700 text-white"
                              >
                                <ThumbsUp className="w-4 h-4 mr-2" />
                                Approve
                              </Button>
                              <Button
                                variant="outline"
                                onClick={() => handleRequestRevision(question.id, 'Please revise')}
                                className="border-border hover:bg-muted"
                              >
                                <Flag className="w-4 h-4 mr-2" />
                                Request Revision
                              </Button>
                              <Button
                                variant="outline"
                                onClick={() => handleReject(question.id)}
                                className="border-border hover:bg-red-50 dark:hover:bg-red-950/30 text-red-600 dark:text-red-500"
                              >
                                <ThumbsDown className="w-4 h-4 mr-2" />
                                Reject
                              </Button>
                              <div className="flex-1"></div>
                              <Button variant="outline" className="border-border">
                                <Edit className="w-4 h-4 mr-2" />
                                Edit
                              </Button>
                            </div>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Approved Questions Tab */}
        <TabsContent value="approved" className="space-y-6">
          <Card className="border-border shadow-sm bg-card">
            <CardHeader className="border-b border-border">
              <CardTitle className="flex items-center text-foreground">
                <CheckCircle className="w-5 h-5 mr-2 text-green-600 dark:text-green-500" />
                Approved Questions
              </CardTitle>
              <CardDescription className="text-muted-foreground">
                Questions that have been reviewed and approved for use
              </CardDescription>
            </CardHeader>
            <CardContent className="p-8">
              <div className="text-center py-8">
                <div className="w-16 h-16 rounded-full bg-green-50 dark:bg-green-950/30 flex items-center justify-center mx-auto mb-4">
                  <CheckCircle className="w-8 h-8 text-green-600 dark:text-green-500" />
                </div>
                <p className="text-muted-foreground">Approved questions will be displayed here.</p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Analytics Tab */}
        <TabsContent value="analytics" className="space-y-6">
          <Card className="border-border shadow-sm bg-card">
            <CardHeader className="border-b border-border">
              <CardTitle className="flex items-center text-foreground">
                <BarChart3 className="w-5 h-5 mr-2 text-primary" />
                Review Analytics
              </CardTitle>
              <CardDescription className="text-muted-foreground">
                Insights and statistics about question review process
              </CardDescription>
            </CardHeader>
            <CardContent className="p-8">
              <div className="text-center py-8">
                <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                  <BarChart3 className="w-8 h-8 text-primary" />
                </div>
                <p className="text-muted-foreground">Review analytics and charts will be displayed here.</p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}

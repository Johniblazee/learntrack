/**
 * Question Bank Manager Component
 * Displays all questions in a table format with search and filters
 */

import React, { useState, useEffect } from 'react'
import { useApiClient } from "@/lib/api-client"
import { toast } from "@/contexts/ToastContext"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Plus,
  Search,
  Edit,
  Eye,
  Trash2,
  X,
  CheckCircle,
} from "lucide-react"

import { 
  DIFFICULTIES, 
  DIFFICULTY_LABELS, 
  QUESTION_TYPES, 
  QUESTION_TYPE_LABELS 
} from "@/lib/constants"
import { useSubjects } from "@/hooks/useQueries"

interface Question {
  id: string
  text: string
  subject: string
  subjectId?: string
  type: string
  difficulty: string
  topic?: string
  options?: string[]
  correctAnswer?: string
  explanation?: string
  points?: number
  tags?: string[]
  status?: string
  lastModified: string
}

// Helper function to get difficulty badge color
const getDifficultyColor = (difficulty: string) => {
  switch (difficulty.toLowerCase()) {
    case DIFFICULTIES.EASY:
      return 'bg-emerald-500/20 text-emerald-400 border-0 font-medium px-3 py-1'
    case DIFFICULTIES.MEDIUM:
      return 'bg-amber-500/20 text-amber-400 border-0 font-medium px-3 py-1'
    case DIFFICULTIES.HARD:
      return 'bg-red-500/20 text-red-400 border-0 font-medium px-3 py-1'
    default:
      return 'bg-muted text-muted-foreground border-0 px-3 py-1'
  }
}

export default function QuestionBankManager() {
  const client = useApiClient()
  const [searchTerm, setSearchTerm] = useState("")
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState("")
  const [subjectFilter, setSubjectFilter] = useState("all")
  const [topicFilter, setTopicFilter] = useState("all")
  const [difficultyFilter, setDifficultyFilter] = useState("all")
  const [typeFilter, setTypeFilter] = useState("all")
  const [currentPage, setCurrentPage] = useState(1)
  const [questions, setQuestions] = useState<Question[]>([])
  const [loading, setLoading] = useState(true)
  const [totalItems, setTotalItems] = useState(0)
  const [totalPages, setTotalPages] = useState(0)
  const itemsPerPage = 20

  // Debounce search term
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchTerm(searchTerm)
      setCurrentPage(1) // Reset to first page on search
    }, 500)
    return () => clearTimeout(timer)
  }, [searchTerm])

  // Reset page on filter change
  useEffect(() => {
    setCurrentPage(1)
  }, [subjectFilter, topicFilter, difficultyFilter, typeFilter])

  // Fetch questions from API
  useEffect(() => {
    fetchQuestions()
  }, [currentPage, debouncedSearchTerm, subjectFilter, topicFilter, difficultyFilter, typeFilter])

  // Modal states
  const [viewModalOpen, setViewModalOpen] = useState(false)
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [selectedQuestion, setSelectedQuestion] = useState<Question | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Form states for create/edit
  const [formData, setFormData] = useState<{
    text: string
    subjectId: string
    topic: string
    type: string
    difficulty: string
    options: string[]
    correctAnswer: string
    correctAnswerIndex: number
    explanation: string
    points: number
    tags: string
  }>({
    text: '',
    subjectId: '',
    topic: '',
    type: QUESTION_TYPES.MULTIPLE_CHOICE,
    difficulty: DIFFICULTIES.MEDIUM,
    options: ['', '', '', ''],
    correctAnswer: '',
    correctAnswerIndex: -1,
    explanation: '',
    points: 1,
    tags: '',
  })

  // Fetch subjects for dropdowns
  const { data: subjectsData } = useSubjects()
  const subjects = subjectsData || []

  // Reset form data
  const resetFormData = () => {
    setFormData({
      text: '',
      subjectId: '',
      topic: '',
      type: QUESTION_TYPES.MULTIPLE_CHOICE,
      difficulty: DIFFICULTIES.MEDIUM,
      options: ['', '', '', ''],
      correctAnswer: '',
      correctAnswerIndex: -1,
      explanation: '',
      points: 1,
      tags: '',
    })
  }

  // Handle delete
  const handleDelete = async (id: string) => {
    const question = questions.find(q => q.id === id)
    if (question) {
      setSelectedQuestion(question)
      setDeleteDialogOpen(true)
    }
  }

  const confirmDelete = async () => {
    if (!selectedQuestion) return

    try {
      setIsSubmitting(true)
      const response = await client.delete(`/questions/${selectedQuestion.id}`)

      if (response.error) {
        toast.error('Failed to delete question', { description: response.error })
        return
      }

      toast.success('Question deleted successfully')
      setDeleteDialogOpen(false)
      setSelectedQuestion(null)
      // Refresh the list
      fetchQuestions()
    } catch (err) {
      console.error('Failed to delete question:', err)
      toast.error('Failed to delete question')
    } finally {
      setIsSubmitting(false)
    }
  }

  // Handle edit
  const handleEdit = (id: string) => {
    const question = questions.find(q => q.id === id)
    if (question) {
      setSelectedQuestion(question)
      const options = question.options?.length 
        ? question.options.filter((o: any) => typeof o === 'string')
        : ['', '', '', '']
      const correctAnswer = question.correctAnswer || ''
      // Find index of correct answer in options for multiple choice
      const correctAnswerIndex = question.type === QUESTION_TYPES.MULTIPLE_CHOICE
        ? options.findIndex(opt => opt === correctAnswer)
        : -1
      setFormData({
        text: question.text || '',
        subjectId: question.subjectId || '',
        topic: question.topic || '',
        type: question.type || QUESTION_TYPES.MULTIPLE_CHOICE,
        difficulty: question.difficulty || DIFFICULTIES.MEDIUM,
        options: options,
        correctAnswer: correctAnswer,
        correctAnswerIndex: correctAnswerIndex >= 0 ? correctAnswerIndex : -1,
        explanation: question.explanation || '',
        points: question.points || 1,
        tags: question.tags?.join(', ') || '',
      })
      setEditModalOpen(true)
    }
  }

  const handleUpdateQuestion = async () => {
    if (!selectedQuestion) return

    if (formData.type === QUESTION_TYPES.MULTIPLE_CHOICE) {
      const nonEmptyOptions = formData.options?.filter(o => o.trim()) || []
      if (nonEmptyOptions.length < 2) {
        toast.error('MCQ questions require at least 2 options')
        return
      }
      if (formData.correctAnswerIndex < 0 || formData.correctAnswerIndex >= formData.options.length) {
        toast.error('Please select a valid correct answer')
        return
      }
      if (!formData.options[formData.correctAnswerIndex]?.trim()) {
        toast.error('Selected correct answer cannot be empty')
        return
      }
    }

    try {
      setIsSubmitting(true)
      // Convert correctAnswerIndex to the actual option text for MCQ
      const correctAnswerValue = formData.type === QUESTION_TYPES.MULTIPLE_CHOICE
        ? formData.options[formData.correctAnswerIndex]
        : formData.correctAnswer
      
      const updateData = {
        question_text: formData.text,
        subject_id: formData.subjectId,
        topic: formData.topic,
        question_type: formData.type,
        difficulty: formData.difficulty,
        options: formData.type === QUESTION_TYPES.MULTIPLE_CHOICE ? formData.options.filter(o => o.trim()) : undefined,
        correct_answer: correctAnswerValue,
        explanation: formData.explanation,
        points: formData.points,
        tags: formData.tags.split(',').map(t => t.trim()).filter(t => t),
      }

      const response = await client.put(`/questions/${selectedQuestion.id}`, updateData)

      if (response.error) {
        toast.error('Failed to update question', { description: response.error })
        return
      }

      toast.success('Question updated successfully')
      setEditModalOpen(false)
      setSelectedQuestion(null)
      resetFormData()
      // Refresh the list
      fetchQuestions()
    } catch (err) {
      console.error('Failed to update question:', err)
      toast.error('Failed to update question')
    } finally {
      setIsSubmitting(false)
    }
  }

  // Handle view
  const handleView = (id: string) => {
    const question = questions.find(q => q.id === id)
    if (question) {
      setSelectedQuestion(question)
      setViewModalOpen(true)
    }
  }

  // Handle create
  const handleCreate = () => {
    resetFormData()
    setCreateModalOpen(true)
  }

  const handleCreateQuestion = async () => {
    if (formData.type === QUESTION_TYPES.MULTIPLE_CHOICE) {
      const nonEmptyOptions = formData.options?.filter(o => o.trim()) || []
      if (nonEmptyOptions.length < 2) {
        toast.error('MCQ questions require at least 2 options')
        return
      }
      if (formData.correctAnswerIndex < 0 || formData.correctAnswerIndex >= formData.options.length) {
        toast.error('Please select a valid correct answer')
        return
      }
      if (!formData.options[formData.correctAnswerIndex]?.trim()) {
        toast.error('Selected correct answer cannot be empty')
        return
      }
    }

    try {
      setIsSubmitting(true)
      // Convert correctAnswerIndex to the actual option text for MCQ
      const correctAnswerValue = formData.type === QUESTION_TYPES.MULTIPLE_CHOICE
        ? formData.options[formData.correctAnswerIndex]
        : formData.correctAnswer
      
      const createData = {
        question_text: formData.text,
        subject_id: formData.subjectId,
        topic: formData.topic,
        question_type: formData.type,
        difficulty: formData.difficulty,
        options: formData.type === QUESTION_TYPES.MULTIPLE_CHOICE ? formData.options.filter(o => o.trim()) : undefined,
        correct_answer: correctAnswerValue,
        explanation: formData.explanation,
        points: formData.points,
        tags: formData.tags.split(',').map(t => t.trim()).filter(t => t),
        status: 'active',
      }

      const response = await client.post('/questions/', createData)

      if (response.error) {
        toast.error('Failed to create question', { description: response.error })
        return
      }

      toast.success('Question created successfully')
      setCreateModalOpen(false)
      resetFormData()
      // Refresh the list
      fetchQuestions()
    } catch (err) {
      console.error('Failed to create question:', err)
      toast.error('Failed to create question')
    } finally {
      setIsSubmitting(false)
    }
  }

  // Update option at index
  const updateOption = (index: number, value: string) => {
    const newOptions = [...formData.options]
    newOptions[index] = value
    setFormData({ ...formData, options: newOptions })
  }

  // Add option
  const addOption = () => {
    setFormData({ ...formData, options: [...formData.options, ''] })
  }

  // Remove option
  const removeOption = (index: number) => {
    const newOptions = formData.options.filter((_, i) => i !== index)
    let newCorrectAnswerIndex = formData.correctAnswerIndex
    
    // If the removed option was selected, reset the correct answer
    if (index === formData.correctAnswerIndex) {
      newCorrectAnswerIndex = -1
    } else if (index < formData.correctAnswerIndex) {
      // If removed option was before the selected one, decrement the index
      newCorrectAnswerIndex = formData.correctAnswerIndex - 1
    }
    
    setFormData({ 
      ...formData, 
      options: newOptions,
      correctAnswerIndex: newCorrectAnswerIndex
    })
  }

  // Fetch questions function (extracted for reuse)
  const fetchQuestions = async () => {
    try {
      setLoading(true)
      
      // Build query parameters
      const params = new URLSearchParams()
      params.append('page', currentPage.toString())
      params.append('per_page', itemsPerPage.toString())
      
      if (subjectFilter !== 'all') params.append('subject_id', subjectFilter)
      if (topicFilter !== 'all') params.append('topic', topicFilter)
      if (difficultyFilter !== 'all') params.append('difficulty', difficultyFilter)
      if (typeFilter !== 'all') params.append('question_type', typeFilter)
      if (debouncedSearchTerm) params.append('search', debouncedSearchTerm)

      const response = await client.get(`/questions?${params.toString()}`)

      if (response.error) {
        console.error('Failed to fetch questions:', response.error)
        toast.error('Failed to load questions')
        setQuestions([])
        return
      }

      if (response.data) {
        // Handle paginated response: { items: [...], total, page, per_page, total_pages }
        const questionsArray = response.data?.items || []
        const mappedQuestions = questionsArray.map((q: any) => ({
          id: q._id || q.id,
          text: q.question_text || q.text,
          subject: q.subject_id?.name || q.subject_id || 'Unknown',
          subjectId: typeof q.subject_id === 'object' ? q.subject_id?._id : q.subject_id,
          type: q.question_type || q.type,
          difficulty: q.difficulty,
          topic: q.topic,
          options: Array.isArray(q.options) ? q.options.filter((o: any) => typeof o === 'string') : [],
          correctAnswer: q.correct_answer || q.correctAnswer,
          explanation: q.explanation,
          points: q.points,
          tags: q.tags,
          status: q.status,
          lastModified: q.updated_at || q.created_at
        }))
        setQuestions(mappedQuestions)
        setTotalItems(response.data.total || 0)
        setTotalPages(response.data.total_pages || 0)
      }
    } catch (err) {
      console.error('Failed to fetch questions:', err)
      toast.error('Failed to load questions')
      setQuestions([])
    } finally {
      setLoading(false)
    }
  }

  // Current questions are just the questions state since it's already paginated by the server
  const currentQuestions = questions

  // Generate page numbers
  const getPageNumbers = () => {
    const pages = []
    const maxVisible = 5
    
    if (totalPages <= maxVisible) {
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i)
      }
    } else {
      if (currentPage <= 3) {
        pages.push(1, 2, 3, '...', totalPages)
      } else if (currentPage >= totalPages - 2) {
        pages.push(1, '...', totalPages - 2, totalPages - 1, totalPages)
      } else {
        pages.push(1, '...', currentPage, '...', totalPages)
      }
    }
    
    return pages
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">
            Question Bank
          </h1>
          <p className="text-muted-foreground mt-1">
            Manage your custom questions for assignments and quizzes.
          </p>
        </div>
        <Button 
          className="bg-primary text-primary-foreground hover:bg-primary/90"
          onClick={handleCreate}
        >
          <Plus className="w-4 h-4 mr-2" />
          Add New Question
        </Button>
      </div>

      {/* Search and Filters */}
      <div className="bg-muted/30 border border-border rounded-lg p-4">
        <div className="flex flex-col lg:flex-row gap-3">
          {/* Search */}
          <div className="flex-1">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
              <Input
                placeholder="Search questions by keyword..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 bg-background border-border h-10"
              />
            </div>
          </div>
          {/* Filters */}
          <div className="flex flex-wrap gap-2">
            <Select value={subjectFilter} onValueChange={setSubjectFilter}>
              <SelectTrigger className="w-[140px] h-10 border-border bg-background">
                <SelectValue placeholder="Subject" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Subjects</SelectItem>
                {subjects.map((subject: any) => (
                  <SelectItem key={subject._id || subject.id || subject} value={subject._id || subject.id || subject}>
                    {subject.name || subject}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={topicFilter} onValueChange={setTopicFilter}>
              <SelectTrigger className="w-[130px] h-10 border-border bg-background">
                <SelectValue placeholder="Topic" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Topics</SelectItem>
              </SelectContent>
            </Select>
            <Select value={difficultyFilter} onValueChange={setDifficultyFilter}>
              <SelectTrigger className="w-[130px] h-10 border-border bg-background">
                <SelectValue placeholder="Difficulty" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Levels</SelectItem>
                {Object.values(DIFFICULTIES).map(diff => (
                  <SelectItem key={diff} value={diff}>{DIFFICULTY_LABELS[diff]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-[130px] h-10 border-border bg-background">
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                {Object.values(QUESTION_TYPES).map(type => (
                  <SelectItem key={type} value={type}>{QUESTION_TYPE_LABELS[type]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="border border-border rounded-lg overflow-hidden bg-card">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              <TableHead>Question Text</TableHead>
              <TableHead>Subject</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Difficulty</TableHead>
              <TableHead>Last Modified</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {currentQuestions.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-12 text-muted-foreground">
                  No questions found
                </TableCell>
              </TableRow>
            ) : (
              currentQuestions.map((question) => (
                <TableRow key={question.id} className="hover:bg-muted/30 transition-colors">
                  <TableCell className="font-medium text-foreground max-w-sm">
                    <span className="line-clamp-2">{question.text}</span>
                  </TableCell>
                  <TableCell className="text-foreground">{question.subject}</TableCell>
                  <TableCell className="text-muted-foreground">{question.type}</TableCell>
                  <TableCell>
                    <Badge className={getDifficultyColor(question.difficulty)}>
                      {question.difficulty}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(question.lastModified).toLocaleDateString('en-US', {
                      month: 'short',
                      day: '2-digit',
                      year: 'numeric'
                    })}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center gap-1 justify-end">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-foreground"
                        onClick={() => handleEdit(question.id)}
                      >
                        <Edit className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-foreground"
                        onClick={() => handleView(question.id)}
                      >
                        <Eye className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => handleDelete(question.id)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-4 border-t border-border">
          <button
            onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
            disabled={currentPage === 1}
            className="flex items-center gap-2 text-muted-foreground hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <span className="text-lg">←</span>
            <span>Previous</span>
          </button>

          <div className="flex items-center gap-1">
            {getPageNumbers().map((page, index) => (
              page === '...' ? (
                <span key={`ellipsis-${index}`} className="px-2 text-muted-foreground">...</span>
              ) : (
                <button
                  key={page}
                  onClick={() => setCurrentPage(page as number)}
                  className={`w-8 h-8 rounded-full text-sm transition-colors ${
                    currentPage === page
                      ? 'bg-amber-500/20 text-amber-400 font-medium'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  }`}
                >
                  {page}
                </button>
              )
            ))}
          </div>

          <button
            onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
            disabled={currentPage === totalPages}
            className="flex items-center gap-2 text-muted-foreground hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <span>Next</span>
            <span className="text-lg">→</span>
          </button>
        </div>
      )}

      {/* View Question Modal */}
      <Dialog open={viewModalOpen} onOpenChange={setViewModalOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Question Details</DialogTitle>
            <DialogDescription>
              View the complete question information
            </DialogDescription>
          </DialogHeader>
          {selectedQuestion && (
            <div className="space-y-6 py-4">
              <div>
                <Label className="text-muted-foreground">Question Text</Label>
                <p className="text-foreground font-medium mt-1">{selectedQuestion.text}</p>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-muted-foreground">Subject</Label>
                  <p className="text-foreground">{selectedQuestion.subject}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Topic</Label>
                  <p className="text-foreground">{selectedQuestion.topic || 'N/A'}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Type</Label>
                  <p className="text-foreground">{QUESTION_TYPE_LABELS[selectedQuestion.type as keyof typeof QUESTION_TYPE_LABELS] || selectedQuestion.type}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Difficulty</Label>
                  <Badge className={getDifficultyColor(selectedQuestion.difficulty)}>
                    {DIFFICULTY_LABELS[selectedQuestion.difficulty as keyof typeof DIFFICULTY_LABELS] || selectedQuestion.difficulty}
                  </Badge>
                </div>
              </div>

              {selectedQuestion.options && selectedQuestion.options.length > 0 && (
                <div>
                  <Label className="text-muted-foreground">Options</Label>
                  <div className="space-y-2 mt-2">
                    {selectedQuestion.options.map((option, idx) => (
                      <div 
                        key={idx} 
                        className={`p-3 rounded-lg border ${option === selectedQuestion.correctAnswer ? 'border-green-500 bg-green-50 dark:bg-green-950/30' : 'border-border'}`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-bold">{String.fromCharCode(65 + idx)}.</span>
                          <span>{option}</span>
                          {option === selectedQuestion.correctAnswer && (
                            <CheckCircle className="w-4 h-4 text-green-600 ml-auto" />
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {selectedQuestion.correctAnswer && (!selectedQuestion.options || selectedQuestion.options.length === 0) && (
                <div>
                  <Label className="text-muted-foreground">Correct Answer</Label>
                  <p className="text-foreground font-medium text-green-600 dark:text-green-400 mt-1">{selectedQuestion.correctAnswer}</p>
                </div>
              )}

              {selectedQuestion.explanation && (
                <div>
                  <Label className="text-muted-foreground">Explanation</Label>
                  <p className="text-foreground mt-1">{selectedQuestion.explanation}</p>
                </div>
              )}

              {selectedQuestion.tags && selectedQuestion.tags.length > 0 && (
                <div>
                  <Label className="text-muted-foreground">Tags</Label>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {selectedQuestion.tags.map((tag, idx) => (
                      <Badge key={idx} variant="secondary">{tag}</Badge>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-muted-foreground">Points</Label>
                  <p className="text-foreground">{selectedQuestion.points || 1}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Status</Label>
                  <p className="text-foreground capitalize">{selectedQuestion.status || 'active'}</p>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewModalOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Question Modal */}
      <Dialog open={editModalOpen} onOpenChange={setEditModalOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Question</DialogTitle>
            <DialogDescription>
              Make changes to the question
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label htmlFor="edit-text">Question Text *</Label>
              <Textarea
                id="edit-text"
                value={formData.text}
                onChange={(e) => setFormData({ ...formData, text: e.target.value })}
                placeholder="Enter the question text..."
                className="mt-1"
                rows={3}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="edit-subject">Subject *</Label>
                <Select value={formData.subjectId} onValueChange={(value) => setFormData({ ...formData, subjectId: value })}>
                  <SelectTrigger id="edit-subject" className="mt-1">
                    <SelectValue placeholder="Select subject" />
                  </SelectTrigger>
                  <SelectContent>
                    {subjects.map((subject: any) => (
                      <SelectItem key={subject._id || subject.id} value={subject._id || subject.id}>
                        {subject.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="edit-topic">Topic</Label>
                <Input
                  id="edit-topic"
                  value={formData.topic}
                  onChange={(e) => setFormData({ ...formData, topic: e.target.value })}
                  placeholder="Enter topic..."
                  className="mt-1"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="edit-type">Question Type *</Label>
                <Select value={formData.type} onValueChange={(value) => setFormData({ ...formData, type: value })}>
                  <SelectTrigger id="edit-type" className="mt-1">
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.values(QUESTION_TYPES).map((type) => (
                      <SelectItem key={type} value={type}>{QUESTION_TYPE_LABELS[type]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="edit-difficulty">Difficulty *</Label>
                <Select value={formData.difficulty} onValueChange={(value) => setFormData({ ...formData, difficulty: value })}>
                  <SelectTrigger id="edit-difficulty" className="mt-1">
                    <SelectValue placeholder="Select difficulty" />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.values(DIFFICULTIES).map((diff) => (
                      <SelectItem key={diff} value={diff}>{DIFFICULTY_LABELS[diff]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {formData.type === QUESTION_TYPES.MULTIPLE_CHOICE && (
              <div>
                <Label>Options *</Label>
                <div className="space-y-2 mt-2">
                  {formData.options.map((option, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <span className="text-muted-foreground w-6">{String.fromCharCode(65 + idx)}.</span>
                      <Input
                        value={option}
                        onChange={(e) => updateOption(idx, e.target.value)}
                        placeholder={`Option ${String.fromCharCode(65 + idx)}`}
                        className="flex-1"
                      />
                      {formData.options.length > 2 && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => removeOption(idx)}
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  ))}
                  <Button variant="outline" size="sm" onClick={addOption} className="mt-2">
                    <Plus className="w-4 h-4 mr-2" />
                    Add Option
                  </Button>
                </div>
              </div>
            )}

            <div>
              <Label htmlFor="edit-correct">Correct Answer *</Label>
              {formData.type === QUESTION_TYPES.MULTIPLE_CHOICE ? (
                <Select 
                  value={formData.correctAnswerIndex >= 0 ? formData.correctAnswerIndex.toString() : ''} 
                  onValueChange={(value) => setFormData({ ...formData, correctAnswerIndex: parseInt(value) })}
                >
                  <SelectTrigger id="edit-correct" className="mt-1">
                    <SelectValue placeholder="Select correct answer" />
                  </SelectTrigger>
                  <SelectContent>
                    {formData.options.map((option, idx) => (
                      typeof option === 'string' && option.trim() && (
                        <SelectItem key={idx} value={idx.toString()}>
                          {String.fromCharCode(65 + idx)}. {option.substring(0, 50)}{option.length > 50 ? '...' : ''}
                        </SelectItem>
                      )
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  id="edit-correct"
                  value={formData.correctAnswer}
                  onChange={(e) => setFormData({ ...formData, correctAnswer: e.target.value })}
                  placeholder="Enter the correct answer..."
                  className="mt-1"
                />
              )}
            </div>

            <div>
              <Label htmlFor="edit-explanation">Explanation</Label>
              <Textarea
                id="edit-explanation"
                value={formData.explanation}
                onChange={(e) => setFormData({ ...formData, explanation: e.target.value })}
                placeholder="Enter explanation for the correct answer..."
                className="mt-1"
                rows={3}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="edit-points">Points</Label>
                <Input
                  id="edit-points"
                  type="number"
                  min={1}
                  value={formData.points}
                  onChange={(e) => setFormData({ ...formData, points: Math.max(parseInt(e.target.value) || 1, 1) })}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="edit-tags">Tags (comma separated)</Label>
                <Input
                  id="edit-tags"
                  value={formData.tags}
                  onChange={(e) => setFormData({ ...formData, tags: e.target.value })}
                  placeholder="e.g., algebra, equations, math"
                  className="mt-1"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditModalOpen(false)} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button 
              onClick={handleUpdateQuestion} 
              disabled={isSubmitting || !formData.text || !formData.subjectId || (formData.type === QUESTION_TYPES.MULTIPLE_CHOICE ? formData.correctAnswerIndex < 0 : !formData.correctAnswer) || (formData.type === QUESTION_TYPES.MULTIPLE_CHOICE && (formData.options?.filter(o => typeof o === 'string' && o.trim()).length || 0) < 2)}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {isSubmitting ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Question Modal */}
      <Dialog open={createModalOpen} onOpenChange={setCreateModalOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create New Question</DialogTitle>
            <DialogDescription>
              Add a new question to your question bank
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label htmlFor="create-text">Question Text *</Label>
              <Textarea
                id="create-text"
                value={formData.text}
                onChange={(e) => setFormData({ ...formData, text: e.target.value })}
                placeholder="Enter the question text..."
                className="mt-1"
                rows={3}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="create-subject">Subject *</Label>
                <Select value={formData.subjectId} onValueChange={(value) => setFormData({ ...formData, subjectId: value })}>
                  <SelectTrigger id="create-subject" className="mt-1">
                    <SelectValue placeholder="Select subject" />
                  </SelectTrigger>
                  <SelectContent>
                    {subjects.map((subject: any) => (
                      <SelectItem key={subject._id || subject.id} value={subject._id || subject.id}>
                        {subject.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="create-topic">Topic</Label>
                <Input
                  id="create-topic"
                  value={formData.topic}
                  onChange={(e) => setFormData({ ...formData, topic: e.target.value })}
                  placeholder="Enter topic..."
                  className="mt-1"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="create-type">Question Type *</Label>
                <Select value={formData.type} onValueChange={(value) => setFormData({ ...formData, type: value })}>
                  <SelectTrigger id="create-type" className="mt-1">
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.values(QUESTION_TYPES).map((type) => (
                      <SelectItem key={type} value={type}>{QUESTION_TYPE_LABELS[type]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="create-difficulty">Difficulty *</Label>
                <Select value={formData.difficulty} onValueChange={(value) => setFormData({ ...formData, difficulty: value })}>
                  <SelectTrigger id="create-difficulty" className="mt-1">
                    <SelectValue placeholder="Select difficulty" />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.values(DIFFICULTIES).map((diff) => (
                      <SelectItem key={diff} value={diff}>{DIFFICULTY_LABELS[diff]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {formData.type === QUESTION_TYPES.MULTIPLE_CHOICE && (
              <div>
                <Label>Options *</Label>
                <div className="space-y-2 mt-2">
                  {formData.options.map((option, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <span className="text-muted-foreground w-6">{String.fromCharCode(65 + idx)}.</span>
                      <Input
                        value={option}
                        onChange={(e) => updateOption(idx, e.target.value)}
                        placeholder={`Option ${String.fromCharCode(65 + idx)}`}
                        className="flex-1"
                      />
                      {formData.options.length > 2 && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => removeOption(idx)}
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  ))}
                  <Button variant="outline" size="sm" onClick={addOption} className="mt-2">
                    <Plus className="w-4 h-4 mr-2" />
                    Add Option
                  </Button>
                </div>
              </div>
            )}

            <div>
              <Label htmlFor="create-correct">Correct Answer *</Label>
              {formData.type === QUESTION_TYPES.MULTIPLE_CHOICE ? (
                <Select 
                  value={formData.correctAnswerIndex >= 0 ? formData.correctAnswerIndex.toString() : ''} 
                  onValueChange={(value) => setFormData({ ...formData, correctAnswerIndex: parseInt(value) })}
                >
                  <SelectTrigger id="create-correct" className="mt-1">
                    <SelectValue placeholder="Select correct answer" />
                  </SelectTrigger>
                  <SelectContent>
                    {formData.options.map((option, idx) => (
                      typeof option === 'string' && option.trim() && (
                        <SelectItem key={idx} value={idx.toString()}>
                          {String.fromCharCode(65 + idx)}. {option.substring(0, 50)}{option.length > 50 ? '...' : ''}
                        </SelectItem>
                      )
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  id="create-correct"
                  value={formData.correctAnswer}
                  onChange={(e) => setFormData({ ...formData, correctAnswer: e.target.value })}
                  placeholder="Enter the correct answer..."
                  className="mt-1"
                />
              )}
            </div>

            <div>
              <Label htmlFor="create-explanation">Explanation</Label>
              <Textarea
                id="create-explanation"
                value={formData.explanation}
                onChange={(e) => setFormData({ ...formData, explanation: e.target.value })}
                placeholder="Enter explanation for the correct answer..."
                className="mt-1"
                rows={3}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="create-points">Points</Label>
                <Input
                  id="create-points"
                  type="number"
                  min={1}
                  value={formData.points}
                  onChange={(e) => setFormData({ ...formData, points: Math.max(parseInt(e.target.value) || 1, 1) })}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="create-tags">Tags (comma separated)</Label>
                <Input
                  id="create-tags"
                  value={formData.tags}
                  onChange={(e) => setFormData({ ...formData, tags: e.target.value })}
                  placeholder="e.g., algebra, equations, math"
                  className="mt-1"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateModalOpen(false)} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button 
              onClick={handleCreateQuestion} 
              disabled={isSubmitting || !formData.text || !formData.subjectId || (formData.type === QUESTION_TYPES.MULTIPLE_CHOICE ? formData.correctAnswerIndex < 0 : !formData.correctAnswer) || (formData.type === QUESTION_TYPES.MULTIPLE_CHOICE && (formData.options?.filter(o => typeof o === 'string' && o.trim()).length || 0) < 2)}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {isSubmitting ? 'Creating...' : 'Create Question'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-destructive">Delete Question</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this question? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {selectedQuestion && (
            <div className="py-4">
              <p className="text-sm text-muted-foreground">Question:</p>
              <p className="font-medium mt-1 line-clamp-2">{selectedQuestion.text}</p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button 
              variant="destructive" 
              onClick={confirmDelete}
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}


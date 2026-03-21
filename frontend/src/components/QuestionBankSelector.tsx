/**
 * QuestionBankSelector Modal Component
 * Allows tutors to browse, filter, and select questions from the question bank
 * for adding to assignments
 */

import { useState, useEffect, useCallback } from 'react'
import { useApiClient } from "@/lib/api-client"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Search, BookOpen, AlertCircle, CheckCircle2, ChevronDown, ChevronUp } from "lucide-react"

export interface QuestionItem {
  id: string
  _id?: string
  text: string
  subject_id?: string | { name: string; _id: string }
  subject?: string
  topic?: string
  difficulty?: 'easy' | 'medium' | 'hard' | 'Easy' | 'Medium' | 'Hard'
  type?: string
  question_type?: string
  options?: string[]
  correct_answer?: string
}

interface QuestionBankSelectorProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  selectedQuestions: string[]
  onConfirm: (questionIds: string[], questionData: QuestionItem[]) => void
}

export default function QuestionBankSelector({
  open,
  onOpenChange,
  selectedQuestions: initialSelected,
  onConfirm,
}: QuestionBankSelectorProps) {
  const client = useApiClient()
  const [questions, setQuestions] = useState<QuestionItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [localSelected, setLocalSelected] = useState<string[]>(initialSelected)
  const [expandedQuestions, setExpandedQuestions] = useState<Set<string>>(new Set())

  // Filters
  const [subjectFilter, setSubjectFilter] = useState('all')
  const [difficultyFilter, setDifficultyFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [subjects, setSubjects] = useState<{ id: string; name: string }[]>([])

  // Sync local selection with parent when modal opens
  useEffect(() => {
    if (open) {
      setLocalSelected(initialSelected)
    }
  }, [open, initialSelected])

  // Fetch subjects for filter
  useEffect(() => {
    const fetchSubjects = async () => {
      try {
        const response = await client.get('/subjects/')
        if (response.data) {
          const items = response.data?.items || response.data || []
          setSubjects(items.map((s: any) => ({ id: s._id || s.id, name: s.name })))
        }
      } catch (err) {
        console.error('Failed to fetch subjects:', err)
      }
    }
    if (open) fetchSubjects()
  }, [open])

  // Fetch questions
  const fetchQuestions = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      
      const params = new URLSearchParams()
      params.append('per_page', '100')
      params.append('status', 'approved') // Only show approved questions
      
      if (subjectFilter !== 'all') params.append('subject_id', subjectFilter)
      if (difficultyFilter !== 'all') params.append('difficulty', difficultyFilter)
      
      const response = await client.get(`/questions/?${params.toString()}`)

      if (response.error) {
        throw new Error(response.error)
      }

      const items = response.data?.items || response.data || []
      setQuestions(items.map((q: any) => ({
        id: q._id || q.id,
        _id: q._id,
        text: q.text || q.content || '',
        subject_id: q.subject_id,
        subject: typeof q.subject_id === 'object' ? q.subject_id?.name : q.subject_id,
        topic: q.topic,
        difficulty: q.difficulty,
        type: q.question_type || q.type,
        question_type: q.question_type,
        options: q.options,
        correct_answer: q.correct_answer,
      })))
    } catch (err: any) {
      console.error('Failed to fetch questions:', err)
      setError(err.message || 'Failed to load questions')
    } finally {
      setLoading(false)
    }
  }, [subjectFilter, difficultyFilter])

  useEffect(() => {
    if (open) fetchQuestions()
  }, [open, fetchQuestions])

  // Filter questions by search and type (client-side)
  const filteredQuestions = questions.filter(q => {
    const matchesSearch = q.text?.toLowerCase().includes(searchTerm.toLowerCase())
    const matchesType = typeFilter === 'all' || 
      q.type?.toLowerCase() === typeFilter.toLowerCase() ||
      q.question_type?.toLowerCase() === typeFilter.toLowerCase()
    return matchesSearch && matchesType
  })

  const handleToggle = (id: string) => {
    setLocalSelected(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    )
  }

  const handleSelectAll = () => {
    const allIds = filteredQuestions.map(q => q.id)
    if (allIds.every(id => localSelected.includes(id))) {
      setLocalSelected(prev => prev.filter(id => !allIds.includes(id)))
    } else {
      setLocalSelected(prev => [...new Set([...prev, ...allIds])])
    }
  }

  const toggleExpand = (id: string) => {
    setExpandedQuestions(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleConfirm = () => {
    const selectedData = questions.filter(q => localSelected.includes(q.id))
    onConfirm(localSelected, selectedData)
    onOpenChange(false)
  }

  const getDifficultyColor = (difficulty?: string) => {
    switch (difficulty?.toLowerCase()) {
      case 'easy': return 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400'
      case 'medium': return 'bg-amber-500/20 text-amber-600 dark:text-amber-400'
      case 'hard': return 'bg-red-500/20 text-red-600 dark:text-red-400'
      default: return 'bg-muted text-muted-foreground'
    }
  }

  const truncateText = (text: string, maxLength: number = 100) => {
    if (text.length <= maxLength) return text
    return text.slice(0, maxLength) + '...'
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-primary" />
            Browse Question Bank
          </DialogTitle>
          <DialogDescription>
            Select questions to add to your assignment
          </DialogDescription>
        </DialogHeader>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 py-3 border-b border-border">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search questions..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
          <Select value={subjectFilter} onValueChange={setSubjectFilter}>
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="Subject" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Subjects</SelectItem>
              {subjects.map(s => (
                <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={difficultyFilter} onValueChange={setDifficultyFilter}>
            <SelectTrigger className="w-[130px]">
              <SelectValue placeholder="Difficulty" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Levels</SelectItem>
              <SelectItem value="easy">Easy</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="hard">Hard</SelectItem>
            </SelectContent>
          </Select>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="multiple_choice">Multiple Choice</SelectItem>
              <SelectItem value="short_answer">Short Answer</SelectItem>
              <SelectItem value="true_false">True/False</SelectItem>
              <SelectItem value="essay">Essay</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Selection info */}
        <div className="flex items-center justify-between py-2">
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="gap-1">
              <CheckCircle2 className="h-3 w-3" />
              {localSelected.length} selected
            </Badge>
            <span className="text-sm text-muted-foreground">
              {filteredQuestions.length} question{filteredQuestions.length !== 1 ? 's' : ''} found
            </span>
          </div>
          <button
            type="button"
            onClick={handleSelectAll}
            className="text-sm text-primary hover:underline"
          >
            {filteredQuestions.every(q => localSelected.includes(q.id))
              ? 'Deselect All' : 'Select All Visible'}
          </button>
        </div>

        {/* Question list - Part 2 continues below */}
        <ScrollArea className="flex-1 min-h-[300px] border rounded-lg">
          <div className="p-2 space-y-2">
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-20 w-full" />
              ))
            ) : error ? (
              <div className="p-6 text-center">
                <AlertCircle className="h-8 w-8 text-red-500 mx-auto mb-2" />
                <p className="text-red-600 dark:text-red-400">{error}</p>
              </div>
            ) : filteredQuestions.length === 0 ? (
              <div className="p-8 text-center">
                <BookOpen className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground">No questions found</p>
                <p className="text-sm text-muted-foreground mt-1">Try adjusting your filters</p>
              </div>
            ) : (
              filteredQuestions.map(question => (
                <QuestionCard
                  key={question.id}
                  question={question}
                  isSelected={localSelected.includes(question.id)}
                  isExpanded={expandedQuestions.has(question.id)}
                  onToggle={() => handleToggle(question.id)}
                  onExpand={() => toggleExpand(question.id)}
                  getDifficultyColor={getDifficultyColor}
                  truncateText={truncateText}
                />
              ))
            )}
          </div>
        </ScrollArea>

        <DialogFooter className="pt-4 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={localSelected.length === 0}>
            Add {localSelected.length} Question{localSelected.length !== 1 ? 's' : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// QuestionCard subcomponent
interface QuestionCardProps {
  question: QuestionItem
  isSelected: boolean
  isExpanded: boolean
  onToggle: () => void
  onExpand: () => void
  getDifficultyColor: (difficulty?: string) => string
  truncateText: (text: string, maxLength?: number) => string
}

function QuestionCard({
  question,
  isSelected,
  isExpanded,
  onToggle,
  onExpand,
  getDifficultyColor,
  truncateText,
}: QuestionCardProps) {
  return (
    <div
      className={`
        p-3 rounded-lg border transition-colors cursor-pointer
        ${isSelected
          ? 'bg-primary/5 border-primary/30'
          : 'bg-card border-border hover:bg-muted'
        }
      `}
      onClick={onToggle}
    >
      <div className="flex items-start gap-3">
        <Checkbox
          checked={isSelected}
          onCheckedChange={onToggle}
          onClick={(e) => e.stopPropagation()}
          className="mt-1"
        />
        <div className="flex-1 min-w-0">
          <p className="text-sm text-foreground">
            {isExpanded ? question.text : truncateText(question.text, 120)}
          </p>
          {question.text.length > 120 && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onExpand(); }}
              className="text-xs text-primary hover:underline mt-1 flex items-center gap-1"
            >
              {isExpanded ? (
                <>Show less <ChevronUp className="h-3 w-3" /></>
              ) : (
                <>Show more <ChevronDown className="h-3 w-3" /></>
              )}
            </button>
          )}
          <div className="flex flex-wrap items-center gap-2 mt-2">
            {question.subject && (
              <Badge variant="outline" className="text-xs">
                {typeof question.subject === 'object'
                  ? (question.subject as any).name
                  : question.subject}
              </Badge>
            )}
            {question.topic && (
              <Badge variant="outline" className="text-xs">
                {question.topic}
              </Badge>
            )}
            {question.difficulty && (
              <Badge className={`text-xs ${getDifficultyColor(question.difficulty)}`}>
                {question.difficulty}
              </Badge>
            )}
            {(question.type || question.question_type) && (
              <Badge variant="secondary" className="text-xs">
                {(question.type || question.question_type)?.replace(/_/g, ' ')}
              </Badge>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}


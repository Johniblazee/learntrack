import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useLocation, useNavigate } from 'react-router-dom'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Users, BookOpen, Plus, X, Save, ArrowLeft } from "lucide-react"
import { useApiClient } from "@/lib/api-client"
import { toast } from "@/contexts/ToastContext"
import GroupSelector from '@/components/GroupSelector'
import SubjectFilter from '@/components/SubjectFilter'
import StudentSelector from '@/components/StudentSelector'
import QuestionBankSelector, { QuestionItem } from '@/components/QuestionBankSelector'
import { useSubjects } from '@/hooks/useQueries'

interface WorkflowSourceState {
  label?: string
  description?: string
}

export default function CreateAssignmentView() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const location = useLocation()
  const workflowSource = ((location.state as any)?.workflowSource || null) as WorkflowSourceState | null
  const initialAssignmentType = (() => {
    const maybeAssignmentType = (location.state as any)?.initialAssignmentType
    return maybeAssignmentType === 'group' || maybeAssignmentType === 'subject'
      ? maybeAssignmentType
      : 'individual'
  })()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [assignmentType, setAssignmentType] = useState<'individual' | 'group' | 'subject'>(initialAssignmentType)
  const [isQuestionSelectorOpen, setIsQuestionSelectorOpen] = useState(false)
  const [selectedQuestionData, setSelectedQuestionData] = useState<QuestionItem[]>([])
  const [appliedTemplateId, setAppliedTemplateId] = useState<string | null>(null)

  const [formData, setFormData] = useState({
    title: '',
    description: '',
    dueDate: '',
    timeLimit: '',
    maxAttempts: '1',
    shuffleQuestions: false,
    showResultsImmediately: true,
    subject: '',
    topic: '',
    selectedStudents: [] as string[],
    selectedGroups: [] as string[],
    selectedSubject: '',
    selectedQuestions: [] as string[],
  })

  const client = useApiClient()
  const { data: subjectsData } = useSubjects()
  const subjects = Array.isArray(subjectsData)
    ? subjectsData
    : subjectsData?.items || []

  useEffect(() => {
    const maybeTemplate = (location.state as any)?.template
    const maybeQuestionBankIds = (location.state as any)?.questionBankIds
    const maybeInitialAssignmentType = (location.state as any)?.initialAssignmentType
    const prefillTitle = String((location.state as any)?.prefillTitle || '')
    const prefillTopic = String((location.state as any)?.prefillTopic || '')
    const prefillSubjectId = String((location.state as any)?.prefillSubjectId || '')

    if (
      maybeInitialAssignmentType === 'individual' ||
      maybeInitialAssignmentType === 'group' ||
      maybeInitialAssignmentType === 'subject'
    ) {
      setAssignmentType(maybeInitialAssignmentType)
    }

    if (maybeTemplate) {
      const templateId = String(maybeTemplate.id || maybeTemplate._id || '')
      if (!templateId || appliedTemplateId === templateId) return

      const questionIds: string[] = Array.isArray(maybeTemplate.question_ids)
        ? maybeTemplate.question_ids.map((questionId: any) => String(questionId))
        : []

      setFormData((prev) => ({
        ...prev,
        title: prev.title || `${maybeTemplate.name || 'Template'} Assignment`,
        description: maybeTemplate.instructions || maybeTemplate.description || prev.description,
        subject: prev.subject || String(maybeTemplate.subject_id || ''),
        timeLimit:
          prev.timeLimit ||
          (maybeTemplate.duration_minutes ? String(maybeTemplate.duration_minutes) : ''),
        shuffleQuestions:
          typeof maybeTemplate.shuffle_questions === 'boolean'
            ? maybeTemplate.shuffle_questions
            : prev.shuffleQuestions,
        selectedSubject: String(maybeTemplate.subject_id || ''),
        selectedQuestions: questionIds,
      }))

      const hydrateQuestionDetails = async () => {
        if (questionIds.length === 0) {
          setSelectedQuestionData([])
          return
        }

        try {
          const questions = await Promise.all(
            questionIds.map(async (questionId) => {
              const response = await client.get(`/questions/${questionId}`)
              if (response.error || !response.data) return null

              const question = response.data as any
              return {
                id: String(question._id || question.id || questionId),
                _id: question._id,
                text: question.question_text || question.text || '',
                subject_id: question.subject_id,
                subject: typeof question.subject_id === 'object' ? question.subject_id?.name : question.subject_id,
                topic: question.topic,
                difficulty: question.difficulty,
                type: question.question_type || question.type,
                question_type: question.question_type,
                options: question.options,
                correct_answer: question.correct_answer,
              } as QuestionItem
            })
          )

          const validQuestions = questions.filter(Boolean) as QuestionItem[]
          const uniqueSubjectIds = Array.from(
            new Set(
              validQuestions
                .map((question) => {
                  if (typeof question.subject_id === 'string') {
                    return question.subject_id
                  }

                  return question.subject_id?._id || ''
                })
                .filter(Boolean),
            ),
          )

          setSelectedQuestionData(validQuestions)
          if (uniqueSubjectIds.length === 1) {
            setFormData((prev) => ({
              ...prev,
              subject: prev.subject || uniqueSubjectIds[0],
            }))
          }
        } catch (error) {
          console.error('Failed to load template questions:', error)
          toast.error('Some template questions could not be loaded')
        }
      }

      hydrateQuestionDetails()
      setAppliedTemplateId(templateId)
    } else if (maybeQuestionBankIds && Array.isArray(maybeQuestionBankIds)) {
      if (appliedTemplateId === '__question_bank__') return

      const questionIds: string[] = maybeQuestionBankIds.map((id: any) => String(id))
      setFormData((prev) => ({
        ...prev,
        title: prev.title || prefillTitle,
        topic: prev.topic || prefillTopic,
        subject: prev.subject || prefillSubjectId,
        selectedQuestions: questionIds,
      }))

      const hydrateQuestionDetails = async () => {
        if (questionIds.length === 0) {
          setSelectedQuestionData([])
          return
        }

        try {
          const questions = await Promise.all(
            questionIds.map(async (questionId) => {
              const response = await client.get(`/questions/${questionId}`)
              if (response.error || !response.data) return null

              const question = response.data as any
              return {
                id: String(question._id || question.id || questionId),
                _id: question._id,
                text: question.question_text || question.text || '',
                subject_id: question.subject_id,
                subject: typeof question.subject_id === 'object' ? question.subject_id?.name : question.subject_id,
                topic: question.topic,
                difficulty: question.difficulty,
                type: question.question_type || question.type,
                question_type: question.question_type,
                options: question.options,
                correct_answer: question.correct_answer,
              } as QuestionItem
            })
          )

          const validQuestions = questions.filter(Boolean) as QuestionItem[]
          const uniqueSubjectIds = Array.from(
            new Set(
              validQuestions
                .map((question) => {
                  if (typeof question.subject_id === 'string') {
                    return question.subject_id
                  }

                  return question.subject_id?._id || ''
                })
                .filter(Boolean),
            ),
          )

          setSelectedQuestionData(validQuestions)
          if (uniqueSubjectIds.length === 1) {
            setFormData((prev) => ({
              ...prev,
              subject: prev.subject || prefillSubjectId || uniqueSubjectIds[0],
            }))
          }
        } catch (error) {
          console.error('Failed to load question bank questions:', error)
          toast.error('Some questions could not be loaded')
        }
      }

      hydrateQuestionDetails()
      setAppliedTemplateId('__question_bank__')
    }
  }, [appliedTemplateId, client, location.state])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    // Validation
    if (!formData.title.trim()) {
      toast.error('Please enter an assignment title')
      return
    }
    
    if (!formData.dueDate) {
      toast.error('Please select a due date')
      return
    }

    const resolvedSubject =
      formData.subject || (assignmentType === 'subject' ? formData.selectedSubject : '')
    if (!resolvedSubject) {
      toast.error('Please select a subject')
      return
    }

    // Check if at least one target is selected
    const hasTarget = 
      (assignmentType === 'individual' && formData.selectedStudents.length > 0) ||
      (assignmentType === 'group' && formData.selectedGroups.length > 0) ||
      (assignmentType === 'subject' && formData.selectedSubject)

    if (!hasTarget) {
      toast.error('Please select at least one student, group, or subject')
      return
    }

    if (formData.selectedQuestions.length === 0) {
      toast.error('Please add at least one question')
      return
    }

    try {
      setIsSubmitting(true)

      const payload = {
        title: formData.title,
        description: formData.description,
        due_date: formData.dueDate,
        time_limit: formData.timeLimit ? Number(formData.timeLimit) : undefined,
        max_attempts: Math.max(Number(formData.maxAttempts) || 1, 1),
        shuffle_questions: formData.shuffleQuestions,
        show_results_immediately: formData.showResultsImmediately,
        subject_id: resolvedSubject,
        topic: formData.topic,
        question_ids: formData.selectedQuestions,
        student_ids: assignmentType === 'individual' ? formData.selectedStudents : undefined,
        group_ids: assignmentType === 'group' ? formData.selectedGroups : undefined,
        subject_filter: assignmentType === 'subject' ? formData.selectedSubject : undefined,
      }

      const response = await client.post('/assignments/', payload)

      if (response.error) {
        throw new Error(response.error)
      }

      toast.success('Assignment draft saved', {
        description: `Publish "${formData.title}" from Active Assignments when you are ready.`
      })

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['assignments'] }),
        queryClient.invalidateQueries({ queryKey: ['assignments', 'my'] }),
        queryClient.invalidateQueries({ queryKey: ['student-dashboard-stats'] }),
        queryClient.invalidateQueries({ queryKey: ['student-progress-analytics'] }),
      ])

      // Reset form
      setFormData({
        title: '',
        description: '',
        dueDate: '',
        timeLimit: '',
        maxAttempts: '1',
        shuffleQuestions: false,
        showResultsImmediately: true,
        subject: '',
        topic: '',
        selectedStudents: [],
        selectedGroups: [],
        selectedSubject: '',
        selectedQuestions: [],
      })
      setSelectedQuestionData([])
      navigate('/dashboard/assignments')
    } catch (err: any) {
      console.error('Failed to create assignment:', err)
      toast.error('Failed to create assignment', {
        description: err.message || 'Please check your input and try again'
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">
            Create New Assignment
          </h2>
          <p className="text-muted-foreground">
            Create and assign work to your students
          </p>
        </div>
        <Button variant="outline" type="button" onClick={() => navigate('/dashboard/assignments')}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Assignments
        </Button>
      </div>

      {workflowSource?.label && (
        <Card className="border border-border bg-muted/30">
          <CardContent className="flex items-start justify-between gap-4 p-4">
            <div>
              <p className="text-sm font-medium text-foreground">Loaded from {workflowSource.label}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {workflowSource.description || 'Selected questions were loaded into this draft assignment.'}
              </p>
            </div>
            <Badge variant="secondary">{formData.selectedQuestions.length} question{formData.selectedQuestions.length === 1 ? '' : 's'}</Badge>
          </CardContent>
        </Card>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Basic Information */}
        <Card>
          <CardHeader>
            <CardTitle>Basic Information</CardTitle>
            <CardDescription>
              Enter the assignment details
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="title">
                Assignment Title <span className="text-red-500">*</span>
              </Label>
              <Input
                id="title"
                placeholder="e.g., Math Quiz 1"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                placeholder="Describe what students need to do..."
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                rows={4}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="dueDate">
                  Due Date <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="dueDate"
                  type="date"
                  value={formData.dueDate}
                  onChange={(e) => setFormData({ ...formData, dueDate: e.target.value })}
                  min={new Date().toISOString().split('T')[0]}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="subject">Subject</Label>
                <Select
                  value={formData.subject}
                  onValueChange={(value) => setFormData({ ...formData, subject: value })}
                >
                  <SelectTrigger id="subject">
                    <SelectValue placeholder="Select subject" />
                  </SelectTrigger>
                  <SelectContent>
                    {subjects.map((subject: any) => {
                      const subjectId = String(subject._id || subject.id || '')
                      if (!subjectId) {
                        return null
                      }

                      return (
                        <SelectItem key={subjectId} value={subjectId}>
                          {subject.name || subjectId}
                        </SelectItem>
                      )
                    })}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="topic">Topic</Label>
                <Input
                  id="topic"
                  placeholder="e.g., Algebra"
                  value={formData.topic}
                  onChange={(e) => setFormData({ ...formData, topic: e.target.value })}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Assignment Rules</CardTitle>
            <CardDescription>
              Control attempts, timing, and when students can view results
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="timeLimit">Time Limit (minutes)</Label>
                <Input
                  id="timeLimit"
                  type="number"
                  min={1}
                  placeholder="Optional"
                  value={formData.timeLimit}
                  onChange={(e) => setFormData({ ...formData, timeLimit: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="maxAttempts">Max Attempts</Label>
                <Input
                  id="maxAttempts"
                  type="number"
                  min={1}
                  value={formData.maxAttempts}
                  onChange={(e) => setFormData({ ...formData, maxAttempts: e.target.value })}
                />
              </div>
            </div>

            <div className="rounded-lg border border-border p-4 space-y-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-foreground">Shuffle Questions</p>
                  <p className="text-xs text-muted-foreground">Randomize question order for students</p>
                </div>
                <Switch
                  checked={formData.shuffleQuestions}
                  onCheckedChange={(checked) =>
                    setFormData({ ...formData, shuffleQuestions: checked })
                  }
                />
              </div>

              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-foreground">Release Results Immediately</p>
                  <p className="text-xs text-muted-foreground">Show scores to students as soon as grading is available</p>
                </div>
                <Switch
                  checked={formData.showResultsImmediately}
                  onCheckedChange={(checked) =>
                    setFormData({ ...formData, showResultsImmediately: checked })
                  }
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Assign To */}
        <Card>
          <CardHeader>
            <CardTitle>Assign To</CardTitle>
            <CardDescription>
              Choose who should receive this assignment
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs value={assignmentType} onValueChange={(value: any) => setAssignmentType(value)}>
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="individual">
                  <Users className="h-4 w-4 mr-2" />
                  Individual Students
                </TabsTrigger>
                <TabsTrigger value="group">
                  <Users className="h-4 w-4 mr-2" />
                  Groups
                </TabsTrigger>
                <TabsTrigger value="subject">
                  <BookOpen className="h-4 w-4 mr-2" />
                  By Subject
                </TabsTrigger>
              </TabsList>

              <TabsContent value="individual" className="space-y-4">
                <StudentSelector
                  selectedStudents={formData.selectedStudents}
                  onChange={(students) => setFormData({ ...formData, selectedStudents: students })}
                />
              </TabsContent>

              <TabsContent value="group" className="space-y-4">
                <GroupSelector
                  selectedGroups={formData.selectedGroups}
                  onChange={(groups) => setFormData({ ...formData, selectedGroups: groups })}
                />
              </TabsContent>

              <TabsContent value="subject" className="space-y-4">
                <SubjectFilter
                  selectedSubject={formData.selectedSubject}
                  onChange={(subject) => setFormData({ ...formData, selectedSubject: subject })}
                />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        {/* Questions */}
        <Card>
          <CardHeader>
            <CardTitle>Questions</CardTitle>
            <CardDescription>
              Add questions from your question bank
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {formData.selectedQuestions.length} question(s) selected
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsQuestionSelectorOpen(true)}
              >
                <Plus className="h-4 w-4 mr-2" />
                Add Questions
              </Button>
            </div>

            {formData.selectedQuestions.length === 0 ? (
              <div className="p-8 border-2 border-dashed border-border rounded-lg text-center">
                <BookOpen className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground mb-4">
                  No questions added yet
                </p>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsQuestionSelectorOpen(true)}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Browse Question Bank
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                {selectedQuestionData.map((question, index) => {
                  const truncatedText = question.text.length > 100
                    ? question.text.slice(0, 100) + '...'
                    : question.text

                  const getDifficultyColor = (difficulty?: string) => {
                    switch (difficulty?.toLowerCase()) {
                      case 'easy': return 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                      case 'medium': return 'bg-amber-500/20 text-amber-600 dark:text-amber-400'
                      case 'hard': return 'bg-red-500/20 text-red-600 dark:text-red-400'
                      default: return 'bg-muted text-muted-foreground'
                    }
                  }

                  return (
                    <div
                      key={question.id}
                      className="flex items-start justify-between p-3 border border-border rounded-lg bg-card"
                    >
                      <div className="flex-1 min-w-0 pr-4">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-medium text-muted-foreground">
                            Q{index + 1}
                          </span>
                          {question.difficulty && (
                            <Badge className={`text-xs ${getDifficultyColor(question.difficulty)}`}>
                              {question.difficulty}
                            </Badge>
                          )}
                          {question.type && (
                            <Badge variant="secondary" className="text-xs">
                              {question.type.replace(/_/g, ' ')}
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-foreground">
                          {truncatedText}
                        </p>
                        {question.subject && (
                          <p className="text-xs text-muted-foreground mt-1">
                            Subject: {typeof question.subject === 'object'
                              ? (question.subject as any).name
                              : question.subject}
                          </p>
                        )}
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          const newQuestions = formData.selectedQuestions.filter(id => id !== question.id)
                          setFormData({ ...formData, selectedQuestions: newQuestions })
                          setSelectedQuestionData(prev => prev.filter(q => q.id !== question.id))
                        }}
                        className="text-muted-foreground hover:text-red-500"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Question Bank Selector Modal */}
        <QuestionBankSelector
          open={isQuestionSelectorOpen}
          onOpenChange={setIsQuestionSelectorOpen}
          selectedQuestions={formData.selectedQuestions}
          onConfirm={(questionIds, questionData) => {
            const uniqueSubjectIds = Array.from(
              new Set(
                questionData
                  .map((question) => {
                    if (typeof question.subject_id === 'string') {
                      return question.subject_id
                    }

                    return question.subject_id?._id || ''
                  })
                  .filter(Boolean),
              ),
            )

            setFormData({
              ...formData,
              selectedQuestions: questionIds,
              subject: formData.subject || (uniqueSubjectIds.length === 1 ? uniqueSubjectIds[0] : ''),
            })
            setSelectedQuestionData(questionData)
          }}
        />

        {/* Actions */}
        <div className="flex justify-end gap-4">
          <Button type="button" variant="outline" onClick={() => navigate('/dashboard/assignments')}>
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            <Save className="h-4 w-4 mr-2" />
            {isSubmitting ? 'Saving Draft...' : 'Save Draft'}
          </Button>
        </div>
      </form>
    </div>
  )
}

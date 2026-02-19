import { useEffect, useMemo, useState } from "react"
import { useUser } from "@clerk/clerk-react"
import { useQueryClient } from "@tanstack/react-query"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Textarea } from "@/components/ui/textarea"
import { Skeleton } from "@/components/ui/skeleton"
import { useUserContext } from "@/contexts/UserContext"
import { useApiClient } from "@/lib/api-client"
import { toast } from "@/contexts/ToastContext"

interface StudentAssignmentWorkspaceProps {
  assignmentId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmitted?: () => void
}

interface StudentQuestion {
  id: string
  questionText: string
  questionType: string
  options: Array<{ text: string }>
  points: number
}

interface AnswerState {
  answer: string
  selectedOptions: string[]
}

const EMPTY_ANSWER: AnswerState = {
  answer: "",
  selectedOptions: [],
}

export default function StudentAssignmentWorkspace({
  assignmentId,
  open,
  onOpenChange,
  onSubmitted,
}: StudentAssignmentWorkspaceProps) {
  const { user } = useUser()
  const { backendUser } = useUserContext()
  const client = useApiClient()
  const queryClient = useQueryClient()
  const activeStudentId = backendUser?.clerk_id || user?.id || null

  const [loading, setLoading] = useState(false)
  const [savingDraft, setSavingDraft] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [assignmentTitle, setAssignmentTitle] = useState("Assignment")
  const [questions, setQuestions] = useState<StudentQuestion[]>([])
  const [answers, setAnswers] = useState<Record<string, AnswerState>>({})
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0)

  const totalQuestions = questions.length

  const answeredCount = useMemo(() => {
    return questions.filter((question) => {
      const state = answers[question.id]
      if (!state) return false
      return Boolean(state.answer.trim() || state.selectedOptions.length > 0)
    }).length
  }, [answers, questions])

  const completionPercentage = totalQuestions > 0 ? Math.round((answeredCount / totalQuestions) * 100) : 0

  const currentQuestion = questions[currentQuestionIndex]

  useEffect(() => {
    if (!open || !assignmentId || !activeStudentId) return

    const loadWorkspace = async () => {
      try {
        setLoading(true)
        setCurrentQuestionIndex(0)

        const assignmentResponse = await client.get(`/assignments/${assignmentId}`)
        if (assignmentResponse.error || !assignmentResponse.data) {
          throw new Error(assignmentResponse.error || "Failed to load assignment")
        }

        const assignment = assignmentResponse.data as any
        setAssignmentTitle(assignment.title || "Assignment")

        const progressResponse = await client.get(
          `/progress/assignment/${assignmentId}/student/${activeStudentId}`
        )
        if (progressResponse.error || !progressResponse.data) {
          throw new Error(progressResponse.error || "Failed to load assignment progress")
        }

        const questionRows = Array.isArray(assignment.questions) ? assignment.questions : []

        const questionResults = await Promise.all(
          questionRows.map(async (questionRow: any) => {
            const questionId = String(questionRow.question_id || "")
            if (!questionId) return null

            const response = await client.get(`/questions/${questionId}/student`)
            if (response.error || !response.data) return null

            const question = response.data as any
            return {
              id: String(question.id || question._id || questionId),
              questionText: question.question_text || "Untitled question",
              questionType: String(question.question_type || "short-answer"),
              options: Array.isArray(question.options) ? question.options : [],
              points: Number(questionRow.points || question.points || 1),
            } as StudentQuestion
          })
        )

        const safeQuestions = questionResults.filter(Boolean) as StudentQuestion[]
        setQuestions(safeQuestions)

        const progress = progressResponse.data as any
        const answerMap: Record<string, AnswerState> = {}
        const existingAnswers = Array.isArray(progress.answers) ? progress.answers : []

        existingAnswers.forEach((answerRow: any) => {
          const questionId = String(answerRow.question_id || "")
          if (!questionId) return

          answerMap[questionId] = {
            answer: String(answerRow.answer || ""),
            selectedOptions: Array.isArray(answerRow.selected_options)
              ? answerRow.selected_options.map((option: any) => String(option))
              : [],
          }
        })

        safeQuestions.forEach((question) => {
          if (!answerMap[question.id]) {
            answerMap[question.id] = { ...EMPTY_ANSWER }
          }
        })

        setAnswers(answerMap)
      } catch (error) {
        console.error("Failed to load assignment workspace:", error)
        toast.error("Failed to open assignment workspace")
        onOpenChange(false)
      } finally {
        setLoading(false)
      }
    }

    loadWorkspace()
  }, [activeStudentId, assignmentId, client, onOpenChange, open])

  const updateAnswer = (questionId: string, nextState: Partial<AnswerState>) => {
    setAnswers((prev) => ({
      ...prev,
      [questionId]: {
        ...(prev[questionId] || EMPTY_ANSWER),
        ...nextState,
      },
    }))
  }

  const serializeAnswers = () => {
    return questions.map((question) => {
      const state = answers[question.id] || EMPTY_ANSWER
      const fallbackAnswer = state.answer.trim() || state.selectedOptions[0] || ""

      return {
        question_id: question.id,
        answer: fallbackAnswer,
        selected_options: state.selectedOptions,
      }
    })
  }

  const handleSaveDraft = async () => {
    if (!assignmentId) return

    try {
      setSavingDraft(true)
      const payload = {
        answers: serializeAnswers(),
        status: "in_progress",
      }

      const response = await client.put(`/progress/assignment/${assignmentId}`, payload)
      if (response.error) throw new Error(response.error)

      toast.success("Progress saved")
    } catch (error) {
      console.error("Failed to save assignment draft:", error)
      toast.error("Could not save progress")
    } finally {
      setSavingDraft(false)
    }
  }

  const handleSubmitAssignment = async () => {
    if (!assignmentId) return

    try {
      setSubmitting(true)

      const response = await client.post(`/progress/assignment/${assignmentId}/answer`, {
        answers: serializeAnswers(),
        submit_assignment: true,
      })

      if (response.error || !response.data) {
        throw new Error(response.error || "Failed to submit assignment")
      }

      const score = (response.data as any).score
      toast.success("Assignment submitted", {
        description: typeof score === "number" ? `Score: ${score}%` : "Submission sent for review",
      })

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["assignments", "my"] }),
        queryClient.invalidateQueries({ queryKey: ["student-dashboard-stats"] }),
        queryClient.invalidateQueries({ queryKey: ["student-progress-analytics"] }),
      ])

      onSubmitted?.()
      onOpenChange(false)
    } catch (error) {
      console.error("Failed to submit assignment:", error)
      toast.error("Could not submit assignment")
    } finally {
      setSubmitting(false)
    }
  }

  const renderQuestionInput = (question: StudentQuestion) => {
    const state = answers[question.id] || EMPTY_ANSWER
    const questionType = question.questionType.toLowerCase()

    if (questionType === "multiple-choice") {
      return (
        <div className="space-y-2">
          {question.options.map((option) => {
            const isSelected = state.selectedOptions.includes(option.text)
            return (
              <button
                key={option.text}
                type="button"
                className={`w-full rounded-lg border px-4 py-3 text-left text-sm transition-colors ${
                  isSelected
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border bg-card hover:border-primary/40"
                }`}
                onClick={() =>
                  updateAnswer(question.id, {
                    selectedOptions: [option.text],
                    answer: option.text,
                  })
                }
              >
                {option.text}
              </button>
            )
          })}
        </div>
      )
    }

    if (questionType === "true-false") {
      return (
        <div className="grid grid-cols-2 gap-2">
          {["True", "False"].map((value) => {
            const selected = (state.answer || state.selectedOptions[0] || "").toLowerCase() === value.toLowerCase()
            return (
              <Button
                key={value}
                type="button"
                variant={selected ? "default" : "outline"}
                onClick={() =>
                  updateAnswer(question.id, {
                    answer: value,
                    selectedOptions: [value],
                  })
                }
              >
                {value}
              </Button>
            )
          })}
        </div>
      )
    }

    return (
      <Textarea
        value={state.answer}
        onChange={(event) =>
          updateAnswer(question.id, {
            answer: event.target.value,
            selectedOptions: [],
          })
        }
        placeholder="Type your answer here..."
        className="min-h-[160px]"
      />
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{assignmentTitle}</DialogTitle>
          <DialogDescription>Answer each question, save progress, then submit when ready.</DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="space-y-4">
            <Skeleton className="h-5 w-1/3" />
            <Skeleton className="h-36 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : totalQuestions === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
            This assignment has no available questions yet.
          </div>
        ) : (
          <div className="space-y-5">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span>Completion</span>
                <span>{answeredCount}/{totalQuestions} answered</span>
              </div>
              <Progress value={completionPercentage} className="h-2" />
            </div>

            <div className="rounded-lg border p-4 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <Badge variant="secondary">Question {currentQuestionIndex + 1} of {totalQuestions}</Badge>
                <Badge variant="outline">{currentQuestion?.points || 1} point{(currentQuestion?.points || 1) === 1 ? "" : "s"}</Badge>
              </div>

              <p className="text-base font-medium text-foreground">{currentQuestion?.questionText}</p>

              {currentQuestion && renderQuestionInput(currentQuestion)}

              <div className="flex items-center justify-between pt-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={currentQuestionIndex === 0}
                  onClick={() => setCurrentQuestionIndex((index) => Math.max(0, index - 1))}
                >
                  Previous
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={currentQuestionIndex >= totalQuestions - 1}
                  onClick={() => setCurrentQuestionIndex((index) => Math.min(totalQuestions - 1, index + 1))}
                >
                  Next
                </Button>
              </div>
            </div>

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" onClick={handleSaveDraft} disabled={savingDraft || submitting}>
                {savingDraft ? "Saving..." : "Save Progress"}
              </Button>
              <Button type="button" onClick={handleSubmitAssignment} disabled={submitting}>
                {submitting ? "Submitting..." : "Submit Assignment"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

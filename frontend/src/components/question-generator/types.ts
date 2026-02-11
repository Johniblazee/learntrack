export type QuestionReviewStatus = 'pending' | 'approved' | 'rejected'

export interface GeneratedQuestion {
  question_id: string
  session_id?: string
  type: string
  difficulty: string
  blooms_level?: string
  question_text: string
  options?: string[]
  correct_answer: string
  explanation?: string
  status?: QuestionReviewStatus
  versions?: GeneratedQuestion[]
  currentVersionIndex?: number
}

export interface StreamEvent {
  event_type: string
  session_id?: string
  step?: string
  content?: string
  question_data?: GeneratedQuestion
  error_message?: string
  error_code?: string
}

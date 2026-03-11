export type QuestionReviewStatus = 'pending' | 'approved' | 'rejected' | 'edited'

export interface SourceCitation {
  material_id: string
  material_title?: string
  excerpt?: string
  location?: string | null
}

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
  review_comments?: string | null
  rejection_reason?: string | null
  quality_score?: number | null
  source_citations?: SourceCitation[]
  published_question_id?: string | null
  published_at?: string | null
  versions?: GeneratedQuestion[]
  currentVersionIndex?: number
}

export interface StreamEvent {
  event_type: string
  session_id?: string
  step?: string
  content?: string
  question_data?: GeneratedQuestion
  source_id?: string
  source_title?: string
  source_excerpt?: string
  error_message?: string
  error_code?: string
}

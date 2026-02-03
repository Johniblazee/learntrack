/**
 * Hook for consuming SSE stream from Question Generator API
 * 
 * Handles real-time streaming of question generation events including:
 * - Thinking steps (agent reasoning)
 * - Source material discovery
 * - Question content streaming
 * - Completion events
 */

import { useState, useCallback, useRef } from 'react'
import { useAuth } from '@clerk/clerk-react'
import { API_BASE_URL } from '@/lib/config'

const API_BASE = API_BASE_URL

// Event types from backend
export type StreamEventType =
  | 'agent:thinking'
  | 'agent:action'
  | 'agent:observation'
  | 'generation:start'
  | 'generation:chunk'
  | 'generation:question_complete'
  | 'generation:complete'
  | 'source:found'
  | 'source:cited'
  | 'error:message'
  | 'done'

export interface StreamEvent {
  event_type: StreamEventType
  timestamp: string
  step?: string
  question_id?: string
  content?: string
  question_number?: number
  total_questions?: number
  source_id?: string
  source_title?: string
  source_excerpt?: string
  quality_score?: number
  question_data?: GeneratedQuestion
  error_message?: string
  session_id?: string
}

export interface GeneratedQuestion {
  question_id: string
  type: 'multiple-choice' | 'true-false' | 'short-answer' | 'essay' | 'MCQ' | 'TRUE_FALSE' | 'SHORT_ANSWER' | 'ESSAY'
  difficulty: 'easy' | 'medium' | 'hard' | 'EASY' | 'MEDIUM' | 'HARD'
  blooms_level: string
  question_text: string
  options?: string[]
  correct_answer: string
  explanation: string
  source_citations: Array<{
    material_id: string
    material_title: string
    excerpt: string
    location?: string
  }>
  tags: string[]
  quality_score?: number
  subject?: string
  topic?: string
}

export interface GenerationConfig {
  prompt: string
  question_count: number
  question_types: string[]
  difficulty: string
  material_ids?: string[]
  subject?: string
  topic?: string
  grade_level?: string
  ai_provider?: string
}

export interface UseQuestionGeneratorResult {
  // State
  isGenerating: boolean
  thinkingSteps: string[]
  sources: Array<{ id: string; title: string; excerpt: string; url?: string }>
  questions: GeneratedQuestion[]
  currentContent: string
  error: string | null
  sessionId: string | null
  progress: { current: number; total: number }
  
  // Actions
  startGeneration: (config: GenerationConfig) => Promise<void>
  stopGeneration: () => void
  clearResults: () => void
}

export function useQuestionGenerator(): UseQuestionGeneratorResult {
  const { getToken } = useAuth()
  const abortControllerRef = useRef<AbortController | null>(null)
  
  const [isGenerating, setIsGenerating] = useState(false)
  const [thinkingSteps, setThinkingSteps] = useState<string[]>([])
  const [sources, setSources] = useState<Array<{ id: string; title: string; excerpt: string; url?: string }>>([])
  const [questions, setQuestions] = useState<GeneratedQuestion[]>([])
  const [currentContent, setCurrentContent] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [progress, setProgress] = useState({ current: 0, total: 0 })

  const startGeneration = useCallback(async (config: GenerationConfig) => {
    // Clear previous state
    setThinkingSteps([])
    setSources([])
    setQuestions([])
    setCurrentContent('')
    setError(null)
    setIsGenerating(true)
    setProgress({ current: 0, total: config.question_count })
    
    // Create abort controller
    abortControllerRef.current = new AbortController()
    
    try {
      const token = await getToken()
      
      const response = await fetch(`${API_BASE}/question-generator/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(config),
        signal: abortControllerRef.current.signal,
      })
      
      if (!response.ok) {
        throw new Error(`Generation failed: ${response.statusText}`)
      }
      
      const reader = response.body?.getReader()
      if (!reader) throw new Error('No response body')
      
      const decoder = new TextDecoder()
      let buffer = ''
      
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        
        for (const line of lines) {
          if (line.startsWith('event:')) {
            continue // Skip event type line, we get it from data
          }
          if (line.startsWith('data:')) {
            try {
              const data: StreamEvent = JSON.parse(line.slice(5).trim())
              handleEvent(data)
            } catch (e) {
              console.warn('Failed to parse SSE data:', line)
            }
          }
        }
      }
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        setError(e.message || 'Generation failed')
      }
    } finally {
      setIsGenerating(false)
      abortControllerRef.current = null
    }
  }, [getToken])

  const handleEvent = useCallback((event: StreamEvent) => {
    switch (event.event_type) {
      case 'agent:thinking':
      case 'agent:action':
        if (event.step) {
          setThinkingSteps(prev => [...prev, event.step!])
        }
        break

      case 'generation:start':
        setSessionId(event.session_id || null)
        setProgress({ current: 0, total: event.total_questions || 0 })
        break

      case 'source:found':
        if (event.source_id && event.source_title) {
          setSources(prev => [...prev, {
            id: event.source_id!,
            title: event.source_title!,
            excerpt: event.source_excerpt || ''
          }])
        }
        break

      case 'generation:chunk':
        if (event.content) {
          setCurrentContent(prev => prev + event.content)
        }
        break

      case 'generation:question_complete':
        if (event.question_data) {
          setQuestions(prev => [...prev, event.question_data as GeneratedQuestion])
          setCurrentContent('')
          setProgress(prev => ({ ...prev, current: prev.current + 1 }))
        }
        break

      case 'error:message':
        setError(event.error_message || 'Unknown error')
        break

      case 'done':
        setIsGenerating(false)
        break
    }
  }, [])

  const stopGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      setIsGenerating(false)
    }
  }, [])

  const clearResults = useCallback(() => {
    setThinkingSteps([])
    setSources([])
    setQuestions([])
    setCurrentContent('')
    setError(null)
    setSessionId(null)
    setProgress({ current: 0, total: 0 })
  }, [])

  return {
    isGenerating,
    thinkingSteps,
    sources,
    questions,
    currentContent,
    error,
    sessionId,
    progress,
    startGeneration,
    stopGeneration,
    clearResults,
  }
}

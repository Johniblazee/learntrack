import { useState, useCallback, useEffect } from 'react'
import { motion } from 'motion/react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Settings, Sparkles } from 'lucide-react'
import { useAuth } from '@clerk/clerk-react'
import { toast } from '@/contexts/ToastContext'
import { cn } from '@/lib/utils'
import { API_BASE_URL } from '@/lib/config'
import { QUESTION_TYPES, DIFFICULTIES } from '@/lib/constants'
import { ChatPanel, ChatMessage } from './ChatPanel'
import { SettingsModal, GenerationSettings, GenerationSourceOption } from './SettingsModal'

import { QuestionCanvas } from './QuestionCanvas'
import { GeneratedQuestion, StreamEvent } from './types'

// Types
interface Session {
  session_id: string
  prompt: string
  created_at: string
  updated_at?: string
  status: 'completed' | 'failed' | 'in_progress' | 'pending'
  question_count: number
  approved_count: number
  pending_count: number
  rejected_count: number
}

interface ChatApiResponse {
  response: string
  ready_to_generate?: boolean
  missing_fields?: string[]
  session_id?: string
}

interface SessionSnapshot {
  questions: GeneratedQuestion[]
  chatMessages: ChatMessage[]
}

interface LibraryItem {
  id: string
  filename: string
  content_type: string
  status: string
  embedding_status: string
  topic?: string | null
  subject_id?: string | null
}

export function OpenCanvasGenerator() {
  const { getToken } = useAuth()

  // Settings state
  const [settings, setSettings] = useState<GenerationSettings>({
    subject: '',
    topic: '',
    questionCount: 3,
    questionTypes: [QUESTION_TYPES.MULTIPLE_CHOICE],
    difficulty: DIFFICULTIES.MEDIUM,
    aiProvider: 'groq',
    modelName: 'llama-3.3-70b-versatile',
    bloomsLevels: [],
    materialIds: [],
  })
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [availableSources, setAvailableSources] = useState<GenerationSourceOption[]>([])
  const [isSourcesLoading, setIsSourcesLoading] = useState(false)

  // Generation state
  const [isGenerating, setIsGenerating] = useState(false)
  const [isChatResponding, setIsChatResponding] = useState(false)
  const [questions, setQuestions] = useState<GeneratedQuestion[]>([])
  const [streamingContent, setStreamingContent] = useState('')
  const [selectedQuestionId, setSelectedQuestionId] = useState<string | null>(null)
  const [generationProgressCurrent, setGenerationProgressCurrent] = useState(0)

  // Chat state
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])

  // Session state
  const [sessions, setSessions] = useState<Session[]>([])
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
  const [sessionSnapshots, setSessionSnapshots] = useState<Record<string, SessionSnapshot>>({})
  const [isDeletingSessions, setIsDeletingSessions] = useState(false)

  // Fetch AI defaults from settings on mount
  useEffect(() => {
    const fetchAIDefaults = async () => {
      try {
        const token = await getToken()
        const response = await fetch(`${API_BASE_URL}/settings/ai/defaults`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (response.ok) {
          const data = await response.json()
          setSettings(prev => ({
            ...prev,
            aiProvider: data.default_provider || 'groq',
            modelName: data.default_model || 'llama-3.3-70b-versatile',
          }))
        }
      } catch (error) {
        console.error('Failed to fetch AI defaults:', error)
      }
    }
    fetchAIDefaults()
  }, [getToken])

  const fetchAvailableSources = useCallback(async () => {
    try {
      setIsSourcesLoading(true)
      const token = await getToken()
      const response = await fetch(`${API_BASE_URL}/rag/library`, {
        headers: { Authorization: `Bearer ${token}` },
      })

      if (!response.ok) {
        throw new Error('Failed to load generation sources')
      }

      const data = (await response.json()) as LibraryItem[]
      const sourceOptions = (Array.isArray(data) ? data : [])
        .filter((item) => item.status === 'processed' || item.embedding_status === 'completed')
        .map((item) => ({
          id: item.id,
          title: item.filename,
          subtitle: [
            item.embedding_status === 'completed' ? 'Embedded and ready' : 'Processed and ready',
            item.topic || item.subject_id || item.content_type,
          ]
            .filter(Boolean)
            .join(' • '),
        }))

      setAvailableSources(sourceOptions)
    } catch (error) {
      console.error('Failed to load generation sources:', error)
    } finally {
      setIsSourcesLoading(false)
    }
  }, [getToken])

  useEffect(() => {
    void fetchAvailableSources()
  }, [fetchAvailableSources])

  useEffect(() => {
    if (isSettingsOpen) {
      void fetchAvailableSources()
    }
  }, [fetchAvailableSources, isSettingsOpen])

  // Fetch sessions
  const fetchSessions = useCallback(async () => {
    try {
      const token = await getToken()
      const response = await fetch(`${API_BASE_URL}/question-generator/sessions?per_page=100`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (response.ok) {
        const data = await response.json()
        setSessions(data.items || [])  // Fixed: backend returns 'items', not 'sessions'
      }
    } catch (error) {
      console.error('Failed to fetch sessions:', error)
    }
  }, [getToken])

  // Load sessions on mount
  useEffect(() => {
    fetchSessions()
  }, [fetchSessions])

  const getErrorDetail = async (response: Response, fallback: string): Promise<string> => {
    try {
      const data = await response.json()
      if (typeof data?.detail === 'string' && data.detail.trim()) {
        return data.detail
      }
      if (typeof data?.error === 'string' && data.error.trim()) {
        return data.error
      }
    } catch {
      // ignore JSON parsing errors
    }
    return fallback
  }

  const mapPersistedChatMessages = useCallback((messages: any[] = []): ChatMessage[] => {
    return messages.map((message: any) => ({
      id: String(message.id || `msg-${Date.now()}-${Math.random()}`),
      role: (message.role || 'assistant') as ChatMessage['role'],
      content: String(message.content || ''),
      referencedQuestionId: message.referenced_question_id || message.referencedQuestionId,
      timestamp: message.timestamp ? new Date(message.timestamp) : new Date(),
    }))
  }, [])

  const buildGenerationPrompt = useCallback((instruction?: string): string | null => {
    const trimmedInstruction = instruction?.trim() || ''
    if (!trimmedInstruction && !settings.subject && !settings.topic) {
      return null
    }

    const lines = [
      `Generate ${settings.questionCount} question(s).`,
      `Difficulty: ${settings.difficulty}.`,
      `Question types: ${settings.questionTypes.join(', ')}.`,
      `Subject: ${settings.subject || 'not specified'}.`,
      `Topic: ${settings.topic || 'not specified'}.`,
    ]

    if (settings.bloomsLevels.length > 0) {
      lines.push(`Bloom levels: ${settings.bloomsLevels.join(', ')}.`)
    }

    if (settings.materialIds.length > 0) {
      lines.push(`Use attached material IDs: ${settings.materialIds.join(', ')}.`)
    }

    if (trimmedInstruction) {
      lines.push(`Tutor instruction: ${trimmedInstruction}`)
    }

    return lines.join('\n')
  }, [
    settings.questionCount,
    settings.difficulty,
    settings.questionTypes,
    settings.subject,
    settings.topic,
    settings.bloomsLevels,
    settings.materialIds,
  ])

  const hasGenerateIntent = useCallback((message: string) => {
    return /\b(generate|create|make|draft|produce|build|start)\b/i.test(message)
  }, [])

  const runGeneration = useCallback(async (explicitPrompt?: string) => {
    if (isGenerating || isChatResponding) return

    const generationPrompt = buildGenerationPrompt(explicitPrompt)
    if (!generationPrompt) {
      toast.error('Add requirements in chat or set subject/topic before generating')
      return
    }

    setIsGenerating(true)
    setStreamingContent('')
    setGenerationProgressCurrent(0)

    try {
      const token = await getToken()
      const bloomsLevels = settings.bloomsLevels.length > 0
        ? settings.bloomsLevels.map(level => level.toUpperCase())
        : undefined

      const response = await fetch(`${API_BASE_URL}/question-generator/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          prompt: generationPrompt,
          question_count: settings.questionCount,
          question_types: settings.questionTypes,
          difficulty: settings.difficulty,
          subject: settings.subject,
          topic: settings.topic,
          blooms_levels: bloomsLevels,
          material_ids: settings.materialIds,
          ai_provider: settings.aiProvider,
          model_name: settings.modelName,
          session_id: currentSessionId,
        }),
      })

      if (!response.ok) {
        throw new Error(await getErrorDetail(response, 'Failed to generate questions'))
      }

      const reader = response.body?.getReader()
      if (!reader) throw new Error('No response body')

      const decoder = new TextDecoder()
      let assistantContent = ''
      let buffer = ''
      let sessionId: string | null = currentSessionId
      let appendedCount = 0

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue

          const data = JSON.parse(line.slice(6)) as StreamEvent

          if (data.event_type === 'error:message') {
            throw new Error(data.error_message || 'Question generation failed')
          }

          if (data.event_type === 'session:created' && data.session_id) {
            sessionId = data.session_id
            setCurrentSessionId(sessionId)
          } else if (data.event_type === 'agent:thinking' && data.step) {
            assistantContent += `💭 ${data.step}\n`
          } else if (data.event_type === 'agent:action' && data.step) {
            assistantContent += `⚡ ${data.step}\n`
          } else if (data.event_type === 'generation:chunk' && data.content) {
            setStreamingContent(prev => prev + data.content)
          } else if (data.event_type === 'generation:question_complete' && data.question_data) {
            const question = {
              ...data.question_data,
              session_id: sessionId || undefined,
              status: 'pending' as const,
            }
            appendedCount += 1
            setGenerationProgressCurrent(appendedCount)
            setQuestions(prev => [...prev, question])
            setStreamingContent('')
          }

          setChatMessages(prev => {
            const lastMsg = prev[prev.length - 1]
            if (lastMsg?.role === 'assistant' && lastMsg.isStreaming) {
              return [...prev.slice(0, -1), { ...lastMsg, content: assistantContent || 'Generating...' }]
            }
            return [...prev, {
              id: `assistant-${Date.now()}`,
              role: 'assistant',
              content: assistantContent || 'Generating...',
              timestamp: new Date(),
              isStreaming: true,
            }]
          })
        }
      }

      setChatMessages(prev => {
        const lastMsg = prev[prev.length - 1]
        if (lastMsg?.role === 'assistant') {
          return [...prev.slice(0, -1), {
            ...lastMsg,
            content: assistantContent || `Generated ${appendedCount} question(s).`,
            isStreaming: false,
          }]
        }
        return prev
      })

      await fetchSessions()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to generate questions'
      console.error('Generate error:', error)
      toast.error(message)
    } finally {
      setIsGenerating(false)
      setStreamingContent('')
      setGenerationProgressCurrent(0)
    }
  }, [
    isGenerating,
    isChatResponding,
    buildGenerationPrompt,
    getToken,
    settings,
    currentSessionId,
    fetchSessions,
    setGenerationProgressCurrent,
  ])

  // Handle chat message (for refining/updating questions)
  const handleSendMessage = useCallback(async (message: string, referencedQuestionId?: string) => {
    if (isGenerating || isChatResponding) return

    // Add user message
    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: message,
      timestamp: new Date(),
      referencedQuestionId,
    }
    setChatMessages(prev => [...prev, userMessage])

    // Clear selection after sending
    setSelectedQuestionId(null)

    let pendingAssistantId: string | null = null

    try {
      const token = await getToken()

      if (referencedQuestionId) {
        const targetQuestion = questions.find(question => question.question_id === referencedQuestionId)
        const sessionIdForEdit = currentSessionId || targetQuestion?.session_id

        if (!sessionIdForEdit) {
          throw new Error('Missing session context for question edit')
        }

        setIsGenerating(true)
        setStreamingContent('')

        const response = await fetch(`${API_BASE_URL}/question-generator/edit?session_id=${sessionIdForEdit}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            question_id: referencedQuestionId,
            edit_instruction: message,
          }),
        })

        if (!response.ok) {
          throw new Error(await getErrorDetail(response, 'Failed to update question'))
        }

        const reader = response.body?.getReader()
        if (!reader) throw new Error('No response body')

        const decoder = new TextDecoder()
        let assistantContent = ''
        let buffer = ''
        let updatedQuestion = false

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue

            try {
              const data = JSON.parse(line.slice(6)) as StreamEvent

              if (data.event_type === 'error:message') {
                throw new Error(data.error_message || 'Question edit failed')
              }

              if (data.event_type === 'agent:thinking' && data.step) {
                assistantContent += `💭 ${data.step}\n`
              } else if (data.event_type === 'agent:action' && data.step) {
                assistantContent += `⚡ ${data.step}\n`
              } else if (data.event_type === 'generation:question_complete' && data.question_data) {
                const editedQuestion = data.question_data
                updatedQuestion = true

                setQuestions(prev => {
                  const index = prev.findIndex(q => q.question_id === referencedQuestionId)
                  if (index === -1) return prev

                  const previousQuestion = prev[index]
                  const versions = [...(previousQuestion.versions || []), previousQuestion]
                  const updated = {
                    ...previousQuestion,
                    ...editedQuestion,
                    status: 'pending' as const,
                    versions,
                    currentVersionIndex: versions.length,
                  }

                  const next = [...prev]
                  next[index] = updated
                  return next
                })
              }

              setChatMessages(prev => {
                const lastMsg = prev[prev.length - 1]
                if (lastMsg?.role === 'assistant' && lastMsg.isStreaming) {
                  return [...prev.slice(0, -1), { ...lastMsg, content: assistantContent || 'Updating question...' }]
                }
                return [...prev, {
                  id: `assistant-${Date.now()}`,
                  role: 'assistant',
                  content: assistantContent || 'Updating question...',
                  timestamp: new Date(),
                  isStreaming: true,
                  referencedQuestionId,
                }]
              })
            } catch (streamError) {
              if (streamError instanceof SyntaxError) {
                console.warn('Failed to parse edit stream event:', line)
                continue
              }
              throw streamError
            }
          }
        }

        setChatMessages(prev => {
          const lastMsg = prev[prev.length - 1]
          if (lastMsg?.role === 'assistant') {
            return [...prev.slice(0, -1), {
              ...lastMsg,
              content: assistantContent || (updatedQuestion
                ? 'Updated the referenced question and saved a new version.'
                : 'Edit completed.'),
              isStreaming: false,
            }]
          }
          return prev
        })

        await fetchSessions()
      } else {
        setIsChatResponding(true)
        const chatPendingId = `assistant-pending-${Date.now()}`
        pendingAssistantId = chatPendingId
        setChatMessages(prev => [...prev, {
          id: chatPendingId,
          role: 'assistant',
          content: 'Thinking...',
          timestamp: new Date(),
          isStreaming: true,
        }])

        const historyPayload = [...chatMessages, userMessage]
          .slice(-10)
          .map(chat => ({ role: chat.role, content: chat.content }))

        const response = await fetch(`${API_BASE_URL}/question-generator/chat`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            session_id: currentSessionId,
            message,
            history: historyPayload,
            question_count: settings.questionCount,
            question_types: settings.questionTypes,
            difficulty: settings.difficulty,
            subject: settings.subject,
            topic: settings.topic,
            ai_provider: settings.aiProvider,
            model_name: settings.modelName,
          }),
        })

        if (!response.ok) {
          throw new Error(await getErrorDetail(response, 'Failed to send chat message'))
        }

        const data = await response.json() as ChatApiResponse
        if (data.session_id) {
          setCurrentSessionId(data.session_id)
        }

        setChatMessages(prev => prev.map(chatMessage => {
          if (chatMessage.id !== pendingAssistantId) {
            return chatMessage
          }

          return {
            ...chatMessage,
            content: data.response || 'Could you share a bit more detail?',
            isStreaming: false,
            timestamp: new Date(),
          }
        }))

        const shouldAutoGenerate = Boolean(data.ready_to_generate) && hasGenerateIntent(message)
        if (shouldAutoGenerate) {
          await runGeneration(message)
        }
      }

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to send message'
      if (pendingAssistantId) {
        setChatMessages(prev => prev.map(chatMessage => {
          if (chatMessage.id !== pendingAssistantId) {
            return chatMessage
          }

          return {
            ...chatMessage,
            content: 'Sorry, I ran into an issue responding. Please try again.',
            isStreaming: false,
            timestamp: new Date(),
          }
        }))
      }
      console.error('Question generator chat error:', error)
      toast.error(message)
    } finally {
      setIsGenerating(false)
      setIsChatResponding(false)
      setStreamingContent('')
    }
  }, [
    isGenerating,
    isChatResponding,
    chatMessages,
    getToken,
    currentSessionId,
    questions,
    runGeneration,
    hasGenerateIntent,
    settings,
    fetchSessions,
  ])

  // Handle question actions
  const handleApprove = useCallback(async (questionId: string) => {
    const target = questions.find(q => q.question_id === questionId)
    const sessionId = target?.session_id || currentSessionId
    if (!sessionId) {
      toast.error('Unable to approve: missing session context')
      return
    }

    setQuestions(prev => prev.map(q =>
      q.question_id === questionId ? { ...q, status: 'approved' } : q
    ))

    try {
      const token = await getToken()
      const response = await fetch(
        `${API_BASE_URL}/question-generator/sessions/${sessionId}/questions/${questionId}/approve`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        }
      )

      if (!response.ok) {
        throw new Error('approve failed')
      }

      toast.success('Question approved')
      await fetchSessions()
    } catch (error) {
      setQuestions(prev => prev.map(q =>
        q.question_id === questionId ? { ...q, status: 'pending' } : q
      ))
      console.error('Approve error:', error)
      toast.error('Failed to approve question')
    }
  }, [questions, currentSessionId, getToken, fetchSessions])

  const handleReject = useCallback(async (questionId: string) => {
    const target = questions.find(q => q.question_id === questionId)
    const sessionId = target?.session_id || currentSessionId
    if (!sessionId) {
      toast.error('Unable to reject: missing session context')
      return
    }

    setQuestions(prev => prev.map(q =>
      q.question_id === questionId ? { ...q, status: 'rejected' } : q
    ))

    try {
      const token = await getToken()
      const response = await fetch(
        `${API_BASE_URL}/question-generator/sessions/${sessionId}/questions/${questionId}/reject`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        }
      )

      if (!response.ok) {
        throw new Error('reject failed')
      }

      toast.success('Question rejected')
      await fetchSessions()
    } catch (error) {
      setQuestions(prev => prev.map(q =>
        q.question_id === questionId ? { ...q, status: 'pending' } : q
      ))
      console.error('Reject error:', error)
      toast.error('Failed to reject question')
    }
  }, [questions, currentSessionId, getToken, fetchSessions])

  const handleDelete = useCallback((questionId: string) => {
    setQuestions(prev => prev.filter(q => q.question_id !== questionId))
    if (selectedQuestionId === questionId) {
      setSelectedQuestionId(null)
    }
    toast.success('Question deleted')
  }, [selectedQuestionId])

  const handleApproveAll = useCallback(async () => {
    const pendingQuestions = questions.filter(q => (q.status ?? 'pending') !== 'approved')
    if (pendingQuestions.length === 0) {
      toast.success('All questions are already approved')
      return
    }

    const snapshot = questions
    setQuestions(prev => prev.map(q => ({ ...q, status: 'approved' })))

    try {
      const token = await getToken()
      await Promise.all(
        pendingQuestions.map(async q => {
          const sessionId = q.session_id || currentSessionId
          if (!sessionId) {
            throw new Error('Missing session context for one or more questions')
          }

          const response = await fetch(
            `${API_BASE_URL}/question-generator/sessions/${sessionId}/questions/${q.question_id}/approve`,
            {
              method: 'POST',
              headers: { Authorization: `Bearer ${token}` },
            }
          )

          if (!response.ok) {
            throw new Error(`Failed to approve question ${q.question_id}`)
          }
        })
      )

      toast.success('All questions approved')
      await fetchSessions()
    } catch (error) {
      setQuestions(snapshot)
      console.error('Approve all error:', error)
      toast.error('Failed to approve all questions')
    }
  }, [questions, getToken, currentSessionId, fetchSessions])

  // Handle clearing chat
  const handleClearChat = useCallback(() => {
    setChatMessages([])
  }, [])

  // Handle new conversation
  const handleNewConversation = useCallback(() => {
    if (currentSessionId) {
      setSessionSnapshots((previous) => ({
        ...previous,
        [currentSessionId]: {
          questions,
          chatMessages,
        },
      }))
    }

    setChatMessages([])
    setCurrentSessionId(null)
    setQuestions([])
    setStreamingContent('')
    setGenerationProgressCurrent(0)
    setSelectedQuestionId(null)
    toast.success('Started new conversation')
  }, [currentSessionId, questions, chatMessages])

  const handleDeleteSessions = useCallback(async (sessionIds: string[]) => {
    const uniqueSessionIds = Array.from(new Set(sessionIds.filter(Boolean)))
    if (uniqueSessionIds.length === 0) {
      return
    }

    setIsDeletingSessions(true)

    try {
      const token = await getToken()
      const deletionResults = await Promise.allSettled(
        uniqueSessionIds.map(async (sessionId) => {
          const response = await fetch(`${API_BASE_URL}/question-generator/sessions/${sessionId}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` },
          })

          if (!response.ok) {
            throw new Error(`Delete failed for session ${sessionId}`)
          }

          return sessionId
        })
      )

      const deletedSessionIds = deletionResults
        .filter((result): result is PromiseFulfilledResult<string> => result.status === 'fulfilled')
        .map((result) => result.value)
      const failedDeletes = deletionResults.length - deletedSessionIds.length

      if (deletedSessionIds.length > 0) {
        setSessions((previous) => previous.filter((session) => !deletedSessionIds.includes(session.session_id)))
        setSessionSnapshots((previous) => {
          const next = { ...previous }
          deletedSessionIds.forEach((sessionId) => {
            delete next[sessionId]
          })
          return next
        })

        if (currentSessionId && deletedSessionIds.includes(currentSessionId)) {
          setCurrentSessionId(null)
          setQuestions([])
          setStreamingContent('')
          setGenerationProgressCurrent(0)
          setChatMessages([])
          setSelectedQuestionId(null)
        }
      }

      await fetchSessions()

      if (deletedSessionIds.length > 0 && failedDeletes === 0) {
        toast.success(
          deletedSessionIds.length === 1
            ? 'Conversation deleted'
            : `${deletedSessionIds.length} conversations deleted`
        )
      } else if (deletedSessionIds.length > 0 && failedDeletes > 0) {
        toast.warning(
          `${deletedSessionIds.length} conversation(s) deleted, ${failedDeletes} failed. Try again for the remaining items.`
        )
      } else {
        toast.error('Failed to delete selected conversation(s)')
      }
    } catch (error) {
      console.error('Delete sessions error:', error)
      toast.error('Failed to delete selected conversation(s)')
    } finally {
      setIsDeletingSessions(false)
    }
  }, [currentSessionId, fetchSessions, getToken])

  // Handle delete conversation
  const handleDeleteConversation = useCallback(async () => {
    if (!currentSessionId) {
      toast.error('No active conversation to delete')
      return
    }

    await handleDeleteSessions([currentSessionId])
  }, [currentSessionId, handleDeleteSessions])

  // Handle switch session
  const handleSwitchSession = useCallback(async (sessionId: string) => {
    if (!sessionId) {
      return
    }

    if (currentSessionId && currentSessionId !== sessionId) {
      setSessionSnapshots((previous) => ({
        ...previous,
        [currentSessionId]: {
          questions,
          chatMessages,
        },
      }))
    }

    const cachedSession = sessionSnapshots[sessionId]
    setCurrentSessionId(sessionId)

    if (cachedSession) {
      setQuestions(cachedSession.questions)
      setChatMessages(cachedSession.chatMessages)
    }

    setIsGenerating(true)

    try {
      const token = await getToken()
      const response = await fetch(`${API_BASE_URL}/question-generator/sessions/${sessionId}`, {
        headers: { Authorization: `Bearer ${token}` },
      })

      if (response.ok) {
        const data = await response.json()

        const loadedQuestions: GeneratedQuestion[] = Array.isArray(data.questions)
          ? data.questions
          : cachedSession?.questions || []

        const loadedChatMessages: ChatMessage[] = Array.isArray(data.chat_messages)
          ? mapPersistedChatMessages(data.chat_messages)
          : data.original_prompt
            ? [{
                id: `legacy-${sessionId}-prompt`,
                role: 'user',
                content: data.original_prompt,
                timestamp: data.created_at ? new Date(data.created_at) : new Date(),
              }]
            : cachedSession?.chatMessages || []

        setQuestions(loadedQuestions)
        setChatMessages(loadedChatMessages)

        setSessionSnapshots((previous) => ({
          ...previous,
          [sessionId]: {
            questions: loadedQuestions,
            chatMessages: loadedChatMessages,
          },
        }))
      } else {
        toast.error('Failed to load session')
      }
    } catch (error) {
      console.error('Load session error:', error)
      toast.error('Failed to load session')
    } finally {
      setIsGenerating(false)
    }
  }, [
    currentSessionId,
    questions,
    chatMessages,
    getToken,
    mapPersistedChatMessages,
    sessionSnapshots,
  ])

  // Handle request regenerate from QuestionCard
  const handleRequestRegenerate = useCallback((questionId: string, _defaultMessage: string) => {
    setSelectedQuestionId(questionId)
    toast.success('Question selected for regeneration. Add your instructions in chat.')
  }, [])

  const handleExport = useCallback(() => {
    if (questions.length === 0) {
      return
    }

    const payload = {
      exported_at: new Date().toISOString(),
      session_id: currentSessionId,
      questions,
    }

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `question-generator-${new Date().toISOString().slice(0, 10)}.json`
    link.click()
    URL.revokeObjectURL(url)
  }, [questions, currentSessionId])

  // Convert sessions to ChatSession format
  const chatSessions = sessions
    .map((session) => ({
      id: session.session_id,
      title: session.prompt.slice(0, 120) || 'Untitled Session',
      createdAt: new Date(session.created_at),
      updatedAt: new Date(session.updated_at || session.created_at),
      messageCount: session.question_count,
      preview: `${session.approved_count} approved, ${session.pending_count} pending`,
    }))
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())

  return (
    <div className="flex flex-col h-[calc(100vh-120px)] bg-background">
      {/* Header Bar */}
      <div className="flex items-center justify-between px-6 py-3 border-b bg-muted/30">
        <div className="flex items-center gap-4">
          <h1 className="text-lg font-semibold">AI Question Generator</h1>
          {settings.subject && (
            <Badge variant="secondary" className="font-normal">
              {settings.subject}
            </Badge>
          )}
          {settings.topic && (
            <Badge variant="outline" className="font-normal">
              {settings.topic}
            </Badge>
          )}
          {settings.difficulty && (
            <Badge
              variant="secondary"
              className={cn(
                "font-normal",
                settings.difficulty === 'easy' && "bg-green-100 text-green-700",
                settings.difficulty === 'medium' && "bg-amber-100 text-amber-700",
                settings.difficulty === 'hard' && "bg-red-100 text-red-700",
              )}
            >
              {settings.difficulty.charAt(0).toUpperCase() + settings.difficulty.slice(1)}
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-2">

          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsSettingsOpen(true)}
            className="gap-2"
          >
            <Settings className="h-4 w-4" />
            Adjust Parameters
          </Button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Chat Panel (Left - 30%) */}
        <div className="w-[30%] border-r overflow-hidden">
          <ChatPanel
            messages={chatMessages}
            isStreaming={isGenerating || isChatResponding}
            onSendMessage={handleSendMessage}
            onClearChat={handleClearChat}
            selectedQuestionId={selectedQuestionId}
            sessions={chatSessions}
            currentSessionId={currentSessionId || undefined}
            onNewConversation={handleNewConversation}
            onDeleteConversation={handleDeleteConversation}
            onDeleteSessions={handleDeleteSessions}
            isDeletingSessions={isDeletingSessions}
            onSwitchSession={handleSwitchSession}
            settings={{
              aiProvider: settings.aiProvider,
              modelName: settings.modelName,
            }}
          />
        </div>

        {/* Questions Panel (Right - 70%) */}
        <div className="w-[70%] overflow-hidden flex flex-col">
          {questions.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center">
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex flex-col items-center justify-center py-20 text-center"
              >
                <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
                  <Sparkles className="h-8 w-8 text-muted-foreground" />
                </div>
                <h3 className="text-lg font-semibold mb-2">No questions yet</h3>
                <p className="text-sm text-muted-foreground max-w-sm mb-6">
                  Configure your settings and generate questions, or start chatting with the AI assistant.
                </p>
                <Button
                  onClick={() => setIsSettingsOpen(true)}
                  className="bg-[#5c4a38] hover:bg-[#4a3c2e]"
                >
                  <Sparkles className="h-4 w-4 mr-2" />
                  Start Generating
                </Button>
              </motion.div>
            </div>
          ) : (
            <QuestionCanvas
              isGenerating={isGenerating}
              currentAction={isGenerating ? 'Generating questions...' : null}
              thinkingSteps={[]}
              progress={{
                current: isGenerating ? generationProgressCurrent : questions.length,
                total: settings.questionCount,
              }}
              foundSources={[]}
              questions={questions}
              streamingContent={streamingContent}
              onApprove={handleApprove}
              onReject={handleReject}
              onDelete={handleDelete}
              onApproveAll={handleApproveAll}
              onExport={handleExport}
              onRequestRegenerate={handleRequestRegenerate}
            />
          )}
        </div>
      </div>

      {/* Settings Modal */}
      <SettingsModal
        open={isSettingsOpen}
        onOpenChange={setIsSettingsOpen}
        settings={settings}
        onSettingsChange={setSettings}
        availableSources={availableSources}
        isSourcesLoading={isSourcesLoading}
      />
    </div>
  )
}

export default OpenCanvasGenerator

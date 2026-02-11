import { useState, useCallback, useEffect } from 'react'
import { motion } from 'motion/react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Settings, Sparkles, CheckCircle } from 'lucide-react'
import { useAuth } from '@clerk/clerk-react'
import { toast } from '@/contexts/ToastContext'
import { cn } from '@/lib/utils'
import { API_BASE_URL } from '@/lib/config'
import { ChatPanel, ChatMessage } from './ChatPanel'
import { SettingsModal, GenerationSettings } from './SettingsModal'

import { QuestionCanvas } from './QuestionCanvas'
import { GeneratedQuestion, StreamEvent } from './types'

// Types
interface Session {
  session_id: string
  prompt: string
  created_at: string
  status: 'completed' | 'failed' | 'in_progress' | 'pending'
  question_count: number
  approved_count: number
  pending_count: number
  rejected_count: number
}

export function OpenCanvasGenerator() {
  const { getToken } = useAuth()

  // Settings state
  const [settings, setSettings] = useState<GenerationSettings>({
    subject: '',
    topic: '',
    questionCount: 3,
    questionTypes: ['multiple-choice'],
    difficulty: 'medium',
    aiProvider: 'groq',
    modelName: 'llama-3.3-70b-versatile',
    bloomsLevels: [],
    materialIds: [],
  })
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)

  // Generation state
  const [isGenerating, setIsGenerating] = useState(false)
  const [isSavingToBank, setIsSavingToBank] = useState(false)
  const [questions, setQuestions] = useState<GeneratedQuestion[]>([])
  const [streamingContent, setStreamingContent] = useState('')
  const [selectedQuestionId, setSelectedQuestionId] = useState<string | null>(null)

  // Chat state
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])

  // Session state
  const [sessions, setSessions] = useState<Session[]>([])
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)

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

  // Fetch sessions
  const fetchSessions = useCallback(async () => {
    try {
      const token = await getToken()
      const response = await fetch(`${API_BASE_URL}/question-generator/sessions`, {
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

  // Handle chat message (for refining/updating questions)
  const handleSendMessage = useCallback(async (message: string, referencedQuestionId?: string) => {
    if (isGenerating) return

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

    setIsGenerating(true)
    setStreamingContent('')

    try {
      const token = await getToken()
      if (referencedQuestionId && currentSessionId) {
        const response = await fetch(`${API_BASE_URL}/question-generator/edit?session_id=${currentSessionId}`, {
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

        if (!response.ok) throw new Error('Update failed')

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
            } catch {
              console.warn('Failed to parse edit stream event:', line)
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
        const response = await fetch(`${API_BASE_URL}/question-generator/generate`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            prompt: message,
            question_count: settings.questionCount,
            question_types: settings.questionTypes,
            difficulty: settings.difficulty,
            subject: settings.subject,
            topic: settings.topic,
            blooms_levels: settings.bloomsLevels,
            material_ids: settings.materialIds,
            ai_provider: settings.aiProvider,
          }),
        })

        if (!response.ok) throw new Error('Update failed')

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

            try {
              const data = JSON.parse(line.slice(6)) as StreamEvent

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
            } catch {
              console.warn('Failed to parse update stream event:', line)
            }
          }
        }

        setChatMessages(prev => {
          const lastMsg = prev[prev.length - 1]
          if (lastMsg?.role === 'assistant') {
            return [...prev.slice(0, -1), {
              ...lastMsg,
              content: assistantContent || `Generated ${appendedCount} follow-up question(s).`,
              isStreaming: false,
            }]
          }
          return prev
        })

        await fetchSessions()
      }

    } catch (error) {
      console.error('Update error:', error)
      toast.error('Failed to update question')
    } finally {
      setIsGenerating(false)
      setStreamingContent('')
    }
  }, [
    isGenerating,
    questions.length,
    chatMessages,
    getToken,
    currentSessionId,
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
    setChatMessages([])
    setCurrentSessionId(null)
    setQuestions([])
    setStreamingContent('')
    setSelectedQuestionId(null)
    toast.success('Started new conversation')
  }, [])

  // Handle delete conversation
  const handleDeleteConversation = useCallback(async () => {
    if (!currentSessionId) {
      toast.error('No active conversation to delete')
      return
    }

    try {
      const token = await getToken()
      const response = await fetch(`${API_BASE_URL}/question-generator/sessions/${currentSessionId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (response.ok) {
        setSessions(prev => prev.filter(s => s.session_id !== currentSessionId))
        setCurrentSessionId(null)
        setQuestions([])
        setStreamingContent('')
        setChatMessages([])
        toast.success('Conversation deleted')
      } else {
        toast.error('Failed to delete conversation')
      }
    } catch (error) {
      console.error('Delete error:', error)
      toast.error('Failed to delete conversation')
    }
  }, [currentSessionId, getToken])

  // Handle switch session
  const handleSwitchSession = useCallback(async (sessionId: string) => {
    setCurrentSessionId(sessionId)
    setIsGenerating(true)
    try {
      const token = await getToken()
      const response = await fetch(`${API_BASE_URL}/question-generator/sessions/${sessionId}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (response.ok) {
        const data = await response.json()
        if (data.questions) {
          setQuestions(data.questions)
        }
        if (Array.isArray(data.messages)) {
          setChatMessages(data.messages.map((message: any) => ({
            ...message,
            timestamp: message.timestamp ? new Date(message.timestamp) : new Date(),
          })))
        } else {
          setChatMessages([])
        }
        toast.success('Session loaded')
      } else {
        toast.error('Failed to load session')
      }
    } catch (error) {
      console.error('Load session error:', error)
      toast.error('Failed to load session')
    } finally {
      setIsGenerating(false)
    }
  }, [getToken])

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

  const handleSaveToQuestionBank = useCallback(async () => {
    if (!currentSessionId) {
      toast.error('Save failed: no active session')
      return
    }

    setIsSavingToBank(true)
    try {
      const token = await getToken()
      const response = await fetch(
        `${API_BASE_URL}/question-generator/sessions/${currentSessionId}/save-to-question-bank`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({}),
        }
      )

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data?.detail || 'Failed to save questions')
      }

      const failedCount = Array.isArray(data.failed_items) ? data.failed_items.length : 0
      if (failedCount > 0) {
        toast.error(`Saved ${data.saved_count}, failed ${failedCount}. Check session subject/topic mappings.`)
      } else {
        toast.success(`Saved ${data.saved_count} question(s) to question bank`)
      }
    } catch (error) {
      console.error('Save to bank error:', error)
      toast.error('Failed to save approved questions to question bank')
    } finally {
      setIsSavingToBank(false)
    }
  }, [currentSessionId, getToken])

  // Convert sessions to ChatSession format
  const chatSessions = sessions.map(session => ({
    id: session.session_id,
    title: session.prompt.slice(0, 60) || 'Untitled Session',
    createdAt: new Date(session.created_at),
    updatedAt: new Date(session.created_at),
    messageCount: session.question_count,
    preview: `${session.approved_count} approved, ${session.pending_count} pending`,
  }))

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

          {questions.length > 0 && (
            <Button
              size="sm"
              onClick={handleSaveToQuestionBank}
              disabled={isSavingToBank || isGenerating}
              className="bg-[#5c4a38] hover:bg-[#4a3c2e] gap-2"
            >
              <CheckCircle className="h-4 w-4" />
              {isSavingToBank ? 'Saving...' : 'Save Approved to Bank'}
            </Button>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Questions Panel (Left - 70%) */}
        <div className="w-[70%] border-r overflow-hidden flex flex-col">
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
              progress={{ current: questions.length, total: settings.questionCount }}
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

        {/* Chat Panel (Right - 30%) */}
        <div className="w-[30%] overflow-hidden">
          <ChatPanel
            messages={chatMessages}
            isStreaming={isGenerating}
            onSendMessage={handleSendMessage}
            onClearChat={handleClearChat}
            selectedQuestionId={selectedQuestionId}
            sessions={chatSessions}
            currentSessionId={currentSessionId || undefined}
            onNewConversation={handleNewConversation}
            onDeleteConversation={handleDeleteConversation}
            onSwitchSession={handleSwitchSession}
            settings={{
              aiProvider: settings.aiProvider,
              modelName: settings.modelName,
            }}
          />
        </div>
      </div>

      {/* Settings Modal */}
      <SettingsModal
        open={isSettingsOpen}
        onOpenChange={setIsSettingsOpen}
        settings={settings}
        onSettingsChange={setSettings}
      />
    </div>
  )
}

export default OpenCanvasGenerator

import React, { useState, useCallback, useEffect } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Settings, Sparkles, CheckCircle, Loader2 } from 'lucide-react'
import { useAuth } from '@clerk/clerk-react'
import { toast } from '@/contexts/ToastContext'
import { cn } from '@/lib/utils'
import { API_BASE_URL } from '@/lib/config'
import { ChatPanel, ChatMessage } from './ChatPanel'
import { SettingsModal, GenerationSettings } from './SettingsModal'

import { QuestionCanvas } from './QuestionCanvas'

// Types
interface GeneratedQuestion {
  question_id: string
  session_id?: string
  type: string
  difficulty: string
  blooms_level?: string
  question_text: string
  options?: string[]
  correct_answer: string
  explanation?: string
  status?: 'pending' | 'approved' | 'rejected'
  versions?: GeneratedQuestion[] // For version history
  currentVersionIndex?: number
}

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
  const [questions, setQuestions] = useState<GeneratedQuestion[]>([])
  const [selectedQuestionId, setSelectedQuestionId] = useState<string | null>(null)

  // Chat state
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatHistory, setChatHistory] = useState<ChatMessage[][]>([])
  const [currentHistoryIndex, setCurrentHistoryIndex] = useState(-1)

  // Session state
  const [sessions, setSessions] = useState<Session[]>([])
  const [isLoadingSessions, setIsLoadingSessions] = useState(false)
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
    setIsLoadingSessions(true)
    try {
      const token = await getToken()
      const response = await fetch(`${API_BASE_URL}/question-generator/sessions`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (response.ok) {
        const data = await response.json()
        setSessions(data.sessions || [])
      }
    } catch (error) {
      console.error('Failed to fetch sessions:', error)
    } finally {
      setIsLoadingSessions(false)
    }
  }, [getToken])

  // Load sessions on mount
  useEffect(() => {
    fetchSessions()
  }, [fetchSessions])

  // Handle generating questions
  const handleGenerate = useCallback(async () => {
    if (!settings.subject || !settings.topic) {
      setIsSettingsOpen(true)
      toast.error('Please configure subject and topic')
      return
    }

    setIsGenerating(true)

    // Add user message to chat
    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: `Generate ${settings.questionCount} ${settings.difficulty} ${settings.questionTypes.join(', ')} questions about ${settings.topic} in ${settings.subject}`,
      timestamp: new Date(),
    }
    setChatMessages(prev => [...prev, userMessage])

    try {
      const token = await getToken()
      const response = await fetch(`${API_BASE_URL}/question-generator/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          message: userMessage.content,
          settings,
          stream: true,
        }),
      })

      if (!response.ok) throw new Error('Generation failed')

      // Handle streaming response
      const reader = response.body?.getReader()
      if (!reader) throw new Error('No response body')

      const decoder = new TextDecoder()
      let assistantContent = ''
      let newQuestions: GeneratedQuestion[] = []

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value)
        const lines = chunk.split('\n')

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6))

              if (data.type === 'content') {
                assistantContent += data.content
                // Update streaming message
                setChatMessages(prev => {
                  const lastMsg = prev[prev.length - 1]
                  if (lastMsg?.role === 'assistant' && lastMsg.isStreaming) {
                    return [...prev.slice(0, -1), { ...lastMsg, content: assistantContent }]
                  }
                  return [...prev, {
                    id: `assistant-${Date.now()}`,
                    role: 'assistant',
                    content: assistantContent,
                    timestamp: new Date(),
                    isStreaming: true,
                  }]
                })
              } else if (data.type === 'question_complete' && data.question) {
                newQuestions.push(data.question)
                setQuestions(prev => [...prev, data.question])
              }
            } catch (e) {
              // Skip invalid JSON
            }
          }
        }
      }

      // Mark streaming as complete
      setChatMessages(prev => {
        const lastMsg = prev[prev.length - 1]
        if (lastMsg?.role === 'assistant') {
          return [...prev.slice(0, -1), { ...lastMsg, isStreaming: false }]
        }
        return prev
      })

      toast.success(`Generated ${newQuestions.length} questions`)
    } catch (error) {
      console.error('Generation error:', error)
      toast.error('Failed to generate questions')
    } finally {
      setIsGenerating(false)
    }
  }, [settings, getToken])

  // Handle chat message (for refining/updating questions)
  const handleSendMessage = useCallback(async (message: string, referencedQuestionId?: string) => {
    if (isGenerating) return

    // Save current state to history before making changes
    if (questions.length > 0) {
      setChatHistory(prev => [...prev.slice(0, currentHistoryIndex + 1), chatMessages])
      setCurrentHistoryIndex(prev => prev + 1)
    }

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

    try {
      const token = await getToken()
      const response = await fetch(`${API_BASE_URL}/question-generator/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          message,
          referenced_question_id: referencedQuestionId,
          current_questions: questions,
          settings,
          stream: true,
        }),
      })

      if (!response.ok) throw new Error('Update failed')

      // Handle streaming response (similar to above)
      const reader = response.body?.getReader()
      if (!reader) throw new Error('No response body')

      const decoder = new TextDecoder()
      let assistantContent = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value)
        const lines = chunk.split('\n')

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6))

              if (data.type === 'content') {
                assistantContent += data.content
                setChatMessages(prev => {
                  const lastMsg = prev[prev.length - 1]
                  if (lastMsg?.role === 'assistant' && lastMsg.isStreaming) {
                    return [...prev.slice(0, -1), { ...lastMsg, content: assistantContent }]
                  }
                  return [...prev, {
                    id: `assistant-${Date.now()}`,
                    role: 'assistant',
                    content: assistantContent,
                    timestamp: new Date(),
                    isStreaming: true,
                    referencedQuestionId,
                  }]
                })
              } else if (data.type === 'question_updated' && data.question) {
                // Update the specific question
                setQuestions(prev => {
                  const index = prev.findIndex(q => q.question_id === data.question.question_id)
                  if (index !== -1) {
                    // Save current version to history
                    const oldQuestion = prev[index]
                    const versions = [...(oldQuestion.versions || []), oldQuestion]

                    const newQuestions = [...prev]
                    newQuestions[index] = {
                      ...data.question,
                      versions,
                      currentVersionIndex: versions.length,
                    }
                    return newQuestions
                  }
                  return prev
                })
              }
            } catch (e) {
              // Skip invalid JSON
            }
          }
        }
      }

      // Mark streaming complete
      setChatMessages(prev => {
        const lastMsg = prev[prev.length - 1]
        if (lastMsg?.role === 'assistant') {
          return [...prev.slice(0, -1), { ...lastMsg, isStreaming: false }]
        }
        return prev
      })

    } catch (error) {
      console.error('Update error:', error)
      toast.error('Failed to update question')
    } finally {
      setIsGenerating(false)
    }
  }, [isGenerating, questions, settings, getToken, chatMessages, currentHistoryIndex])

  // Cycle through question versions
  const handleCycleVersion = useCallback((questionId: string, direction: 'prev' | 'next') => {
    setQuestions(prev => {
      const index = prev.findIndex(q => q.question_id === questionId)
      if (index === -1) return prev

      const question = prev[index]
      const versions = question.versions || []
      const currentIdx = question.currentVersionIndex ?? versions.length

      let newIdx: number
      if (direction === 'prev') {
        newIdx = Math.max(0, currentIdx - 1)
      } else {
        newIdx = Math.min(versions.length, currentIdx + 1)
      }

      const newQuestions = [...prev]

      if (newIdx === versions.length) {
        // Current version
        newQuestions[index] = { ...question, currentVersionIndex: newIdx }
      } else {
        // Historical version
        newQuestions[index] = {
          ...versions[newIdx],
          versions: question.versions,
          currentVersionIndex: newIdx,
          question_id: question.question_id, // Keep same ID
        }
      }

      return newQuestions
    })
  }, [])

  // Cycle through chat history
  const handleCycleChatHistory = useCallback((direction: 'prev' | 'next') => {
    if (direction === 'prev' && currentHistoryIndex > 0) {
      setCurrentHistoryIndex(prev => prev - 1)
      setChatMessages(chatHistory[currentHistoryIndex - 1])
    } else if (direction === 'next' && currentHistoryIndex < chatHistory.length - 1) {
      setCurrentHistoryIndex(prev => prev + 1)
      setChatMessages(chatHistory[currentHistoryIndex + 1])
    }
  }, [chatHistory, currentHistoryIndex])

  // Handle question actions
  const handleApprove = useCallback((questionId: string) => {
    setQuestions(prev => prev.map(q =>
      q.question_id === questionId ? { ...q, status: 'approved' } : q
    ))
    toast.success('Question approved')
  }, [])

  const handleReject = useCallback((questionId: string) => {
    setQuestions(prev => prev.map(q =>
      q.question_id === questionId ? { ...q, status: 'rejected' } : q
    ))
    toast.success('Question rejected')
  }, [])

  const handleDelete = useCallback((questionId: string) => {
    setQuestions(prev => prev.filter(q => q.question_id !== questionId))
    if (selectedQuestionId === questionId) {
      setSelectedQuestionId(null)
    }
    toast.success('Question deleted')
  }, [selectedQuestionId])

  const handleApproveAll = useCallback(() => {
    setQuestions(prev => prev.map(q => ({ ...q, status: 'approved' })))
    toast.success('All questions approved')
  }, [])

  // Handle clearing chat
  const handleClearChat = useCallback(() => {
    setChatMessages([])
    setChatHistory([])
    setCurrentHistoryIndex(-1)
  }, [])

  // Handle new conversation
  const handleNewConversation = useCallback(() => {
    setChatMessages([])
    setChatHistory([])
    setCurrentHistoryIndex(-1)
    setCurrentSessionId(null)
    setQuestions([])
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
        if (data.messages) {
          setChatMessages(data.messages)
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
  const handleRequestRegenerate = useCallback((questionId: string, defaultMessage: string) => {
    setSelectedQuestionId(questionId)
    // Send the regenerate message
    handleSendMessage(defaultMessage, questionId)
  }, [handleSendMessage])

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
              onClick={handleApproveAll}
              className="bg-[#5c4a38] hover:bg-[#4a3c2e] gap-2"
            >
              <CheckCircle className="h-4 w-4" />
              Finalize & Save All
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
              onApprove={handleApprove}
              onReject={handleReject}
              onDelete={handleDelete}
              onApproveAll={handleApproveAll}
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
        isGenerating={isGenerating}
      />
    </div>
  )
}

export default OpenCanvasGenerator

/**
 * ChatPanel - Continuous chat interface for question generation
 * Features: Streaming messages, question references, chat history cycling, session management
 */
import { useState, useRef, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { 
  Bot, 
  User, 
  History, 
  ChevronLeft, 
  ChevronRight, 
  X,
  MoreVertical,
  Plus,
  Trash2,
  MessageSquare,
  Search
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { AIInput } from '@/components/ui/animated-ai-input'
import { MessageLoading } from '@/components/ui/message-loading'
import { AgentPlan } from '@/components/ui/agent-plan'
import { LoadingSpinner } from '@/components/ui/loading-state'
import { formatDistanceToNow } from 'date-fns'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: Date
  referencedQuestionId?: string
  isStreaming?: boolean
  versions?: string[] // For cycling through question versions
  currentVersionIndex?: number
  agentPlan?: any // Agent thinking/plan tasks
}

export interface ChatSession {
  id: string
  title: string
  createdAt: Date
  updatedAt: Date
  messageCount: number
  preview?: string
}

interface ChatPanelProps {
  messages: ChatMessage[]
  isStreaming: boolean
  onSendMessage: (message: string, referencedQuestionId?: string) => void
  onCycleVersion?: (messageId: string, direction: 'prev' | 'next') => void
  onClearChat?: () => void
  selectedQuestionId?: string | null
  className?: string
  // Session management props
  onNewConversation?: () => void
  onDeleteConversation?: () => void
  onDeleteSessions?: (sessionIds: string[]) => void
  isDeletingSessions?: boolean
  sessions?: ChatSession[]
  onSwitchSession?: (sessionId: string) => void
  currentSessionId?: string
  settings?: {
    aiProvider?: string
    modelName?: string
  }
}

export function ChatPanel({
  messages,
  isStreaming,
  onSendMessage,
  onCycleVersion,
  onClearChat,
  selectedQuestionId,
  className,
  // Session management props
  onNewConversation,
  onDeleteConversation,
  onDeleteSessions,
  isDeletingSessions = false,
  sessions = [],
  onSwitchSession,
  currentSessionId,
  settings,
}: ChatPanelProps) {
  const [input, setInput] = useState('')
  const [historySheetOpen, setHistorySheetOpen] = useState(false)
  const [historyQuery, setHistoryQuery] = useState('')
  const [selectedSessionIds, setSelectedSessionIds] = useState<Set<string>>(new Set())
  const scrollRef = useRef<HTMLDivElement>(null)

  const filteredSessions = useMemo(() => {
    const query = historyQuery.trim().toLowerCase()
    if (!query) {
      return sessions
    }

    return sessions.filter((session) => {
      const title = session.title.toLowerCase()
      const preview = (session.preview || '').toLowerCase()
      return title.includes(query) || preview.includes(query)
    })
  }, [sessions, historyQuery])

  const selectedCount = selectedSessionIds.size
  const isSelectionMode = selectedCount > 0
  const hasVisibleSessions = filteredSessions.length > 0
  const allVisibleSelected =
    hasVisibleSessions && filteredSessions.every((session) => selectedSessionIds.has(session.id))
  const someVisibleSelected =
    hasVisibleSessions && filteredSessions.some((session) => selectedSessionIds.has(session.id))

  const allCheckboxState: boolean | 'indeterminate' = allVisibleSelected
    ? true
    : someVisibleSelected
      ? 'indeterminate'
      : false

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, input])

  // Focus input when question is selected
  useEffect(() => {
    if (selectedQuestionId) {
      setInput(prev => {
        if (prev && !prev.includes('Question')) return prev
        return ''
      })
    }
  }, [selectedQuestionId])

  useEffect(() => {
    setSelectedSessionIds((previous) => {
      const next = new Set(
        Array.from(previous).filter((sessionId) => sessions.some((session) => session.id === sessionId))
      )
      if (next.size === previous.size) {
        return previous
      }
      return next
    })
  }, [sessions])

  const handleSubmit = () => {
    if (!input.trim() || isStreaming) return
    
    onSendMessage(input.trim(), selectedQuestionId || undefined)
    setInput('')
  }

  const toggleSessionSelection = (sessionId: string, checked: boolean) => {
    setSelectedSessionIds((previous) => {
      const next = new Set(previous)
      if (checked) {
        next.add(sessionId)
      } else {
        next.delete(sessionId)
      }
      return next
    })
  }

  const toggleSelectAllVisible = (checked: boolean) => {
    setSelectedSessionIds((previous) => {
      const next = new Set(previous)
      if (checked) {
        filteredSessions.forEach((session) => next.add(session.id))
      } else {
        filteredSessions.forEach((session) => next.delete(session.id))
      }
      return next
    })
  }

  const handleDeleteSelected = () => {
    if (!onDeleteSessions || selectedSessionIds.size === 0) {
      return
    }

    onDeleteSessions(Array.from(selectedSessionIds))
    setSelectedSessionIds(new Set())
  }

  const getSessionMeta = (session: ChatSession) => {
    const updatedAt = session.updatedAt instanceof Date ? session.updatedAt : new Date(session.updatedAt)
    if (Number.isNaN(updatedAt.getTime())) {
      return 'Last message recently'
    }

    return `Last message ${formatDistanceToNow(updatedAt, { addSuffix: true })}`
  }

  return (
    <div className={cn("flex flex-col h-full bg-background", className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/30">
        <div className="flex items-center gap-2">
          <Bot className="h-5 w-5 text-primary" />
          <span className="font-semibold text-sm">AI Assistant</span>
          {isStreaming && (
            <Badge variant="secondary" className="text-xs animate-pulse">
              <LoadingSpinner size="sm" className="mr-1 text-current" />
              Thinking...
            </Badge>
          )}
        </div>
        
        <div className="flex items-center gap-1">
          {/* History Button - Icon only */}
          <Sheet open={historySheetOpen} onOpenChange={setHistorySheetOpen}>
            <SheetTrigger asChild>
              <Button 
                variant="ghost" 
                size="icon"
                className="h-8 w-8"
              >
                <History className="h-4 w-4" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-full p-0 sm:max-w-3xl">
              <div className="flex h-full flex-col bg-background">
                <SheetHeader className="border-b px-6 py-4 pr-16">
                  <div className="flex items-center justify-between gap-3">
                    <SheetTitle className="text-left text-3xl font-semibold tracking-tight">
                      Chats
                    </SheetTitle>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            onClick={onNewConversation}
                            disabled={isDeletingSessions}
                            className="h-9 w-9"
                          >
                            <Plus className="h-4 w-4" />
                            <span className="sr-only">New chat</span>
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>New chat</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                </SheetHeader>

                <div className="border-b px-6 py-4">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={historyQuery}
                      onChange={(event) => setHistoryQuery(event.target.value)}
                      placeholder="Search your chats..."
                      className="pl-10"
                    />
                  </div>

                  {isSelectionMode && (
                    <div className="mt-3 flex items-center justify-between gap-2 text-sm text-muted-foreground">
                      <div className="flex items-center gap-2">
                        <Checkbox
                          checked={allCheckboxState}
                          onCheckedChange={(value) => toggleSelectAllVisible(Boolean(value))}
                          aria-label="Select all visible chats"
                        />
                        <span>{selectedCount} selected</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={handleDeleteSelected}
                          disabled={isDeletingSessions}
                        >
                          {isDeletingSessions ? (
                            <LoadingSpinner size="sm" className="text-foreground" />
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => setSelectedSessionIds(new Set())}
                        disabled={isDeletingSessions}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </div>

                <ScrollArea className="flex-1 px-6 pb-4">
                  <div className="space-y-1 py-4">
                    {filteredSessions.length === 0 ? (
                      <div className="text-center py-10 text-muted-foreground">
                        <MessageSquare className="h-8 w-8 mx-auto mb-3 opacity-50" />
                        <p className="text-sm">
                          {historyQuery.trim()
                            ? 'No chats match your search'
                            : 'No previous conversations'}
                        </p>
                      </div>
                    ) : (
                      filteredSessions.map((session) => {
                        const isSelected = selectedSessionIds.has(session.id)
                        const isActive = currentSessionId === session.id

                        return (
                          <div
                            key={session.id}
                            className={cn(
                              'group relative rounded-lg border-b border-border/60 px-4 py-3 transition-colors',
                              isActive ? 'bg-primary/15' : 'hover:bg-muted/40'
                            )}
                          >
                            <button
                              type="button"
                              onClick={() => {
                                onSwitchSession?.(session.id)
                                setHistorySheetOpen(false)
                              }}
                              className="min-w-0 w-full pr-8 text-left"
                            >
                              <p className={cn('truncate text-sm', isActive ? 'font-semibold' : 'font-medium')}>
                                {session.title}
                              </p>
                              <p className="mt-1 text-xs text-muted-foreground">
                                {getSessionMeta(session)}
                              </p>
                            </button>

                            <div
                              className={cn(
                                'absolute right-3 top-3 transition-opacity',
                                isSelectionMode
                                  ? 'opacity-100 pointer-events-auto'
                                  : 'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto'
                              )}
                              onClick={(event) => event.stopPropagation()}
                            >
                              <Checkbox
                                checked={isSelected}
                                onCheckedChange={(value) => toggleSessionSelection(session.id, Boolean(value))}
                                aria-label={`Select session ${session.title}`}
                                disabled={isDeletingSessions}
                              />
                            </div>
                          </div>
                        )
                      })
                    )}
                  </div>
                </ScrollArea>
              </div>
            </SheetContent>
          </Sheet>

          {/* Actions Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onNewConversation}>
                <Plus className="h-4 w-4 mr-2" />
                New Conversation
              </DropdownMenuItem>
              {(messages.length > 0 || currentSessionId) && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={onClearChat}>
                    <X className="h-4 w-4 mr-2" />
                    Clear Chat
                  </DropdownMenuItem>
                  <DropdownMenuItem 
                    onClick={onDeleteConversation}
                    className="text-red-600 focus:text-red-600"
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete Conversation
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 px-4" ref={scrollRef}>
        <div className="py-4 space-y-4">
          <AnimatePresence initial={false}>
            {messages.length === 0 ? (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex flex-col items-center justify-center py-12 text-center"
              >
                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-3">
                  <Bot className="h-6 w-6 text-primary" />
                </div>
                <p className="text-sm text-muted-foreground max-w-xs">
                  Start a conversation to generate or refine questions. 
                  Click on any question to reference it in chat.
                </p>
              </motion.div>
            ) : (
              messages.map((message) => (
                <motion.div
                  key={message.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className={cn(
                    "flex gap-3",
                    message.role === 'user' ? "flex-row-reverse" : ""
                  )}
                >
                  {/* Avatar */}
                  <Avatar className={cn(
                    "h-8 w-8 shrink-0",
                    message.role === 'user' 
                      ? "bg-[#5c4a38]" 
                      : "bg-primary/10"
                  )}>
                    <AvatarFallback className={cn(
                      "text-xs",
                      message.role === 'user' 
                        ? "text-white" 
                        : "text-primary"
                    )}>
                      {message.role === 'user' ? (
                        <User className="h-4 w-4" />
                      ) : (
                        <Bot className="h-4 w-4" />
                      )}
                    </AvatarFallback>
                  </Avatar>

                  {/* Message Content */}
                  <div className={cn(
                    "flex flex-col max-w-[80%]",
                    message.role === 'user' ? "items-end" : "items-start"
                  )}>
                    <span className="mb-1 text-[11px] font-semibold text-foreground/80">
                      {message.role === 'user' ? 'Tutor' : 'AI'}
                    </span>

                    {/* Referenced Question Badge */}
                    {message.referencedQuestionId && (
                      <Badge 
                        variant="outline" 
                        className="mb-1 text-[10px] border-[#5c4a38]/50 text-[#5c4a38]"
                      >
                        Referencing Question {message.referencedQuestionId.slice(-4)}
                      </Badge>
                    )}

                    {/* Message Bubble */}
                    <Card className={cn(
                      "p-3 text-sm",
                      message.role === 'user' 
                        ? "bg-[#5c4a38] text-white border-0" 
                        : "bg-muted/50"
                    )}>
                      <div className="whitespace-pre-wrap">
                        {message.content}
                        {message.isStreaming && (
                          <span className="inline-block w-2 h-4 ml-1 bg-current animate-pulse" />
                        )}
                      </div>
                    </Card>

                    {/* Agent Plan - Show for assistant messages with plan */}
                    {message.role === 'assistant' && message.agentPlan && (
                      <div className="mt-2 w-full max-w-md">
                        <AgentPlan tasks={message.agentPlan} />
                      </div>
                    )}

                    {/* Version Cycling (for assistant messages with versions) */}
                    {message.role === 'assistant' && 
                     message.versions && 
                     message.versions.length > 1 && 
                     onCycleVersion && (
                      <div className="flex items-center gap-2 mt-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => onCycleVersion(message.id, 'prev')}
                          disabled={message.currentVersionIndex === 0}
                        >
                          <ChevronLeft className="h-3 w-3" />
                        </Button>
                        <span className="text-xs text-muted-foreground">
                          {((message.currentVersionIndex || 0) + 1)} / {message.versions.length}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => onCycleVersion(message.id, 'next')}
                          disabled={message.currentVersionIndex === message.versions.length - 1}
                        >
                          <ChevronRight className="h-3 w-3" />
                        </Button>
                        <Badge variant="secondary" className="text-[10px]">
                          Version History
                        </Badge>
                      </div>
                    )}

                    {/* Timestamp */}
                    <span className="text-[10px] text-muted-foreground mt-1">
                      {message.timestamp.toLocaleTimeString([], { 
                        hour: '2-digit', 
                        minute: '2-digit' 
                      })}
                    </span>
                  </div>
                </motion.div>
              ))
            )}
          </AnimatePresence>
          
          {/* Streaming Indicator */}
          {isStreaming && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex items-center gap-2 text-muted-foreground"
            >
              <MessageLoading />
              <span className="text-xs">AI is thinking...</span>
            </motion.div>
          )}
        </div>
      </ScrollArea>

      {/* Selected Question Indicator */}
      {selectedQuestionId && (
        <div className="px-4 py-2 bg-[#5c4a38]/10 border-y border-[#5c4a38]/20">
          <div className="flex items-center justify-between">
            <span className="text-xs text-[#5c4a38]">
              Referencing Question {selectedQuestionId.slice(-4)}
            </span>
            <span className="text-[10px] text-muted-foreground">
              Your next message will update this question
            </span>
          </div>
        </div>
      )}

      {/* Input Area */}
      <div className="p-4 border-t bg-muted/30">
        <AIInput
          value={input}
          onChange={setInput}
          onSubmit={handleSubmit}
          placeholder={
            selectedQuestionId 
              ? "Type your update for the selected question..."
              : "Chat to refine requirements, then ask me to generate questions"
          }
          disabled={isStreaming}
          selectedModel={settings?.modelName}
          aiProvider={settings?.aiProvider}
        />
      </div>
    </div>
  )
}

export default ChatPanel

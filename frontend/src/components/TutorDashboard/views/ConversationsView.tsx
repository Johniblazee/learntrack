/**
 * Conversations View - Real-time chat interface
 * Design: Split panel with conversation list (left) and chat area (right)
 */
import { useState, useEffect, useMemo, useRef } from "react"
import { useAuth } from "@clerk/clerk-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  Search,
  Plus,
  Smile,
  Mail,
  MessageCircle,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Skeleton } from "@/components/ui/skeleton"
import { socketClient } from "@/lib/socket"
import { useVisibility } from "@/hooks/useVisibility"
import { useApiClient } from "@/lib/api-client"
import { toast } from "@/contexts/ToastContext"

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api/v1'

interface Message {
  _id: string
  conversation_id: string
  sender_id: string
  sender_name: string
  sender_role: string
  content: string
  subject?: string | null
  delivery_method?: 'chat' | 'email'
  created_at: string
  read_by: string[]
}

interface Conversation {
  _id: string
  participants: string[]
  participant_names: Record<string, string>
  participant_roles: Record<string, string>
  last_message: string | null
  last_delivery_method?: 'chat' | 'email'
  last_message_at: string | null
  unread_count: Record<string, number>
}

export default function ConversationsView() {
  const { getToken, userId } = useAuth()
  const client = useApiClient()
  const { visibleUserIds, loading: visibilityLoading } = useVisibility()
  const [searchQuery, setSearchQuery] = useState("")
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [newMessage, setNewMessage] = useState("")
  const [deliveryMethod, setDeliveryMethod] = useState<'chat' | 'email'>('chat')
  const [emailSubject, setEmailSubject] = useState("")
  const [sendingMessage, setSendingMessage] = useState(false)
  const [isTyping, setIsTyping] = useState(false)
  const [loading, setLoading] = useState(true)
  const [messagesLoading, setMessagesLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Initialize socket connection
  useEffect(() => {
    const initSocket = async () => {
      const token = await getToken()
      if (token) {
        socketClient.connect(token)
      }
    }
    initSocket()
    return () => {
      socketClient.disconnect()
    }
  }, [getToken])

  // Load conversations on mount
  useEffect(() => {
    loadConversations()
  }, [])

  // Listen for new messages
  useEffect(() => {
    const handleNewMessage = (message: Message) => {
      if (selectedConversation && message.conversation_id === selectedConversation._id) {
        setMessages((prev) => [...prev, message])
        scrollToBottom()
        markConversationAsRead(selectedConversation._id)
      }
      loadConversations()
    }

    const handleUserTyping = (data: { conversation_id: string; user_id: string; typing: boolean }) => {
      if (selectedConversation && data.conversation_id === selectedConversation._id && data.user_id !== userId) {
        setIsTyping(data.typing)
      }
    }

    socketClient.onNewMessage(handleNewMessage)
    socketClient.onUserTyping(handleUserTyping)

    return () => {
      socketClient.offNewMessage(handleNewMessage)
      socketClient.offUserTyping(handleUserTyping)
    }
  }, [selectedConversation, userId])

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    scrollToBottom()
  }, [messages])

  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (deliveryMethod !== 'email' || !selectedConversation) {
      return
    }

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current)
      typingTimeoutRef.current = null
    }

    socketClient.stopTyping(selectedConversation._id)
    setIsTyping(false)
  }, [deliveryMethod, selectedConversation])

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }

  const loadConversations = async () => {
    try {
      setLoading(true)
      const token = await getToken()
      const response = await fetch(`${API_BASE}/conversations`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await response.json()

      setConversations(data.conversations || [])
    } catch (error) {
      console.error("Failed to load conversations:", error)
    } finally {
      setLoading(false)
    }
  }

  const visibleConversations = useMemo(() => {
    if (!userId || visibilityLoading) {
      return []
    }

    return conversations.filter((conv) => {
      return conv.participants.every(
        (participantId) => participantId === userId || visibleUserIds.includes(participantId)
      )
    })
  }, [conversations, userId, visibilityLoading, visibleUserIds])

  useEffect(() => {
    if (!selectedConversation || visibilityLoading) {
      return
    }

    const stillVisible = visibleConversations.some(
      (conversation) => conversation._id === selectedConversation._id
    )

    if (!stillVisible) {
      setSelectedConversation(null)
      setMessages([])
    }
  }, [selectedConversation, visibilityLoading, visibleConversations])

  const loadMessages = async (conversationId: string) => {
    try {
      setMessagesLoading(true)
      const token = await getToken()
      const response = await fetch(
        `${API_BASE}/messages/conversation/${conversationId}?page=1&page_size=50`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      const data = await response.json()
      setMessages(data.messages || [])
      socketClient.joinConversation(conversationId)
      markConversationAsRead(conversationId)
    } catch (error) {
      console.error("Failed to load messages:", error)
    } finally {
      setMessagesLoading(false)
    }
  }

  const markConversationAsRead = async (conversationId: string) => {
    try {
      const token = await getToken()
      await fetch(`${API_BASE}/conversations/${conversationId}/read`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}` },
      })
      loadConversations()
    } catch (error) {
      console.error("Failed to mark as read:", error)
    }
  }

  const handleSelectConversation = (conversation: Conversation) => {
    if (selectedConversation) {
      socketClient.leaveConversation(selectedConversation._id)
    }
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current)
      typingTimeoutRef.current = null
    }
    setDeliveryMethod('chat')
    setEmailSubject("")
    setSelectedConversation(conversation)
    loadMessages(conversation._id)
  }

  const getOtherParticipantId = (conversation: Conversation) => {
    return conversation.participants.find((p) => p !== userId) || null
  }

  const handleSendMessage = async () => {
    if (!newMessage.trim() || !selectedConversation || sendingMessage) return

    if (deliveryMethod === 'email' && !emailSubject.trim()) {
      toast.error('Please add an email subject')
      return
    }

    try {
      setSendingMessage(true)

      if (deliveryMethod === 'email') {
        const recipientId = getOtherParticipantId(selectedConversation)
        if (!recipientId) {
          throw new Error('Unable to determine email recipient')
        }

        const emailResponse = await client.post('/messages/email', {
          recipient_id: recipientId,
          subject: emailSubject.trim(),
          content: newMessage.trim(),
        })

        if (emailResponse.error) {
          throw new Error(emailResponse.error)
        }

        toast.success('Email sent successfully')
        setNewMessage("")
        setEmailSubject("")
        await loadMessages(selectedConversation._id)
        await loadConversations()
        return
      }

      if (socketClient.isConnected()) {
        const socketResponse = await new Promise<{ success: boolean; error?: string }>(
          (resolve) => {
            socketClient.sendMessage(
              selectedConversation._id,
              newMessage.trim(),
              "text",
              resolve,
            )
          }
        )

        if (!socketResponse.success) {
          throw new Error(socketResponse.error || 'Failed to send message')
        }

        setNewMessage("")
        socketClient.stopTyping(selectedConversation._id)
        await loadConversations()
        return
      }

      const messageResponse = await client.post('/messages/', {
        conversation_id: selectedConversation._id,
        content: newMessage.trim(),
        message_type: 'text',
        delivery_method: 'chat',
      })

      if (messageResponse.error) {
        throw new Error(messageResponse.error)
      }

      setNewMessage("")
      await loadMessages(selectedConversation._id)
      await loadConversations()
    } catch (error: any) {
      console.error('Failed to send message:', error)
      toast.error(error.message || 'Failed to send message')
    } finally {
      setSendingMessage(false)
    }
  }

  const handleTyping = (e: React.ChangeEvent<HTMLInputElement>) => {
    setNewMessage(e.target.value)
    if (!selectedConversation || deliveryMethod !== 'chat') return

    socketClient.startTyping(selectedConversation._id)

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current)
    }

    typingTimeoutRef.current = setTimeout(() => {
      socketClient.stopTyping(selectedConversation._id)
    }, 2000)
  }

  const getOtherParticipant = (conversation: Conversation) => {
    const otherParticipantId = conversation.participants.find((p) => p !== userId)
    if (!otherParticipantId) return { name: "Unknown", role: "user" }
    return {
      name: conversation.participant_names[otherParticipantId] || "Unknown",
      role: conversation.participant_roles[otherParticipantId] || "user",
    }
  }

  const formatMessageTime = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: true })
  }

  const formatConversationTime = (dateString: string | null) => {
    if (!dateString) return ""
    const date = new Date(dateString)
    const now = new Date()
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24))

    if (diffDays === 0) {
      return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: true })
    } else if (diffDays === 1) {
      return "Yesterday"
    } else if (diffDays < 7) {
      return `${diffDays}d ago`
    } else {
      return date.toLocaleDateString([], { month: "short", day: "numeric" })
    }
  }

  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2)
  }

  const getRoleLabel = (role: string) => {
    const labels: Record<string, string> = {
      tutor: "Teacher",
      student: "Student",
      parent: "Parent",
    }
    return labels[role] || role.charAt(0).toUpperCase() + role.slice(1)
  }

  const filteredConversations = visibleConversations.filter((conv) => {
    const { name } = getOtherParticipant(conv)
    return name.toLowerCase().includes(searchQuery.toLowerCase())
  })

  const isConversationsLoading = loading || visibilityLoading


  return (
    <div className="flex h-[calc(100vh-8rem)] bg-background rounded-lg overflow-hidden border border-border">
      {/* Left Panel - Conversations List */}
      <div className="w-80 border-r border-border flex flex-col bg-card">
        {/* Header */}
        <div className="p-4 border-b border-border">
          <h2 className="text-lg font-semibold text-foreground mb-4">Conversations</h2>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search conversations..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-10 bg-background border-border"
            />
          </div>
        </div>

        {/* Conversations List */}
        <ScrollArea className="flex-1">
          <div className="p-2">
            {isConversationsLoading ? (
              /* Conversation List Skeleton */
              <div className="space-y-1">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-3 p-3 rounded-lg"
                  >
                    {/* Avatar skeleton */}
                    <Skeleton className="h-10 w-10 rounded-full shrink-0" />
                    {/* Content skeleton */}
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center justify-between">
                        <Skeleton className="h-4 w-28" />
                        <Skeleton className="h-3 w-12" />
                      </div>
                      <Skeleton className="h-3 w-full" />
                    </div>
                  </div>
                ))}
              </div>
            ) : filteredConversations.length === 0 ? (
              <div className="text-center py-8">
                <MessageCircle className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">No conversations yet</p>
              </div>
            ) : (
              filteredConversations.map((conv) => {
                const { name } = getOtherParticipant(conv)
                const isSelected = selectedConversation?._id === conv._id
                const unreadCount = conv.unread_count[userId || ""] || 0
                const hasUnread = unreadCount > 0

                return (
                  <div
                    key={conv._id}
                    onClick={() => handleSelectConversation(conv)}
                    className={cn(
                      "flex items-start gap-3 p-3 rounded-lg cursor-pointer transition-all duration-200 mb-1",
                      isSelected
                        ? "bg-accent/20 border border-accent/30"
                        : "hover:bg-muted/50 border border-transparent"
                    )}
                  >
                    {/* Avatar with online indicator */}
                    <div className="relative shrink-0">
                      <Avatar className="h-10 w-10">
                        <AvatarFallback className={cn(
                          "text-sm font-medium",
                          isSelected ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground"
                        )}>
                          {getInitials(name)}
                        </AvatarFallback>
                      </Avatar>
                      {/* Online indicator */}
                      <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full bg-green-500 border-2 border-card" />
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className={cn(
                            "text-sm truncate",
                            hasUnread ? "font-semibold text-foreground" : "font-medium text-foreground"
                          )}>
                            {name}
                          </p>
                          <p className="text-xs text-muted-foreground">{formatConversationTime(conv.last_message_at)}</p>
                        </div>
                        {hasUnread && (
                          <span className="h-2.5 w-2.5 rounded-full bg-accent shrink-0 mt-1" />
                        )}
                      </div>
                      {conv.last_message && (
                        <p className={cn(
                          "text-xs mt-1 truncate",
                          hasUnread ? "text-accent font-medium" : "text-muted-foreground"
                        )}>
                          {conv.last_delivery_method === 'email' ? `Email: ${conv.last_message}` : conv.last_message}
                        </p>
                      )}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Right Panel - Chat Area */}
      <div className="flex-1 flex flex-col bg-background">
        {selectedConversation ? (
          <>
            {/* Chat Header */}
            <div className="flex items-center gap-3 p-4 border-b border-border bg-card">
              <Avatar className="h-10 w-10">
                <AvatarFallback className="bg-muted text-muted-foreground text-sm font-medium">
                  {getInitials(getOtherParticipant(selectedConversation).name)}
                </AvatarFallback>
              </Avatar>
              <div>
                <p className="font-semibold text-foreground">
                  {getOtherParticipant(selectedConversation).name} - {getRoleLabel(getOtherParticipant(selectedConversation).role)}
                </p>
                <p className="text-xs text-green-500 font-medium">Online</p>
              </div>
            </div>

            {/* Messages Area */}
            <ScrollArea className="flex-1 p-4">
              <div className="space-y-4 max-w-3xl mx-auto">
                {messagesLoading ? (
                  /* Messages Skeleton */
                  <>
                    {/* Incoming message skeleton */}
                    <div className="flex gap-3 justify-start">
                      <Skeleton className="h-8 w-8 rounded-full shrink-0" />
                      <div className="space-y-2">
                        <Skeleton className="h-16 w-64 rounded-2xl rounded-bl-md" />
                        <Skeleton className="h-2 w-12" />
                      </div>
                    </div>
                    {/* Outgoing message skeleton */}
                    <div className="flex gap-3 justify-end">
                      <div className="space-y-2 flex flex-col items-end">
                        <Skeleton className="h-12 w-48 rounded-2xl rounded-br-md" />
                        <Skeleton className="h-2 w-12" />
                      </div>
                    </div>
                    {/* Incoming message skeleton */}
                    <div className="flex gap-3 justify-start">
                      <Skeleton className="h-8 w-8 rounded-full shrink-0" />
                      <div className="space-y-2">
                        <Skeleton className="h-20 w-72 rounded-2xl rounded-bl-md" />
                        <Skeleton className="h-2 w-12" />
                      </div>
                    </div>
                    {/* Outgoing message skeleton */}
                    <div className="flex gap-3 justify-end">
                      <div className="space-y-2 flex flex-col items-end">
                        <Skeleton className="h-10 w-56 rounded-2xl rounded-br-md" />
                        <Skeleton className="h-2 w-12" />
                      </div>
                    </div>
                    {/* Incoming message skeleton */}
                    <div className="flex gap-3 justify-start">
                      <Skeleton className="h-8 w-8 rounded-full shrink-0" />
                      <div className="space-y-2">
                        <Skeleton className="h-14 w-60 rounded-2xl rounded-bl-md" />
                        <Skeleton className="h-2 w-12" />
                      </div>
                    </div>
                  </>
                ) : (
                  messages.map((message) => {
                    const isOwnMessage = message.sender_id === userId

                    return (
                      <div
                        key={message._id}
                        className={cn("flex gap-3", isOwnMessage ? "justify-end" : "justify-start")}
                      >
                        {!isOwnMessage && (
                          <Avatar className="h-8 w-8 shrink-0 mt-1">
                            <AvatarFallback className="bg-muted text-muted-foreground text-xs">
                              {getInitials(getOtherParticipant(selectedConversation).name)}
                            </AvatarFallback>
                          </Avatar>
                        )}
                        <div
                          className={cn(
                            "max-w-[70%] rounded-2xl px-4 py-2.5",
                            isOwnMessage
                              ? "bg-accent text-accent-foreground rounded-br-md"
                              : "bg-card border border-border text-foreground rounded-bl-md"
                          )}
                        >
                          {message.delivery_method === 'email' && (
                            <p
                              className={cn(
                                "text-[10px] mb-1 uppercase tracking-wide",
                                isOwnMessage ? "text-accent-foreground/70" : "text-muted-foreground"
                              )}
                            >
                              Email{message.subject ? ` • ${message.subject}` : ''}
                            </p>
                          )}
                          <p className="text-sm leading-relaxed">{message.content}</p>
                          <p className={cn(
                            "text-[10px] mt-1",
                            isOwnMessage ? "text-accent-foreground/70" : "text-muted-foreground"
                          )}>
                            {formatMessageTime(message.created_at)}
                          </p>
                        </div>
                      </div>
                    )
                  })
                )}
                {isTyping && deliveryMethod === 'chat' && (
                  <div className="flex justify-start">
                    <div className="bg-muted rounded-2xl px-4 py-2.5 rounded-bl-md">
                      <p className="text-sm text-muted-foreground italic">Typing...</p>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
            </ScrollArea>

            {/* Message Input */}
            <div className="p-4 border-t border-border bg-card">
              <div className="max-w-3xl mx-auto space-y-2.5">
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant={deliveryMethod === 'chat' ? 'default' : 'outline'}
                    className="h-8 px-3 text-xs"
                    onClick={() => setDeliveryMethod('chat')}
                    disabled={sendingMessage}
                  >
                    <MessageCircle className="h-3.5 w-3.5 mr-1.5" />
                    Chat
                  </Button>
                  <Button
                    type="button"
                    variant={deliveryMethod === 'email' ? 'default' : 'outline'}
                    className="h-8 px-3 text-xs"
                    onClick={() => setDeliveryMethod('email')}
                    disabled={sendingMessage}
                  >
                    <Mail className="h-3.5 w-3.5 mr-1.5" />
                    Email
                  </Button>
                </div>

                {deliveryMethod === 'email' && (
                  <Input
                    placeholder="Email subject"
                    value={emailSubject}
                    onChange={(e) => setEmailSubject(e.target.value)}
                    className="h-10 bg-background border-border"
                    maxLength={200}
                    disabled={sendingMessage}
                  />
                )}

                <div className="flex items-center gap-3">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-10 w-10 shrink-0 text-muted-foreground hover:text-foreground"
                    disabled={sendingMessage}
                  >
                    <Plus className="h-5 w-5" />
                  </Button>
                  <div className="flex-1 relative">
                    <Input
                      placeholder={deliveryMethod === 'email' ? 'Type your email message...' : 'Type your message here...'}
                      value={newMessage}
                      onChange={handleTyping}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault()
                          void handleSendMessage()
                        }
                      }}
                      className="h-11 pr-10 bg-background border-border rounded-full"
                      disabled={sendingMessage}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8 text-muted-foreground hover:text-foreground"
                      disabled={sendingMessage}
                    >
                      <Smile className="h-5 w-5" />
                    </Button>
                  </div>
                  <Button
                    onClick={() => void handleSendMessage()}
                    disabled={
                      !newMessage.trim() ||
                      sendingMessage ||
                      (deliveryMethod === 'email' && !emailSubject.trim())
                    }
                    className="h-10 px-6 rounded-full bg-accent hover:bg-accent/90 text-accent-foreground"
                  >
                    {sendingMessage ? 'Sending...' : deliveryMethod === 'email' ? 'Send Email' : 'Send'}
                  </Button>
                </div>
              </div>
            </div>
          </>
        ) : (
          /* Empty State */
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <MessageCircle className="h-16 w-16 mx-auto mb-4 text-muted-foreground" />
              <h3 className="text-lg font-semibold text-foreground mb-2">No conversation selected</h3>
              <p className="text-sm text-muted-foreground">
                Select a conversation from the list to start chatting
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

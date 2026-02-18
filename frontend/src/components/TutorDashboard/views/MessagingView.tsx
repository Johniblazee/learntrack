import { useState, useMemo } from "react"
import { useAuth } from "@clerk/clerk-react"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Search,
  MessageSquare,
  Mail,
  AlertCircle,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useConversations } from "@/hooks/useQueries"
import { formatDistanceToNow } from "date-fns"

interface Message {
  id: string
  sender: string
  senderAvatar: string
  subject: string
  preview: string
  timestamp: string
  deliveryMethod: "chat" | "email"
  isRead: boolean
  isUnread: boolean
}

interface MessagingViewProps {
  type: "chats" | "emails"
}

export default function MessagingView({ type }: MessagingViewProps) {
  const { userId } = useAuth()
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null)

  const { data: conversations, isLoading, isError } = useConversations()

  // Transform conversations to messages format
  const messages: Message[] = useMemo(() => {
    if (!conversations || !Array.isArray(conversations)) return []

    const mappedMessages = conversations.map((conv: any) => {
      const participantIds = Array.isArray(conv.participants) ? conv.participants : []
      const otherParticipantId = participantIds.find((id: string) => id !== userId) || participantIds[0]
      const otherParticipant = otherParticipantId
        ? (conv.participant_names?.[otherParticipantId] || 'Unknown')
        : 'Unknown'
      const initials = otherParticipant.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)
      const unreadCountForUser = Number(conv.unread_count?.[userId ?? '']) || 0
      const deliveryMethod: 'chat' | 'email' = conv.last_delivery_method === 'email' ? 'email' : 'chat'
      const preview = conv.last_message || 'No messages yet'
      const subject =
        deliveryMethod === 'email'
          ? (preview.startsWith('Email: ') ? preview.slice(7).trim() : 'Email message')
          : (conv.title || 'Direct message')

      return {
        id: conv._id || conv.id,
        sender: otherParticipant,
        senderAvatar: initials,
        subject,
        preview,
        timestamp: conv.updated_at ? formatDistanceToNow(new Date(conv.updated_at), { addSuffix: true }) : '',
        deliveryMethod,
        isRead: unreadCountForUser === 0,
        isUnread: unreadCountForUser > 0
      }
    })

    return mappedMessages.filter((message) => {
      if (type === 'emails') return message.deliveryMethod === 'email'
      return message.deliveryMethod === 'chat'
    })
  }, [conversations, type, userId])

  const unreadCount = messages.filter(m => m.isUnread).length
  const icon = type === "chats" ? MessageSquare : Mail

  const filteredMessages = messages.filter(message =>
    message.sender.toLowerCase().includes(searchQuery.toLowerCase()) ||
    message.subject.toLowerCase().includes(searchQuery.toLowerCase()) ||
    message.preview.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const Icon = icon

  // Loading skeleton
  if (isLoading) {
    return (
      <div className="flex h-[calc(100vh-8rem)] bg-background">
        <div className="w-80 border-r border-border flex flex-col bg-card">
          <div className="p-4 border-b border-border">
            <div className="flex items-center gap-2 mb-4">
              <Skeleton className="h-8 w-8 rounded-lg" />
              <Skeleton className="h-5 w-20" />
            </div>
            <Skeleton className="h-9 w-full" />
          </div>
          <div className="p-2 space-y-2">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex items-start gap-3 p-3">
                <Skeleton className="h-10 w-10 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-3/4" />
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <Skeleton className="h-8 w-48" />
        </div>
      </div>
    )
  }

  // Error state
  if (isError) {
    return (
      <div className="flex h-[calc(100vh-8rem)] bg-background items-center justify-center">
        <div className="text-center">
          <AlertCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground">Failed to load messages</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] bg-background">
      <div className="w-80 border-r border-border flex flex-col bg-card">
        <div className="p-4 border-b border-border">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 bg-primary rounded-lg flex items-center justify-center">
                <Icon className="h-4 w-4 text-primary-foreground" />
              </div>
              <h2 className="text-lg font-semibold text-foreground">Inbox</h2>
            </div>
            {unreadCount > 0 && (
              <Badge variant="secondary" className="h-5 px-2 text-xs">
                Unreads {unreadCount}
              </Badge>
            )}
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Type to search..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-9 bg-background"
            />
          </div>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-2">
            {filteredMessages.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Icon className="h-8 w-8 text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">No messages yet</p>
              </div>
            ) : filteredMessages.map((message) => (
              <div
                key={message.id}
                onClick={() => setSelectedMessage(message)}
                className={cn(
                  "flex items-start gap-3 p-3 rounded-lg cursor-pointer transition-colors mb-1",
                  selectedMessage?.id === message.id ? "bg-primary/10" : "hover:bg-muted/50",
                  !message.isRead && "bg-muted/30"
                )}
              >
                <Avatar className="h-10 w-10 shrink-0 mt-0.5">
                  <AvatarFallback className={cn(
                    "text-xs font-medium",
                    !message.isRead ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                  )}>
                    {message.senderAvatar}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <p className={cn(
                      "text-sm truncate",
                      !message.isRead ? "font-semibold text-foreground" : "font-normal text-foreground"
                    )}>
                      {message.sender}
                    </p>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {message.timestamp}
                    </span>
                  </div>
                  <p className={cn(
                    "text-sm mb-1 truncate",
                    !message.isRead ? "font-medium text-foreground" : "text-muted-foreground"
                  )}>
                    {message.subject}
                  </p>
                  <p className="text-xs text-muted-foreground line-clamp-2">
                    {message.preview}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </div>
      <div className="flex-1 flex items-center justify-center bg-background">
        {selectedMessage ? (
          <div className="p-8 max-w-4xl w-full">
            <div className="bg-card border border-border rounded-lg p-6">
              <div className="flex items-start gap-4 mb-6">
                <Avatar className="h-12 w-12">
                  <AvatarFallback className="bg-primary text-primary-foreground">
                    {selectedMessage.senderAvatar}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-foreground mb-1">
                    {selectedMessage.subject}
                  </h3>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <span className="font-medium text-foreground">{selectedMessage.sender}</span>
                    <span>•</span>
                    <span>{selectedMessage.timestamp}</span>
                  </div>
                </div>
              </div>
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <p className="text-foreground">{selectedMessage.preview}</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-center">
            <Icon className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-foreground mb-2">
              No message selected
            </h3>
            <p className="text-sm text-muted-foreground">
              Select a message from the list to view its contents
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

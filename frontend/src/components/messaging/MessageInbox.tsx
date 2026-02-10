import { useState, useMemo } from "react"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Mail,
  Search,
  Star,
  Archive,
  MailOpen,
  AlertCircle
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
  isRead: boolean
  isStarred: boolean
  category: "inbox" | "sent" | "archived"
}

export function MessageInbox() {
  const { data: conversations, isLoading, isError } = useConversations()
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [starredIds, setStarredIds] = useState<Set<string>>(new Set())
  const [readIds, setReadIds] = useState<Set<string>>(new Set())

  // Transform conversations to messages format
  const messages: Message[] = useMemo(() => {
    if (!conversations || !Array.isArray(conversations)) return []

    return conversations.map((conv: any) => {
      const otherParticipant = conv.participant_names?.[0] || 'Unknown'
      const initials = otherParticipant.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)

      return {
        id: conv._id || conv.id,
        sender: otherParticipant,
        senderAvatar: initials,
        subject: conv.title || 'No subject',
        preview: conv.last_message || 'No messages yet',
        timestamp: conv.updated_at ? formatDistanceToNow(new Date(conv.updated_at), { addSuffix: true }) : '',
        isRead: readIds.has(conv._id || conv.id) || conv.is_read !== false,
        isStarred: starredIds.has(conv._id || conv.id),
        category: "inbox" as const
      }
    })
  }, [conversations, starredIds, readIds])

  const unreadCount = messages.filter(m => !m.isRead).length

  const filteredMessages = messages.filter(message =>
    message.sender.toLowerCase().includes(searchQuery.toLowerCase()) ||
    message.subject.toLowerCase().includes(searchQuery.toLowerCase()) ||
    message.preview.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const toggleStar = (messageId: string) => {
    setStarredIds(prev => {
      const newSet = new Set(prev)
      if (newSet.has(messageId)) {
        newSet.delete(messageId)
      } else {
        newSet.add(messageId)
      }
      return newSet
    })
  }

  const markAsRead = (messageId: string) => {
    setReadIds(prev => new Set(prev).add(messageId))
  }

  const handleMessageClick = (message: Message) => {
    setSelectedMessage(message)
    markAsRead(message.id)
  }

  // Loading skeleton
  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-8 rounded-lg" />
          <Skeleton className="h-4 w-20" />
        </div>
        <Skeleton className="h-8 w-full" />
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-20 w-full rounded-lg" />
          ))}
        </div>
      </div>
    )
  }

  // Error state
  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <AlertCircle className="h-8 w-8 text-muted-foreground mb-2" />
        <p className="text-sm text-muted-foreground">Failed to load messages</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 bg-primary/10 rounded-lg flex items-center justify-center">
            <Mail className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">Inbox</h3>
            {unreadCount > 0 && (
              <p className="text-[10px] text-muted-foreground">
                {unreadCount} unread
              </p>
            )}
          </div>
        </div>
        {unreadCount > 0 && (
          <Badge variant="secondary" className="h-5 px-2">
            {unreadCount}
          </Badge>
        )}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          placeholder="Search messages..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-8 h-8 text-xs"
        />
      </div>

      {/* Message List */}
      <ScrollArea className="h-[400px]">
        <div className="space-y-2">
          {filteredMessages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Mail className="h-8 w-8 text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">No messages yet</p>
            </div>
          ) : filteredMessages.map((message) => (
            <div
              key={message.id}
              onClick={() => handleMessageClick(message)}
              className={cn(
                "bg-card border border-border rounded-lg p-3 cursor-pointer transition-all duration-200 group",
                "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground hover:shadow-sm",
                !message.isRead && "bg-primary/5 border-primary/30",
                selectedMessage?.id === message.id && "border-primary shadow-sm"
              )}
            >
              <div className="flex items-start gap-2">
                <Avatar className="h-8 w-8 shrink-0">
                  <AvatarFallback className="text-[10px] bg-primary/10 text-primary">
                    {message.senderAvatar}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <p className={cn(
                      "text-xs truncate",
                      !message.isRead ? "font-semibold text-foreground" : "font-medium text-foreground"
                    )}>
                      {message.sender}
                    </p>
                    <div className="flex items-center gap-1 shrink-0">
                      <span className="text-[10px] text-muted-foreground">
                        {message.timestamp}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-4 w-4 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={(e) => {
                          e.stopPropagation()
                          toggleStar(message.id)
                        }}
                      >
                        <Star
                          className={cn(
                            "h-3 w-3",
                            message.isStarred ? "fill-amber-400 text-amber-400" : "text-muted-foreground"
                          )}
                        />
                      </Button>
                    </div>
                  </div>
                  <p className={cn(
                    "text-[11px] mb-1 truncate",
                    !message.isRead ? "font-medium text-foreground" : "text-muted-foreground"
                  )}>
                    {message.subject}
                  </p>
                  <p className="text-[10px] text-muted-foreground line-clamp-1">
                    {message.preview}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>

      {/* Quick Actions */}
      <div className="flex items-center gap-2 pt-2 border-t border-border">
        <Button variant="ghost" size="sm" className="h-7 text-xs flex-1">
          <MailOpen className="h-3 w-3 mr-1" />
          Mark all read
        </Button>
        <Button variant="ghost" size="sm" className="h-7 text-xs flex-1">
          <Archive className="h-3 w-3 mr-1" />
          Archive
        </Button>
      </div>
    </div>
  )
}


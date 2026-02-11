/**
 * Floating chat widget - accessible from all pages
 */
import { useState, useEffect, useMemo, useRef, type ChangeEvent } from 'react'
import { MessageCircle, X, Send, Minimize2, Maximize2 } from 'lucide-react';
import { useAuth } from '@clerk/clerk-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { socketClient } from '@/lib/socket';
import { useVisibility } from '@/hooks/useVisibility';
import { cn } from '@/lib/utils';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api/v1';

interface Message {
  _id: string;
  conversation_id: string;
  sender_id: string;
  sender_name: string;
  sender_role: string;
  content: string;
  created_at: string;
  read_by: string[];
}

interface Conversation {
  _id: string;
  participants: string[];
  participant_names: Record<string, string>;
  participant_roles: Record<string, string>;
  last_message: string | null;
  last_message_at: string | null;
  unread_count: Record<string, number>;
}

export default function ChatWidget() {
  const { getToken, userId } = useAuth();
  const { visibleUserIds, loading: visibilityLoading } = useVisibility();
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationsLoading, setConversationsLoading] = useState(false);
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [unreadCount, setUnreadCount] = useState(0);
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Initialize socket connection
  useEffect(() => {
    const initSocket = async () => {
      const token = await getToken();
      if (token) {
        socketClient.connect(token);
      }
    };

    initSocket();

    return () => {
      socketClient.disconnect();
    };
  }, [getToken]);

  // Load conversations
  useEffect(() => {
    if (isOpen) {
      loadConversations();
      loadUnreadCount();
    }
  }, [isOpen]);

  // Listen for new messages
  useEffect(() => {
    const handleNewMessage = (message: Message) => {
      if (selectedConversation && message.conversation_id === selectedConversation._id) {
        setMessages((prev) => [...prev, message]);
        scrollToBottom();
        
        // Mark as read if widget is open
        if (isOpen && !isMinimized) {
          markConversationAsRead(selectedConversation._id);
        }
      }
      
      // Update unread count
      loadUnreadCount();
      loadConversations();
    };

    const handleUserTyping = (data: any) => {
      if (selectedConversation && data.conversation_id === selectedConversation._id && data.user_id !== userId) {
        setIsTyping(data.typing);
      }
    };

    socketClient.onNewMessage(handleNewMessage);
    socketClient.onUserTyping(handleUserTyping);

    return () => {
      socketClient.offNewMessage(handleNewMessage);
      socketClient.offUserTyping(handleUserTyping);
    };
  }, [selectedConversation, isOpen, isMinimized, userId]);

  // Auto-scroll to bottom
  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const loadConversations = async () => {
    try {
      setConversationsLoading(true);
      const token = await getToken();
      const response = await fetch(`${API_BASE}/conversations`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();

      setConversations(data.conversations || []);
    } catch (error) {
      console.error('Failed to load conversations:', error);
    } finally {
      setConversationsLoading(false);
    }
  };

  const visibleConversations = useMemo(() => {
    if (!userId || visibilityLoading) {
      return [];
    }

    return conversations.filter((conv) =>
      conv.participants.every(
        (participantId) => participantId === userId || visibleUserIds.includes(participantId)
      )
    );
  }, [conversations, userId, visibilityLoading, visibleUserIds]);

  useEffect(() => {
    if (!selectedConversation || visibilityLoading) {
      return;
    }

    const stillVisible = visibleConversations.some(
      (conversation) => conversation._id === selectedConversation._id
    );

    if (!stillVisible) {
      socketClient.leaveConversation(selectedConversation._id);
      setSelectedConversation(null);
      setMessages([]);
    }
  }, [selectedConversation, visibilityLoading, visibleConversations]);

  const loadUnreadCount = async () => {
    try {
      const token = await getToken();
      const response = await fetch(`${API_BASE}/conversations/unread/count`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      setUnreadCount(data.unread_count || 0);
    } catch (error) {
      console.error('Failed to load unread count:', error);
    }
  };

  const loadMessages = async (conversationId: string) => {
    try {
      const token = await getToken();
      const response = await fetch(`${API_BASE}/messages/conversation/${conversationId}?page=1&page_size=50`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      setMessages(data.messages || []);
      
      // Join conversation room
      socketClient.joinConversation(conversationId);
      
      // Mark as read
      markConversationAsRead(conversationId);
    } catch (error) {
      console.error('Failed to load messages:', error);
    }
  };

  const markConversationAsRead = async (conversationId: string) => {
    try {
      const token = await getToken();
      await fetch(`${API_BASE}/conversations/${conversationId}/read`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` },
      });
      loadUnreadCount();
      loadConversations();
    } catch (error) {
      console.error('Failed to mark as read:', error);
    }
  };

  const handleSelectConversation = (conversation: Conversation) => {
    // Leave previous conversation
    if (selectedConversation) {
      socketClient.leaveConversation(selectedConversation._id);
    }
    
    setSelectedConversation(conversation);
    loadMessages(conversation._id);
    setIsMinimized(false);
  };

  const handleSendMessage = () => {
    if (!newMessage.trim() || !selectedConversation) return;

    socketClient.sendMessage(selectedConversation._id, newMessage, 'text', (response) => {
      if (response.success) {
        setNewMessage('');
        socketClient.stopTyping(selectedConversation._id);
      }
    });
  };

  const handleTyping = (e: ChangeEvent<HTMLInputElement>) => {
    setNewMessage(e.target.value);
    
    if (!selectedConversation) return;
    
    // Start typing indicator
    socketClient.startTyping(selectedConversation._id);
    
    // Clear previous timeout
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    
    // Stop typing after 2 seconds of inactivity
    typingTimeoutRef.current = setTimeout(() => {
      socketClient.stopTyping(selectedConversation._id);
    }, 2000);
  };

  const getOtherParticipantName = (conversation: Conversation) => {
    const otherParticipant = conversation.participants.find((p) => p !== userId);
    return otherParticipant ? conversation.participant_names[otherParticipant] : 'Unknown';
  };

  if (!isOpen) {
    return (
      <div className="fixed bottom-6 right-6 z-50">
        <Button
          onClick={() => setIsOpen(true)}
          size="lg"
          className="h-14 w-14 rounded-full shadow-lg hover:shadow-xl transition-all"
        >
          <MessageCircle className="h-6 w-6" />
          {unreadCount > 0 && (
            <Badge
              variant="destructive"
              className="absolute -top-1 -right-1 h-5 w-5 p-0 flex items-center justify-center text-[10px]"
            >
              {unreadCount > 9 ? '9+' : unreadCount}
            </Badge>
          )}
        </Button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "fixed bottom-6 right-6 z-50 bg-card dark:bg-sidebar-background border border-border dark:border-sidebar-border rounded-lg shadow-2xl transition-all",
        isMinimized ? "w-80 h-14" : "w-96 h-[500px]",
        "flex flex-col"
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border dark:border-sidebar-border bg-primary/5 dark:bg-sidebar-background">
        <div className="flex items-center gap-3">
          <Avatar className="h-8 w-8">
            <AvatarFallback className="bg-primary/10 text-primary text-xs">
              {selectedConversation ? getOtherParticipantName(selectedConversation).charAt(0).toUpperCase() : 'M'}
            </AvatarFallback>
          </Avatar>
          <div>
            <p className="text-sm font-semibold text-foreground dark:text-sidebar-foreground">
              {selectedConversation ? getOtherParticipantName(selectedConversation) : 'Messages'}
            </p>
            {selectedConversation && (
              <p className="text-[10px] text-muted-foreground dark:text-sidebar-foreground/70">Active now</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {selectedConversation && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                socketClient.leaveConversation(selectedConversation._id);
                setSelectedConversation(null);
                setMessages([]);
              }}
              className="h-8 w-8 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-all duration-200"
            >
              ←
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsMinimized(!isMinimized)}
            className="h-8 w-8 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-all duration-200"
          >
            {isMinimized ? (
              <Maximize2 className="h-4 w-4" />
            ) : (
              <Minimize2 className="h-4 w-4" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              setIsOpen(false);
              if (selectedConversation) {
                socketClient.leaveConversation(selectedConversation._id);
              }
            }}
            className="h-8 w-8 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-all duration-200"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {!isMinimized && (
        <>
          {/* Conversation List or Messages */}
          {!selectedConversation ? (
            <ScrollArea className="flex-1 p-4">
              {conversationsLoading || visibilityLoading ? (
                <div className="text-center text-muted-foreground py-8">
                  <p className="text-sm">Loading conversations...</p>
                </div>
              ) : visibleConversations.length === 0 ? (
                <div className="text-center text-muted-foreground py-8">
                  <MessageCircle className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                  <p className="text-sm">No conversations yet</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {visibleConversations.map((conv) => (
                    <div
                      key={conv._id}
                      onClick={() => handleSelectConversation(conv)}
                      className={cn(
                        "flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all duration-200",
                        "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground border border-border dark:border-sidebar-border"
                      )}
                    >
                      <div className="relative">
                        <Avatar className="h-10 w-10">
                          <AvatarFallback className="bg-primary/10 text-primary">
                            {getOtherParticipantName(conv).charAt(0).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <p className="text-sm font-semibold text-foreground dark:text-sidebar-foreground truncate">
                            {getOtherParticipantName(conv)}
                          </p>
                          {conv.unread_count[userId || ''] > 0 && (
                            <Badge variant="destructive" className="h-5 px-2 text-[10px] ml-2">
                              {conv.unread_count[userId || '']}
                            </Badge>
                          )}
                        </div>
                        {conv.last_message && (
                          <p className="text-xs text-muted-foreground dark:text-sidebar-foreground/70 truncate">
                            {conv.last_message}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          ) : (
            <>
              {/* Messages */}
              <ScrollArea className="flex-1 p-4">
                <div className="space-y-4">
                  {messages.map((message) => (
                    <div
                      key={message._id}
                      className={cn(
                        "flex gap-2",
                        message.sender_id === userId ? "justify-end" : "justify-start"
                      )}
                    >
                      {message.sender_id !== userId && (
                        <Avatar className="h-6 w-6 shrink-0">
                          <AvatarFallback className="bg-primary/10 text-primary text-[10px]">
                            {getOtherParticipantName(selectedConversation).charAt(0).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                      )}
                      <div
                        className={cn(
                          "max-w-[75%] rounded-lg px-3 py-2",
                          message.sender_id === userId
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-foreground"
                        )}
                      >
                        <p className="text-xs">{message.content}</p>
                        <p className={cn(
                          "text-[10px] mt-1",
                          message.sender_id === userId
                            ? "text-primary-foreground/70"
                            : "text-muted-foreground"
                        )}>
                          {new Date(message.created_at).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </p>
                      </div>
                      {message.sender_id === userId && (
                        <Avatar className="h-6 w-6 shrink-0">
                          <AvatarFallback className="bg-primary text-primary-foreground text-[10px]">
                            ME
                          </AvatarFallback>
                        </Avatar>
                      )}
                    </div>
                  ))}
                  {isTyping && (
                    <div className="flex justify-start">
                      <div className="bg-muted rounded-lg px-3 py-2">
                        <p className="text-xs text-muted-foreground italic">Typing...</p>
                      </div>
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </div>
              </ScrollArea>

              {/* Message Input */}
              <div className="p-4 border-t border-border dark:border-sidebar-border">
                <div className="flex items-center gap-2">
                  <Input
                    placeholder="Type a message..."
                    value={newMessage}
                    onChange={handleTyping}
                    onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSendMessage()}
                    className="flex-1 h-9 text-sm dark:bg-sidebar-background dark:text-sidebar-foreground dark:border-sidebar-border"
                  />
                  <Button
                    size="icon"
                    onClick={handleSendMessage}
                    disabled={!newMessage.trim()}
                    className="h-9 w-9 shrink-0"
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}


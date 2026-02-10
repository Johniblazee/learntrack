/**
 * Send Message Modal - For sending messages to students
 * Matches the dark theme design with golden send button
 */

import { useState, type KeyboardEvent } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Send, Loader2 } from 'lucide-react'
import { toast } from '@/contexts/ToastContext'
import { useApiClient } from '@/lib/api-client'
import { socketClient } from '@/lib/socket'

interface Student {
  id: string
  name: string
  email: string
  avatar?: string
}

interface SendMessageModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  student: Student | null
  onMessageSent?: () => void
}

/**
 * Modal for sending messages to students
 * Creates or finds existing conversation and sends message via WebSocket
 */
export function SendMessageModal({
  open,
  onOpenChange,
  student,
  onMessageSent
}: SendMessageModalProps) {
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const client = useApiClient()

  const handleSendMessage = async () => {
    if (!message.trim() || !student) {
      toast.error('Please enter a message')
      return
    }

    try {
      setSending(true)

      // Get or create conversation with this student using the convenient endpoint
      const conversationResponse = await client.post(`/conversations/with-user/${student.id}`)

      if (conversationResponse.error) {
        throw new Error(conversationResponse.error)
      }

      const conversation = conversationResponse.data as any

      // Send message via WebSocket if connected, otherwise use HTTP
      if (socketClient.isConnected()) {
        socketClient.sendMessage(conversation._id, message, 'text', (response) => {
          if (response.success) {
            toast.success('Message sent successfully')
            setMessage('')
            onOpenChange(false)
            onMessageSent?.()
          } else {
            toast.error(response.error || 'Failed to send message')
          }
          setSending(false)
        })
      } else {
        // Fallback to HTTP if WebSocket not connected
        const messageResponse = await client.post('/messages/', {
          conversation_id: conversation._id,
          content: message,
          message_type: 'text'
        })

        if (messageResponse.error) {
          throw new Error(messageResponse.error)
        }

        toast.success('Message sent successfully')
        setMessage('')
        onOpenChange(false)
        onMessageSent?.()
        setSending(false)
      }
    } catch (error: any) {
      console.error('Failed to send message:', error)
      toast.error(error.message || 'Failed to send message')
      setSending(false)
    }
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSendMessage()
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] bg-[#1a1a1a] dark:bg-[#1a1a1a] border-gray-800">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold text-white">
            Send a Message
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-4">
          {/* Recipient */}
          {student && (
            <div className="flex items-center gap-3 pb-2">
              <span className="text-sm text-gray-400">To:</span>
              <div className="flex items-center gap-2">
                <Avatar className="h-6 w-6">
                  <AvatarImage src={student.avatar} alt={student.name} />
                  <AvatarFallback className="bg-[#C8A882] text-gray-900 text-xs font-semibold">
                    {student.name.split(' ').map(n => n[0]).join('')}
                  </AvatarFallback>
                </Avatar>
                <span className="text-sm font-medium text-white">{student.name}</span>
              </div>
            </div>
          )}

          {/* Message Input */}
          <Textarea
            placeholder="Type your message here..."
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            className="min-h-[160px] bg-[#2a2a2a] border-0 text-white placeholder:text-gray-500 focus-visible:ring-1 focus-visible:ring-[#C8A882] resize-none"
            disabled={sending}
          />

          {/* Send Button */}
          <div className="flex justify-end pt-2">
            <Button
              onClick={handleSendMessage}
              disabled={!message.trim() || sending}
              className="bg-[#C8A882] hover:bg-[#B89872] text-gray-900 font-semibold px-6 py-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {sending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  Send Message
                  <Send className="h-4 w-4 ml-2" />
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}


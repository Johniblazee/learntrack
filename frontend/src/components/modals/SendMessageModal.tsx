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
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Send } from 'lucide-react'
import { LoadingSpinner } from '@/components/ui/loading-state'
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
  const [subject, setSubject] = useState('')
  const [deliveryMethod, setDeliveryMethod] = useState<'chat' | 'email'>('chat')
  const [sending, setSending] = useState(false)
  const client = useApiClient()

  const resetForm = () => {
    setMessage('')
    setSubject('')
    setDeliveryMethod('chat')
  }

  const handleSendMessage = async () => {
    if (!message.trim() || !student) {
      toast.error('Please enter a message')
      return
    }

    if (deliveryMethod === 'email' && !subject.trim()) {
      toast.error('Please enter an email subject')
      return
    }

    try {
      setSending(true)

      if (deliveryMethod === 'email') {
        const emailResponse = await client.post('/messages/email', {
          recipient_id: student.id,
          subject: subject.trim(),
          content: message.trim(),
        })

        if (emailResponse.error) {
          throw new Error(emailResponse.error)
        }

        toast.success('Email sent successfully')
        resetForm()
        onOpenChange(false)
        onMessageSent?.()
        setSending(false)
        return
      }

      // Get or create conversation with this student using the convenient endpoint
      const conversationResponse = await client.post(`/conversations/with-user/${student.id}`)

      if (conversationResponse.error) {
        throw new Error(conversationResponse.error)
      }

      const conversation = conversationResponse.data as any
      const conversationId = conversation?._id || conversation?.id

      if (!conversationId) {
        throw new Error('Conversation ID not found')
      }

      // Send message via WebSocket if connected, otherwise use HTTP
      if (socketClient.isConnected()) {
        socketClient.sendMessage(conversationId, message.trim(), 'text', (response) => {
          if (response.success) {
            toast.success('Message sent successfully')
            resetForm()
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
          conversation_id: conversationId,
          content: message.trim(),
          message_type: 'text',
          delivery_method: 'chat',
        })

        if (messageResponse.error) {
          throw new Error(messageResponse.error)
        }

        toast.success('Message sent successfully')
        resetForm()
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

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      resetForm()
    }
    onOpenChange(nextOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
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
          <div className="flex gap-2 pb-1">
            <Button
              type="button"
              variant={deliveryMethod === 'chat' ? 'default' : 'outline'}
              className="h-8 text-xs"
              disabled={sending}
              onClick={() => setDeliveryMethod('chat')}
            >
              Chat
            </Button>
            <Button
              type="button"
              variant={deliveryMethod === 'email' ? 'default' : 'outline'}
              className="h-8 text-xs"
              disabled={sending}
              onClick={() => setDeliveryMethod('email')}
            >
              Email
            </Button>
          </div>

          {deliveryMethod === 'email' && (
            <Input
              placeholder="Subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="h-10 bg-[#2a2a2a] border-gray-700 text-white placeholder:text-gray-500 focus-visible:ring-1 focus-visible:ring-[#C8A882]"
              disabled={sending}
              maxLength={200}
            />
          )}

          <Textarea
            placeholder={deliveryMethod === 'email' ? 'Type your email message here...' : 'Type your message here...'}
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
              disabled={!message.trim() || sending || (deliveryMethod === 'email' && !subject.trim())}
              className="bg-[#C8A882] hover:bg-[#B89872] text-gray-900 font-semibold px-6 py-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {sending ? (
                <>
                  <LoadingSpinner size="sm" className="mr-2 text-gray-900" />
                  Sending...
                </>
              ) : (
                <>
                  {deliveryMethod === 'email' ? 'Send Email' : 'Send Message'}
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


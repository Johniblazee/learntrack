/**
 * Socket.IO client wrapper for real-time chat
 */
import { io, Socket } from 'socket.io-client';
import { API_HOST } from '@/lib/config';

const RAW_SOCKET_BASE = import.meta.env.VITE_WS_URL || API_HOST
const SOCKET_URL = RAW_SOCKET_BASE.replace(/\/api\/v\d+$/, '').replace(/\/+$/, '')

class SocketClient {
  private socket: Socket | null = null;

  connect(token: string) {
    if (this.socket?.connected) {
      return this.socket;
    }

    this.socket = io(SOCKET_URL, {
      path: '/ws/socket.io',
      auth: { token },
      autoConnect: true,
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 5,
    });

    this.socket.on('connect', () => {
      console.log('Socket connected');
    });

    this.socket.on('disconnect', () => {
      console.log('Socket disconnected');
    });

    this.socket.on('connect_error', (error) => {
      console.error('Socket connection error:', error);
    });

    return this.socket;
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  getSocket(): Socket | null {
    return this.socket;
  }

  isConnected(): boolean {
    return this.socket?.connected || false;
  }

  // Event emitters
  joinConversation(conversationId: string, callback?: (response: any) => void) {
    this.socket?.emit('join_conversation', { conversation_id: conversationId }, callback);
  }

  leaveConversation(conversationId: string, callback?: (response: any) => void) {
    this.socket?.emit('leave_conversation', { conversation_id: conversationId }, callback);
  }

  sendMessage(conversationId: string, content: string, messageType: string = 'text', callback?: (response: any) => void) {
    this.socket?.emit('send_message', {
      conversation_id: conversationId,
      content,
      message_type: messageType,
    }, callback);
  }

  startTyping(conversationId: string) {
    this.socket?.emit('typing_start', { conversation_id: conversationId });
  }

  stopTyping(conversationId: string) {
    this.socket?.emit('typing_stop', { conversation_id: conversationId });
  }

  markMessageAsRead(messageId: string, conversationId: string) {
    this.socket?.emit('message_read', { message_id: messageId, conversation_id: conversationId });
  }

  // Event listeners
  onNewMessage(callback: (message: any) => void) {
    this.socket?.on('new_message', callback);
  }

  onUserTyping(callback: (data: any) => void) {
    this.socket?.on('user_typing', callback);
  }

  onMessageRead(callback: (data: any) => void) {
    this.socket?.on('message_read_receipt', callback);
  }

  offNewMessage(callback: (message: any) => void) {
    this.socket?.off('new_message', callback);
  }

  offUserTyping(callback: (data: any) => void) {
    this.socket?.off('user_typing', callback);
  }

  offMessageRead(callback: (data: any) => void) {
    this.socket?.off('message_read_receipt', callback);
  }
}

export const socketClient = new SocketClient();


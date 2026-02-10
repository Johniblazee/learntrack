import { createContext, useContext, ReactNode } from 'react'
import { useWebSocket } from '@/hooks/useWebSocket'

interface WebSocketContextType {
  isConnected: boolean
  lastMessage: any
  sendMessage: (message: any) => void
}

const WebSocketContext = createContext<WebSocketContextType | null>(null)

export function useWebSocketContext() {
  const context = useContext(WebSocketContext)
  if (!context) {
    throw new Error('useWebSocketContext must be used within WebSocketProvider')
  }
  return context
}

interface WebSocketProviderProps {
  children: ReactNode
}

export function WebSocketProvider({ children }: WebSocketProviderProps) {
  const { isConnected, lastMessage, sendMessage } = useWebSocket({
    autoReconnect: true,
    reconnectInterval: 5000,
  })

  return (
    <WebSocketContext.Provider value={{ isConnected, lastMessage, sendMessage }}>
      {children}
    </WebSocketContext.Provider>
  )
}


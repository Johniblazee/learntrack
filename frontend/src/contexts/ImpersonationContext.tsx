import { createContext, useContext, useState, useCallback, useEffect } from 'react'
import { useAuth } from '@clerk/clerk-react'
import { IMPERSONATION_STORAGE_KEY } from '@/lib/api-client'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api/v1'

interface ImpersonatedUser {
  id: string
  clerk_id: string
  email: string
  name: string
  role: string
  tutor_id?: string
}

interface ImpersonationSession {
  sessionId: string
  targetUser: ImpersonatedUser
  expiresInMinutes: number
}

interface ImpersonationContextType {
  isImpersonating: boolean
  impersonatedUser: ImpersonatedUser | null
  sessionId: string | null
  startImpersonation: (userId: string) => Promise<void>
  endImpersonation: () => Promise<void>
  isLoading: boolean
  error: string | null
}

const ImpersonationContext = createContext<ImpersonationContextType | undefined>(undefined)

const STORAGE_KEY = IMPERSONATION_STORAGE_KEY

export function ImpersonationProvider({ children }: { children: React.ReactNode }) {
  const { getToken } = useAuth()
  const [session, setSession] = useState<ImpersonationSession | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load session from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      try {
        const parsed = JSON.parse(stored)
        setSession(parsed)
      } catch {
        localStorage.removeItem(STORAGE_KEY)
      }
    }
  }, [])

  const startImpersonation = useCallback(async (userId: string) => {
    try {
      setIsLoading(true)
      setError(null)
      const token = await getToken()
      
      const response = await fetch(`${API_BASE_URL}/admin/impersonation/start`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ target_user_id: userId })
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.detail || 'Failed to start impersonation')
      }

      const data = await response.json()
      const newSession: ImpersonationSession = {
        sessionId: data.session_id,
        targetUser: {
          id: data.target_user.id,
          clerk_id: data.target_user.clerk_id,
          email: data.target_user.email,
          name: data.target_user.name,
          role: data.target_user.role,
          tutor_id: data.target_user.tutor_id
        },
        expiresInMinutes: data.expires_in_minutes
      }
      
      setSession(newSession)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newSession))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      throw err
    } finally {
      setIsLoading(false)
    }
  }, [getToken])

  const endImpersonation = useCallback(async () => {
    if (!session) return
    
    try {
      setIsLoading(true)
      setError(null)
      const token = await getToken()
      
      await fetch(`${API_BASE_URL}/admin/impersonation/end?session_id=${session.sessionId}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      })
      
      setSession(null)
      localStorage.removeItem(STORAGE_KEY)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setIsLoading(false)
    }
  }, [getToken, session])

  const value: ImpersonationContextType = {
    isImpersonating: session !== null,
    impersonatedUser: session?.targetUser ?? null,
    sessionId: session?.sessionId ?? null,
    startImpersonation,
    endImpersonation,
    isLoading,
    error
  }

  return (
    <ImpersonationContext.Provider value={value}>
      {children}
    </ImpersonationContext.Provider>
  )
}

export function useImpersonation() {
  const context = useContext(ImpersonationContext)
  if (context === undefined) {
    throw new Error('useImpersonation must be used within an ImpersonationProvider')
  }
  return context
}


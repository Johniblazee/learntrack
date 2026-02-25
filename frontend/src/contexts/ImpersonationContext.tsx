import { createContext, useContext, useState, useCallback, useEffect } from 'react'
import { useAuth } from '@clerk/clerk-react'
import {
  IMPERSONATION_SESSION_CHANGED_EVENT,
  IMPERSONATION_STORAGE_KEY,
} from '@/lib/api-client'
import { API_BASE_URL } from '@/lib/config'

function emitImpersonationSessionChangedEvent() {
  if (typeof window === 'undefined') {
    return
  }

  window.dispatchEvent(new Event(IMPERSONATION_SESSION_CHANGED_EVENT))
}

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

function parseStoredSession(raw: string | null): ImpersonationSession | null {
  if (!raw) {
    return null
  }

  try {
    const parsed = JSON.parse(raw)
    const sessionId = typeof parsed?.sessionId === 'string' ? parsed.sessionId.trim() : ''
    const targetUser = parsed?.targetUser

    if (!sessionId || !targetUser || typeof targetUser !== 'object') {
      return null
    }

    const targetClerkId = typeof targetUser.clerk_id === 'string' ? targetUser.clerk_id.trim() : ''
    if (!targetClerkId) {
      return null
    }

    const expiresInMinutes = Number(parsed?.expiresInMinutes)
    return {
      sessionId,
      targetUser: {
        id: typeof targetUser.id === 'string' ? targetUser.id : '',
        clerk_id: targetClerkId,
        email: typeof targetUser.email === 'string' ? targetUser.email : '',
        name: typeof targetUser.name === 'string' ? targetUser.name : 'Unknown',
        role: typeof targetUser.role === 'string' ? targetUser.role : 'student',
        tutor_id: typeof targetUser.tutor_id === 'string' ? targetUser.tutor_id : undefined,
      },
      expiresInMinutes: Number.isFinite(expiresInMinutes) ? expiresInMinutes : 0,
    }
  } catch {
    return null
  }
}

export function ImpersonationProvider({ children }: { children: React.ReactNode }) {
  const { getToken } = useAuth()
  const [session, setSession] = useState<ImpersonationSession | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const persistSession = useCallback((nextSession: ImpersonationSession) => {
    setSession(nextSession)
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextSession))
      emitImpersonationSessionChangedEvent()
    }
  }, [])

  const clearSession = useCallback(() => {
    setSession(null)
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(STORAGE_KEY)
      emitImpersonationSessionChangedEvent()
    }
  }, [])

  const validateSession = useCallback(async (sessionId: string) => {
    const normalizedSessionId = sessionId.trim()
    if (!normalizedSessionId) {
      clearSession()
      return false
    }

    try {
      const token = await getToken()
      if (!token) {
        clearSession()
        return false
      }

      const response = await fetch(`${API_BASE_URL}/admin/impersonation/session/${normalizedSessionId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      })

      if (!response.ok) {
        clearSession()
        if (response.status === 404) {
          setError('User preview session expired. Start a new session to continue.')
        }
        return false
      }

      const data = await response.json()
      const refreshedSession: ImpersonationSession = {
        sessionId: typeof data?.session_id === 'string' ? data.session_id : normalizedSessionId,
        targetUser: {
          id: typeof data?.target_user?.id === 'string' ? data.target_user.id : '',
          clerk_id: typeof data?.target_user?.clerk_id === 'string' ? data.target_user.clerk_id : '',
          email: typeof data?.target_user?.email === 'string' ? data.target_user.email : '',
          name: typeof data?.target_user?.name === 'string' ? data.target_user.name : 'Unknown',
          role: typeof data?.target_user?.role === 'string' ? data.target_user.role : 'student',
          tutor_id:
            typeof data?.target_user?.tutor_id === 'string' ? data.target_user.tutor_id : undefined,
        },
        expiresInMinutes:
          typeof data?.remaining_minutes === 'number' && Number.isFinite(data.remaining_minutes)
            ? data.remaining_minutes
            : 0,
      }

      if (!refreshedSession.targetUser.clerk_id) {
        clearSession()
        setError('User preview session is invalid. Start a new session to continue.')
        return false
      }

      persistSession(refreshedSession)
      return true
    } catch (validationError) {
      console.error('Failed to validate impersonation session:', validationError)
      return false
    }
  }, [clearSession, getToken, persistSession])

  // Load session from localStorage on mount
  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const storedSession = parseStoredSession(window.localStorage.getItem(STORAGE_KEY))
    if (!storedSession) {
      window.localStorage.removeItem(STORAGE_KEY)
      return
    }

    setSession(storedSession)
    void validateSession(storedSession.sessionId)
  }, [validateSession])

  useEffect(() => {
    if (typeof window === 'undefined' || !session?.sessionId) {
      return
    }

    const revalidateSession = () => {
      void validateSession(session.sessionId)
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        revalidateSession()
      }
    }

    window.addEventListener('focus', revalidateSession)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    const intervalId = window.setInterval(revalidateSession, 60_000)

    return () => {
      window.removeEventListener('focus', revalidateSession)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.clearInterval(intervalId)
    }
  }, [session?.sessionId, validateSession])

  const startImpersonation = useCallback(async (userId: string) => {
    try {
      setIsLoading(true)
      setError(null)
      const token = await getToken()

      if (!token) {
        throw new Error('Authentication token is missing')
      }
      
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

      persistSession(newSession)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      throw err
    } finally {
      setIsLoading(false)
    }
  }, [getToken, persistSession])

  const endImpersonation = useCallback(async () => {
    if (!session) {
      clearSession()
      return
    }

    let endError: string | null = null
    
    try {
      setIsLoading(true)
      setError(null)
      const token = await getToken()

      if (token) {
        const response = await fetch(`${API_BASE_URL}/admin/impersonation/end?session_id=${session.sessionId}`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        })

        if (!response.ok) {
          const payload = await response.json().catch(() => ({}))
          endError = payload?.detail || 'Failed to stop user preview session'
        }
      }
    } catch (err) {
      endError = err instanceof Error ? err.message : 'Unknown error'
    } finally {
      clearSession()
      if (endError) {
        setError(endError)
      }
      setIsLoading(false)
    }
  }, [clearSession, getToken, session])

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


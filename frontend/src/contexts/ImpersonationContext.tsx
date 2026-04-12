import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react'
import { useAuth } from '@clerk/clerk-react'
import { IMPERSONATION_SESSION_CHANGED_EVENT } from '@/lib/api-client'
import { API_BASE_URL } from '@/lib/config'

// BroadcastChannel name shared across tabs for the same origin.
const BC_CHANNEL_NAME = 'learntrack_impersonation'

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

type BcMessage =
  | { type: 'session_changed' }
  | { type: 'session_cleared' }

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

async function fetchCurrentSession(token: string): Promise<ImpersonationSession | null> {
  const response = await fetch(`${API_BASE_URL}/admin/impersonation/current`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    credentials: 'include',
  })

  if (!response.ok) {
    return null
  }

  const data = await response.json().catch(() => null)
  if (!data || data.active !== true) {
    return null
  }

  const targetClerkId = typeof data?.target_user?.clerk_id === 'string' ? data.target_user.clerk_id : ''
  if (!targetClerkId) {
    return null
  }

  return {
    sessionId: typeof data?.session_id === 'string' ? data.session_id : '',
    targetUser: {
      id: typeof data?.target_user?.id === 'string' ? data.target_user.id : '',
      clerk_id: targetClerkId,
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
}

export function ImpersonationProvider({ children }: { children: React.ReactNode }) {
  const { getToken } = useAuth()
  const [session, setSession] = useState<ImpersonationSession | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // BroadcastChannel for cross-tab coordination — the cookie itself is
  // shared across tabs automatically; this just lets other tabs refresh their
  // React state when the session starts or ends.
  const bcRef = useRef<BroadcastChannel | null>(null)

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return
    const bc = new BroadcastChannel(BC_CHANNEL_NAME)
    bcRef.current = bc

    bc.onmessage = async (event: MessageEvent<BcMessage>) => {
      if (event.data.type === 'session_cleared') {
        setSession(null)
        return
      }

      if (event.data.type === 'session_changed') {
        try {
          const token = await getToken()
          if (!token) return
          const refreshed = await fetchCurrentSession(token)
          setSession(refreshed)
        } catch (err) {
          console.error('Failed to refresh impersonation session after broadcast:', err)
        }
      }
    }

    return () => {
      bc.close()
      bcRef.current = null
    }
  }, [getToken])

  const broadcastChanged = useCallback(() => {
    bcRef.current?.postMessage({ type: 'session_changed' } satisfies BcMessage)
  }, [])

  const broadcastCleared = useCallback(() => {
    bcRef.current?.postMessage({ type: 'session_cleared' } satisfies BcMessage)
  }, [])

  const refreshFromServer = useCallback(async () => {
    try {
      const token = await getToken()
      if (!token) {
        setSession(null)
        return
      }

      const currentSession = await fetchCurrentSession(token)
      setSession(currentSession)
    } catch (err) {
      console.error('Failed to load impersonation session:', err)
      setSession(null)
    }
  }, [getToken])

  // On mount: ask the backend whether there's an active session for the
  // cookie the browser is already sending.
  useEffect(() => {
    void refreshFromServer()
  }, [refreshFromServer])

  // Revalidate on focus / visibility / interval — same cadence as before, just
  // against the new `/current` endpoint.
  useEffect(() => {
    if (typeof window === 'undefined' || !session?.sessionId) {
      return
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void refreshFromServer()
      }
    }

    const handleFocus = () => {
      void refreshFromServer()
    }

    window.addEventListener('focus', handleFocus)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    const intervalId = window.setInterval(() => void refreshFromServer(), 60_000)

    return () => {
      window.removeEventListener('focus', handleFocus)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.clearInterval(intervalId)
    }
  }, [session?.sessionId, refreshFromServer])

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
        credentials: 'include',
        body: JSON.stringify({ target_user_id: userId })
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data?.detail || 'Failed to start impersonation')
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
      emitImpersonationSessionChangedEvent()
      broadcastChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      throw err
    } finally {
      setIsLoading(false)
    }
  }, [getToken, broadcastChanged])

  const endImpersonation = useCallback(async () => {
    let endError: string | null = null

    try {
      setIsLoading(true)
      setError(null)
      const token = await getToken()

      if (token) {
        const response = await fetch(`${API_BASE_URL}/admin/impersonation/end`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          credentials: 'include',
        })

        if (!response.ok && response.status !== 404) {
          const payload = await response.json().catch(() => ({}))
          endError = payload?.detail || 'Failed to stop user preview session'
        }
      }
    } catch (err) {
      endError = err instanceof Error ? err.message : 'Unknown error'
    } finally {
      setSession(null)
      emitImpersonationSessionChangedEvent()
      broadcastCleared()
      if (endError) {
        setError(endError)
      }
      setIsLoading(false)
    }
  }, [getToken, broadcastCleared])

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

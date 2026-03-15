import { useCallback, useMemo } from 'react'
import { useAuth } from '@clerk/clerk-react'
import { API_BASE_URL } from './config'

// Use centralized API configuration
const API_ROOT = API_BASE_URL
let globalTokenGetter: (() => Promise<string | null>) | null = null

export const IMPERSONATION_STORAGE_KEY = 'impersonation_session'
export const IMPERSONATION_SESSION_CHANGED_EVENT = 'learntrack:impersonation-session-changed'

function readImpersonationSessionId(): string | null {
  if (typeof window === 'undefined') {
    return null
  }

  const raw = window.localStorage.getItem(IMPERSONATION_STORAGE_KEY)
  if (!raw) {
    return null
  }

  try {
    const parsed = JSON.parse(raw)
    if (typeof parsed?.sessionId === 'string' && parsed.sessionId.trim()) {
      return parsed.sessionId
    }
  } catch {
    return null
  }

  return null
}

export interface ApiResponse<T = any> {
  data?: T
  error?: string
  status: number
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public response?: any
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export class ApiClient {
  private getToken: () => Promise<string | null>

  constructor(getToken: () => Promise<string | null>) {
    this.getToken = getToken
  }

  private async makeRequest<T = any>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<ApiResponse<T>> {
    try {
      const token = await this.getToken()

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(options.headers as Record<string, string>),
      }

      if (token) {
        headers['Authorization'] = `Bearer ${token}`
      }

      // Avoid accidental double prefixing if callers pass '/api/v1/...'
      const sanitized = endpoint.replace(/^\/api\/v\d+/, '')
      let path = sanitized.startsWith('/') ? sanitized : `/${sanitized}`

      const impersonationSessionId = readImpersonationSessionId()
      if (impersonationSessionId && !path.startsWith('/admin/')) {
        headers['X-LearnTrack-Impersonation-Session'] = impersonationSessionId
      }

      // Ensure trailing slash for root collection endpoints (FastAPI routes with redirect_slashes=False)
      // Only add trailing slash for top-level collection endpoints like /students, /groups, /invitations
      // Do NOT add trailing slash for nested paths like /dashboard/stats, /students/123, etc.
      const pathWithoutQuery = path.split('?')[0]
      const queryPart = path.includes('?') ? path.slice(path.indexOf('?')) : ''

      // Root collection patterns that need trailing slashes (single segment after /api/v1/)
      // These are paths like /students, /groups, /invitations, /assignments, /subjects, etc.
      const rootCollectionPattern = /^\/[a-z-]+$/
      if (!pathWithoutQuery.endsWith('/') && rootCollectionPattern.test(pathWithoutQuery)) {
        path = pathWithoutQuery + '/' + queryPart
      }

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 30000)

      const response = await fetch(`${API_ROOT}${path}`, {
        ...options,
        headers,
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      const data = await response.json().catch(() => null)

      if (!response.ok) {
        const errorMessage = data?.detail || `HTTP ${response.status}: ${response.statusText}`
        console.error('API Error:', errorMessage, data)
        return {
          error: errorMessage,
          status: response.status,
        }
      }

      return {
        data,
        status: response.status,
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return { error: 'Request timed out', status: 0 }
      }
      console.error('API Request Error:', error)
      return {
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        status: 0,
      }
    }
  }

  async get<T = any>(endpoint: string): Promise<ApiResponse<T>> {
    return this.makeRequest<T>(endpoint, { method: 'GET' })
  }

  async post<T = any>(endpoint: string, data?: any): Promise<ApiResponse<T>> {
    return this.makeRequest<T>(endpoint, {
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
    })
  }

  async put<T = any>(endpoint: string, data?: any): Promise<ApiResponse<T>> {
    return this.makeRequest<T>(endpoint, {
      method: 'PUT',
      body: data ? JSON.stringify(data) : undefined,
    })
  }

  async delete<T = any>(endpoint: string): Promise<ApiResponse<T>> {
    return this.makeRequest<T>(endpoint, { method: 'DELETE' })
  }

  async patch<T = any>(endpoint: string, data?: any): Promise<ApiResponse<T>> {
    return this.makeRequest<T>(endpoint, {
      method: 'PATCH',
      body: data ? JSON.stringify(data) : undefined,
    })
  }
}

export function setTokenGetter(getter: () => Promise<string | null>) {
  globalTokenGetter = getter
}

const globalApiClient = new ApiClient(() => {
  return globalTokenGetter ? globalTokenGetter() : Promise.resolve(null)
})

async function makeLegacyRequest<T = any>(
  method: 'get' | 'post' | 'put' | 'delete' | 'patch',
  endpoint: string,
  payload?: any
): Promise<{ data: T; status: number }> {
  const response =
    method === 'get' || method === 'delete'
      ? await globalApiClient[method]<T>(endpoint)
      : await globalApiClient[method]<T>(endpoint, payload)

  if (response.error) {
    throw new ApiError(response.error, response.status, response)
  }

  return {
    data: response.data as T,
    status: response.status,
  }
}

// Backwards-compatible API surface used by legacy callers
export const api = {
  get: <T = any>(endpoint: string) => makeLegacyRequest<T>('get', endpoint),
  post: <T = any>(endpoint: string, data?: any) =>
    makeLegacyRequest<T>('post', endpoint, data),
  put: <T = any>(endpoint: string, data?: any) =>
    makeLegacyRequest<T>('put', endpoint, data),
  delete: <T = any>(endpoint: string) => makeLegacyRequest<T>('delete', endpoint),
  patch: <T = any>(endpoint: string, data?: any) =>
    makeLegacyRequest<T>('patch', endpoint, data),
}

/**
 * Hook to create an authenticated API client
 * Gets Clerk JWT token without template (uses default)
 */
export function useApiClient() {
  const { getToken } = useAuth()

  const memoizedGetToken = useCallback(() => {
    // Don't specify template - use default Clerk JWT
    return getToken()
  }, [getToken])

  return useMemo(() => new ApiClient(memoizedGetToken), [memoizedGetToken])
}


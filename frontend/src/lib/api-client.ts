import { useCallback } from 'react'
import { useAuth } from '@clerk/clerk-react'
import { API_BASE_URL } from './config'

// Use centralized API configuration
const API_ROOT = API_BASE_URL

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

      const response = await fetch(`${API_ROOT}${path}`, {
        ...options,
        headers,
      })

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

  return new ApiClient(memoizedGetToken)
}

// Utility functions for common API operations
export const apiUtils = {
  // Students
  getStudents: (client: ApiClient) => client.get('/students/'),
  getStudent: (client: ApiClient, id: string) => client.get(`/students/${id}`),
  createStudent: (client: ApiClient, data: any) => client.post('/students/', data),
  updateStudent: (client: ApiClient, id: string, data: any) => client.put(`/students/${id}`, data),
  deleteStudent: (client: ApiClient, id: string) => client.delete(`/students/${id}`),

  // Groups
  getGroups: (client: ApiClient) => client.get('/groups/'),
  getGroup: (client: ApiClient, id: string) => client.get(`/groups/${id}`),
  createGroup: (client: ApiClient, data: any) => client.post('/groups/', data),
  updateGroup: (client: ApiClient, id: string, data: any) => client.put(`/groups/${id}`, data),
  deleteGroup: (client: ApiClient, id: string) => client.delete(`/groups/${id}`),

  // Assignments
  getAssignments: (client: ApiClient) => client.get('/assignments/'),
  getAssignment: (client: ApiClient, id: string) => client.get(`/assignments/${id}`),
  createAssignment: (client: ApiClient, data: any) => client.post('/assignments/', data),
  updateAssignment: (client: ApiClient, id: string, data: any) => client.put(`/assignments/${id}`, data),
  deleteAssignment: (client: ApiClient, id: string) => client.delete(`/assignments/${id}`),

  // Questions
  getQuestions: (client: ApiClient) => client.get('/questions/'),
  generateQuestions: (client: ApiClient, data: any) => client.post('/questions/generate', data),
  reviewQuestions: (client: ApiClient, data: any) => client.post('/questions/review', data),

  // Progress
  getProgress: (client: ApiClient) => client.get('/progress/'),
  getStudentProgress: (client: ApiClient, studentId: string) => client.get(`/progress/student/${studentId}`),

  // User Profile
  getProfile: (client: ApiClient) => client.get('/users/me'),
  updateProfile: (client: ApiClient, data: any) => client.put('/users/me', data),
}

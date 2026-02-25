import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useUser } from '@clerk/clerk-react'
import { useApiClient } from '@/lib/api-client'

interface VisibilityData {
  visibleUsers: string[]
  visibleUserIds: string[]
  loading: boolean
  error: string | null
  canSeeUser: (userId: string) => boolean
  canAccessConversation: (conversationId: string) => Promise<boolean>
  refresh: () => Promise<void>
}

export function useVisibility(): VisibilityData {
  const { user } = useUser()
  const client = useApiClient()
  const queryClient = useQueryClient()

  const usersQuery = useQuery({
    queryKey: ['visibility', 'users'],
    queryFn: async () => {
      const response = await client.get('/visibility/visible-users')
      if (response.error) throw new Error(response.error)
      const data = response.data
      return Array.isArray(data)
        ? data.filter((value): value is string => typeof value === 'string')
        : []
    },
    enabled: !!user,
  })

  useQuery({
    queryKey: ['visibility', 'students'],
    queryFn: async () => {
      const response = await client.get('/visibility/visible-students')
      if (response.error) throw new Error(response.error)
      return response.data || []
    },
    enabled: !!user,
  })

  const visibleUsers: string[] = usersQuery.data || []
  const loading = usersQuery.isLoading
  const error = usersQuery.error ? (usersQuery.error as Error).message : null

  const canSeeUser = (userId: string): boolean => {
    if (!userId) return false
    return userId === user?.id || visibleUsers.includes(userId)
  }

  const canAccessConversation = async (conversationId: string): Promise<boolean> => {
    try {
      const response = await client.get(
        `/visibility/can-access-conversation/${conversationId}`
      )
      if (response.error) return false
      const data = response.data
      if (typeof data === 'boolean') return data
      return data?.can_access === true
    } catch (err) {
      console.error('Failed to check conversation access:', err)
      return false
    }
  }

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['visibility'] })
  }

  return {
    visibleUsers,
    visibleUserIds: visibleUsers,
    loading,
    error,
    canSeeUser,
    canAccessConversation,
    refresh,
  }
}

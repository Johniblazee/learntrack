/**
 * Hook that bridges Socket.IO notification events to TanStack Query cache invalidation.
 *
 * Mount once at the dashboard level. When the backend emits a "notification" event
 * via Socket.IO, this hook invalidates all notification-related query keys so the
 * UI refreshes without polling.
 *
 * This replaces the refetchInterval that was removed from the 5 affected hooks (C3).
 */
import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@clerk/clerk-react'
import { socketClient } from '@/lib/socket'

export function useNotificationSocket() {
  const queryClient = useQueryClient()
  const { getToken } = useAuth()

  useEffect(() => {
    let connected = false

    const init = async () => {
      const token = await getToken()
      if (!token) return

      socketClient.connect(token)
      connected = true

      const handleNotification = () => {
        queryClient.invalidateQueries({ queryKey: ['notifications'] })
        queryClient.invalidateQueries({ queryKey: ['notifications', 'unread-count'] })
        queryClient.invalidateQueries({ queryKey: ['announcements'] })
        queryClient.invalidateQueries({ queryKey: ['dashboard', 'recent-activity'] })
        queryClient.invalidateQueries({ queryKey: ['activities', 'me'] })
      }

      socketClient.onNotification(handleNotification)

      return () => {
        socketClient.offNotification(handleNotification)
      }
    }

    let cleanup: (() => void) | undefined

    init().then((fn) => {
      cleanup = fn
    })

    return () => {
      cleanup?.()
      if (connected) {
        socketClient.disconnect()
      }
    }
  }, [getToken, queryClient])
}

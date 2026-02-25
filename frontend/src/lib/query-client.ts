/**
 * React Query configuration and setup
 */
import { QueryClient } from '@tanstack/react-query'

/**
 * Create a new QueryClient instance with default options
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Stale time: 5 minutes
      staleTime: 5 * 60 * 1000,

      // Cache time: 10 minutes
      gcTime: 10 * 60 * 1000,

      // Retry failed requests only once (reduced from 3 for faster error feedback)
      retry: 1,

      // Retry delay: 1 second
      retryDelay: 1000,

      // Refetch on window focus
      refetchOnWindowFocus: false,

      // Refetch on reconnect
      refetchOnReconnect: true,

      // Don't refetch on mount if data is fresh
      refetchOnMount: false,
    },
    mutations: {
      // Retry failed mutations once
      retry: 1,

      // Retry delay: 1 second
      retryDelay: 1000,
    },
  },
})


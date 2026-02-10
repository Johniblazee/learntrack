"use client"

import { createContext, useContext, useCallback, useState, useEffect, useMemo, useRef } from 'react'
import { ToastContainer, ToastType, ToastProps } from "@/components/ui/animated-toast"

interface ToastOptions {
  description?: string
  duration?: number
}

interface ToastContextValue {
  success: (message: string, options?: ToastOptions) => void
  error: (message: string, options?: ToastOptions) => void
  warning: (message: string, options?: ToastOptions) => void
  info: (message: string, options?: ToastOptions) => void
  dismiss: (id: string) => void
  dismissAll: () => void
}

interface ToastWithDedupeKey extends ToastProps {
  dedupeKey: string
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined)

// Use ref for toast ID to avoid issues with StrictMode double-mounting
let toastIdCounter = 0

// Global callback for imperative toast API - use ref pattern to avoid stale closures
let globalToastCallback: ToastContextValue | null = null

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastWithDedupeKey[]>([])

  const pendingToastsRef = useRef<Set<string>>(new Set())
  const timeoutIdsRef = useRef<Set<NodeJS.Timeout>>(new Set())

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => {
      const toastToRemove = prev.find((toast) => toast.id === id)
      if (toastToRemove) {
        pendingToastsRef.current.delete(toastToRemove.dedupeKey)
      }
      return prev.filter((toast) => toast.id !== id)
    })
  }, [])

  const addToast = useCallback(
    (message: string, type: ToastType, options?: ToastOptions) => {
      // Create a unique key based on message and type to prevent duplicates
      const dedupeKey = `${type}-${message}-${options?.description || ''}`

      // Prevent duplicate toasts within a short time window (handles StrictMode double-invoke)
      if (pendingToastsRef.current.has(dedupeKey)) {
        return ''
      }

      const id = `toast-${++toastIdCounter}`
      const newToast: ToastWithDedupeKey = {
        id,
        message,
        type,
        description: options?.description,
        duration: options?.duration ?? 3000,
        isVisible: true,
        dedupeKey,
      }

      // Mark this toast as pending
      pendingToastsRef.current.add(dedupeKey)

      // Remove from pending set after a short delay (allows same toast to be shown again later)
      const timeoutId = setTimeout(() => {
        pendingToastsRef.current.delete(dedupeKey)
        timeoutIdsRef.current.delete(timeoutId)
      }, 100)
      timeoutIdsRef.current.add(timeoutId)

      setToasts((prev) => [...prev, newToast])
      return id
    },
    []
  )

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      timeoutIdsRef.current.forEach((id) => clearTimeout(id))
      timeoutIdsRef.current.clear()
    }
  }, [])

  const success = useCallback(
    (message: string, options?: ToastOptions) => addToast(message, "success", options),
    [addToast]
  )

  const error = useCallback(
    (message: string, options?: ToastOptions) => addToast(message, "error", options),
    [addToast]
  )

  const warning = useCallback(
    (message: string, options?: ToastOptions) => addToast(message, "warning", options),
    [addToast]
  )

  const info = useCallback(
    (message: string, options?: ToastOptions) => addToast(message, "info", options),
    [addToast]
  )

  const dismissAll = useCallback(() => {
    setToasts([])
    pendingToastsRef.current.clear()
  }, [])

  // Memoize the context value to prevent unnecessary re-renders and effect triggers
  const contextValue = useMemo<ToastContextValue>(() => ({
    success,
    error,
    warning,
    info,
    dismiss: removeToast,
    dismissAll,
  }), [success, error, warning, info, removeToast, dismissAll])

  // Register global callback for imperative API
  useEffect(() => {
    globalToastCallback = contextValue

    return () => {
      globalToastCallback = null
    }
  }, [contextValue])

  return (
    <ToastContext.Provider value={contextValue}>
      {children}
      <ToastContainer toasts={toasts} onClose={removeToast} />
    </ToastContext.Provider>
  )
}

export function useAnimatedToast() {
  const context = useContext(ToastContext)
  if (!context) {
    throw new Error("useAnimatedToast must be used within a ToastProvider")
  }
  return context
}

// Standalone toast object that can be used outside of React components
// This creates a simple imperative API similar to sonner
export const toast = {
  success: (message: string, options?: ToastOptions) => {
    if (globalToastCallback) globalToastCallback.success(message, options)
  },
  error: (message: string, options?: ToastOptions) => {
    if (globalToastCallback) globalToastCallback.error(message, options)
  },
  warning: (message: string, options?: ToastOptions) => {
    if (globalToastCallback) globalToastCallback.warning(message, options)
  },
  info: (message: string, options?: ToastOptions) => {
    if (globalToastCallback) globalToastCallback.info(message, options)
  },
}

/**
 * Centralized configuration for the frontend application
 * All environment-based configuration should be accessed through this file
 */

// Raw API base URL from environment
const RAW_API_BASE_URL = (import.meta as any).env?.VITE_API_BASE_URL || 'http://localhost:8000'

// Normalize base URL (remove trailing slashes)
const NORMALIZED_BASE = RAW_API_BASE_URL.replace(/\/+$/, '')

// API root with version prefix
export const API_BASE_URL = NORMALIZED_BASE.match(/\/api\/v\d+$/) 
  ? NORMALIZED_BASE 
  : `${NORMALIZED_BASE}/api/v1`

// Raw base URL (without /api/v1 prefix, for non-versioned endpoints)
export const API_HOST = NORMALIZED_BASE.replace(/\/api\/v\d+$/, '')

// Clerk configuration
export const CLERK_PUBLISHABLE_KEY = (import.meta as any).env?.VITE_CLERK_PUBLISHABLE_KEY || ''

// PostHog configuration
export const POSTHOG_API_KEY = (import.meta as any).env?.VITE_POSTHOG_API_KEY || ''


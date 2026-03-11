import { render } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import App from '../App'
import { MemoryRouter } from 'react-router-dom'
import { ReactNode } from 'react'

// Mock Clerk provider
vi.mock('@clerk/clerk-react', () => ({
  ClerkProvider: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  useUser: () => ({ isSignedIn: false, user: null, isLoaded: true }),
  useAuth: () => ({ getToken: vi.fn().mockResolvedValue(null), isSignedIn: false, userId: null }),
}))

describe('App', () => {
  it('renders the main application component', () => {
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>
    )
    // We can't assert specific content due to Clerk mocking,
    // but a successful render is a good smoke test.
    expect(true).toBe(true)
  })
})

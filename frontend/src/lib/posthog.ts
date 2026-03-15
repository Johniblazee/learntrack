import posthog from 'posthog-js'

const POSTHOG_API_KEY = (import.meta as any).env?.VITE_POSTHOG_API_KEY as string | undefined

if (POSTHOG_API_KEY) {
  posthog.init(POSTHOG_API_KEY, {
    api_host: 'https://us.i.posthog.com',
    capture_pageview: false, // handled by PostHogProvider router integration
  })
}

export default posthog

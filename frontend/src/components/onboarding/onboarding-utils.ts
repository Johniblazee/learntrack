import { useState } from 'react'
import type { NavigateFunction } from 'react-router-dom'
import { toast } from '@/contexts/ToastContext'
import { API_BASE_URL } from '@/lib/config'

interface UseOnboardingStepsOptions {
  totalSteps: number
  validateStep?: (step: number) => string | null
}

export function useOnboardingSteps({ totalSteps, validateStep }: UseOnboardingStepsOptions) {
  const [step, setStep] = useState(1)

  const handleNext = () => {
    const validationMessage = validateStep?.(step)
    if (validationMessage) {
      toast.error(validationMessage)
      return
    }

    if (step < totalSteps) {
      setStep(step + 1)
    }
  }

  const handleBack = () => {
    if (step > 1) {
      setStep(step - 1)
    }
  }

  return {
    step,
    handleNext,
    handleBack,
  }
}

export async function saveOnboardingProfile(
  getToken: () => Promise<string | null>,
  payload: Record<string, unknown>
) {
  const token = await getToken()

  const response = await fetch(`${API_BASE_URL}/users/me`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  return response.ok
}

export function completeOnboarding(navigate: NavigateFunction) {
  localStorage.setItem('onboarding_complete', 'true')
  navigate('/dashboard')
}

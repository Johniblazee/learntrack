export interface AIProviderOption {
  id: string
  label: string
  models: string[]
}

export const AI_PROVIDERS: AIProviderOption[] = [
  { id: 'openai', label: 'OpenAI', models: ['gpt-5', 'gpt-5-mini', 'gpt-4o', 'gpt-4o-mini'] },
  { id: 'anthropic', label: 'Anthropic', models: ['claude-3-5-sonnet-20241022', 'claude-3-opus-20240229'] },
  { id: 'gemini', label: 'Google Gemini', models: ['gemini-3.0-pro', 'gemini-3.0-flash', 'gemini-2.5-pro', 'gemini-2.5-flash'] },
  { id: 'groq', label: 'Groq', models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'llama-3.3-8b-instant'] },
]

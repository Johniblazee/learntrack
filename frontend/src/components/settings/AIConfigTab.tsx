import { useEffect, useState } from 'react'
import { Eye, EyeOff, Trash2, TestTube, Save, CheckCircle2, XCircle, Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { useApiClient } from '@/lib/api-client'
import { toast } from '@/contexts/ToastContext'

interface ProviderStatus {
  provider_id: string
  name: string
  has_system_key: boolean
  has_custom_key: boolean
  key_source: 'custom' | 'system' | null
  available: boolean
  masked_key: string | null
  enabled_models: string[]
  models: Array<{
    model_id: string
    name: string
    description: string
    available: boolean
    context_window?: number | null
    priority: number
  }>
}

interface AIConfigStatus {
  default_provider: string
  default_model: string
  allow_custom_api_keys: boolean
  providers: ProviderStatus[]
}

const PROVIDER_LABELS: Record<string, { description: string }> = {
  openai: { description: 'GPT-4o, GPT-4o-mini, and more' },
  anthropic: { description: 'Claude 3.5 Sonnet, Claude 3 Haiku, and more' },
  gemini: { description: 'Gemini 2.0 Flash, Gemini 1.5 Pro, and more' },
  groq: { description: 'Llama 3.3 70B, Mixtral, and more' },
}

export function AIConfigTab() {
  const apiClient = useApiClient()
  const [config, setConfig] = useState<AIConfigStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({})
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({})
  const [saving, setSaving] = useState<Record<string, boolean>>({})
  const [testing, setTesting] = useState<Record<string, boolean>>({})

  const fetchConfig = async () => {
    try {
      const res = await apiClient.get('/ai-config/status')
      if (res.data) {
        setConfig(res.data as AIConfigStatus)
      }
    } catch {
      toast.error('Failed to load AI configuration')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void fetchConfig()
  }, [apiClient])

  const handleTestKey = async (providerId: string) => {
    const key = keyInputs[providerId]
    if (!key) {
      toast.error('Enter an API key first')
      return
    }

    setTesting((prev) => ({ ...prev, [providerId]: true }))
    try {
      const res = await apiClient.post(`/ai-config/keys/${providerId}/test`, {
        provider_id: providerId,
        api_key: key,
      })
      if (res.error) throw new Error(res.error)
      toast.success(`${providerId} key is valid!`)
    } catch (err: any) {
      toast.error(err?.message || 'Key test failed')
    } finally {
      setTesting((prev) => ({ ...prev, [providerId]: false }))
    }
  }

  const handleSaveKey = async (providerId: string) => {
    const key = keyInputs[providerId]
    if (!key) {
      toast.error('Enter an API key first')
      return
    }

    setSaving((prev) => ({ ...prev, [providerId]: true }))
    try {
      const res = await apiClient.post('/ai-config/keys', {
        provider_id: providerId,
        api_key: key,
      })
      if (res.error) throw new Error(res.error)
      toast.success('API key saved')
      setKeyInputs((prev) => ({ ...prev, [providerId]: '' }))
      await fetchConfig()
    } catch (err: any) {
      toast.error(err?.message || 'Failed to save key')
    } finally {
      setSaving((prev) => ({ ...prev, [providerId]: false }))
    }
  }

  const handleDeleteKey = async (providerId: string) => {
    setSaving((prev) => ({ ...prev, [providerId]: true }))
    try {
      const res = await apiClient.delete(`/ai-config/keys/${providerId}`)
      if (res.error) throw new Error(res.error)
      toast.success('API key removed')
      await fetchConfig()
    } catch (err: any) {
      toast.error(err?.message || 'Failed to remove key')
    } finally {
      setSaving((prev) => ({ ...prev, [providerId]: false }))
    }
  }

  const handleUpdateDefaults = async (updates: Partial<Pick<AIConfigStatus, 'default_provider' | 'default_model'>>) => {
    try {
      const res = await apiClient.put('/ai-config/defaults', updates)
      if (res.error) throw new Error(res.error)
      setConfig(res.data as AIConfigStatus)
      toast.success('Defaults updated')
    } catch (err: any) {
      toast.error(err?.message || 'Failed to update defaults')
    }
  }

  const selectedProvider = config?.providers.find((provider) => provider.provider_id === config.default_provider)
  const selectableModels = selectedProvider?.models || []
  const selectedModelValue = selectableModels.some((model) => model.model_id === config?.default_model)
    ? (config?.default_model || '')
    : (selectableModels[0]?.model_id || '')

  if (loading || !config) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const providerOptions = config.providers.filter((provider) => provider.models.length > 0)

  return (
    <div className="space-y-6">
      {/* Default selections */}
      <Card>
        <CardHeader>
          <CardTitle>Default AI Provider</CardTitle>
          <CardDescription>Choose which provider and model to use by default for question generation</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="defaultProvider">Provider</Label>
              <Select
                value={config.default_provider}
                onValueChange={(value) => {
                  const nextProvider = config.providers.find((provider) => provider.provider_id === value)
                  const nextModel = nextProvider?.models[0]?.model_id
                  void handleUpdateDefaults({
                    default_provider: value,
                    ...(nextModel ? { default_model: nextModel } : {}),
                  })
                }}
              >
                <SelectTrigger id="defaultProvider" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {providerOptions.map((p) => (
                    <SelectItem key={p.provider_id} value={p.provider_id} disabled={!p.available}>
                      {p.name} {!p.available ? '(unavailable)' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="defaultModel">Model</Label>
              <Select
                value={selectedModelValue}
                onValueChange={(value) => void handleUpdateDefaults({ default_model: value })}
                disabled={!selectableModels.length}
              >
                <SelectTrigger id="defaultModel" className="w-full">
                  <SelectValue placeholder="Select model" />
                </SelectTrigger>
                <SelectContent>
                  {selectableModels.map((model) => (
                    <SelectItem key={model.model_id} value={model.model_id}>
                      {model.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {!config.allow_custom_api_keys && (
            <p className="text-sm text-muted-foreground">
              Bring-your-own-key is currently disabled for your tenant. You can still use any provider with a system key.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Provider cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {config.providers.map((provider) => {
          const meta = PROVIDER_LABELS[provider.provider_id] || { description: '' }
          const isSaving = saving[provider.provider_id]
          const isTesting = testing[provider.provider_id]
          const keyInput = keyInputs[provider.provider_id] || ''
          const showKey = showKeys[provider.provider_id]

          return (
            <Card key={provider.provider_id}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">{provider.name}</CardTitle>
                  {provider.has_custom_key ? (
                    <Badge variant="default" className="bg-blue-500 hover:bg-blue-600">Your Key</Badge>
                  ) : provider.has_system_key ? (
                    <Badge variant="default" className="bg-green-500 hover:bg-green-600">System Key</Badge>
                  ) : (
                    <Badge variant="secondary">Not Configured</Badge>
                  )}
                </div>
                <CardDescription>{meta.description}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {provider.models.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {provider.models.length} approved model{provider.models.length === 1 ? '' : 's'} available for this provider.
                  </p>
                )}
                {provider.has_custom_key && provider.masked_key && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <CheckCircle2 className="h-4 w-4 text-blue-500" />
                    <span className="font-mono">{provider.masked_key}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDeleteKey(provider.provider_id)}
                      disabled={isSaving}
                      className="ml-auto text-red-500 hover:text-red-600"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}

                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input
                      type={showKey ? 'text' : 'password'}
                      placeholder={provider.has_custom_key ? 'Replace API key...' : 'Enter API key...'}
                      value={keyInput}
                      disabled={!config.allow_custom_api_keys}
                      onChange={(e) =>
                        setKeyInputs((prev) => ({ ...prev, [provider.provider_id]: e.target.value }))
                      }
                    />
                    <button
                      type="button"
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      onClick={() => setShowKeys((prev) => ({ ...prev, [provider.provider_id]: !showKey }))}
                    >
                      {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleTestKey(provider.provider_id)}
                    disabled={!config.allow_custom_api_keys || !keyInput || isTesting}
                  >
                    {isTesting ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                    ) : (
                      <TestTube className="h-3.5 w-3.5 mr-1" />
                    )}
                    Test
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => handleSaveKey(provider.provider_id)}
                    disabled={!config.allow_custom_api_keys || !keyInput || isSaving}
                  >
                    {isSaving ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                    ) : (
                      <Save className="h-3.5 w-3.5 mr-1" />
                    )}
                    Save Key
                  </Button>
                </div>

                {!config.allow_custom_api_keys && (
                  <p className="text-xs text-muted-foreground">
                    Your administrator has disabled personal API keys for this tenant.
                  </p>
                )}

                {provider.available && provider.key_source && (
                  <p className="text-xs text-muted-foreground">
                    Currently using {provider.key_source === 'custom' ? 'your saved key' : 'the shared system key'}.
                  </p>
                )}

                {!provider.available && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                    <XCircle className="h-3 w-3" />
                    No API key configured — add your own key or contact your administrator
                  </p>
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}

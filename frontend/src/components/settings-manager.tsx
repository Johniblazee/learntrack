import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useApiClient } from "@/lib/api-client"
import { toast } from "@/contexts/ToastContext"
import { Bot, CheckCircle, XCircle, Loader2, Save, RefreshCw } from "lucide-react"

interface AIProvider {
  enabled: boolean
  configured: boolean
  models: string[]
  default_model: string | null
}

interface ProvidersStatus {
  providers: Record<string, AIProvider>
  default_provider: string
}

export default function SettingsManager() {
  const apiClient = useApiClient()
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [providersStatus, setProvidersStatus] = useState<ProvidersStatus | null>(null)
  const [selectedProvider, setSelectedProvider] = useState<string>('openai')
  const [apiKey, setApiKey] = useState('')
  const [isTesting, setIsTesting] = useState(false)

  // Load AI providers status
  useEffect(() => {
    loadProviders()
  }, [])

  const loadProviders = async () => {
    try {
      setIsLoading(true)
      const response = await apiClient.get<ProvidersStatus>('/settings/ai/providers')
      if (response.data) {
        setProvidersStatus(response.data)
        setSelectedProvider(response.data.default_provider || 'openai')
      }
    } catch (error) {
      console.error('Failed to load AI providers:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleUpdateProvider = async () => {
    if (!apiKey.trim()) {
      toast.error('Please enter an API key')
      return
    }

    setIsSaving(true)
    try {
      const response = await apiClient.put(`/settings/ai/${selectedProvider}`, {
        provider: selectedProvider,
        api_key: apiKey,
        enabled: true,
      })

      if (response.error) {
        throw new Error(response.error)
      }

      toast.success(`${selectedProvider} API key updated successfully!`)
      setApiKey('')
      await loadProviders()
    } catch (error: any) {
      toast.error(error.message || 'Failed to update API key')
    } finally {
      setIsSaving(false)
    }
  }

  const handleTestProvider = async (provider: string) => {
    setIsTesting(true)
    try {
      const response = await apiClient.post(`/settings/ai/${provider}/test`)

      if (response.data?.success) {
        toast.success(`${provider} connection successful!`)
      } else {
        toast.error(response.data?.error || `${provider} connection failed`)
      }
    } catch (error: any) {
      toast.error(error.message || 'Connection test failed')
    } finally {
      setIsTesting(false)
    }
  }

  const handleSetDefault = async (provider: string) => {
    try {
      const response = await apiClient.put(`/settings/ai/default/${provider}`)

      if (response.error) {
        throw new Error(response.error)
      }

      toast.success(`Default AI provider set to ${provider}`)
      await loadProviders()
    } catch (error: any) {
      toast.error(error.message || 'Failed to set default provider')
    }
  }

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5" />
            AI Provider Configuration
          </CardTitle>
          <CardDescription>
            Configure your AI providers for question generation
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Current Providers Status */}
          <div className="space-y-4">
            <Label>Available Providers</Label>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {providersStatus && Object.entries(providersStatus.providers).map(([name, provider]) => (
                <Card key={name} className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium capitalize">{name}</span>
                    {provider.configured ? (
                      <Badge variant="default" className="bg-green-500">
                        <CheckCircle className="h-3 w-3 mr-1" />
                        Configured
                      </Badge>
                    ) : (
                      <Badge variant="secondary">
                        <XCircle className="h-3 w-3 mr-1" />
                        Not Set
                      </Badge>
                    )}
                  </div>
                  {provider.configured && (
                    <div className="space-y-2">
                      <div className="text-xs text-muted-foreground">
                        Models: {provider.models.join(', ')}
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleTestProvider(name)}
                          disabled={isTesting}
                        >
                          Test
                        </Button>
                        {providersStatus.default_provider !== name && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleSetDefault(name)}
                          >
                            Set Default
                          </Button>
                        )}
                        {providersStatus.default_provider === name && (
                          <Badge>Default</Badge>
                        )}
                      </div>
                    </div>
                  )}
                </Card>
              ))}
            </div>
          </div>

          {/* Add/Update API Key */}
          <div className="border-t pt-6 space-y-4">
            <Label>Add or Update API Key</Label>
            <div className="flex gap-4">
              <Select value={selectedProvider} onValueChange={setSelectedProvider}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="Select provider" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="openai">OpenAI</SelectItem>
                  <SelectItem value="anthropic">Anthropic</SelectItem>
                  <SelectItem value="gemini">Google Gemini</SelectItem>
                  <SelectItem value="groq">Groq</SelectItem>
                </SelectContent>
              </Select>
              <Input
                type="password"
                placeholder="Enter API key..."
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="flex-1"
              />
              <Button onClick={handleUpdateProvider} disabled={isSaving}>
                {isSaving ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Save className="h-4 w-4 mr-2" />
                )}
                Save
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              API keys are encrypted and stored securely. Only masked versions are returned in API responses.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Refresh Button */}
      <div className="flex justify-end">
        <Button variant="outline" onClick={loadProviders}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh Status
        </Button>
      </div>
    </div>
  )
}

import { useEffect, useMemo, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronUp,
  Cpu,
  RefreshCw,
  Save,
  Trash2,
  X,
} from 'lucide-react'

import { toast } from '@/contexts/ToastContext'
import { useApiClient } from '@/lib/api-client'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LoadingSpinner, LoadingState } from '@/components/ui/loading-state'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'

interface ModelAvailability {
  model_id: string
  name: string
  description: string
  available: boolean
  context_window?: number
  priority: number
}

interface ProviderAvailability {
  provider_id: string
  name: string
  description: string
  available: boolean
  api_key_configured: boolean
  models: ModelAvailability[]
  error_message?: string
}

interface EmbeddingModelAvailability {
  model_id: string
  name: string
  description: string
  dimension: number
  available: boolean
}

interface EmbeddingProviderAvailability {
  provider_id: string
  name: string
  description: string
  available: boolean
  api_key_configured: boolean
  models: EmbeddingModelAvailability[]
  error_message?: string
}

interface ProviderConfig {
  provider_id: string
  enabled: boolean
  enabled_models: string[]
  custom_api_key?: string | null
  priority: number
}

interface TenantAIConfig {
  tenant_id: string
  enabled_providers: string[]
  provider_configs: Record<string, ProviderConfig>
  default_provider: string
  default_model: string
  embedding_provider: string
  embedding_model: string
  max_questions_per_generation: number
  allow_custom_api_keys: boolean
  enable_rag: boolean
  enable_web_search: boolean
  enable_streaming: boolean
  created_at?: string
  updated_at?: string
}

interface TenantAIConfigResponse {
  config: TenantAIConfig
  providers: ProviderAvailability[]
  embedding_providers: EmbeddingProviderAvailability[]
}

export function TenantAIConfigPage() {
  const { tenantId } = useParams<{ tenantId: string }>()
  const client = useApiClient()
  const navigate = useNavigate()
  
  const [configData, setConfigData] = useState<TenantAIConfigResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedProviders, setExpandedProviders] = useState<Set<string>>(new Set())
  const [bulkOperationLoading, setBulkOperationLoading] = useState<string | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [auditLogs, setAuditLogs] = useState<Array<{
    _id?: string
    timestamp: string
    admin_email: string
    action: string
  }>>([])
  const [auditLoading, setAuditLoading] = useState(true)
  const [auditError, setAuditError] = useState<string | null>(null)
  const [customApiKeyOverrides, setCustomApiKeyOverrides] = useState<Record<string, string>>({})
  
  // Form state
  const [formData, setFormData] = useState<Partial<TenantAIConfig>>({})

  const fetchConfig = useCallback(async () => {
    if (!tenantId) return
    
    try {
      setIsLoading(true)
      setError(null)
      
      const response = await client.get<TenantAIConfigResponse>(`/admin/tenant-ai-config/${tenantId}`)
      if (response.error) {
        throw new Error(response.error)
      }

      const data = response.data
      if (!data) {
        throw new Error('No configuration data returned')
      }

      setConfigData(data)
      setFormData({
        enabled_providers: data.config.enabled_providers,
        provider_configs: data.config.provider_configs || {},
        default_provider: data.config.default_provider,
        default_model: data.config.default_model,
        embedding_provider: data.config.embedding_provider,
        embedding_model: data.config.embedding_model,
        max_questions_per_generation: data.config.max_questions_per_generation,
        allow_custom_api_keys: data.config.allow_custom_api_keys,
        enable_rag: data.config.enable_rag,
        enable_web_search: data.config.enable_web_search,
        enable_streaming: data.config.enable_streaming,
      })
      setCustomApiKeyOverrides({})
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setIsLoading(false)
    }
  }, [client, tenantId])

  useEffect(() => {
    fetchConfig()
  }, [fetchConfig])

  const fetchAuditLogs = useCallback(async () => {
    if (!tenantId) return
    try {
      setAuditLoading(true)
      setAuditError(null)
      const response = await client.get<{ items: Array<{ _id?: string; timestamp: string; admin_email: string; action: string }>; total: number }>(
        `/admin/tenant-ai-config/${tenantId}/audit-logs?page=1&per_page=5`
      )
      if (response.error) {
        throw new Error(response.error)
      }
      setAuditLogs(response.data?.items || [])
    } catch (err) {
      setAuditError(err instanceof Error ? err.message : 'Failed to load audit logs')
    } finally {
      setAuditLoading(false)
    }
  }, [client, tenantId])

  useEffect(() => {
    fetchAuditLogs()
  }, [fetchAuditLogs])

  const handleSave = async () => {
    if (!tenantId) return
    
    try {
      setIsSaving(true)
      setError(null)

      const providerConfigs = {
        ...(formData.provider_configs || {}),
      }

      Object.entries(customApiKeyOverrides).forEach(([providerId, value]) => {
        const trimmed = value.trim()
        const existing = providerConfigs[providerId] || {
          provider_id: providerId,
          enabled: true,
          enabled_models: [],
          priority: 0,
        }

        providerConfigs[providerId] = {
          ...existing,
          custom_api_key: trimmed ? trimmed : null,
        }
      })

      if (formData.allow_custom_api_keys === false) {
        Object.keys(providerConfigs).forEach((providerId) => {
          providerConfigs[providerId] = {
            ...providerConfigs[providerId],
            custom_api_key: null,
          }
        })
      }

      const response = await client.put(`/admin/tenant-ai-config/${tenantId}`, {
        ...formData,
        provider_configs: providerConfigs,
      })

      if (response.error) {
        throw new Error(response.error)
      }

      toast.success('Configuration saved successfully')
      fetchConfig()
      fetchAuditLogs()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setIsSaving(false)
    }
  }

  const toggleProvider = (providerId: string) => {
    const current = formData.enabled_providers || []
    const updated = current.includes(providerId)
      ? current.filter(p => p !== providerId)
      : [...current, providerId]
    const currentConfigs = formData.provider_configs || {}
    const existingConfig = currentConfigs[providerId] || {
      provider_id: providerId,
      enabled: true,
      enabled_models: [],
      priority: 0,
    }
    let nextDefaultProvider = formData.default_provider || ''
    let nextDefaultModel = formData.default_model || ''
    if (nextDefaultProvider === providerId && !updated.includes(providerId)) {
      nextDefaultProvider = updated[0] || ''
      const nextProvider = configData?.providers.find(p => p.provider_id === nextDefaultProvider)
      const nextModels = nextProvider ? getEnabledModels(nextDefaultProvider, nextProvider.models) : []
      nextDefaultModel = nextModels[0] || nextProvider?.models[0]?.model_id || ''
    }
    setFormData({
      ...formData,
      enabled_providers: updated,
      provider_configs: {
        ...currentConfigs,
        [providerId]: {
          ...existingConfig,
          enabled: updated.includes(providerId),
        },
      },
      default_provider: nextDefaultProvider,
      default_model: nextDefaultModel,
    })
  }

  const toggleProviderExpand = (providerId: string) => {
    const newExpanded = new Set(expandedProviders)
    if (newExpanded.has(providerId)) {
      newExpanded.delete(providerId)
    } else {
      newExpanded.add(providerId)
    }
    setExpandedProviders(newExpanded)
  }

  const updateProviderConfig = (providerId: string, updates: Partial<ProviderConfig>) => {
    const currentConfigs = formData.provider_configs || {}
    const existing = currentConfigs[providerId] || {
      provider_id: providerId,
      enabled: true,
      enabled_models: [],
      priority: 0,
    }

    setFormData({
      ...formData,
      provider_configs: {
        ...currentConfigs,
        [providerId]: {
          ...existing,
          ...updates,
        },
      },
    })
  }

  const getEnabledModels = (providerId: string, models: ModelAvailability[]) => {
    const providerConfig = formData.provider_configs?.[providerId]
    if (!providerConfig || providerConfig.enabled_models.length === 0) {
      return models.map(m => m.model_id)
    }
    return providerConfig.enabled_models
  }

  const toggleModel = (providerId: string, modelId: string, models: ModelAvailability[]) => {
    const currentConfigs = formData.provider_configs || {}
    const existing = currentConfigs[providerId] || {
      provider_id: providerId,
      enabled: true,
      enabled_models: [],
      priority: 0,
    }

    let enabledModels = existing.enabled_models.length > 0
      ? [...existing.enabled_models]
      : models.map(m => m.model_id)

    if (enabledModels.includes(modelId)) {
      enabledModels = enabledModels.filter(id => id !== modelId)
    } else {
      enabledModels.push(modelId)
    }

    const updatedConfigs = {
      ...currentConfigs,
      [providerId]: { ...existing, enabled_models: enabledModels },
    }

    let updatedEnabledProviders = formData.enabled_providers || []
    if (enabledModels.length === 0) {
      updatedEnabledProviders = updatedEnabledProviders.filter(p => p !== providerId)
    } else if (!updatedEnabledProviders.includes(providerId)) {
      updatedEnabledProviders = [...updatedEnabledProviders, providerId]
    }

    let nextDefaultProvider = formData.default_provider || ''
    let nextDefaultModel = formData.default_model || ''
    if (nextDefaultProvider === providerId && enabledModels.length === 0) {
      nextDefaultProvider = updatedEnabledProviders[0] || ''
      const nextProvider = configData?.providers.find(p => p.provider_id === nextDefaultProvider)
      const nextModels = nextProvider ? getEnabledModels(nextDefaultProvider, nextProvider.models) : []
      nextDefaultModel = nextModels[0] || nextProvider?.models[0]?.model_id || ''
    } else if (nextDefaultProvider === providerId && nextDefaultModel && !enabledModels.includes(nextDefaultModel)) {
      nextDefaultModel = enabledModels[0] || models[0]?.model_id || ''
    }

    setFormData({
      ...formData,
      provider_configs: updatedConfigs,
      enabled_providers: updatedEnabledProviders,
      default_provider: nextDefaultProvider,
      default_model: nextDefaultModel,
    })
  }

  const handleDefaultProviderChange = (providerId: string) => {
    const provider = configData?.providers.find(p => p.provider_id === providerId)
    const enabledModels = getEnabledModels(providerId, provider?.models || [])
    const defaultModel = enabledModels[0] || provider?.models[0]?.model_id || ''
    const enabledProviders = formData.enabled_providers || []
    const updatedEnabledProviders = enabledProviders.includes(providerId)
      ? enabledProviders
      : [...enabledProviders, providerId]
    setFormData({
      ...formData,
      default_provider: providerId,
      default_model: defaultModel,
      enabled_providers: updatedEnabledProviders,
    })
  }

  const handleEmbeddingProviderChange = (providerId: string) => {
    const provider = configData?.embedding_providers.find(p => p.provider_id === providerId)
    const defaultModel = provider?.models[0]?.model_id || ''
    setFormData({
      ...formData,
      embedding_provider: providerId,
      embedding_model: defaultModel,
    })
  }

  const handleBulkOperation = async (operation: 'enable_all' | 'disable_all' | 'reset_defaults', providerId?: string) => {
    if (!tenantId) return
    try {
      setBulkOperationLoading(providerId || operation)
      const response = await client.post(`/admin/tenant-ai-config/${tenantId}/bulk-operation`, {
        operation,
        provider_id: providerId,
      })

      if (response.error) {
        throw new Error(response.error)
      }

      toast.success('Bulk update completed')
      fetchConfig()
      fetchAuditLogs()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Bulk update failed')
    } finally {
      setBulkOperationLoading(null)
    }
  }

  const handleDeleteConfig = async () => {
    if (!tenantId) return
    try {
      setDeleteLoading(true)
      const response = await client.delete(`/admin/tenant-ai-config/${tenantId}`)
      if (response.error) {
        throw new Error(response.error)
      }
      toast.success('Tenant AI configuration deleted')
      setDeleteOpen(false)
      navigate(`/admin/tenants/${tenantId}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete configuration')
    } finally {
      setDeleteLoading(false)
    }
  }

  if (isLoading) {
    return <LoadingState message="Loading AI configuration..." size="lg" className="h-64" />
  }

  const { filteredDefaultModels, embeddingModels } = useMemo(() => {
    const defaultProvider = configData?.providers.find(
      (provider) => provider.provider_id === formData.default_provider
    )
    const defaultProviderModels = defaultProvider?.models || []
    const enabledDefaultModels = defaultProvider
      ? getEnabledModels(defaultProvider.provider_id, defaultProviderModels)
      : []
    const filteredDefault = defaultProviderModels.filter((model) =>
      enabledDefaultModels.includes(model.model_id)
    )

    const embeddingProvider = configData?.embedding_providers.find(
      (provider) => provider.provider_id === formData.embedding_provider
    )
    const embedding = embeddingProvider?.models || []

    return {
      filteredDefaultModels: filteredDefault,
      embeddingModels: embedding,
    }
  }, [configData, formData.default_provider, formData.embedding_provider, formData.provider_configs])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" onClick={() => navigate('/admin/tenants')}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div className="p-2 bg-primary/10 rounded-lg">
            <Cpu className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">AI Configuration</h1>
            <p className="text-muted-foreground">Tenant: {tenantId}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={fetchConfig}>
            <RefreshCw className="w-4 h-4" />
            Refresh
          </Button>
          <Button
            variant="outline"
            onClick={() => handleBulkOperation('reset_defaults')}
            disabled={bulkOperationLoading === 'reset_defaults'}
          >
            {bulkOperationLoading === 'reset_defaults' ? 'Resetting...' : 'Reset Defaults'}
          </Button>
          <Button variant="destructive" onClick={() => setDeleteOpen(true)}>
            <Trash2 className="w-4 h-4" />
            Delete Config
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? <LoadingSpinner size="sm" className="text-primary-foreground" /> : <Save className="w-4 h-4" />}
            Save Changes
          </Button>
        </div>
      </div>
      {error && (
        <Alert variant="destructive">
          <AlertTitle>Unable to load configuration</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Default Settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Default Provider</Label>
              <Select
                value={formData.default_provider || ''}
                onValueChange={(value) => handleDefaultProviderChange(value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select provider" />
                </SelectTrigger>
                <SelectContent>
                  {configData?.providers.map((provider) => (
                    <SelectItem key={provider.provider_id} value={provider.provider_id} disabled={!provider.available}>
                      {provider.name} {!provider.available && '(unavailable)'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Default Model</Label>
              <Select
                value={formData.default_model || ''}
                onValueChange={(value) => setFormData({ ...formData, default_model: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select model" />
                </SelectTrigger>
                <SelectContent>
                  {filteredDefaultModels.map((model) => (
                    <SelectItem key={model.model_id} value={model.model_id}>
                      {model.name}
                    </SelectItem>
                  ))}
                  {!filteredDefaultModels.length && (
                    <SelectItem value="" disabled>
                      No models available
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Max Questions per Generation</Label>
              <Input
                type="number"
                min={1}
                max={50}
                value={formData.max_questions_per_generation || 20}
                onChange={(event) =>
                  setFormData({
                    ...formData,
                    max_questions_per_generation: Number(event.target.value || 0),
                  })
                }
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <div>
                <p className="text-sm font-medium text-foreground">Allow custom API keys</p>
                <p className="text-xs text-muted-foreground">Let tenants use their own keys.</p>
              </div>
              <Switch
                checked={formData.allow_custom_api_keys ?? false}
                onCheckedChange={(checked) =>
                  setFormData({ ...formData, allow_custom_api_keys: checked })
                }
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <div>
                <p className="text-sm font-medium text-foreground">Enable RAG</p>
                <p className="text-xs text-muted-foreground">Use retrieval augmented generation.</p>
              </div>
              <Switch
                checked={formData.enable_rag ?? true}
                onCheckedChange={(checked) => setFormData({ ...formData, enable_rag: checked })}
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <div>
                <p className="text-sm font-medium text-foreground">Enable Web Search</p>
                <p className="text-xs text-muted-foreground">Allow live web search augmentation.</p>
              </div>
              <Switch
                checked={formData.enable_web_search ?? true}
                onCheckedChange={(checked) => setFormData({ ...formData, enable_web_search: checked })}
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <div>
                <p className="text-sm font-medium text-foreground">Enable Streaming</p>
                <p className="text-xs text-muted-foreground">Stream AI responses in real time.</p>
              </div>
              <Switch
                checked={formData.enable_streaming ?? true}
                onCheckedChange={(checked) => setFormData({ ...formData, enable_streaming: checked })}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Embedding Settings</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Embedding Provider</Label>
            <Select
              value={formData.embedding_provider || ''}
              onValueChange={(value) => handleEmbeddingProviderChange(value)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select provider" />
              </SelectTrigger>
              <SelectContent>
                {configData?.embedding_providers.map((provider) => (
                  <SelectItem key={provider.provider_id} value={provider.provider_id} disabled={!provider.available}>
                    {provider.name} {!provider.available && '(unavailable)'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Embedding Model</Label>
            <Select
              value={formData.embedding_model || ''}
              onValueChange={(value) => setFormData({ ...formData, embedding_model: value })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select model" />
              </SelectTrigger>
              <SelectContent>
                {embeddingModels.map((model) => (
                  <SelectItem key={model.model_id} value={model.model_id}>
                    {model.name} ({model.dimension} dims)
                  </SelectItem>
                ))}
                {!embeddingModels.length && (
                  <SelectItem value="" disabled>
                    No models available
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>AI Providers</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {configData?.providers.map((provider) => {
            const providerConfig = formData.provider_configs?.[provider.provider_id]
            const enabledModels = getEnabledModels(provider.provider_id, provider.models)
            return (
              <Card key={provider.provider_id} className="border border-border">
                <CardContent className="p-0">
                  <div className="flex flex-wrap items-center justify-between gap-4 p-4">
                    <div className="flex items-start gap-3">
                      <Checkbox
                        checked={formData.enabled_providers?.includes(provider.provider_id) ?? false}
                        onCheckedChange={() => toggleProvider(provider.provider_id)}
                        disabled={!provider.available}
                      />
                      <div>
                        <div className="font-medium flex items-center gap-2">
                          {provider.name}
                          <Badge className={provider.available ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'}>
                            {provider.available ? 'Available' : 'Unavailable'}
                          </Badge>
                          {!provider.api_key_configured && (
                            <Badge variant="outline">API key missing</Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground">{provider.description}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{provider.models.length} models</Badge>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => toggleProviderExpand(provider.provider_id)}
                      >
                        {expandedProviders.has(provider.provider_id) ? (
                          <ChevronUp className="w-4 h-4" />
                        ) : (
                          <ChevronDown className="w-4 h-4" />
                        )}
                      </Button>
                    </div>
                  </div>

                  {expandedProviders.has(provider.provider_id) && (
                    <div className="border-t border-border p-4 bg-muted/40 space-y-4">
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                        <div className="grid gap-4 sm:grid-cols-2">
                          <div className="space-y-2">
                            <Label>Priority</Label>
                            <Input
                              type="number"
                              min={0}
                              value={providerConfig?.priority ?? 0}
                              onChange={(event) =>
                                updateProviderConfig(provider.provider_id, {
                                  priority: Number(event.target.value || 0),
                                })
                              }
                            />
                          </div>
                          {formData.allow_custom_api_keys && (
                            <div className="space-y-2">
                              <Label>Custom API Key</Label>
                              <Input
                                type="password"
                                value={customApiKeyOverrides[provider.provider_id] || ''}
                                onChange={(event) =>
                                  setCustomApiKeyOverrides((prev) => ({
                                    ...prev,
                                    [provider.provider_id]: event.target.value,
                                  }))
                                }
                                placeholder={providerConfig?.custom_api_key ? '•••••••• (saved)' : 'Enter custom API key'}
                              />
                            </div>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleBulkOperation('enable_all', provider.provider_id)}
                            disabled={bulkOperationLoading === provider.provider_id}
                          >
                            {bulkOperationLoading === provider.provider_id ? 'Updating...' : 'Enable All'}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleBulkOperation('disable_all', provider.provider_id)}
                            disabled={bulkOperationLoading === provider.provider_id}
                          >
                            {bulkOperationLoading === provider.provider_id ? 'Updating...' : 'Disable All'}
                          </Button>
                        </div>
                      </div>

                      {provider.error_message && (
                        <Alert variant="destructive">
                          <AlertTitle>Provider error</AlertTitle>
                          <AlertDescription>{provider.error_message}</AlertDescription>
                        </Alert>
                      )}

                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                        {provider.models.map((model) => {
                          const isEnabled = enabledModels.includes(model.model_id)
                          return (
                            <div
                              key={model.model_id}
                              className="flex items-center gap-2 p-2 bg-card rounded border border-border"
                            >
                              <div className="flex-1">
                                <div className="text-sm font-medium">{model.name}</div>
                                <div className="text-xs text-muted-foreground">
                                  {model.context_window
                                    ? `${(model.context_window / 1000).toFixed(0)}k context`
                                    : 'Context size unavailable'}
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <Checkbox
                                  checked={isEnabled}
                                  onCheckedChange={() => toggleModel(provider.provider_id, model.model_id, provider.models)}
                                  disabled={!provider.available}
                                />
                                {model.available ? (
                                  <Check className="w-4 h-4 text-green-500" />
                                ) : (
                                  <X className="w-4 h-4 text-muted-foreground" />
                                )}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Configuration Audit Log</CardTitle>
        </CardHeader>
        <CardContent>
          {auditLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, index) => (
                <div key={index} className="h-12 rounded-lg bg-muted" />
              ))}
            </div>
          ) : auditError ? (
            <Alert variant="destructive">
              <AlertTitle>Unable to load audit logs</AlertTitle>
              <AlertDescription>{auditError}</AlertDescription>
            </Alert>
          ) : auditLogs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No configuration changes recorded yet.</p>
          ) : (
            <div className="space-y-3">
              {auditLogs.map((log) => {
                const logKey = log._id || `${log.admin_email}-${log.timestamp}`
                return (
                  <div key={logKey} className="flex flex-col gap-2 rounded-lg border border-border p-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-medium text-foreground">{log.action}</p>
                      <p className="text-xs text-muted-foreground">{log.admin_email}</p>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {new Date(log.timestamp).toLocaleString()}
                    </p>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Delete Tenant AI Configuration</DialogTitle>
            <DialogDescription>
              This will remove all custom AI provider settings for this tenant. The configuration will be recreated
              automatically the next time it is accessed.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
            <p className="font-medium text-foreground">Tenant ID: {tenantId}</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={deleteLoading}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteConfig} disabled={deleteLoading}>
              {deleteLoading ? 'Deleting...' : 'Delete Config'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}


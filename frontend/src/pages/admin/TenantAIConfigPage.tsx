import { useEffect, useState, useCallback } from 'react'
import { useAuth } from '@clerk/clerk-react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Cpu, ArrowLeft, Save, RefreshCw, Check, X,
  ChevronDown, ChevronUp, AlertCircle, Loader2
} from 'lucide-react'
import { API_BASE_URL } from '@/lib/config'

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
  custom_api_key?: string
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
  const { getToken } = useAuth()
  const navigate = useNavigate()
  
  const [configData, setConfigData] = useState<TenantAIConfigResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [expandedProviders, setExpandedProviders] = useState<Set<string>>(new Set())
  
  // Form state
  const [formData, setFormData] = useState<Partial<TenantAIConfig>>({})

  const fetchConfig = useCallback(async () => {
    if (!tenantId) return
    
    try {
      setIsLoading(true)
      setError(null)
      const token = await getToken()
      
      const response = await fetch(`${API_BASE_URL}/admin/tenant-ai-config/${tenantId}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      })

      if (!response.ok) {
        throw new Error(`Failed to fetch config: ${response.status}`)
      }

      const data: TenantAIConfigResponse = await response.json()
      setConfigData(data)
      setFormData({
        enabled_providers: data.config.enabled_providers,
        provider_configs: data.config.provider_configs || {},
        default_provider: data.config.default_provider,
        default_model: data.config.default_model,
        embedding_provider: data.config.embedding_provider,
        embedding_model: data.config.embedding_model,
        max_questions_per_generation: data.config.max_questions_per_generation,
        enable_rag: data.config.enable_rag,
        enable_web_search: data.config.enable_web_search,
        enable_streaming: data.config.enable_streaming,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setIsLoading(false)
    }
  }, [getToken, tenantId])

  useEffect(() => {
    fetchConfig()
  }, [fetchConfig])

  const handleSave = async () => {
    if (!tenantId) return
    
    try {
      setIsSaving(true)
      setError(null)
      const token = await getToken()
      
      const response = await fetch(`${API_BASE_URL}/admin/tenant-ai-config/${tenantId}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(formData)
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.detail || `Failed to save: ${response.status}`)
      }

      setSuccessMessage('Configuration saved successfully!')
      setTimeout(() => setSuccessMessage(null), 3000)
      fetchConfig()
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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    )
  }

  const defaultProvider = configData?.providers.find(p => p.provider_id === formData.default_provider)
  const defaultProviderModels = defaultProvider?.models || []
  const enabledDefaultModels = defaultProvider
    ? getEnabledModels(defaultProvider.provider_id, defaultProviderModels)
    : []
  const filteredDefaultModels = defaultProviderModels.filter(m => enabledDefaultModels.includes(m.model_id))

  const embeddingProvider = configData?.embedding_providers.find(
    p => p.provider_id === formData.embedding_provider
  )
  const embeddingModels = embeddingProvider?.models || []

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/admin/tenants')}
            className="p-2 hover:bg-muted rounded-lg"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="p-2 bg-primary/10 rounded-lg">
            <Cpu className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              AI Configuration
            </h1>
            <p className="text-muted-foreground">
              Tenant: {tenantId}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={fetchConfig}
            className="flex items-center gap-2 px-4 py-2 border border-border rounded-lg hover:bg-muted/50"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50"
          >
            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Changes
          </button>
        </div>
      </div>
      {/* Messages */}
      {error && (
        <div className="flex items-center gap-2 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-400">
          <AlertCircle className="w-5 h-5" />
          {error}
        </div>
      )}

      {successMessage && (
        <div className="flex items-center gap-2 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg text-green-700 dark:text-green-400">
          <Check className="w-5 h-5" />
          {successMessage}
        </div>
      )}

      {/* Default Settings */}
      <div className="bg-card rounded-lg border border-border p-6">
        <h2 className="text-lg font-semibold mb-4">Default Settings</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Default Provider</label>
            <select
              value={formData.default_provider || ''}
              onChange={(e) => handleDefaultProviderChange(e.target.value)}
              className="w-full px-3 py-2 border border-border rounded-lg bg-card"
            >
              {configData?.providers.map(p => (
                <option key={p.provider_id} value={p.provider_id} disabled={!p.available}>
                  {p.name} {!p.available && '(unavailable)'}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Default Model</label>
            <select
              value={formData.default_model || ''}
              onChange={(e) => setFormData({ ...formData, default_model: e.target.value })}
              className="w-full px-3 py-2 border border-border rounded-lg bg-card"
            >
              {filteredDefaultModels.map(model => (
                <option key={model.model_id} value={model.model_id}>
                  {model.name}
                </option>
              ))}
              {!filteredDefaultModels.length && (
                <option value="">No models available</option>
              )}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Max Questions per Generation</label>
            <input
              type="number"
              min={1}
              max={50}
              value={formData.max_questions_per_generation || 20}
              onChange={(e) => setFormData({ ...formData, max_questions_per_generation: parseInt(e.target.value) })}
              className="w-full px-3 py-2 border border-border rounded-lg bg-card"
            />
          </div>
        </div>

        {/* Feature Toggles */}
        <div className="mt-4 flex flex-wrap gap-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={formData.enable_rag ?? true}
              onChange={(e) => setFormData({ ...formData, enable_rag: e.target.checked })}
              className="w-4 h-4 rounded"
            />
            <span className="text-sm">Enable RAG</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={formData.enable_web_search ?? true}
              onChange={(e) => setFormData({ ...formData, enable_web_search: e.target.checked })}
              className="w-4 h-4 rounded"
            />
            <span className="text-sm">Enable Web Search</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={formData.enable_streaming ?? true}
              onChange={(e) => setFormData({ ...formData, enable_streaming: e.target.checked })}
              className="w-4 h-4 rounded"
            />
            <span className="text-sm">Enable Streaming</span>
          </label>
        </div>
      </div>

      {/* Embedding Settings */}
      <div className="bg-card rounded-lg border border-border p-6">
        <h2 className="text-lg font-semibold mb-4">Embedding Settings</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Embedding Provider</label>
            <select
              value={formData.embedding_provider || ''}
              onChange={(e) => handleEmbeddingProviderChange(e.target.value)}
              className="w-full px-3 py-2 border border-border rounded-lg bg-card"
            >
              {configData?.embedding_providers.map(provider => (
                <option key={provider.provider_id} value={provider.provider_id} disabled={!provider.available}>
                  {provider.name} {!provider.available && '(unavailable)'}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Embedding Model</label>
            <select
              value={formData.embedding_model || ''}
              onChange={(e) => setFormData({ ...formData, embedding_model: e.target.value })}
              className="w-full px-3 py-2 border border-border rounded-lg bg-card"
            >
              {embeddingModels.map(model => (
                <option key={model.model_id} value={model.model_id}>
                  {model.name} ({model.dimension} dims)
                </option>
              ))}
              {!embeddingModels.length && (
                <option value="">No models available</option>
              )}
            </select>
          </div>
        </div>
      </div>

      {/* Providers */}
      <div className="bg-card rounded-lg border border-border p-6">
        <h2 className="text-lg font-semibold mb-4">AI Providers</h2>
        <div className="space-y-3">
          {configData?.providers.map(provider => (
            <div key={provider.provider_id} className="border border-border rounded-lg">
              <div
                className="flex items-center justify-between p-4 cursor-pointer hover:bg-muted/50"
                onClick={() => toggleProviderExpand(provider.provider_id)}
              >
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={formData.enabled_providers?.includes(provider.provider_id) ?? false}
                    onChange={(e) => { e.stopPropagation(); toggleProvider(provider.provider_id) }}
                    className="w-4 h-4 rounded"
                  />
                  <div>
                    <div className="font-medium flex items-center gap-2">
                      {provider.name}
                      {provider.available ? (
                        <span className="text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded-full">Available</span>
                      ) : (
                        <span className="text-xs px-2 py-0.5 bg-red-100 text-red-700 rounded-full">Unavailable</span>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">{provider.description}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">{provider.models.length} models</span>
                  {expandedProviders.has(provider.provider_id) ? (
                    <ChevronUp className="w-5 h-5" />
                  ) : (
                    <ChevronDown className="w-5 h-5" />
                  )}
                </div>
              </div>

              {expandedProviders.has(provider.provider_id) && (
                <div className="border-t border-border p-4 bg-muted/40">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                    {provider.models.map(model => {
                      const enabledModels = getEnabledModels(provider.provider_id, provider.models)
                      const isEnabled = enabledModels.includes(model.model_id)
                      return (
                        <div
                          key={model.model_id}
                          className="flex items-center gap-2 p-2 bg-card rounded border border-border"
                        >
                          <div className="flex-1">
                            <div className="text-sm font-medium">{model.name}</div>
                            <div className="text-xs text-muted-foreground">
                              {model.context_window ? `${(model.context_window / 1000).toFixed(0)}k context` : ''}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={isEnabled}
                              onChange={() => toggleModel(provider.provider_id, model.model_id, provider.models)}
                              className="w-4 h-4 rounded"
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
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}


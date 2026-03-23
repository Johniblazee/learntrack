import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Cpu,
  Eye,
  KeyRound,
  RefreshCw,
  Star,
  Wrench,
} from 'lucide-react'

import { toast } from '@/contexts/ToastContext'
import { useApiClient } from '@/lib/api-client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'

interface AIModel {
  id: string
  name: string
  description: string
  context_window: number
  is_active: boolean
  is_default: boolean
  supports_vision: boolean
  supports_tools: boolean
  source?: 'static' | 'live'
}

interface ProviderStatus {
  has_key: boolean
  connected: boolean
  model_count: number
  cached?: boolean
}

interface TenantConfig {
  tenant_id: string
  tenant_name?: string
  tenant_email?: string
  default_provider?: string
  default_model?: string
  updated_at?: string
}

const PROVIDER_LABELS: Record<string, string> = {
  groq: 'Groq',
  openai: 'OpenAI',
  gemini: 'Google Gemini',
  anthropic: 'Anthropic',
}

function formatContextWindow(tokens: number): string {
  if (!tokens) return '—'
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`
  return String(tokens)
}

export function AIModelsPage() {
  const apiClient = useApiClient()
  const navigate = useNavigate()

  const [providers, setProviders] = useState<Record<string, AIModel[]>>({})
  const [providerStatus, setProviderStatus] = useState<Record<string, ProviderStatus>>({})
  const [tenantConfigs, setTenantConfigs] = useState<TenantConfig[]>([])
  const [tenantTotal, setTenantTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [tenantLoading, setTenantLoading] = useState(true)
  const [expandedProviders, setExpandedProviders] = useState<Set<string>>(new Set())
  const [togglingModels, setTogglingModels] = useState<Set<string>>(new Set())

  const fetchRegistry = useCallback(async (forceRefresh = false) => {
    if (forceRefresh) setRefreshing(true)
    else setLoading(true)
    try {
      const endpoint = forceRefresh
        ? '/api/v1/admin/ai-models/refresh'
        : '/api/v1/admin/ai-models/'
      const res = await apiClient.get(endpoint)
      const data = res.data as Record<string, any> | undefined
      setProviders(data?.providers || {})
      setProviderStatus(data?.provider_status || {})
      if (forceRefresh) toast.success('Models refreshed from vendor APIs')
    } catch {
      toast.error('Failed to load model registry')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [apiClient])

  const fetchTenantConfigs = useCallback(async () => {
    setTenantLoading(true)
    try {
      const res = await apiClient.get('/api/v1/admin/ai-models/tenant-configs')
      const data = res.data as Record<string, any> | undefined
      setTenantConfigs(data?.items || [])
      setTenantTotal(data?.total || 0)
    } catch {
      toast.error('Failed to load tenant configurations')
    } finally {
      setTenantLoading(false)
    }
  }, [apiClient])

  useEffect(() => {
    fetchRegistry()
    fetchTenantConfigs()
  }, [fetchRegistry, fetchTenantConfigs])

  const toggleProvider = (provider: string) => {
    setExpandedProviders((prev) => {
      const next = new Set(prev)
      if (next.has(provider)) next.delete(provider)
      else next.add(provider)
      return next
    })
  }

  const handleToggleActive = async (provider: string, modelId: string, currentActive: boolean) => {
    const key = `${provider}:${modelId}`
    setTogglingModels((prev) => new Set(prev).add(key))
    try {
      const res = await apiClient.put(
        `/api/v1/admin/ai-models/${provider}/${encodeURIComponent(modelId)}/toggle`,
        { is_active: !currentActive },
      )
      if (res.error) throw new Error(res.error)
      // Optimistic update
      setProviders((prev) => {
        const next = { ...prev }
        next[provider] = next[provider].map((m) =>
          m.id === modelId ? { ...m, is_active: !currentActive } : m,
        )
        return next
      })
    } catch {
      toast.error('Failed to toggle model')
    } finally {
      setTogglingModels((prev) => {
        const next = new Set(prev)
        next.delete(key)
        return next
      })
    }
  }

  const handleSetDefault = async (provider: string, modelId: string) => {
    const key = `${provider}:${modelId}`
    setTogglingModels((prev) => new Set(prev).add(key))
    try {
      const res = await apiClient.put(
        `/api/v1/admin/ai-models/${provider}/${encodeURIComponent(modelId)}/set-default`,
      )
      if (res.error) throw new Error(res.error)
      // Optimistic update — clear old default, set new
      setProviders((prev) => {
        const next = { ...prev }
        next[provider] = next[provider].map((m) => ({
          ...m,
          is_default: m.id === modelId,
          is_active: m.id === modelId ? true : m.is_active,
        }))
        return next
      })
      toast.success(`${modelId} set as default for ${PROVIDER_LABELS[provider] || provider}`)
    } catch {
      toast.error('Failed to set default model')
    } finally {
      setTogglingModels((prev) => {
        const next = new Set(prev)
        next.delete(key)
        return next
      })
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <Cpu className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">AI Models</h1>
            <p className="text-sm text-muted-foreground">
              Manage the global model registry and tenant configurations
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchRegistry(true)}
            disabled={refreshing}
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            Sync from Vendors
          </Button>
        </div>
      </div>

      {/* Model Registry */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Model Registry</CardTitle>
          <CardDescription>
            Models from your configured providers. Toggle active status or set the default model per provider.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : Object.keys(providers).length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No providers configured. Add API keys in your environment to see available models.
            </p>
          ) : (
            Object.entries(providers).map(([provider, models]) => {
              const isOpen = expandedProviders.has(provider)
              const activeCount = models.filter((m) => m.is_active).length
              const liveCount = models.filter((m) => m.source === 'live').length
              const status = providerStatus[provider]

              return (
                <Collapsible key={provider} open={isOpen} onOpenChange={() => toggleProvider(provider)}>
                  <CollapsibleTrigger asChild>
                    <button className="flex w-full items-center justify-between rounded-lg border border-border p-4 text-left hover:bg-muted/50 transition-colors">
                      <div className="flex items-center gap-3">
                        {isOpen ? (
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        )}
                        <span className="font-medium">{PROVIDER_LABELS[provider] || provider}</span>
                        {status && !status.has_key && (
                          <Badge variant="outline" className="text-xs text-amber-600 border-amber-400 dark:text-amber-400 dark:border-amber-600">
                            <KeyRound className="mr-1 h-3 w-3" />No API Key
                          </Badge>
                        )}
                        {status && status.has_key && status.connected && (
                          <Badge variant="outline" className="text-xs text-green-600 border-green-400 dark:text-green-400 dark:border-green-600">
                            <CircleCheck className="mr-1 h-3 w-3" />Connected
                          </Badge>
                        )}
                        {status && status.has_key && !status.connected && !status.cached && (
                          <Badge variant="outline" className="text-xs text-red-600 border-red-400 dark:text-red-400 dark:border-red-600">
                            <CircleAlert className="mr-1 h-3 w-3" />Key Invalid
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary">
                          {activeCount}/{models.length} active
                        </Badge>
                        {liveCount > 0 && (
                          <Badge variant="outline" className="text-xs">
                            +{liveCount} from API
                          </Badge>
                        )}
                      </div>
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="mt-1 rounded-lg border border-border overflow-hidden">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-[50px]">Active</TableHead>
                            <TableHead>Model</TableHead>
                            <TableHead className="hidden md:table-cell">Description</TableHead>
                            <TableHead className="text-right hidden sm:table-cell">Context</TableHead>
                            <TableHead className="text-center">Info</TableHead>
                            <TableHead className="text-right w-[100px]">Default</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {models.map((model) => {
                            const toggleKey = `${provider}:${model.id}`
                            const isToggling = togglingModels.has(toggleKey)

                            return (
                              <TableRow key={model.id} className={!model.is_active ? 'opacity-60' : ''}>
                                <TableCell>
                                  <Switch
                                    checked={model.is_active}
                                    disabled={isToggling || model.is_default}
                                    onCheckedChange={() => handleToggleActive(provider, model.id, model.is_active)}
                                  />
                                </TableCell>
                                <TableCell>
                                  <div>
                                    <p className="font-medium text-sm">{model.name}</p>
                                    <p className="text-xs text-muted-foreground font-mono">{model.id}</p>
                                  </div>
                                </TableCell>
                                <TableCell className="text-sm text-muted-foreground hidden md:table-cell">
                                  {model.description}
                                </TableCell>
                                <TableCell className="text-right text-sm hidden sm:table-cell">
                                  {formatContextWindow(model.context_window)}
                                </TableCell>
                                <TableCell>
                                  <div className="flex flex-wrap justify-center gap-1">
                                    {model.source === 'live' && (
                                      <Badge variant="outline" className="text-xs border-blue-500 text-blue-600 dark:text-blue-400">API</Badge>
                                    )}
                                    {model.supports_vision && (
                                      <Badge variant="outline" className="text-xs">
                                        <Eye className="mr-1 h-3 w-3" />Vision
                                      </Badge>
                                    )}
                                    {model.supports_tools && model.source !== 'live' && (
                                      <Badge variant="outline" className="text-xs">
                                        <Wrench className="mr-1 h-3 w-3" />Tools
                                      </Badge>
                                    )}
                                  </div>
                                </TableCell>
                                <TableCell className="text-right">
                                  {model.is_default ? (
                                    <Badge className="text-xs bg-primary">
                                      <Star className="mr-1 h-3 w-3 fill-current" />Default
                                    </Badge>
                                  ) : model.is_active ? (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="text-xs h-7"
                                      disabled={isToggling}
                                      onClick={() => handleSetDefault(provider, model.id)}
                                    >
                                      <Star className="mr-1 h-3 w-3" />
                                      Set Default
                                    </Button>
                                  ) : null}
                                </TableCell>
                              </TableRow>
                            )
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              )
            })
          )}
        </CardContent>
      </Card>

      {/* Tenant Configurations */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            Tenant Configurations
            {tenantTotal > 0 && (
              <Badge variant="secondary" className="ml-2">{tenantTotal}</Badge>
            )}
          </CardTitle>
          <CardDescription>
            Per-tenant AI provider and model overrides.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {tenantLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : tenantConfigs.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No tenant AI configurations found.
            </p>
          ) : (
            <div className="rounded-lg border border-border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tenant</TableHead>
                    <TableHead>Default Provider</TableHead>
                    <TableHead className="hidden sm:table-cell">Default Model</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tenantConfigs.map((config) => (
                    <TableRow key={config.tenant_id}>
                      <TableCell>
                        <div>
                          <p className="font-medium text-sm">
                            {config.tenant_name || config.tenant_email || config.tenant_id}
                          </p>
                          {config.tenant_email && config.tenant_name && (
                            <p className="text-xs text-muted-foreground">{config.tenant_email}</p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {PROVIDER_LABELS[config.default_provider || ''] || config.default_provider || '—'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm font-mono text-muted-foreground hidden sm:table-cell">
                        {config.default_model || '—'}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => navigate(`/admin/tenants/${config.tenant_id}/ai-config`)}
                        >
                          Configure
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

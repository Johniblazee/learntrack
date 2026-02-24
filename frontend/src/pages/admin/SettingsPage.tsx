import { useCallback, useEffect, useState } from 'react'
import { RefreshCw, Save, Settings } from 'lucide-react'

import { toast } from '@/contexts/ToastContext'
import { useApiClient } from '@/lib/api-client'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LoadingSpinner, LoadingState } from '@/components/ui/loading-state'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'

interface FeatureFlag {
  name: string
  enabled: boolean
  description?: string
  rollout_percentage: number
}

interface SystemSettings {
  ai_providers_enabled: string[]
  default_ai_provider: string
  max_questions_per_generation: number
  max_file_size_mb: number
  allowed_file_types: string[]
  enable_user_registration: boolean
  require_email_verification: boolean
  maintenance_mode: boolean
  maintenance_message?: string
}

const AI_PROVIDERS = [
  { id: 'groq', label: 'Groq' },
  { id: 'openai', label: 'OpenAI' },
  { id: 'anthropic', label: 'Anthropic' },
  { id: 'gemini', label: 'Gemini' },
]

export function AdminSettingsPage() {
  const client = useApiClient()
  const [settings, setSettings] = useState<SystemSettings | null>(null)
  const [featureFlags, setFeatureFlags] = useState<FeatureFlag[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [flagSaving, setFlagSaving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const fetchSettings = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)

      const [settingsRes, flagsRes] = await Promise.all([
        client.get<SystemSettings>('/admin/settings/'),
        client.get<{ flags: FeatureFlag[] }>('/admin/settings/feature-flags'),
      ])

      if (settingsRes.error) {
        throw new Error(settingsRes.error)
      }
      if (flagsRes.error) {
        throw new Error(flagsRes.error)
      }

      setSettings(settingsRes.data || null)
      setFeatureFlags(flagsRes.data?.flags || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load settings')
    } finally {
      setIsLoading(false)
    }
  }, [client])

  useEffect(() => {
    fetchSettings()
  }, [fetchSettings])

  const handleSaveSettings = async () => {
    if (!settings) return
    try {
      setIsSaving(true)
      const response = await client.put('/admin/settings/', { settings })
      if (response.error) {
        throw new Error(response.error)
      }
      toast.success('System settings saved successfully')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save settings')
    } finally {
      setIsSaving(false)
    }
  }

  const handleUpdateFlag = async (flag: FeatureFlag) => {
    try {
      setFlagSaving(flag.name)
      const response = await client.put(`/admin/settings/feature-flags/${flag.name}`, flag)
      if (response.error) {
        throw new Error(response.error)
      }
      toast.success(`Feature flag "${flag.name}" updated`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update feature flag')
    } finally {
      setFlagSaving(null)
    }
  }

  const handleFlagChange = (flagName: string, updates: Partial<FeatureFlag>) => {
    setFeatureFlags((prev) =>
      prev.map((flag) => (flag.name === flagName ? { ...flag, ...updates } : flag))
    )
  }

  if (isLoading) {
    return <LoadingState message="Loading system settings..." size="lg" className="h-64" />
  }

  if (!settings) {
    return (
      <div className="space-y-6">
        <Alert variant="destructive">
          <AlertTitle>Unable to load settings</AlertTitle>
          <AlertDescription>{error || 'System settings could not be loaded.'}</AlertDescription>
        </Alert>
        <Button onClick={fetchSettings}>Retry</Button>
      </div>
    )
  }

  const allowedFileTypesValue = settings.allowed_file_types.join(', ')

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-muted rounded-lg"><Settings className="w-6 h-6 text-muted-foreground" /></div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">System Settings</h1>
            <p className="text-muted-foreground">Configure system-wide settings and feature flags</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={fetchSettings} disabled={isSaving}>
            <RefreshCw className="w-4 h-4" />
            Refresh
          </Button>
          <Button onClick={handleSaveSettings} disabled={isSaving}>
            {isSaving ? <LoadingSpinner size="sm" className="text-primary-foreground" /> : <Save className="w-4 h-4" />}
            {isSaving ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>Settings error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="bg-card rounded-xl shadow-sm border border-border p-6 space-y-6">
        <h2 className="text-lg font-semibold text-foreground">General Settings</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <Label>Default AI Provider</Label>
            <Select
              value={settings.default_ai_provider}
              onValueChange={(value) => setSettings({ ...settings, default_ai_provider: value })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select provider" />
              </SelectTrigger>
              <SelectContent>
                {AI_PROVIDERS.map((provider) => (
                  <SelectItem key={provider.id} value={provider.id}>
                    {provider.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Max Questions per Generation</Label>
            <Input
              type="number"
              min={1}
              max={50}
              value={settings.max_questions_per_generation}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  max_questions_per_generation: Number(event.target.value || 0),
                })
              }
            />
          </div>
          <div className="space-y-2">
            <Label>Max File Size (MB)</Label>
            <Input
              type="number"
              min={1}
              value={settings.max_file_size_mb}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  max_file_size_mb: Number(event.target.value || 0),
                })
              }
            />
          </div>
          <div className="space-y-2">
            <Label>Allowed File Types</Label>
            <Input
              value={allowedFileTypesValue}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  allowed_file_types: event.target.value
                    .split(',')
                    .map((item) => item.trim())
                    .filter(Boolean),
                })
              }
              placeholder="pdf, docx, txt, md"
            />
          </div>
        </div>

        <div className="space-y-3">
          <p className="text-sm font-medium text-foreground">Enabled AI Providers</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {AI_PROVIDERS.map((provider) => {
              const enabled = settings.ai_providers_enabled.includes(provider.id)
              return (
                <label key={provider.id} className="flex items-center gap-3 rounded-lg border border-border p-3 text-sm">
                  <Checkbox
                    checked={enabled}
                    onCheckedChange={() =>
                      setSettings({
                        ...settings,
                        ai_providers_enabled: enabled
                          ? settings.ai_providers_enabled.filter((id) => id !== provider.id)
                          : [...settings.ai_providers_enabled, provider.id],
                      })
                    }
                  />
                  <span className="font-medium text-foreground">{provider.label}</span>
                </label>
              )
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div>
              <p className="text-sm font-medium text-foreground">Enable user registration</p>
              <p className="text-xs text-muted-foreground">Allow new users to sign up.</p>
            </div>
            <Switch
              checked={settings.enable_user_registration}
              onCheckedChange={(checked) => setSettings({ ...settings, enable_user_registration: checked })}
            />
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div>
              <p className="text-sm font-medium text-foreground">Require email verification</p>
              <p className="text-xs text-muted-foreground">Force verification before access.</p>
            </div>
            <Switch
              checked={settings.require_email_verification}
              onCheckedChange={(checked) => setSettings({ ...settings, require_email_verification: checked })}
            />
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div>
              <p className="text-sm font-medium text-foreground">Maintenance mode</p>
              <p className="text-xs text-muted-foreground">Display maintenance message to all users.</p>
            </div>
            <Switch
              checked={settings.maintenance_mode}
              onCheckedChange={(checked) => setSettings({ ...settings, maintenance_mode: checked })}
            />
          </div>
          {settings.maintenance_mode && (
            <div className="space-y-2">
              <Label>Maintenance message</Label>
              <Textarea
                value={settings.maintenance_message || ''}
                onChange={(event) => setSettings({ ...settings, maintenance_message: event.target.value })}
                placeholder="We are performing scheduled maintenance. Please check back shortly."
              />
            </div>
          )}
        </div>
      </div>

      <div className="bg-card rounded-xl shadow-sm border border-border p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">Feature Flags</h2>
          <Badge variant="outline">{featureFlags.length} flags</Badge>
        </div>
        <div className="space-y-4">
          {featureFlags.map((flag) => (
            <Card key={flag.name} className="border border-border">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-medium text-foreground">{flag.name.replace(/_/g, ' ')}</p>
                    {flag.description && (
                      <p className="text-sm text-muted-foreground">{flag.description}</p>
                    )}
                  </div>
                  <Switch
                    checked={flag.enabled}
                    onCheckedChange={(checked) => handleFlagChange(flag.name, { enabled: checked })}
                  />
                </div>

                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-3">
                    <Label className="text-xs text-muted-foreground">Rollout %</Label>
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      value={flag.rollout_percentage}
                      onChange={(event) =>
                        handleFlagChange(flag.name, {
                          rollout_percentage: Number(event.target.value || 0),
                        })
                      }
                      className="w-24"
                    />
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => handleUpdateFlag(flag)}
                    disabled={flagSaving === flag.name}
                  >
                    {flagSaving === flag.name ? 'Updating...' : 'Update'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  )
}

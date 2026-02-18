import { useEffect, useState } from 'react'
import { useAuth } from '@clerk/clerk-react'
import { Settings, Save, ToggleLeft, ToggleRight } from 'lucide-react'
import { LoadingButtonContent, LoadingState } from '@/components/ui/loading-state'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api/v1'

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

export function AdminSettingsPage() {
  const { getToken } = useAuth()
  const [settings, setSettings] = useState<SystemSettings | null>(null)
  const [featureFlags, setFeatureFlags] = useState<FeatureFlag[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const fetchSettings = async () => {
    try {
      setIsLoading(true)
      const token = await getToken()
      
      const [settingsRes, flagsRes] = await Promise.all([
        fetch(`${API_BASE_URL}/admin/settings/`, { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch(`${API_BASE_URL}/admin/settings/feature-flags`, { headers: { 'Authorization': `Bearer ${token}` } })
      ])

      if (settingsRes.ok) setSettings(await settingsRes.json())
      if (flagsRes.ok) {
        const data = await flagsRes.json()
        setFeatureFlags(data.flags || [])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load settings')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => { fetchSettings() }, [])

  const handleToggleFlag = async (flagName: string, currentEnabled: boolean) => {
    try {
      const token = await getToken()
      const flag = featureFlags.find(f => f.name === flagName)
      if (!flag) return

      const response = await fetch(`${API_BASE_URL}/admin/settings/feature-flags/${flagName}`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...flag, enabled: !currentEnabled })
      })

      if (response.ok) {
        setFeatureFlags(flags => flags.map(f => f.name === flagName ? { ...f, enabled: !currentEnabled } : f))
        setSuccessMessage(`Feature flag "${flagName}" updated`)
        setTimeout(() => setSuccessMessage(null), 3000)
      }
    } catch (err) {
      setError('Failed to update feature flag')
    }
  }

  const handleSaveSettings = async () => {
    if (!settings) return
    try {
      setIsSaving(true)
      const token = await getToken()
      
      const response = await fetch(`${API_BASE_URL}/admin/settings/`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings })
      })

      if (response.ok) {
        setSuccessMessage('Settings saved successfully')
        setTimeout(() => setSuccessMessage(null), 3000)
      } else {
        throw new Error('Failed to save settings')
      }
    } catch (err) {
      setError('Failed to save settings')
    } finally {
      setIsSaving(false)
    }
  }

  if (isLoading) {
    return <LoadingState message="Loading settings..." />
  }

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
        <button onClick={handleSaveSettings} disabled={isSaving} className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50">
          {isSaving ? <LoadingButtonContent label="Saving..." /> : <><Save className="w-4 h-4" />Save Changes</>}
        </button>
      </div>

      {error && <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 text-red-600 dark:text-red-400">{error}</div>}
      {successMessage && <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4 text-green-600 dark:text-green-400">{successMessage}</div>}

      {/* Feature Flags */}
      <div className="bg-card rounded-xl shadow-sm border border-border p-6">
        <h2 className="text-lg font-semibold text-foreground mb-4">Feature Flags</h2>
        <div className="space-y-4">
          {featureFlags.map((flag) => (
            <div key={flag.name} className="flex items-center justify-between p-4 bg-muted/40 rounded-lg">
              <div>
                <p className="font-medium text-foreground">{flag.name.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</p>
                {flag.description && <p className="text-sm text-muted-foreground">{flag.description}</p>}
              </div>
              <button onClick={() => handleToggleFlag(flag.name, flag.enabled)} className={`p-1 rounded-lg transition-colors ${flag.enabled ? 'text-green-600' : 'text-muted-foreground'}`}>
                {flag.enabled ? <ToggleRight className="w-8 h-8" /> : <ToggleLeft className="w-8 h-8" />}
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* System Settings */}
      {settings && (
        <div className="bg-card rounded-xl shadow-sm border border-border p-6">
          <h2 className="text-lg font-semibold text-foreground mb-4">General Settings</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">Default AI Provider</label>
              <select value={settings.default_ai_provider} onChange={(e) => setSettings({ ...settings, default_ai_provider: e.target.value })}
                className="w-full px-4 py-2 border border-border rounded-lg bg-card">
                <option value="groq">Groq</option>
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic</option>
                <option value="google">Google</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">Max Questions per Generation</label>
              <input type="number" value={settings.max_questions_per_generation} onChange={(e) => setSettings({ ...settings, max_questions_per_generation: parseInt(e.target.value) })}
                className="w-full px-4 py-2 border border-border rounded-lg bg-card" />
            </div>
            <div className="flex items-center gap-3">
              <input type="checkbox" id="maintenance" checked={settings.maintenance_mode} onChange={(e) => setSettings({ ...settings, maintenance_mode: e.target.checked })} className="w-4 h-4 rounded" />
              <label htmlFor="maintenance" className="text-sm font-medium text-foreground">Maintenance Mode</label>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}


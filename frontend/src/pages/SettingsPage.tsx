import { useState, useEffect } from 'react'
import { useAuth, useUser } from '@clerk/clerk-react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { User, Bell, Lock, Palette, Globe, Save, ArrowLeft } from 'lucide-react'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Switch } from '../components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { LoadingSpinner, LoadingState } from '@/components/ui/loading-state'
import { useTheme } from '../contexts/ThemeContext'
import { useApiClient, VIEW_AS_STORAGE_KEY } from '../lib/api-client'
import { toast } from '../contexts/ToastContext'
import { API_BASE_URL } from '@/lib/config'
import { useImpersonation } from '@/contexts/ImpersonationContext'

type ViewAsRole = 'tutor' | 'student' | 'parent'
type ImpersonationTargetRole = 'student' | 'parent'
type StudentDefaultTab = 'dashboard' | 'courses' | 'assignments' | 'grades' | 'library'

interface AdminImpersonationTarget {
  id: string
  clerk_id: string
  email: string
  name: string
  role: string
  tutor_id?: string
}

const PREVIEW_SWITCHER_USER_ID = 'user_33bbM70rwXsrbn1GWQTGORD9d8T'

function readStoredViewAsRole(): ViewAsRole | null {
  if (typeof window === 'undefined') {
    return null
  }

  const value = window.localStorage.getItem(VIEW_AS_STORAGE_KEY)
  if (value === 'tutor' || value === 'student' || value === 'parent') {
    return value
  }

  return null
}

export default function SettingsPage() {
  const { getToken } = useAuth()
  const { user } = useUser()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { theme, toggleTheme } = useTheme()
  const apiClient = useApiClient()
  const {
    isImpersonating,
    impersonatedUser,
    startImpersonation,
    endImpersonation,
    isLoading: isImpersonationLoading,
  } = useImpersonation()
  const [isSaving, setIsSaving] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  const userRole = (user?.publicMetadata?.role || user?.unsafeMetadata?.role) as string | undefined
  const initialViewAsRole: ViewAsRole =
    userRole === 'student' || userRole === 'parent' || userRole === 'tutor'
      ? userRole
      : 'tutor'
  const isPreviewSwitcherUser = user?.id === PREVIEW_SWITCHER_USER_ID
  const [viewAsRole, setViewAsRole] = useState<ViewAsRole>(initialViewAsRole)
  const [impersonationRoleFilter, setImpersonationRoleFilter] = useState<ImpersonationTargetRole>('student')
  const [impersonationSearch, setImpersonationSearch] = useState('')
  const [impersonationTargets, setImpersonationTargets] = useState<AdminImpersonationTarget[]>([])
  const [isLoadingImpersonationTargets, setIsLoadingImpersonationTargets] = useState(false)
  const [selectedImpersonationTargetId, setSelectedImpersonationTargetId] = useState<string | null>(null)

  // Settings state
  const [settings, setSettings] = useState({
    // Profile
    displayName: user?.fullName || '',
    email: user?.primaryEmailAddress?.emailAddress || '',
    timezone: 'America/New_York',

    // Notifications
    emailNotifications: true,
    assignmentReminders: true,
    messageNotifications: true,
    weeklyDigest: false,

    // Privacy
    profileVisibility: 'students',
    showEmail: false,
    showPhone: false,

    // Preferences
    defaultStudentTab: 'dashboard' as StudentDefaultTab,
    showWeekendSchedule: true,
    compactAssignmentCards: false,
    autoOpenNextAssignment: false,
  })

  // Load settings from backend on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        setIsLoading(true)
        const response = await apiClient.get('/settings/user')

        if (response.data) {
          const data = response.data
          setSettings(prev => ({
            ...prev,
            // Profile
            displayName: data.profile?.display_name || user?.fullName || '',
            timezone: data.profile?.timezone || 'America/New_York',
            // Notifications
            emailNotifications: data.notifications?.email_notifications ?? true,
            assignmentReminders: data.notifications?.assignment_reminders ?? true,
            messageNotifications: data.notifications?.message_notifications ?? true,
            weeklyDigest: data.notifications?.weekly_digest ?? false,
            // Privacy
            profileVisibility: data.privacy?.profile_visibility || 'students',
            showEmail: data.privacy?.show_email ?? false,
            showPhone: data.privacy?.show_phone ?? false,
            // Preferences
            defaultStudentTab:
              data.preferences?.default_student_tab === 'dashboard' ||
              data.preferences?.default_student_tab === 'courses' ||
              data.preferences?.default_student_tab === 'assignments' ||
              data.preferences?.default_student_tab === 'grades' ||
              data.preferences?.default_student_tab === 'library'
                ? data.preferences.default_student_tab
                : 'dashboard',
            showWeekendSchedule: data.preferences?.show_weekend_schedule ?? true,
            compactAssignmentCards: data.preferences?.compact_assignment_cards ?? false,
            autoOpenNextAssignment: data.preferences?.auto_open_next_assignment ?? false,
          }))
        }
      } catch (error) {
        console.error('Failed to load settings:', error)
        // Use defaults on error - don't show error toast since defaults are fine
      } finally {
        setIsLoading(false)
      }
    }

    loadSettings()
  }, [user])

  useEffect(() => {
    if (!isPreviewSwitcherUser) {
      return
    }

    const storedRole = readStoredViewAsRole()
    setViewAsRole(storedRole ?? initialViewAsRole)
  }, [initialViewAsRole, isPreviewSwitcherUser])

  useEffect(() => {
    if (!isPreviewSwitcherUser) {
      return
    }

    fetchImpersonationTargets('').catch((error) => {
      console.error('Initial impersonation target load failed:', error)
    })
  }, [isPreviewSwitcherUser, impersonationRoleFilter])

  useEffect(() => {
    if (!isImpersonating || typeof window === 'undefined') {
      return
    }

    window.localStorage.removeItem(VIEW_AS_STORAGE_KEY)
    setViewAsRole(initialViewAsRole)
  }, [initialViewAsRole, isImpersonating])

  const handleSetViewAsRole = (role: ViewAsRole) => {
    if (role === viewAsRole) {
      return
    }

    setViewAsRole(role)

    if (!isPreviewSwitcherUser || typeof window === 'undefined') {
      return
    }

    window.localStorage.setItem(VIEW_AS_STORAGE_KEY, role)
    queryClient.clear()
    toast.success(`Preview role set to ${role}`)
  }

  const handleExitViewAs = () => {
    setViewAsRole(initialViewAsRole)

    if (!isPreviewSwitcherUser || typeof window === 'undefined') {
      return
    }

    window.localStorage.removeItem(VIEW_AS_STORAGE_KEY)
    queryClient.clear()
    toast.success('View-as preview reset to default role')
  }

  const fetchImpersonationTargets = async (searchOverride?: string) => {
    if (!isPreviewSwitcherUser) {
      return
    }

    try {
      setIsLoadingImpersonationTargets(true)

      const token = await getToken()
      const params = new URLSearchParams({
        page: '1',
        per_page: '50',
        role_filter: impersonationRoleFilter,
      })

      const searchValue = (searchOverride ?? impersonationSearch).trim()
      if (searchValue) {
        params.append('search', searchValue)
      }

      const response = await fetch(`${API_BASE_URL}/admin/users/?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      })

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(payload?.detail || 'Failed to load impersonation targets')
      }

      const payload = await response.json()
      const users: AdminImpersonationTarget[] = Array.isArray(payload?.users) ? payload.users : []
      setImpersonationTargets(users)

      if (users.length === 0) {
        setSelectedImpersonationTargetId(null)
      } else if (
        selectedImpersonationTargetId &&
        !users.some((target) => target.clerk_id === selectedImpersonationTargetId)
      ) {
        setSelectedImpersonationTargetId(null)
      }
    } catch (error) {
      console.error('Failed to fetch impersonation targets:', error)
      toast.error(error instanceof Error ? error.message : 'Failed to load impersonation targets')
      setImpersonationTargets([])
      setSelectedImpersonationTargetId(null)
    } finally {
      setIsLoadingImpersonationTargets(false)
    }
  }

  const handleStartImpersonation = async () => {
    if (!selectedImpersonationTargetId) {
      toast.error('Select a user to preview first')
      return
    }

    const selectedTarget = impersonationTargets.find(
      (target) => target.clerk_id === selectedImpersonationTargetId
    )

    if (!selectedTarget) {
      toast.error('Selected user is no longer available')
      return
    }

    try {
      if (typeof window !== 'undefined') {
        window.localStorage.removeItem(VIEW_AS_STORAGE_KEY)
      }

      await startImpersonation(selectedTarget.clerk_id)
      queryClient.clear()
      toast.success(`Now previewing ${selectedTarget.name}`)
      navigate('/dashboard')
    } catch (error) {
      console.error('Failed to start impersonation:', error)
      toast.error(error instanceof Error ? error.message : 'Failed to start impersonation')
    }
  }

  const handleEndImpersonation = async () => {
    try {
      await endImpersonation()
      queryClient.clear()
      toast.success('Stopped user preview session')
    } catch (error) {
      console.error('Failed to end impersonation:', error)
      toast.error('Failed to stop user preview session')
    }
  }

  const handleSave = async () => {
    setIsSaving(true)
    try {
      const response = await apiClient.put('/settings/user', {
        profile: {
          display_name: settings.displayName || null,
          timezone: settings.timezone,
        },
        notifications: {
          email_notifications: settings.emailNotifications,
          assignment_reminders: settings.assignmentReminders,
          message_notifications: settings.messageNotifications,
          weekly_digest: settings.weeklyDigest,
        },
        privacy: {
          profile_visibility: settings.profileVisibility,
          show_email: settings.showEmail,
          show_phone: settings.showPhone,
        },
        preferences: {
          default_student_tab: settings.defaultStudentTab,
          show_weekend_schedule: settings.showWeekendSchedule,
          compact_assignment_cards: settings.compactAssignmentCards,
          auto_open_next_assignment: settings.autoOpenNextAssignment,
        },
      })

      if (response.error) {
        throw new Error(response.error)
      }

      toast.success('Settings saved successfully!')
    } catch (error: any) {
      console.error('Failed to save settings:', error)
      toast.error(error.message || 'Failed to save settings')
    } finally {
      setIsSaving(false)
    }
  }

  if (isLoading) {
    return <LoadingState fullScreen message="Loading settings..." size="lg" />
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate('/dashboard')}
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back
              </Button>
              <div>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                  Settings
                </h1>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Manage your account settings and preferences
                </p>
              </div>
            </div>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? (
                <>
                  <LoadingSpinner size="sm" className="mr-2" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  Save Changes
                </>
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Tabs defaultValue="profile" className="space-y-6">
          <TabsList className="grid w-full grid-cols-5 lg:w-auto">
            <TabsTrigger value="profile">
              <User className="h-4 w-4 mr-2" />
              Profile
            </TabsTrigger>
            <TabsTrigger value="notifications">
              <Bell className="h-4 w-4 mr-2" />
              Notifications
            </TabsTrigger>
            <TabsTrigger value="privacy">
              <Lock className="h-4 w-4 mr-2" />
              Privacy
            </TabsTrigger>
            <TabsTrigger value="appearance">
              <Palette className="h-4 w-4 mr-2" />
              Appearance
            </TabsTrigger>
            <TabsTrigger value="preferences">
              <Globe className="h-4 w-4 mr-2" />
              Preferences
            </TabsTrigger>
          </TabsList>

          {/* Profile Tab */}
          <TabsContent value="profile" className="space-y-6">
            {isPreviewSwitcherUser && !isImpersonating && (
              <Card>
                <CardHeader>
                  <CardTitle>View As (Temporary)</CardTitle>
                  <CardDescription>
                    Preview the dashboard as tutor, student, or parent. This does not change your real account role.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex flex-wrap gap-2">
                    {(['tutor', 'student', 'parent'] as ViewAsRole[]).map((role) => (
                      <Button
                        key={role}
                        type="button"
                        size="sm"
                        variant={viewAsRole === role ? 'default' : 'outline'}
                        onClick={() => handleSetViewAsRole(role)}
                      >
                        {role.charAt(0).toUpperCase() + role.slice(1)}
                      </Button>
                    ))}
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={handleExitViewAs}
                    >
                      Exit
                    </Button>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                    <span>Current preview:</span>
                    <span className="font-medium text-foreground">{viewAsRole}</span>
                    <Button
                      type="button"
                      variant="link"
                      className="h-auto p-0"
                      onClick={() => navigate('/dashboard')}
                    >
                      Open dashboard view
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {isPreviewSwitcherUser && (
              <Card>
                <CardHeader>
                  <CardTitle>View As User (Phase 2)</CardTitle>
                  <CardDescription>
                    Start a true user preview session to load data as a specific student or parent account.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {isImpersonating && impersonatedUser ? (
                    <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-700 dark:bg-amber-900/20">
                      <p className="font-medium text-amber-900 dark:text-amber-100">
                        Currently previewing: {impersonatedUser.name} ({impersonatedUser.role})
                      </p>
                      <p className="mt-1 text-amber-800 dark:text-amber-200">{impersonatedUser.email}</p>
                      <div className="mt-3 flex items-center gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="destructive"
                          onClick={handleEndImpersonation}
                          disabled={isImpersonationLoading}
                        >
                          {isImpersonationLoading ? 'Stopping...' : 'Exit User Preview'}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => navigate('/dashboard')}
                        >
                          Open preview dashboard
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="flex flex-wrap items-center gap-2">
                        {(['student', 'parent'] as ImpersonationTargetRole[]).map((role) => (
                          <Button
                            key={role}
                            type="button"
                            size="sm"
                            variant={impersonationRoleFilter === role ? 'default' : 'outline'}
                            onClick={() => {
                              setImpersonationRoleFilter(role)
                              setSelectedImpersonationTargetId(null)
                            }}
                          >
                            {role === 'student' ? 'Students' : 'Parents'}
                          </Button>
                        ))}
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <Input
                          value={impersonationSearch}
                          onChange={(event) => setImpersonationSearch(event.target.value)}
                          placeholder={`Search ${impersonationRoleFilter}s by name or email`}
                          className="max-w-md"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => fetchImpersonationTargets()}
                          disabled={isLoadingImpersonationTargets}
                        >
                          {isLoadingImpersonationTargets ? 'Loading...' : 'Search'}
                        </Button>
                      </div>

                      <div className="max-h-64 space-y-2 overflow-y-auto rounded-md border p-2">
                        {isLoadingImpersonationTargets ? (
                          <p className="text-sm text-muted-foreground">Loading available users...</p>
                        ) : impersonationTargets.length === 0 ? (
                          <p className="text-sm text-muted-foreground">No matching users found.</p>
                        ) : (
                          impersonationTargets.map((target) => (
                            <button
                              key={target.clerk_id}
                              type="button"
                              className={`w-full rounded-md border px-3 py-2 text-left transition-colors ${
                                selectedImpersonationTargetId === target.clerk_id
                                  ? 'border-primary bg-primary/5'
                                  : 'border-border hover:bg-muted/40'
                              }`}
                              onClick={() => setSelectedImpersonationTargetId(target.clerk_id)}
                            >
                              <p className="text-sm font-medium text-foreground">{target.name}</p>
                              <p className="text-xs text-muted-foreground">{target.email}</p>
                            </button>
                          ))
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          size="sm"
                          onClick={handleStartImpersonation}
                          disabled={!selectedImpersonationTargetId || isImpersonationLoading}
                        >
                          {isImpersonationLoading ? 'Starting...' : 'Start User Preview'}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => navigate('/dashboard')}
                        >
                          Back to dashboard
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader>
                <CardTitle>Profile Information</CardTitle>
                <CardDescription>
                  Update your personal information and how others see you
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="displayName">Display Name</Label>
                  <Input
                    id="displayName"
                    value={settings.displayName}
                    onChange={(e) => setSettings({ ...settings, displayName: e.target.value })}
                    placeholder="Your name"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="email">Email Address</Label>
                  <Input
                    id="email"
                    type="email"
                    value={settings.email}
                    disabled
                    className="bg-gray-50 dark:bg-gray-800"
                  />
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Email is managed by your authentication provider
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="timezone">Timezone</Label>
                  <select
                    id="timezone"
                    value={settings.timezone}
                    onChange={(e) => setSettings({ ...settings, timezone: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                  >
                    <option value="America/New_York">Eastern Time (ET)</option>
                    <option value="America/Chicago">Central Time (CT)</option>
                    <option value="America/Denver">Mountain Time (MT)</option>
                    <option value="America/Los_Angeles">Pacific Time (PT)</option>
                    <option value="Europe/London">London (GMT)</option>
                    <option value="Europe/Paris">Paris (CET)</option>
                    <option value="Asia/Tokyo">Tokyo (JST)</option>
                    <option value="Asia/Shanghai">Shanghai (CST)</option>
                  </select>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Notifications Tab */}
          <TabsContent value="notifications" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Notification Preferences</CardTitle>
                <CardDescription>
                  Choose how you want to be notified about updates
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Email Notifications</Label>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      Receive notifications via email
                    </p>
                  </div>
                  <Switch
                    checked={settings.emailNotifications}
                    onCheckedChange={(checked) => 
                      setSettings({ ...settings, emailNotifications: checked })
                    }
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Assignment Reminders</Label>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      Get reminded about upcoming assignment deadlines
                    </p>
                  </div>
                  <Switch
                    checked={settings.assignmentReminders}
                    onCheckedChange={(checked) => 
                      setSettings({ ...settings, assignmentReminders: checked })
                    }
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Message Notifications</Label>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      Get notified when you receive new messages
                    </p>
                  </div>
                  <Switch
                    checked={settings.messageNotifications}
                    onCheckedChange={(checked) => 
                      setSettings({ ...settings, messageNotifications: checked })
                    }
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Weekly Digest</Label>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      Receive a weekly summary of your activity
                    </p>
                  </div>
                  <Switch
                    checked={settings.weeklyDigest}
                    onCheckedChange={(checked) => 
                      setSettings({ ...settings, weeklyDigest: checked })
                    }
                  />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Privacy Tab */}
          <TabsContent value="privacy" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Privacy Settings</CardTitle>
                <CardDescription>
                  Control who can see your information
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-2">
                  <Label htmlFor="profileVisibility">Profile Visibility</Label>
                  <select
                    id="profileVisibility"
                    value={settings.profileVisibility}
                    onChange={(e) => setSettings({ ...settings, profileVisibility: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                  >
                    <option value="everyone">Everyone</option>
                    <option value="students">My Students Only</option>
                    <option value="private">Private</option>
                  </select>
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Show Email Address</Label>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      Allow students to see your email
                    </p>
                  </div>
                  <Switch
                    checked={settings.showEmail}
                    onCheckedChange={(checked) => 
                      setSettings({ ...settings, showEmail: checked })
                    }
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Show Phone Number</Label>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      Allow students to see your phone number
                    </p>
                  </div>
                  <Switch
                    checked={settings.showPhone}
                    onCheckedChange={(checked) => 
                      setSettings({ ...settings, showPhone: checked })
                    }
                  />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Appearance Tab */}
          <TabsContent value="appearance" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Appearance</CardTitle>
                <CardDescription>
                  Customize how the app looks
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Dark Mode</Label>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      Use dark theme for better visibility in low light
                    </p>
                  </div>
                  <Switch
                    checked={theme === 'dark'}
                    onCheckedChange={toggleTheme}
                  />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Preferences Tab */}
          <TabsContent value="preferences" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Preferences</CardTitle>
                <CardDescription>
                  Tailor your student workspace experience
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-2">
                  <Label htmlFor="defaultStudentTab">Default Student Dashboard Tab</Label>
                  <select
                    id="defaultStudentTab"
                    value={settings.defaultStudentTab}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        defaultStudentTab: e.target.value as StudentDefaultTab,
                      })
                    }
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                  >
                    <option value="dashboard">Dashboard</option>
                    <option value="courses">My Courses</option>
                    <option value="assignments">Assignments</option>
                    <option value="grades">Grades</option>
                    <option value="library">Library</option>
                  </select>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Choose which tab opens first when you enter the student dashboard.
                  </p>
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Show Weekend in Weekly Schedule</Label>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      Include Saturday and Sunday in the student schedule view.
                    </p>
                  </div>
                  <Switch
                    checked={settings.showWeekendSchedule}
                    onCheckedChange={(checked) =>
                      setSettings({ ...settings, showWeekendSchedule: checked })
                    }
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Compact Assignment Cards</Label>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      Reduce card spacing so more assignments are visible at once.
                    </p>
                  </div>
                  <Switch
                    checked={settings.compactAssignmentCards}
                    onCheckedChange={(checked) =>
                      setSettings({ ...settings, compactAssignmentCards: checked })
                    }
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Auto-open Next Assignment</Label>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      Open the next in-progress assignment when using Resume Learning Session.
                    </p>
                  </div>
                  <Switch
                    checked={settings.autoOpenNextAssignment}
                    onCheckedChange={(checked) =>
                      setSettings({ ...settings, autoOpenNextAssignment: checked })
                    }
                  />
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}


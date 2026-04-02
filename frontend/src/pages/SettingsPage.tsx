import { useEffect, useState } from 'react'
import { useUser } from '@clerk/clerk-react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Bell, Brain, Globe, Lock, Palette, Save, User } from 'lucide-react'

import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Switch } from '../components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { LoadingSpinner, LoadingState } from '@/components/ui/loading-state'
import { useTheme } from '../contexts/ThemeContext'
import { toast } from '../contexts/ToastContext'
import { useUserContext } from '@/contexts/UserContext'
import { useApiClient } from '../lib/api-client'
import { AIConfigTab } from '@/components/settings/AIConfigTab'

type StudentDefaultTab = 'dashboard' | 'courses' | 'assignments' | 'grades' | 'library' | 'messages'
type ParentDefaultTab = 'overview' | 'children' | 'upcoming' | 'messages'

interface SettingsState {
  displayName: string
  email: string
  timezone: string
  emailNotifications: boolean
  assignmentReminders: boolean
  messageNotifications: boolean
  weeklyDigest: boolean
  profileVisibility: string
  showEmail: boolean
  showPhone: boolean
  defaultStudentTab: StudentDefaultTab
  defaultParentTab: ParentDefaultTab
  showWeekendSchedule: boolean
  compactAssignmentCards: boolean
  autoOpenNextAssignment: boolean
}

const DEFAULT_SETTINGS: SettingsState = {
  displayName: '',
  email: '',
  timezone: 'America/New_York',
  emailNotifications: true,
  assignmentReminders: true,
  messageNotifications: true,
  weeklyDigest: false,
  profileVisibility: 'students',
  showEmail: false,
  showPhone: false,
  defaultStudentTab: 'dashboard',
  defaultParentTab: 'overview',
  showWeekendSchedule: true,
  compactAssignmentCards: false,
  autoOpenNextAssignment: false,
}

function normalizeDefaultStudentTab(value: unknown): StudentDefaultTab {
  if (
    value === 'dashboard' ||
    value === 'courses' ||
    value === 'assignments' ||
    value === 'grades' ||
    value === 'library' ||
    value === 'messages'
  ) {
    return value
  }

  return 'dashboard'
}

function normalizeDefaultParentTab(value: unknown): ParentDefaultTab {
  if (value === 'overview' || value === 'children' || value === 'upcoming' || value === 'messages') {
    return value
  }

  return 'overview'
}

export default function SettingsPage() {
  const { user } = useUser()
  const navigate = useNavigate()
  const { theme, toggleTheme } = useTheme()
  const apiClient = useApiClient()
  const queryClient = useQueryClient()
  const { backendUser } = useUserContext()

  const [isSaving, setIsSaving] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [settings, setSettings] = useState<SettingsState>({
    ...DEFAULT_SETTINGS,
    displayName: user?.fullName || '',
    email: user?.primaryEmailAddress?.emailAddress || '',
  })

  const userRole = String(backendUser?.role || user?.publicMetadata?.role || '').toLowerCase()
  const isStudent = userRole === 'student'
  const isTutor = userRole === 'tutor'
  const roleLabel = isStudent ? 'student workspace' : userRole === 'parent' ? 'parent account' : 'personal account'

  useEffect(() => {
    const loadSettings = async () => {
      try {
        setIsLoading(true)
        const response = await apiClient.get('/settings/user')

        if (!response.data) {
          return
        }

        const data = response.data as any
        setSettings((prev) => ({
          ...prev,
          displayName: data.profile?.display_name || user?.fullName || '',
          email: user?.primaryEmailAddress?.emailAddress || prev.email,
          timezone: data.profile?.timezone || DEFAULT_SETTINGS.timezone,
          emailNotifications: data.notifications?.email_notifications ?? DEFAULT_SETTINGS.emailNotifications,
          assignmentReminders: data.notifications?.assignment_reminders ?? DEFAULT_SETTINGS.assignmentReminders,
          messageNotifications: data.notifications?.message_notifications ?? DEFAULT_SETTINGS.messageNotifications,
          weeklyDigest: data.notifications?.weekly_digest ?? DEFAULT_SETTINGS.weeklyDigest,
          profileVisibility: data.privacy?.profile_visibility || DEFAULT_SETTINGS.profileVisibility,
          showEmail: data.privacy?.show_email ?? DEFAULT_SETTINGS.showEmail,
          showPhone: data.privacy?.show_phone ?? DEFAULT_SETTINGS.showPhone,
          defaultStudentTab: normalizeDefaultStudentTab(data.preferences?.default_student_tab),
          defaultParentTab: normalizeDefaultParentTab(data.preferences?.default_parent_tab),
          showWeekendSchedule:
            data.preferences?.show_weekend_schedule ?? DEFAULT_SETTINGS.showWeekendSchedule,
          compactAssignmentCards:
            data.preferences?.compact_assignment_cards ?? DEFAULT_SETTINGS.compactAssignmentCards,
          autoOpenNextAssignment:
            data.preferences?.auto_open_next_assignment ?? DEFAULT_SETTINGS.autoOpenNextAssignment,
        }))
      } catch (error) {
        console.error('Failed to load settings:', error)
      } finally {
        setIsLoading(false)
      }
    }

    void loadSettings()
  }, [apiClient, user])

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
          default_parent_tab: settings.defaultParentTab,
          show_weekend_schedule: settings.showWeekendSchedule,
          compact_assignment_cards: settings.compactAssignmentCards,
          auto_open_next_assignment: settings.autoOpenNextAssignment,
        },
      })

      if (response.error) {
        throw new Error(response.error)
      }

      toast.success('Settings saved successfully!')
      queryClient.invalidateQueries({ queryKey: ['user-settings'] })
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
    <div className="min-h-screen bg-muted">
      <div className="bg-card border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="sm" onClick={() => navigate('/dashboard')}>
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back
              </Button>
              <div>
                <h1 className="text-2xl font-bold text-foreground">Settings</h1>
                  <p className="text-sm text-muted-foreground">
                  Manage your {roleLabel} settings and preferences
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

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Tabs defaultValue="profile" className="space-y-6">
          <TabsList className={`grid w-full ${isTutor ? 'grid-cols-6' : 'grid-cols-5'} lg:w-auto`}>
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
            {isTutor && (
              <TabsTrigger value="ai">
                <Brain className="h-4 w-4 mr-2" />
                AI
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="profile" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Profile Information</CardTitle>
                <CardDescription>Update your personal information and how others see you</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="displayName">Display Name</Label>
                  <Input
                    id="displayName"
                    value={settings.displayName}
                    onChange={(event) => setSettings({ ...settings, displayName: event.target.value })}
                    placeholder="Your name"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="email">Email Address</Label>
                  <Input id="email" type="email" value={settings.email} disabled className="bg-muted" />
                  <p className="text-sm text-muted-foreground">
                    Email is managed by your authentication provider
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="timezone">Timezone</Label>
                  <Select value={settings.timezone} onValueChange={(value) => setSettings({ ...settings, timezone: value })}>
                    <SelectTrigger id="timezone" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="America/New_York">Eastern Time (ET)</SelectItem>
                      <SelectItem value="America/Chicago">Central Time (CT)</SelectItem>
                      <SelectItem value="America/Denver">Mountain Time (MT)</SelectItem>
                      <SelectItem value="America/Los_Angeles">Pacific Time (PT)</SelectItem>
                      <SelectItem value="Europe/London">London (GMT)</SelectItem>
                      <SelectItem value="Europe/Paris">Paris (CET)</SelectItem>
                      <SelectItem value="Asia/Tokyo">Tokyo (JST)</SelectItem>
                      <SelectItem value="Asia/Shanghai">Shanghai (CST)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="notifications" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Notification Preferences</CardTitle>
                <CardDescription>Choose how you want to be notified about updates</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Email Notifications</Label>
                    <p className="text-sm text-muted-foreground">Receive notifications via email</p>
                  </div>
                  <Switch
                    checked={settings.emailNotifications}
                    onCheckedChange={(checked) => setSettings({ ...settings, emailNotifications: checked })}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Assignment Reminders</Label>
                    <p className="text-sm text-muted-foreground">
                      Get reminded about upcoming assignment deadlines
                    </p>
                  </div>
                  <Switch
                    checked={settings.assignmentReminders}
                    onCheckedChange={(checked) => setSettings({ ...settings, assignmentReminders: checked })}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Message Notifications</Label>
                    <p className="text-sm text-muted-foreground">Get notified when you receive new messages</p>
                  </div>
                  <Switch
                    checked={settings.messageNotifications}
                    onCheckedChange={(checked) => setSettings({ ...settings, messageNotifications: checked })}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Weekly Digest</Label>
                    <p className="text-sm text-muted-foreground">Receive a weekly summary of your activity</p>
                  </div>
                  <Switch
                    checked={settings.weeklyDigest}
                    onCheckedChange={(checked) => setSettings({ ...settings, weeklyDigest: checked })}
                  />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="privacy" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Privacy Settings</CardTitle>
                <CardDescription>Control who can see your information</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-2">
                  <Label htmlFor="profileVisibility">Profile Visibility</Label>
                  <select
                    id="profileVisibility"
                    value={settings.profileVisibility}
                    onChange={(event) => setSettings({ ...settings, profileVisibility: event.target.value })}
                    className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground"
                  >
                    <option value="everyone">Everyone</option>
                    <option value="students">My Students Only</option>
                    <option value="private">Private</option>
                  </select>
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Show Email Address</Label>
                    <p className="text-sm text-muted-foreground">Allow other users to see your email</p>
                  </div>
                  <Switch checked={settings.showEmail} onCheckedChange={(checked) => setSettings({ ...settings, showEmail: checked })} />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Show Phone Number</Label>
                    <p className="text-sm text-muted-foreground">Allow other users to see your phone number</p>
                  </div>
                  <Switch checked={settings.showPhone} onCheckedChange={(checked) => setSettings({ ...settings, showPhone: checked })} />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="appearance" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Appearance</CardTitle>
                <CardDescription>Customize how the app looks</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Dark Mode</Label>
                    <p className="text-sm text-muted-foreground">Use dark theme for better visibility in low light</p>
                  </div>
                  <Switch checked={theme === 'dark'} onCheckedChange={toggleTheme} />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="preferences" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Preferences</CardTitle>
                <CardDescription>
                  {isStudent
                    ? 'Tailor your student workspace experience'
                    : userRole === 'parent'
                      ? 'Messaging and alert preferences are handled above for your parent dashboard.'
                      : 'Personal notification and privacy settings above drive most of your day-to-day experience.'}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {isStudent ? (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="defaultStudentTab">Default Student Dashboard Tab</Label>
                      <select
                        id="defaultStudentTab"
                        value={settings.defaultStudentTab}
                        onChange={(event) =>
                          setSettings({
                            ...settings,
                            defaultStudentTab: normalizeDefaultStudentTab(event.target.value),
                          })
                        }
                        className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground"
                      >
                        <option value="dashboard">Dashboard</option>
                        <option value="courses">My Courses</option>
                        <option value="assignments">Assignments</option>
                        <option value="grades">Grades</option>
                        <option value="library">Library</option>
                        <option value="messages">Messages</option>
                      </select>
                      <p className="text-sm text-muted-foreground">
                        Choose which tab opens first when you enter the student dashboard.
                      </p>
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label>Show Weekend in Weekly Schedule</Label>
                        <p className="text-sm text-muted-foreground">Include Saturday and Sunday in the schedule view.</p>
                      </div>
                      <Switch
                        checked={settings.showWeekendSchedule}
                        onCheckedChange={(checked) => setSettings({ ...settings, showWeekendSchedule: checked })}
                      />
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label>Compact Assignment Cards</Label>
                        <p className="text-sm text-muted-foreground">Reduce card spacing to fit more assignments on screen.</p>
                      </div>
                      <Switch
                        checked={settings.compactAssignmentCards}
                        onCheckedChange={(checked) => setSettings({ ...settings, compactAssignmentCards: checked })}
                      />
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label>Auto-open Next Assignment</Label>
                        <p className="text-sm text-muted-foreground">Open the next in-progress assignment from Resume Learning Session.</p>
                      </div>
                      <Switch
                        checked={settings.autoOpenNextAssignment}
                        onCheckedChange={(checked) => setSettings({ ...settings, autoOpenNextAssignment: checked })}
                      />
                    </div>
                  </>
                ) : userRole === 'parent' ? (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="defaultParentTab">Default Parent Dashboard Tab</Label>
                      <select
                        id="defaultParentTab"
                        value={settings.defaultParentTab}
                        onChange={(event) =>
                          setSettings({
                            ...settings,
                            defaultParentTab: normalizeDefaultParentTab(event.target.value),
                          })
                        }
                        className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground"
                      >
                        <option value="overview">Overview</option>
                        <option value="children">Children</option>
                        <option value="upcoming">Upcoming Work</option>
                        <option value="messages">Messages</option>
                      </select>
                      <p className="text-sm text-muted-foreground">
                        Choose which view opens first when you enter the parent dashboard.
                      </p>
                    </div>
                  </>
                ) : (
                  <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                    Tutor-specific AI and system configuration is managed in the admin settings area. Personal controls here are handled through profile, notifications, privacy, and appearance.
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {isTutor && (
            <TabsContent value="ai" className="space-y-6">
              <AIConfigTab />
            </TabsContent>
          )}
        </Tabs>
      </div>
    </div>
  )
}

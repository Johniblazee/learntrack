import { Bell, CheckCheck, ChevronLeft } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useMarkAllNotificationsRead, useMarkNotificationRead, useNotifications } from '@/hooks/useQueries'

export default function NotificationsPage() {
  const navigate = useNavigate()
  const { data, isLoading } = useNotifications(1, 50)
  const markNotificationRead = useMarkNotificationRead()
  const markAllNotificationsRead = useMarkAllNotificationsRead()

  const notifications = Array.isArray(data?.items) ? data.items : []

  const handleOpenNotification = (notification: any) => {
    const notificationId = notification?.id || notification?._id
    if (notificationId && !notification?.is_read) {
      markNotificationRead.mutate(String(notificationId))
    }

    if (typeof notification?.action_url === 'string' && notification.action_url.startsWith('/')) {
      navigate(notification.action_url)
    }
  }

  return (
    <div className="min-h-screen bg-muted px-4 py-8">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <Button variant="ghost" size="sm" onClick={() => navigate('/dashboard')}>
              <ChevronLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
            <h1 className="mt-3 text-3xl font-bold text-foreground">Notifications</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Review message alerts, grading updates, and assignment activity in one place.
            </p>
          </div>

          <Button
            variant="outline"
            onClick={() => markAllNotificationsRead.mutate()}
            disabled={markAllNotificationsRead.isPending}
          >
            <CheckCheck className="mr-2 h-4 w-4" />
            Mark all read
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
            <CardDescription>Click any notification to jump to the related destination.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {isLoading ? (
              Array.from({ length: 6 }).map((_, index) => (
                <Skeleton key={index} className="h-20 w-full" />
              ))
            ) : notifications.length === 0 ? (
              <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
                <Bell className="mx-auto mb-3 h-8 w-8 opacity-50" />
                No notifications yet.
              </div>
            ) : (
              notifications.map((notification: any, index: number) => (
                <button
                  key={String(notification?.id || notification?._id || index)}
                  type="button"
                  onClick={() => handleOpenNotification(notification)}
                  className={`w-full rounded-lg border p-4 text-left transition-colors ${
                    notification?.is_read ? 'bg-background' : 'bg-primary/5'
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className={`font-medium ${notification?.is_read ? 'text-foreground' : 'text-primary'}`}>
                        {notification?.title || 'Notification'}
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {notification?.message || 'No details available.'}
                      </p>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {notification?.created_at
                        ? new Date(notification.created_at).toLocaleString()
                        : 'Just now'}
                    </span>
                  </div>
                </button>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

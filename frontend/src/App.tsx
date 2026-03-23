import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { ThemeProvider } from './contexts/ThemeContext'
import { UserProvider } from './contexts/UserContext'
import { ToastProvider } from './contexts/ToastContext'
import { ImpersonationProvider } from './contexts/ImpersonationContext'
import { ErrorBoundary } from './components/ErrorBoundary'
import ProtectedRoute from './components/ProtectedRoute'
import { AdminProtectedRoute } from './components/admin/AdminProtectedRoute'
import { ImpersonationBanner } from './components/admin/ImpersonationBanner'

// Lazy-load all page-level components
const HomePage             = lazy(() => import('./pages/HomePage'))
const GetStartedPage       = lazy(() => import('./pages/GetStartedPage'))
const SignInPage            = lazy(() => import('./pages/SignInPage'))
const SignUpPage            = lazy(() => import('./pages/SignUpPage'))
const DashboardPage         = lazy(() => import('./pages/DashboardPage'))
const RoleSetupPage         = lazy(() => import('./pages/RoleSetupPage'))
const AcceptInvitationPage  = lazy(() => import('./pages/AcceptInvitationPage'))
const TeacherOnboarding     = lazy(() => import('./components/onboarding/TeacherOnboarding'))
const StudentOnboarding     = lazy(() => import('./components/onboarding/StudentOnboarding'))
const ParentOnboarding      = lazy(() => import('./components/onboarding/ParentOnboarding'))
const NotificationsPage     = lazy(() => import('./pages/NotificationsPage'))
const SettingsPage          = lazy(() => import('./pages/SettingsPage'))
const NotFoundPage          = lazy(() => import('./pages/NotFoundPage'))
const AccessDeniedPage      = lazy(() => import('./pages/AccessDeniedPage'))
const AdminLayout           = lazy(() => import('./components/admin/AdminLayout').then(m => ({ default: m.AdminLayout })))

// Admin pages (named exports)
const ActivityPage          = lazy(() => import('./pages/admin').then(m => ({ default: m.ActivityPage })))
const AdminDashboardPage    = lazy(() => import('./pages/admin').then(m => ({ default: m.AdminDashboardPage })))
const AdminSettingsPage     = lazy(() => import('./pages/admin').then(m => ({ default: m.AdminSettingsPage })))
const TenantAIConfigPage    = lazy(() => import('./pages/admin').then(m => ({ default: m.TenantAIConfigPage })))
const TenantDetailsPage     = lazy(() => import('./pages/admin').then(m => ({ default: m.TenantDetailsPage })))
const TenantsPage           = lazy(() => import('./pages/admin').then(m => ({ default: m.TenantsPage })))
const UsersPage             = lazy(() => import('./pages/admin').then(m => ({ default: m.UsersPage })))
const AIModelsPage          = lazy(() => import('./pages/admin').then(m => ({ default: m.AIModelsPage })))

function App() {
  return (
    <ThemeProvider>
      <UserProvider>
        <ImpersonationProvider>
          <ToastProvider>
            <ErrorBoundary>
              <ImpersonationBanner />
              <div
                className="min-h-screen bg-background transition-colors duration-300"
                style={{ paddingTop: 'var(--lt-impersonation-offset, 0px)' }}
              >
                <Suspense fallback={
                  <div className="flex items-center justify-center min-h-screen">
                    <div className="h-8 w-8 animate-spin rounded-full border-4 border-border border-t-blue-600" />
                  </div>
                }>
                <Routes>
              {/* Public routes */}
              <Route path="/" element={<HomePage />} />
              <Route path="/get-started" element={<GetStartedPage />} />
              <Route path="/sign-in/*" element={<SignInPage />} />
              <Route path="/sign-up/*" element={<SignUpPage />} />
              <Route path="/accept-invitation/:token" element={<AcceptInvitationPage />} />

              {/* Onboarding routes - Protected */}
              <Route
                path="/onboarding/teacher"
                element={
                  <ProtectedRoute>
                    <TeacherOnboarding />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/onboarding/student"
                element={
                  <ProtectedRoute>
                    <StudentOnboarding />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/onboarding/parent"
                element={
                  <ProtectedRoute>
                    <ParentOnboarding />
                  </ProtectedRoute>
                }
              />

              {/* Protected routes - Dashboard with nested routes */}
              <Route
                path="/dashboard/*"
                element={
                  <ProtectedRoute>
                    <DashboardPage />
                  </ProtectedRoute>
                }
              />

              {/* Legacy routes - redirect to dashboard equivalents */}
              <Route path="/assignments" element={<Navigate to="/dashboard/assignments" replace />} />
              <Route path="/questions" element={<Navigate to="/dashboard/content/bank" replace />} />
              <Route path="/students" element={<Navigate to="/dashboard/students" replace />} />

              {/* Role setup and settings - Protected */}
              <Route
                path="/role-setup"
                element={
                  <ProtectedRoute>
                    <RoleSetupPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/notifications"
                element={
                  <ProtectedRoute>
                    <NotificationsPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/settings"
                element={
                  <ProtectedRoute>
                    <SettingsPage />
                  </ProtectedRoute>
                }
              />

              {/* Admin routes - Super Admin only */}
              <Route
                path="/admin"
                element={
                  <AdminProtectedRoute>
                    <AdminLayout />
                  </AdminProtectedRoute>
                }
              >
                <Route
                  index
                  element={
                    <AdminProtectedRoute requiredPermission="view_analytics">
                      <AdminDashboardPage />
                    </AdminProtectedRoute>
                  }
                />
                <Route
                  path="tenants"
                  element={
                    <AdminProtectedRoute requiredPermission="view_all_tenants">
                      <TenantsPage />
                    </AdminProtectedRoute>
                  }
                />
                <Route
                  path="tenants/:tenantId"
                  element={
                    <AdminProtectedRoute requiredPermission="view_all_tenants">
                      <TenantDetailsPage />
                    </AdminProtectedRoute>
                  }
                />
                <Route
                  path="tenants/:tenantId/ai-config"
                  element={
                    <AdminProtectedRoute requiredPermission="manage_ai_providers">
                      <TenantAIConfigPage />
                    </AdminProtectedRoute>
                  }
                />
                <Route
                  path="users"
                  element={
                    <AdminProtectedRoute requiredPermission="view_all_users">
                      <UsersPage />
                    </AdminProtectedRoute>
                  }
                />
                <Route
                  path="settings"
                  element={
                    <AdminProtectedRoute requiredPermission="manage_system_settings">
                      <AdminSettingsPage />
                    </AdminProtectedRoute>
                  }
                />
                <Route
                  path="activity"
                  element={
                    <AdminProtectedRoute requiredPermission="view_audit_logs">
                      <ActivityPage />
                    </AdminProtectedRoute>
                  }
                />
                <Route
                  path="ai-models"
                  element={
                    <AdminProtectedRoute requiredPermission="manage_ai_providers">
                      <AIModelsPage />
                    </AdminProtectedRoute>
                  }
                />
                {/* 404 Catch-all for undefined admin routes */}
                <Route path="*" element={<NotFoundPage />} />
              </Route>

              {/* Access Denied route */}
              <Route path="/access-denied" element={<AccessDeniedPage />} />

              {/* 404 Catch-all route - must be last */}
              <Route path="*" element={<NotFoundPage />} />
                </Routes>
                </Suspense>
              </div>
            </ErrorBoundary>
          </ToastProvider>
        </ImpersonationProvider>
      </UserProvider>
    </ThemeProvider>
  )
}

export default App

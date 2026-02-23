import { Routes, Route, Navigate } from 'react-router-dom'
import { ThemeProvider } from './contexts/ThemeContext'
import { UserProvider } from './contexts/UserContext'
import { ToastProvider } from './contexts/ToastContext'
import { ImpersonationProvider } from './contexts/ImpersonationContext'
import { ErrorBoundary } from './components/ErrorBoundary'
import ProtectedRoute from './components/ProtectedRoute'
import HomePage from './pages/HomePage'
import GetStartedPage from './pages/GetStartedPage'
import SignInPage from './pages/SignInPage'
import SignUpPage from './pages/SignUpPage'
import DashboardPage from './pages/DashboardPage'
import RoleSetupPage from './pages/RoleSetupPage'
import AcceptInvitationPage from './pages/AcceptInvitationPage'
import TeacherOnboarding from './components/onboarding/TeacherOnboarding'
import StudentOnboarding from './components/onboarding/StudentOnboarding'
import ParentOnboarding from './components/onboarding/ParentOnboarding'
import SettingsPage from './pages/SettingsPage'
import NotFoundPage from './pages/NotFoundPage'
import AccessDeniedPage from './pages/AccessDeniedPage'

// Admin imports
import { AdminLayout } from './components/admin/AdminLayout'
import {
  ActivityPage,
  AdminDashboardPage,
  AdminSettingsPage,
  TenantAIConfigPage,
  TenantDetailsPage,
  TenantsPage,
  UsersPage,
} from './pages/admin'
import { AdminProtectedRoute } from './components/admin/AdminProtectedRoute'
import { ImpersonationBanner } from './components/admin/ImpersonationBanner'

function App() {
  return (
    <ThemeProvider>
      <UserProvider>
        <ImpersonationProvider>
          <ToastProvider>
            <ErrorBoundary>
              <ImpersonationBanner />
              <div
                className="min-h-screen bg-white dark:bg-gray-900 transition-colors duration-300"
                style={{ paddingTop: 'var(--lt-impersonation-offset, 0px)' }}
              >
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
                {/* 404 Catch-all for undefined admin routes */}
                <Route path="*" element={<NotFoundPage />} />
              </Route>

              {/* Access Denied route */}
              <Route path="/access-denied" element={<AccessDeniedPage />} />

              {/* 404 Catch-all route - must be last */}
              <Route path="*" element={<NotFoundPage />} />
                </Routes>
              </div>
            </ErrorBoundary>
          </ToastProvider>
        </ImpersonationProvider>
      </UserProvider>
    </ThemeProvider>
  )
}

export default App

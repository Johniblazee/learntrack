import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist', 'node_modules'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
      // Relaxed rules for development
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: [
      'src/components/InviteUserModal.tsx',
      'src/components/MaterialManager.tsx',
      'src/components/QuestionBankSelector.tsx',
      'src/components/StudentSelector.tsx',
      'src/components/SubjectFilter.tsx',
      'src/components/TutorDashboard/DashboardHeader.tsx',
      'src/components/TutorDashboard/components/UpcomingDeadlines.tsx',
      'src/components/TutorDashboard/views/ActiveAssignmentsView.tsx',
      'src/components/TutorDashboard/views/AssignmentTemplatesView.tsx',
      'src/components/TutorDashboard/views/CreateAssignmentView.tsx',
      'src/components/TutorDashboard/views/GroupsManagementView.tsx',
      'src/components/TutorDashboard/views/OverviewView.tsx',
      'src/components/admin/AdminLayout.tsx',
      'src/components/admin/AdminProtectedRoute.tsx',
      'src/components/modals/CreateGroupModal.tsx',
      'src/components/modals/EditAssignmentModal.tsx',
      'src/components/modals/EditGroupModal.tsx',
      'src/components/modals/SendMessageModal.tsx',
      'src/components/modals/ViewGroupDetailsModal.tsx',
      'src/components/question-bank-manager.tsx',
      'src/components/question-generator/ChatPanel.tsx',
      'src/components/question-generator/QuestionCard.tsx',
      'src/components/question-generator/index.tsx',
      'src/components/question-reviewer.tsx',
      'src/components/settings/AIConfigTab.tsx',
      'src/components/student-assignment-workspace.tsx',
      'src/components/student-manager.tsx',
      'src/components/ui/agent-plan.tsx',
      'src/components/ui/chart.tsx',
      'src/lib/api-client.ts',
      'src/lib/config.ts',
      'src/lib/posthog.ts',
      'src/lib/socket.ts',
      'src/pages/AcceptInvitationPage.tsx',
      'src/pages/StudentDetailsPage.tsx',
      'src/pages/admin/AIModelsPage.tsx',
    ],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    files: [
      'src/components/GroupSelector.tsx',
      'src/components/MaterialManager.tsx',
      'src/components/QuestionBankSelector.tsx',
      'src/components/StudentSelector.tsx',
      'src/components/SubjectFilter.tsx',
      'src/components/TutorDashboard/components/UpcomingDeadlines.tsx',
      'src/components/TutorDashboard/views/ActiveAssignmentsView.tsx',
      'src/components/TutorDashboard/views/ConversationsView.tsx',
      'src/components/question-bank-manager.tsx',
      'src/components/question-generator/ConfigSidebar.tsx',
      'src/components/question-reviewer.tsx',
      'src/components/settings/AIConfigTab.tsx',
      'src/components/student-manager.tsx',
      'src/contexts/ToastContext.tsx',
      'src/pages/AcceptInvitationPage.tsx',
      'src/pages/StudentDetailsPage.tsx',
      'src/pages/admin/TenantAIConfigPage.tsx',
    ],
    rules: {
      'react-hooks/exhaustive-deps': 'off',
    },
  },
  {
    files: [
      'src/components/ui/badge.tsx',
      'src/components/ui/button.tsx',
      'src/components/ui/form.tsx',
      'src/components/ui/sidebar.tsx',
      'src/components/ui/toggle.tsx',
      'src/contexts/ImpersonationContext.tsx',
      'src/contexts/ThemeContext.tsx',
      'src/contexts/ToastContext.tsx',
      'src/contexts/UserContext.tsx',
    ],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
)


import { 
  Users, 
  GraduationCap, 
  UserCheck, 
  FileQuestion, 
  ClipboardList,
  BookOpen,
  Database,
  Activity
} from 'lucide-react'

interface SystemMetrics {
  total_tutors: number
  total_students: number
  total_parents: number
  total_users: number
  active_tutors: number
  active_students: number
  active_parents: number
  total_questions: number
  total_assignments: number
  total_subjects: number
  total_materials: number
  database_size_mb: number
  storage_used_mb: number
  questions_generated_today: number
  assignments_created_today: number
  logins_today: number
  metrics_updated_at: string
}

interface MetricCardProps {
  title: string
  value: number | string
  icon: React.ReactNode
  subtitle?: string
  trend?: { value: number; isPositive: boolean }
  color?: 'purple' | 'blue' | 'green' | 'orange' | 'pink'
}

function MetricCard({ title, value, icon, subtitle, trend, color = 'purple' }: MetricCardProps) {
  const colorClasses = {
    purple: 'bg-primary/10 text-primary',
    blue: 'bg-primary/10 text-primary',
    green: 'bg-primary/10 text-primary',
    orange: 'bg-primary/10 text-primary',
    pink: 'bg-primary/10 text-primary',
  }

  return (
    <div className="bg-card rounded-xl p-6 shadow-sm border border-border hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
          <p className="mt-2 text-3xl font-bold text-foreground">{value}</p>
          {subtitle && (
            <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
          )}
          {trend && (
            <p className={`mt-1 text-sm ${trend.isPositive ? 'text-green-600' : 'text-red-600'}`}>
              {trend.isPositive ? '↑' : '↓'} {trend.value}% from last week
            </p>
          )}
        </div>
        <div className={`p-3 rounded-lg ${colorClasses[color]}`}>
          {icon}
        </div>
      </div>
    </div>
  )
}

interface AdminMetricsProps {
  metrics: SystemMetrics | null
  isLoading: boolean
  error: string | null
}

export function AdminMetrics({ metrics, isLoading, error }: AdminMetricsProps) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {[...Array(8)].map((_, i) => (
          <div key={i} className="bg-card rounded-xl p-6 shadow-sm animate-pulse">
            <div className="h-4 bg-muted rounded w-1/2 mb-4"></div>
            <div className="h-8 bg-muted rounded w-3/4"></div>
          </div>
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-6">
        <p className="text-red-600 dark:text-red-400">Failed to load metrics: {error}</p>
      </div>
    )
  }

  if (!metrics) return null

  return (
    <div className="space-y-6">
      {/* User Metrics */}
      <div>
        <h3 className="text-lg font-semibold text-foreground mb-4">User Statistics</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <MetricCard title="Total Users" value={metrics.total_users} icon={<Users className="w-6 h-6" />} color="purple" />
          <MetricCard title="Tutors" value={metrics.total_tutors} subtitle={`${metrics.active_tutors} active`} icon={<GraduationCap className="w-6 h-6" />} color="blue" />
          <MetricCard title="Students" value={metrics.total_students} subtitle={`${metrics.active_students} active`} icon={<UserCheck className="w-6 h-6" />} color="green" />
          <MetricCard title="Parents" value={metrics.total_parents} subtitle={`${metrics.active_parents} active`} icon={<Users className="w-6 h-6" />} color="orange" />
        </div>
      </div>

      {/* Content Metrics */}
      <div>
        <h3 className="text-lg font-semibold text-foreground mb-4">Content Statistics</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <MetricCard title="Questions" value={metrics.total_questions} subtitle={`${metrics.questions_generated_today} today`} icon={<FileQuestion className="w-6 h-6" />} color="purple" />
          <MetricCard title="Assignments" value={metrics.total_assignments} subtitle={`${metrics.assignments_created_today} today`} icon={<ClipboardList className="w-6 h-6" />} color="blue" />
          <MetricCard title="Subjects" value={metrics.total_subjects} icon={<BookOpen className="w-6 h-6" />} color="green" />
          <MetricCard title="Materials" value={metrics.total_materials} icon={<Database className="w-6 h-6" />} color="orange" />
        </div>
      </div>

      {/* System Metrics */}
      <div>
        <h3 className="text-lg font-semibold text-foreground mb-4">System Health</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <MetricCard title="Database Size" value={`${metrics.database_size_mb} MB`} icon={<Database className="w-6 h-6" />} color="purple" />
          <MetricCard title="Storage Used" value={`${metrics.storage_used_mb} MB`} icon={<Activity className="w-6 h-6" />} color="blue" />
          <MetricCard title="Logins Today" value={metrics.logins_today} icon={<UserCheck className="w-6 h-6" />} color="green" />
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Last updated: {new Date(metrics.metrics_updated_at).toLocaleString()}
      </p>
    </div>
  )
}


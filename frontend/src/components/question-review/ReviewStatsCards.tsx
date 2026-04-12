import { Card, CardContent } from '@/components/ui/card'
import { BookOpen, Clock, CheckCircle, XCircle, Star } from 'lucide-react'
import type { ReviewStats } from './types'

interface ReviewStatsCardsProps {
  stats: ReviewStats
}

export default function ReviewStatsCards({ stats }: ReviewStatsCardsProps) {
  const items = [
    { label: 'Total Questions', value: stats.totalQuestions, icon: BookOpen, color: 'bg-primary/10 text-primary' },
    { label: 'Pending Review', value: stats.pendingReview, icon: Clock, color: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-500' },
    { label: 'Approved', value: stats.approved, icon: CheckCircle, color: 'bg-green-500/10 text-green-600 dark:text-green-500' },
    { label: 'Rejected', value: stats.rejected, icon: XCircle, color: 'bg-red-500/10 text-red-600 dark:text-red-500' },
    { label: 'Avg. Rating', value: stats.averageRating.toFixed(1), icon: Star, color: 'bg-primary/10 text-primary', colSpan: true },
  ]

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
      {items.map(({ label, value, icon: Icon, color, colSpan }) => (
        <Card key={label} className={`border-0 shadow-sm bg-card${colSpan ? ' col-span-2 sm:col-span-1' : ''}`}>
          <CardContent className="p-4 sm:p-5">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 sm:w-12 sm:h-12 rounded-lg ${color.split(' ')[0]} flex items-center justify-center flex-shrink-0`}>
                <Icon className={`w-5 h-5 sm:w-6 sm:h-6 ${color.split(' ').slice(1).join(' ')}`} />
              </div>
              <div className="min-w-0">
                <p className="text-muted-foreground text-xs sm:text-sm font-medium truncate">
                  {label}
                </p>
                <p className="text-2xl sm:text-3xl font-bold text-foreground">
                  {value}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

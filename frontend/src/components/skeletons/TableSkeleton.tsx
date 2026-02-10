/**
 * Reusable table skeleton loader component
 */
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

interface TableSkeletonProps {
  /**
   * Number of columns
   */
  columns?: number
  
  /**
   * Number of rows
   */
  rows?: number
  
  /**
   * Whether to show header
   */
  showHeader?: boolean
  
  /**
   * Additional CSS classes
   */
  className?: string
}

/**
 * Table skeleton loader
 */
export function TableSkeleton({
  columns = 5,
  rows = 5,
  showHeader = true,
  className = ''
}: TableSkeletonProps) {
  return (
    <div className={`rounded-md border border-border ${className}`}>
      <Table>
        {showHeader && (
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              {Array.from({ length: columns }).map((_, i) => (
                <TableHead key={i}>
                  <div className="h-4 w-24 bg-muted rounded animate-pulse"></div>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
        )}
        <TableBody>
          {Array.from({ length: rows }).map((_, rowIndex) => (
            <TableRow key={rowIndex}>
              {Array.from({ length: columns }).map((_, colIndex) => (
                <TableCell key={colIndex}>
                  <div
                    className="h-4 bg-muted rounded animate-pulse"
                    style={{ width: `${80 + (colIndex * 5)}%` }}
                  ></div>
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

/**
 * Student table skeleton (specific for student list)
 * Matches the actual student table: Student Name, Email, Parent, Last Active, Progress, Actions
 */
export function StudentTableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/50 hover:bg-muted/50">
            <TableHead>Student Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Parent</TableHead>
            <TableHead>Last Active</TableHead>
            <TableHead>Progress</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: rows }).map((_, i) => (
            <TableRow key={i}>
              {/* Student Name with Avatar */}
              <TableCell>
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 bg-muted rounded-full animate-pulse"></div>
                  <div className="h-4 w-32 bg-muted rounded animate-pulse"></div>
                </div>
              </TableCell>
              {/* Email */}
              <TableCell>
                <div className="h-4 w-40 bg-muted rounded animate-pulse"></div>
              </TableCell>
              {/* Parent */}
              <TableCell>
                <div className="h-4 w-28 bg-muted rounded animate-pulse"></div>
              </TableCell>
              {/* Last Active */}
              <TableCell>
                <div className="h-4 w-24 bg-muted rounded animate-pulse"></div>
              </TableCell>
              {/* Progress Bar */}
              <TableCell>
                <div className="flex items-center gap-3">
                  <div className="h-2 flex-1 bg-muted rounded-full animate-pulse"></div>
                  <div className="h-4 w-10 bg-muted rounded animate-pulse"></div>
                </div>
              </TableCell>
              {/* Actions Button */}
              <TableCell className="text-right">
                <div className="h-8 w-8 bg-muted rounded animate-pulse ml-auto"></div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}


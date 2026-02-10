import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { MessageCircle, Edit, CheckCircle2, Users, FileText } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { useApiClient } from '@/lib/api-client'
import { toast } from '@/contexts/ToastContext'
import { format } from 'date-fns'

interface StudentDetailsModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  studentId: string
  onSendMessage?: () => void
  onEditProfile?: () => void
}

interface StudentDetails {
  id: string
  name: string
  email: string
  avatar?: string
  joinedDate: string
  studentId: string
  grade?: string
  parentEmail?: string
  parentName?: string
  averageScore: number
  completionRate: number
  totalAssignments: number
  completedAssignments: number
}

interface Assignment {
  id: string
  title: string
  subject: string
  dueDate: string
  status: string
  score?: number
}

interface Group {
  id: string
  name: string
  color: string
}

interface Activity {
  id: string
  type: 'assignment' | 'submission'
  title: string
  timestamp: string
  score?: number
  status?: string
}

interface ProgressData {
  month: string
  score: number
}

export function StudentDetailsModal({
  open,
  onOpenChange,
  studentId,
  onSendMessage,
  onEditProfile
}: StudentDetailsModalProps) {
  const [loading, setLoading] = useState(true)
  const [student, setStudent] = useState<StudentDetails | null>(null)
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [groups, setGroups] = useState<Group[]>([])
  const [activities, setActivities] = useState<Activity[]>([])
  const [progressData, setProgressData] = useState<ProgressData[]>([])

  const client = useApiClient()

  const fetchStudentDetails = async () => {
    try {
      setLoading(true)

      // Fetch student details
      const studentRes = await client.get(`/users/${studentId}`)
      if (studentRes.error) throw new Error(studentRes.error)

      const userData = studentRes.data as any

      setStudent({
        id: userData.clerk_id || userData._id,
        name: userData.name,
        email: userData.email,
        avatar: userData.avatar_url,
        joinedDate: userData.created_at,
        studentId: userData._id?.slice(-6).toUpperCase() || 'ST84321',
        grade: userData.student_profile?.grade || '10th Grade',
        parentEmail: userData.student_profile?.parentEmail,
        parentName: userData.student_profile?.parentName,
        averageScore: userData.student_profile?.averageScore || 0,
        completionRate: userData.student_profile?.completionRate || 0,
        totalAssignments: userData.student_profile?.totalAssignments || 0,
        completedAssignments: userData.student_profile?.completedAssignments || 0
      })

      // Fetch progress data from API
      try {
        const progressRes = await client.get(`/progress/student/${studentId}`)
        if (!progressRes.error && progressRes.data) {
          const progressItems = progressRes.data?.items || progressRes.data || []
          setProgressData(progressItems.map((item: any) => ({
            month: item.month || format(new Date(item.date || item.created_at), 'MMM'),
            score: item.score || item.average_score || 0
          })))
        }
      } catch (e) {
        console.log('No progress data available')
        setProgressData([])
      }

      // Fetch assignments from API
      try {
        const assignmentsRes = await client.get(`/assignments?student_id=${studentId}`)
        if (!assignmentsRes.error && assignmentsRes.data) {
          const assignmentItems = assignmentsRes.data?.items || assignmentsRes.data || []
          setAssignments(assignmentItems.map((item: any) => ({
            id: item._id || item.id,
            title: item.title,
            subject: item.subject,
            dueDate: item.due_date,
            status: item.status,
            score: item.score
          })))
        }
      } catch (e) {
        console.log('No assignments available')
        setAssignments([])
      }

      // Fetch groups from API
      try {
        const groupsRes = await client.get(`/groups/?member_id=${studentId}`)
        if (!groupsRes.error && groupsRes.data) {
          const groupItems = groupsRes.data?.items || groupsRes.data || []
          setGroups(groupItems.map((item: any) => ({
            id: item._id || item.id,
            name: item.name,
            color: item.color || 'blue'
          })))
        }
      } catch (e) {
        console.log('No groups available')
        setGroups([])
      }

      // Fetch recent activity from API
      try {
        const activityRes = await client.get(`/activity?user_id=${studentId}&limit=10`)
        if (!activityRes.error && activityRes.data) {
          const activityItems = activityRes.data?.items || activityRes.data || []
          setActivities(activityItems.map((item: any) => ({
            id: item._id || item.id,
            type: item.activity_type === 'assignment_completed' ? 'assignment' : 'submission',
            title: item.title || item.description,
            timestamp: item.created_at,
            score: item.score,
            status: item.status
          })))
        }
      } catch (e) {
        console.log('No activity available')
        setActivities([])
      }

    } catch (error: any) {
      console.error('Failed to fetch student details:', error)
      toast.error('Failed to load student details')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open && studentId) {
      console.log('StudentDetailsModal opened with studentId:', studentId)
      fetchStudentDetails()
    }
  }, [open, studentId])

  if (!student && !loading) {
    return null
  }

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2)
  }

  const pendingAssignments = assignments.filter(a => a.status === 'pending')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto bg-[#1a1a1a] dark:bg-[#1a1a1a] border-gray-800 text-white">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#C8A882]"></div>
          </div>
        ) : student ? (
          <>
            {/* Header */}
            <DialogHeader className="border-b border-gray-800 pb-6">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-4">
                  <Avatar className="h-16 w-16">
                    <AvatarImage src={student.avatar} alt={student.name} />
                    <AvatarFallback className="bg-[#C8A882] text-black text-lg">
                      {getInitials(student.name)}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <DialogTitle className="text-2xl font-bold text-white mb-1">
                      {student.name}
                    </DialogTitle>
                    <p className="text-sm text-gray-400">
                      Joined: {format(new Date(student.joinedDate), 'MMMM dd, yyyy')}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="border-[#C8A882] text-[#C8A882] hover:bg-[#C8A882] hover:text-black"
                    onClick={onSendMessage}
                  >
                    <MessageCircle className="h-4 w-4 mr-2" />
                    Send Message
                  </Button>
                  <Button
                    className="bg-[#C8A882] text-black hover:bg-[#B89872]"
                    onClick={onEditProfile}
                  >
                    <Edit className="h-4 w-4 mr-2" />
                    Edit Profile
                  </Button>
                </div>
              </div>
            </DialogHeader>

            {/* Content Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
              {/* Academic Progress Summary */}
              <Card className="border-border bg-card col-span-1 lg:col-span-2">
                <CardHeader>
                  <CardTitle className="text-foreground">Academic Progress Summary</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={250}>
                    <LineChart data={progressData}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis
                        dataKey="month"
                        tick={{ fill: 'hsl(var(--muted-foreground))' }}
                      />
                      <YAxis
                        tick={{ fill: 'hsl(var(--muted-foreground))' }}
                        domain={[60, 100]}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: 'hsl(var(--card))',
                          border: '1px solid hsl(var(--border))',
                          borderRadius: '8px',
                          color: 'hsl(var(--foreground))'
                        }}
                      />
                      <Line
                        type="monotone"
                        dataKey="score"
                        stroke="#C8A882"
                        strokeWidth={2}
                        dot={{ fill: '#C8A882', r: 4 }}
                        activeDot={{ r: 6 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              {/* Personal Information */}
              <Card className="border-border bg-card">
                <CardHeader>
                  <CardTitle className="text-foreground">Personal Information</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Full Name:</span>
                    <span className="text-foreground font-medium">{student.name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Student ID:</span>
                    <span className="text-foreground font-medium">{student.studentId}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Email:</span>
                    <span className="text-foreground font-medium text-sm break-all">{student.email}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Parent/Guardian:</span>
                    <span className="text-[#C8A882] font-medium">{student.parentName || 'N/A'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Grade Level:</span>
                    <span className="text-foreground font-medium">{student.grade}</span>
                  </div>
                </CardContent>
              </Card>

              {/* Assignments & Groups */}
              <Card className="border-border bg-card">
                <CardHeader>
                  <CardTitle className="text-foreground">Assignments & Groups</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Pending Assignments */}
                  <div>
                    <h4 className="text-sm font-semibold text-foreground mb-2">
                      Pending Assignments ({pendingAssignments.length})
                    </h4>
                    <div className="space-y-2">
                      {pendingAssignments.length > 0 ? (
                        pendingAssignments.map(assignment => (
                          <div
                            key={assignment.id}
                            className="flex items-center justify-between p-2 rounded bg-muted/50 border border-border"
                          >
                            <div className="flex-1 min-w-0">
                              <p className="text-sm text-foreground font-medium">{assignment.title}</p>
                              <p className="text-xs text-muted-foreground">{assignment.subject}</p>
                            </div>
                            <Badge variant="destructive" className="text-xs ml-2 flex-shrink-0">
                              Due {format(new Date(assignment.dueDate), 'MMM dd')}
                            </Badge>
                          </div>
                        ))
                      ) : (
                        <p className="text-sm text-muted-foreground">No pending assignments</p>
                      )}
                    </div>
                  </div>

                  {/* Active Groups */}
                  <div>
                    <h4 className="text-sm font-semibold text-foreground mb-2">
                      Active Groups ({groups.length})
                    </h4>
                    <div className="space-y-2">
                      {groups.length > 0 ? (
                        groups.map(group => (
                          <div
                            key={group.id}
                            className="flex items-center gap-2 p-2 rounded bg-muted/50 border border-border"
                          >
                            <Users className="h-4 w-4 text-[#C8A882] flex-shrink-0" />
                            <span className="text-sm text-foreground">{group.name}</span>
                          </div>
                        ))
                      ) : (
                        <p className="text-sm text-muted-foreground">No active groups</p>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Recent Activity */}
              <Card className="border-border bg-card col-span-1 lg:col-span-2">
                <CardHeader>
                  <CardTitle className="text-foreground">Recent Activity</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {activities.length > 0 ? (
                      activities.map(activity => (
                        <div
                          key={activity.id}
                          className="flex items-start gap-3 p-3 rounded bg-muted/50 border border-border"
                        >
                          {activity.type === 'assignment' && activity.status === 'completed' ? (
                            <CheckCircle2 className="h-5 w-5 text-green-500 mt-0.5 flex-shrink-0" />
                          ) : (
                            <FileText className="h-5 w-5 text-blue-500 mt-0.5 flex-shrink-0" />
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-foreground">
                                  {activity.type === 'assignment' ? 'Completed Assignment: ' : 'Submitted: '}
                                  "{activity.title}"
                                </p>
                                <p className="text-xs text-muted-foreground mt-1">
                                  {format(new Date(activity.timestamp), 'PPp')}
                                  {activity.status === 'awaiting_grade' && ' · Awaiting Grade'}
                                </p>
                              </div>
                              {activity.score !== undefined && (
                                <Badge className="bg-green-500/20 text-green-400 border-green-500/30 flex-shrink-0">
                                  Score: {activity.score}%
                                </Badge>
                              )}
                            </div>
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-muted-foreground text-center py-4">No recent activity</p>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}


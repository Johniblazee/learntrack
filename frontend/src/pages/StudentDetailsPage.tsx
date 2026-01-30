import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  MessageCircle,
  Edit,
  CheckCircle2,
  Clock,
  Users,
  FileText,
  Calendar,
  Link as LinkIcon,
  X,
  UserPlus,
  Mail,
  Loader2,
  TrendingUp,
  Target,
  BookOpen,
  Award,
  BarChart3,
  Activity,
  GraduationCap,
  User
} from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { useApiClient } from '@/lib/api-client'
import { toast } from '@/contexts/ToastContext'
import { format } from 'date-fns'
import { SendMessageModal } from '@/components/modals/SendMessageModal'

interface StudentDetails {
  id: string
  name: string
  email: string
  avatar?: string
  joinedDate: string
  studentId: string
  grade: string
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
  status: 'pending' | 'completed' | 'overdue'
}

interface Group {
  id: string
  name: string
  color: string
}

interface Activity {
  id: string
  type: 'completed' | 'submitted'
  title: string
  timestamp: string
  score?: string
}

interface ProgressData {
  month: string
  score: number
}

interface LinkedParent {
  id: string
  name: string
  email: string
}

export default function StudentDetailsPage() {
  const { studentSlug } = useParams<{ studentSlug: string }>()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [student, setStudent] = useState<StudentDetails | null>(null)
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [groups, setGroups] = useState<Group[]>([])
  const [activities, setActivities] = useState<Activity[]>([])
  const [progressData, setProgressData] = useState<ProgressData[]>([])
  const [sendMessageModalOpen, setSendMessageModalOpen] = useState(false)

  // Parent management state
  const [linkedParents, setLinkedParents] = useState<LinkedParent[]>([])
  const [linkParentModalOpen, setLinkParentModalOpen] = useState(false)
  const [parentEmail, setParentEmail] = useState('')
  const [parentName, setParentName] = useState('')
  const [availableParents, setAvailableParents] = useState<LinkedParent[]>([])
  const [loadingParents, setLoadingParents] = useState(false)
  const [parentSelection, setParentSelection] = useState('new')
  const [linkingParent, setLinkingParent] = useState(false)
  const [unlinkingParentId, setUnlinkingParentId] = useState<string | null>(null)

  const client = useApiClient()
  const queryClient = useQueryClient()

  const selectableParents = availableParents.filter(
    (parent) => !linkedParents.some((linked) => linked.id === parent.id)
  )

  const fetchStudentDetails = async () => {
    if (!studentSlug) return

    try {
      setLoading(true)

      // Fetch student details by slug
      const studentRes = await client.get(`/students/by-slug/${studentSlug}`)
      if (studentRes.error) throw new Error(studentRes.error)

      const userData = studentRes.data as any
      const studentClerkId = userData.clerk_id || userData._id

      setStudent({
        id: studentClerkId,
        name: userData.name,
        email: userData.email,
        avatar: userData.avatar_url,
        joinedDate: userData.created_at,
        studentId: userData._id?.slice(-6).toUpperCase() || 'ST84321',
        grade: userData.student_profile?.grade || '10th Grade',
        parentEmail: userData.student_profile?.parentEmail,
        parentName: userData.student_profile?.parentName || 'Sarah Reed',
        averageScore: userData.student_profile?.averageScore || 0,
        completionRate: userData.student_profile?.completionRate || 0,
        totalAssignments: userData.student_profile?.totalAssignments || 0,
        completedAssignments: userData.student_profile?.completedAssignments || 0
      })

      // Fetch progress data from API
      try {
        const progressRes = await client.get(`/progress/student/${studentClerkId}/analytics`)
        if (progressRes.data?.monthly_scores) {
          setProgressData(progressRes.data.monthly_scores)
        }
      } catch (err) {
        console.error('Failed to fetch progress data:', err)
        // Set empty array if API fails
        setProgressData([])
      }

      // Fetch assignments from API
      try {
        const assignmentsRes = await client.get(`/assignments/student/${studentClerkId}?status=pending`)
        if (assignmentsRes.data) {
          const mappedAssignments = assignmentsRes.data.map((a: any) => ({
            id: a._id,
            title: a.title,
            subject: a.subject_id?.name || 'Unknown',
            dueDate: a.due_date,
            status: a.status
          }))
          setAssignments(mappedAssignments)
        }
      } catch (err) {
        console.error('Failed to fetch assignments:', err)
        setAssignments([])
      }

      // Fetch groups from API
      try {
        const groupsRes = await client.get(`/groups/student/${studentClerkId}`)
        if (groupsRes.data) {
          const mappedGroups = groupsRes.data.map((g: any) => ({
            id: g._id,
            name: g.name,
            color: g.color || 'blue'
          }))
          setGroups(mappedGroups)
        }
      } catch (err) {
        console.error('Failed to fetch groups:', err)
        setGroups([])
      }

      // Fetch recent activity from API
      try {
        const activityRes = await client.get(`/activity/student/${studentClerkId}`)
        if (activityRes.data) {
          const mappedActivities = activityRes.data.map((a: any) => ({
            id: a._id,
            type: a.type,
            title: a.title,
            timestamp: a.timestamp,
            score: a.score
          }))
          setActivities(mappedActivities)
        }
      } catch (err) {
        console.error('Failed to fetch activity:', err)
        setActivities([])
      }
      // Fetch linked parents for this student
      try {
        const parentsRes = await client.get(`/students/${studentClerkId}/parents`)
        if (parentsRes.data) {
          const mappedParents = parentsRes.data.map((p: any) => ({
            id: String(p.clerk_id || p._id),
            name: p.name,
            email: p.email
          }))
          setLinkedParents(mappedParents)
        }
      } catch (err) {
        console.error('Failed to fetch linked parents:', err)
        setLinkedParents([])
      }
    } catch (err: any) {
      console.error('Failed to fetch student details:', err)
      toast.error('Failed to load student details')
    } finally {
      setLoading(false)
    }
  }

  const fetchAvailableParents = async () => {
    try {
      setLoadingParents(true)
      const res = await client.get('/parents')
      if (res.error) throw new Error(res.error)

      const parents = res.data?.parents || res.data || []
      const mappedParents = parents.map((p: any) => ({
        id: String(p.clerk_id || p._id),
        name: p.name,
        email: p.email
      }))
      setAvailableParents(mappedParents)
    } catch (error) {
      console.error('Failed to load parents list:', error)
      setAvailableParents([])
    } finally {
      setLoadingParents(false)
    }
  }

  const handleParentSelection = (value: string) => {
    setParentSelection(value)
    if (value === 'new') {
      setParentName('')
      setParentEmail('')
      return
    }

    const selectedParent = availableParents.find((parent) => parent.id === value)
    if (selectedParent) {
      setParentName(selectedParent.name)
      setParentEmail(selectedParent.email)
    }
  }

  const handleLinkParent = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!parentEmail.trim() || !parentName.trim() || !student) return

    try {
      setLinkingParent(true)
      const res = await client.post(`/students/${student.id}/parents`, {
        parent_email: parentEmail.trim(),
        parent_name: parentName.trim()
      })

      if (res.error) throw new Error(res.error)

      toast.success('Parent linked successfully!', {
        description: `${parentName} has been linked to ${student.name}.`
      })

      // Refresh parents list
      const parentsRes = await client.get(`/students/${student.id}/parents`)
      if (parentsRes.data) {
        const mappedParents = parentsRes.data.map((p: any) => ({
          id: String(p.clerk_id || p._id),
          name: p.name,
          email: p.email
        }))
        setLinkedParents(mappedParents)
      }

      queryClient.invalidateQueries({ queryKey: ['students'] })
      fetchAvailableParents()

      // Reset form and close modal
      setParentEmail('')
      setParentName('')
      setParentSelection('new')
      setLinkParentModalOpen(false)
    } catch (error: any) {
      console.error('Failed to link parent:', error)
      toast.error('Failed to link parent', {
        description: error.message || 'Please try again or contact support.'
      })
    } finally {
      setLinkingParent(false)
    }
  }

  const handleUnlinkParent = async (parentId: string) => {
    if (!student) return

    try {
      setUnlinkingParentId(parentId)
      const res = await client.delete(`/students/${student.id}/parents/${parentId}`)

      if (res.error) throw new Error(res.error)

      toast.success('Parent unlinked successfully')
      setLinkedParents(prev => prev.filter(p => p.id !== parentId))
      queryClient.invalidateQueries({ queryKey: ['students'] })
      fetchAvailableParents()
    } catch (error: any) {
      console.error('Failed to unlink parent:', error)
      toast.error('Failed to unlink parent', {
        description: error.message || 'Please try again.'
      })
    } finally {
      setUnlinkingParentId(null)
    }
  }

  useEffect(() => {
    if (studentSlug) {
      console.log('StudentDetailsPage loaded with studentSlug:', studentSlug)
      fetchStudentDetails()
    }
  }, [studentSlug])

  useEffect(() => {
    if (linkParentModalOpen) {
      fetchAvailableParents()
    } else {
      setParentSelection('new')
      setParentName('')
      setParentEmail('')
    }
  }, [linkParentModalOpen])

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2)
  }

  const handleSendMessage = () => {
    setSendMessageModalOpen(true)
  }

  const handleEditProfile = () => {
    toast.info('Edit profile feature coming soon')
  }

  const pendingAssignments = assignments.filter(a => a.status === 'pending')

  return (
    <div className="flex-1 overflow-y-auto bg-background p-6">
          {loading ? (
            // Loading skeleton
            <div className="space-y-6">
              {/* Header skeleton */}
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-4">
                  <Skeleton className="h-16 w-16 rounded-full" />
                  <div className="space-y-2">
                    <Skeleton className="h-6 w-48" />
                    <Skeleton className="h-4 w-64" />
                  </div>
                </div>
                <div className="flex gap-2">
                  <Skeleton className="h-10 w-32" />
                  <Skeleton className="h-10 w-32" />
                </div>
              </div>

              {/* Stats cards skeleton */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="bg-card border border-border rounded-lg p-4 space-y-2">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-8 w-16" />
                  </div>
                ))}
              </div>

              {/* Content cards skeleton */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="bg-card border border-border rounded-lg p-6 space-y-4">
                    <Skeleton className="h-6 w-32" />
                    <div className="space-y-2">
                      <Skeleton className="h-4 w-full" />
                      <Skeleton className="h-4 w-3/4" />
                      <Skeleton className="h-4 w-1/2" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : !student ? (
            // Error state
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <h2 className="text-2xl font-bold mb-4">Student not found</h2>
                <Button
                  onClick={() => navigate('/dashboard/students')}
                  className="bg-[#C8A882] text-white hover:bg-[#B89872]"
                >
                  Back to Students
                </Button>
              </div>
            </div>
          ) : (
            // Actual content
            <>
              {/* Header */}
              <div className="mb-6">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-4">
                    <Avatar className="h-20 w-20 border-4 border-[#C8A882]/20">
                      {student.avatar ? (
                        <AvatarImage src={student.avatar} alt={student.name} />
                      ) : (
                        <AvatarFallback className="bg-gradient-to-br from-[#C8A882] to-[#B89872] text-white text-2xl font-semibold">
                          {getInitials(student.name)}
                        </AvatarFallback>
                      )}
                    </Avatar>
                    <div>
                      <div className="flex items-center gap-3">
                        <h1 className="text-3xl font-bold text-foreground">{student.name}</h1>
                        <Badge variant="outline" className="border-[#C8A882] text-[#C8A882]">
                          <GraduationCap className="h-3 w-3 mr-1" />
                          {student.grade}
                        </Badge>
                      </div>
                      <p className="text-muted-foreground mt-1 flex items-center gap-2">
                        <Calendar className="h-4 w-4" />
                        Joined {format(new Date(student.joinedDate), 'MMMM dd, yyyy')}
                      </p>
                      <p className="text-muted-foreground text-sm flex items-center gap-2 mt-1">
                        <Mail className="h-3 w-3" />
                        {student.email}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <Button
                      variant="outline"
                      onClick={handleSendMessage}
                      className="border-[#C8A882] text-[#C8A882] hover:bg-[#C8A882] hover:text-white"
                    >
                      <MessageCircle className="h-4 w-4 mr-2" />
                      Send Message
                    </Button>
                    <Button
                      onClick={handleEditProfile}
                      className="bg-[#C8A882] text-white hover:bg-[#B89872]"
                    >
                      <Edit className="h-4 w-4 mr-2" />
                      Edit Profile
                    </Button>
                  </div>
                </div>
              </div>

              {/* Stats Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                <Card className="border-border bg-card hover:shadow-md transition-shadow">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-muted-foreground">Average Score</p>
                        <p className="text-2xl font-bold text-foreground">{student.averageScore}%</p>
                      </div>
                      <div className="h-12 w-12 rounded-full bg-green-500/10 flex items-center justify-center">
                        <TrendingUp className="h-6 w-6 text-green-500" />
                      </div>
                    </div>
                    <div className="mt-2 flex items-center text-xs text-muted-foreground">
                      <Award className="h-3 w-3 mr-1" />
                      Based on completed assignments
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-border bg-card hover:shadow-md transition-shadow">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-muted-foreground">Completion Rate</p>
                        <p className="text-2xl font-bold text-foreground">{student.completionRate}%</p>
                      </div>
                      <div className="h-12 w-12 rounded-full bg-blue-500/10 flex items-center justify-center">
                        <Target className="h-6 w-6 text-blue-500" />
                      </div>
                    </div>
                    <div className="mt-2 flex items-center text-xs text-muted-foreground">
                      <CheckCircle2 className="h-3 w-3 mr-1" />
                      {student.completedAssignments} of {student.totalAssignments} completed
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-border bg-card hover:shadow-md transition-shadow">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-muted-foreground">Pending Tasks</p>
                        <p className="text-2xl font-bold text-foreground">{pendingAssignments.length}</p>
                      </div>
                      <div className="h-12 w-12 rounded-full bg-orange-500/10 flex items-center justify-center">
                        <Clock className="h-6 w-6 text-orange-500" />
                      </div>
                    </div>
                    <div className="mt-2 flex items-center text-xs text-muted-foreground">
                      <BookOpen className="h-3 w-3 mr-1" />
                      Assignments awaiting completion
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-border bg-card hover:shadow-md transition-shadow">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-muted-foreground">Active Groups</p>
                        <p className="text-2xl font-bold text-foreground">{groups.length}</p>
                      </div>
                      <div className="h-12 w-12 rounded-full bg-purple-500/10 flex items-center justify-center">
                        <Users className="h-6 w-6 text-purple-500" />
                      </div>
                    </div>
                    <div className="mt-2 flex items-center text-xs text-muted-foreground">
                      <Users className="h-3 w-3 mr-1" />
                      Study groups enrolled
                    </div>
                  </CardContent>
                </Card>
              </div>

          {/* Main Content Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left Column - Academic Progress & Recent Activity */}
            <div className="lg:col-span-2 space-y-6">
              {/* Academic Progress Summary */}
              <Card className="border-border bg-card">
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle className="text-foreground flex items-center gap-2">
                    <BarChart3 className="h-5 w-5 text-[#C8A882]" />
                    Academic Progress
                  </CardTitle>
                  {progressData.length > 0 && (
                    <Badge variant="outline" className="text-xs">
                      Last {progressData.length} months
                    </Badge>
                  )}
                </CardHeader>
                <CardContent>
                  {progressData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={280}>
                      <LineChart data={progressData}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                        <XAxis
                          dataKey="month"
                          className="text-muted-foreground"
                          tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
                        />
                        <YAxis
                          className="text-muted-foreground"
                          tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
                          domain={[0, 100]}
                          tickFormatter={(value) => `${value}%`}
                        />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: 'hsl(var(--card))',
                            border: '1px solid hsl(var(--border))',
                            borderRadius: '8px',
                            color: 'hsl(var(--foreground))'
                          }}
                          formatter={(value: number) => [`${value}%`, 'Score']}
                        />
                        <Line
                          type="monotone"
                          dataKey="score"
                          stroke="#C8A882"
                          strokeWidth={3}
                          dot={{ fill: '#C8A882', r: 5, strokeWidth: 2, stroke: '#fff' }}
                          activeDot={{ r: 7, stroke: '#C8A882', strokeWidth: 2 }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-12 text-center">
                      <div className="h-16 w-16 rounded-full bg-muted/50 flex items-center justify-center mb-4">
                        <BarChart3 className="h-8 w-8 text-muted-foreground" />
                      </div>
                      <h3 className="text-foreground font-medium mb-1">No Progress Data Yet</h3>
                      <p className="text-muted-foreground text-sm max-w-xs">
                        Progress data will appear here once the student completes assignments.
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Recent Activity */}
              <Card className="border-border bg-card">
                <CardHeader>
                  <CardTitle className="text-foreground flex items-center gap-2">
                    <Activity className="h-5 w-5 text-blue-500" />
                    Recent Activity
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {activities.length > 0 ? (
                    <div className="space-y-3">
                      {activities.map((activity) => (
                        <div key={activity.id} className="flex items-start gap-3 p-3 rounded-lg bg-muted/50 border border-border hover:bg-muted/70 transition-colors">
                          <div className={`h-10 w-10 rounded-full flex items-center justify-center flex-shrink-0 ${
                            activity.type === 'completed' ? 'bg-green-500/10' : 'bg-blue-500/10'
                          }`}>
                            {activity.type === 'completed' ? (
                              <CheckCircle2 className="h-5 w-5 text-green-500" />
                            ) : (
                              <FileText className="h-5 w-5 text-blue-500" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-foreground font-medium">
                              {activity.type === 'completed' ? 'Completed: ' : 'Submitted: '}
                              {activity.title}
                            </p>
                            <div className="flex items-center gap-2 mt-1">
                              <p className="text-muted-foreground text-sm">
                                {format(new Date(activity.timestamp), 'PPp')}
                              </p>
                              {activity.score && (
                                <Badge variant="secondary" className="text-xs">
                                  Score: {activity.score}
                                </Badge>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-12 text-center">
                      <div className="h-16 w-16 rounded-full bg-muted/50 flex items-center justify-center mb-4">
                        <Activity className="h-8 w-8 text-muted-foreground" />
                      </div>
                      <h3 className="text-foreground font-medium mb-1">No Recent Activity</h3>
                      <p className="text-muted-foreground text-sm max-w-xs">
                        Activity will appear here when the student starts working on assignments.
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Right Column - Parent Management & Assignments */}
            <div className="space-y-6">
              {/* Parent Management */}
              <Card className="border-border bg-card">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
                  <CardTitle className="text-foreground flex items-center gap-2 text-base">
                    <Users className="h-5 w-5 text-[#C8A882]" />
                    Linked Parents
                  </CardTitle>
                  <Button
                    size="sm"
                    onClick={() => setLinkParentModalOpen(true)}
                    className="bg-[#C8A882] text-white hover:bg-[#B89872] h-8"
                  >
                    <UserPlus className="h-4 w-4 mr-1" />
                    Link
                  </Button>
                </CardHeader>
                <CardContent className="space-y-3">
                  {linkedParents.length > 0 ? (
                    linkedParents.map((parent) => (
                      <div
                        key={parent.id}
                        className="flex items-center justify-between p-3 rounded-lg bg-muted/50 border border-border hover:bg-muted/70 transition-colors"
                      >
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <div className="h-9 w-9 rounded-full bg-[#C8A882]/10 flex items-center justify-center flex-shrink-0">
                            <User className="h-4 w-4 text-[#C8A882]" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-foreground font-medium text-sm truncate">{parent.name}</p>
                            <p className="text-muted-foreground text-xs truncate">{parent.email}</p>
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleUnlinkParent(parent.id)}
                          disabled={unlinkingParentId === parent.id}
                          className="text-destructive hover:text-destructive hover:bg-destructive/10 h-8 w-8 p-0"
                        >
                          {unlinkingParentId === parent.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <X className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    ))
                  ) : (
                    <div className="flex flex-col items-center justify-center py-6 text-center">
                      <div className="h-12 w-12 rounded-full bg-muted/50 flex items-center justify-center mb-3">
                        <Users className="h-6 w-6 text-muted-foreground" />
                      </div>
                      <p className="text-muted-foreground text-sm">No parents linked yet</p>
                      <p className="text-muted-foreground text-xs mt-1">
                        Click "Link" to add a parent
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Pending Assignments */}
              <Card className="border-border bg-card">
                <CardHeader className="pb-3">
                  <CardTitle className="text-foreground flex items-center gap-2 text-base">
                    <Clock className="h-5 w-5 text-orange-500" />
                    Pending Assignments
                    {pendingAssignments.length > 0 && (
                      <Badge variant="secondary" className="ml-auto text-xs">
                        {pendingAssignments.length}
                      </Badge>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {pendingAssignments.length > 0 ? (
                    <div className="space-y-2">
                      {pendingAssignments.slice(0, 5).map((assignment) => {
                        const dueDate = new Date(assignment.dueDate)
                        const now = new Date()
                        const diffMs = dueDate.getTime() - now.getTime()
                        const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24))

                        let dueDateText = ''
                        let dueDateColor = 'text-muted-foreground'
                        let badgeVariant: 'outline' | 'destructive' | 'secondary' = 'outline'

                        if (diffDays < 0) {
                          dueDateText = 'Overdue'
                          dueDateColor = 'text-red-500'
                          badgeVariant = 'destructive'
                        } else if (diffDays === 0) {
                          dueDateText = 'Today'
                          dueDateColor = 'text-orange-500'
                        } else if (diffDays === 1) {
                          dueDateText = 'Tomorrow'
                          dueDateColor = 'text-orange-500'
                        } else {
                          dueDateText = `${diffDays}d`
                        }

                        return (
                          <div key={assignment.id} className="flex items-center gap-3 p-2.5 rounded-lg bg-muted/50 border border-border hover:bg-muted/70 transition-colors">
                            <div className="h-8 w-8 rounded-full bg-orange-500/10 flex items-center justify-center flex-shrink-0">
                              <BookOpen className="h-4 w-4 text-orange-500" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-foreground font-medium text-sm truncate">{assignment.title}</p>
                              <p className="text-muted-foreground text-xs truncate">{assignment.subject}</p>
                            </div>
                            <Badge variant={badgeVariant} className={`text-xs ${dueDateColor} flex-shrink-0`}>
                              {dueDateText}
                            </Badge>
                          </div>
                        )
                      })}
                      {pendingAssignments.length > 5 && (
                        <p className="text-muted-foreground text-xs text-center pt-2">
                          +{pendingAssignments.length - 5} more assignments
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-6 text-center">
                      <div className="h-10 w-10 rounded-full bg-green-500/10 flex items-center justify-center mb-2">
                        <CheckCircle2 className="h-5 w-5 text-green-500" />
                      </div>
                      <p className="text-muted-foreground text-sm">All caught up!</p>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Active Groups */}
              <Card className="border-border bg-card">
                <CardHeader className="pb-3">
                  <CardTitle className="text-foreground flex items-center gap-2 text-base">
                    <Users className="h-5 w-5 text-purple-500" />
                    Study Groups
                    {groups.length > 0 && (
                      <Badge variant="secondary" className="ml-auto text-xs">
                        {groups.length}
                      </Badge>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {groups.length > 0 ? (
                    <div className="space-y-2">
                      {groups.map((group) => (
                        <div key={group.id} className="flex items-center gap-3 p-2.5 rounded-lg bg-muted/50 border border-border hover:bg-muted/70 transition-colors">
                          <div className="h-8 w-8 rounded-full bg-purple-500/10 flex items-center justify-center flex-shrink-0">
                            <Users className="h-4 w-4 text-purple-500" />
                          </div>
                          <p className="text-foreground text-sm font-medium">{group.name}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-6 text-center">
                      <div className="h-10 w-10 rounded-full bg-muted/50 flex items-center justify-center mb-2">
                        <Users className="h-5 w-5 text-muted-foreground" />
                      </div>
                      <p className="text-muted-foreground text-sm">No groups yet</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
            </>
          )}

      {/* Send Message Modal */}
      {student && (
        <SendMessageModal
          open={sendMessageModalOpen}
          onOpenChange={setSendMessageModalOpen}
          student={{
            id: student.id,
            name: student.name,
            email: student.email,
            avatar: student.avatar
          }}
          onMessageSent={() => {
            toast.success('Message sent successfully')
          }}
        />
      )}

      {/* Link Parent Modal */}
      <Dialog open={linkParentModalOpen} onOpenChange={setLinkParentModalOpen}>
        <DialogContent className="sm:max-w-[450px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="h-5 w-5 text-primary" />
              Link Parent to {student?.name}
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleLinkParent} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="existing-parent">Existing Parent (optional)</Label>
              <Select
                value={parentSelection}
                onValueChange={handleParentSelection}
                disabled={loadingParents}
              >
                <SelectTrigger id="existing-parent">
                  <SelectValue placeholder="Select existing parent or create new" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="new">Create new parent</SelectItem>
                  {selectableParents.map((parent) => (
                    <SelectItem key={parent.id} value={parent.id}>
                      {parent.name} ({parent.email})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {loadingParents && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Loading parents...
                </div>
              )}
              {!loadingParents && selectableParents.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No existing parents found yet.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="parent-name">Parent Name *</Label>
              <Input
                id="parent-name"
                placeholder="Enter parent's full name"
                value={parentName}
                onChange={(e) => setParentName(e.target.value)}
                disabled={parentSelection !== 'new'}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="parent-email">Parent Email *</Label>
              <Input
                id="parent-email"
                type="email"
                placeholder="parent@example.com"
                value={parentEmail}
                onChange={(e) => setParentEmail(e.target.value)}
                disabled={parentSelection !== 'new'}
                required
              />
            </div>

            <div className="bg-muted/50 p-3 rounded-lg">
              <p className="text-sm text-muted-foreground">
                The parent will be linked to this student and can view their progress.
              </p>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setLinkParentModalOpen(false)}
                disabled={linkingParent}
                className="border-[#C8A882] text-[#C8A882] hover:bg-[#C8A882] hover:text-white"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={linkingParent || !parentEmail.trim() || !parentName.trim()}
                className="bg-[#C8A882] text-white hover:bg-[#B89872] disabled:bg-[#C8A882]/50"
              >
                {linkingParent ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Linking...
                  </>
                ) : (
                  'Link Parent'
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

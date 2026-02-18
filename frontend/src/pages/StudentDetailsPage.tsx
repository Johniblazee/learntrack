import { useState, useEffect, useMemo, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { MessageCircle, Edit, CheckCircle2, Clock, Users, FileText, Calendar, X, UserPlus, Mail, Phone, TrendingUp, Target, BookOpen, Award, BarChart3, Activity as ActivityIcon, GraduationCap, User } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { useApiClient } from '@/lib/api-client'
import { toast } from '@/contexts/ToastContext'
import { format, isValid } from 'date-fns'
import { SendMessageModal } from '@/components/modals/SendMessageModal'
import { LoadingSpinner } from '@/components/ui/loading-state'

interface StudentDetails {
  id: string
  clerkId?: string
  dbId?: string
  name: string
  email: string
  phone?: string
  avatar?: string
  joinedDate: string
  studentId: string
  grade: string
  parentEmail?: string
  parentName?: string
  notes?: string
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

interface GroupOption {
  id: string
  name: string
  color: string
  studentIds: string[]
}

const toUniqueStrings = (values: Array<unknown>): string[] => {
  return Array.from(
    new Set(
      values
        .map((value) => String(value ?? '').trim())
        .filter((value) => value.length > 0)
    )
  )
}

const asCollection = (payload: any): any[] => {
  if (Array.isArray(payload)) {
    return payload
  }

  if (Array.isArray(payload?.items)) {
    return payload.items
  }

  if (Array.isArray(payload?.data)) {
    return payload.data
  }

  return []
}

const asParentsCollection = (payload: any): any[] => {
  if (Array.isArray(payload)) {
    return payload
  }

  if (Array.isArray(payload?.parents)) {
    return payload.parents
  }

  if (Array.isArray(payload?.items)) {
    return payload.items
  }

  return []
}

const mapLinkedParents = (payload: any): LinkedParent[] => {
  return asParentsCollection(payload)
    .map((parent: any) => ({
      id: String(parent.clerk_id || parent._id || parent.id || ''),
      name: String(parent.name || 'Unknown Parent'),
      email: String(parent.email || ''),
    }))
    .filter((parent: LinkedParent) => parent.id)
}

const mapGroupOptions = (payload: any): GroupOption[] => {
  return asCollection(payload)
    .map((group: any, index: number) => ({
      id: String(group._id || group.id || group.name || `group-${index}`),
      name: String(group.name || 'Untitled Group'),
      color: String(group.color || 'blue'),
      studentIds: toUniqueStrings(Array.isArray(group.studentIds) ? group.studentIds : []),
    }))
    .filter((group: GroupOption) => group.id)
}

export default function StudentDetailsPage() {
  const { studentSlug } = useParams<{ studentSlug: string }>()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [student, setStudent] = useState<StudentDetails | null>(null)
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [groups, setGroups] = useState<Group[]>([])
  const [allGroups, setAllGroups] = useState<GroupOption[]>([])
  const [activities, setActivities] = useState<Activity[]>([])
  const [progressData, setProgressData] = useState<ProgressData[]>([])
  const [sendMessageModalOpen, setSendMessageModalOpen] = useState(false)
  const [editProfileModalOpen, setEditProfileModalOpen] = useState(false)
  const [editProfileName, setEditProfileName] = useState('')
  const [editProfileEmail, setEditProfileEmail] = useState('')
  const [editProfileGrade, setEditProfileGrade] = useState('')
  const [editProfilePhone, setEditProfilePhone] = useState('')
  const [editProfileParentName, setEditProfileParentName] = useState('')
  const [editProfileParentEmail, setEditProfileParentEmail] = useState('')
  const [editProfileNotes, setEditProfileNotes] = useState('')
  const [savingProfile, setSavingProfile] = useState(false)

  // Parent management state
  const [linkedParents, setLinkedParents] = useState<LinkedParent[]>([])
  const [linkParentModalOpen, setLinkParentModalOpen] = useState(false)
  const [parentEmail, setParentEmail] = useState('')
  const [parentName, setParentName] = useState('')
  const [availableParents, setAvailableParents] = useState<LinkedParent[]>([])
  const [loadingParents, setLoadingParents] = useState(false)
  const [loadingLinkedParents, setLoadingLinkedParents] = useState(false)
  const [parentSelection, setParentSelection] = useState('new')
  const [linkingParent, setLinkingParent] = useState(false)
  const [unlinkingParentId, setUnlinkingParentId] = useState<string | null>(null)
  const [assignGroupModalOpen, setAssignGroupModalOpen] = useState(false)
  const [selectedGroupId, setSelectedGroupId] = useState('')
  const [loadingAllGroups, setLoadingAllGroups] = useState(false)
  const [assigningGroup, setAssigningGroup] = useState(false)

  const isMountedRef = useRef(false)
  const activeFetchIdRef = useRef(0)
  const lastLoadErrorToastAtRef = useRef(0)

  const client = useApiClient()
  const queryClient = useQueryClient()

  const selectableParents = availableParents.filter(
    (parent) => !linkedParents.some((linked) => linked.id === parent.id)
  )

  const studentGroupIdentifierCandidates = useMemo(() => {
    if (!student) {
      return []
    }

    return toUniqueStrings([student.dbId, student.clerkId, student.id])
  }, [student])

  const assignableGroups = useMemo(() => {
    if (!studentGroupIdentifierCandidates.length) {
      return allGroups
    }

    return allGroups.filter((group) => {
      const memberIds = toUniqueStrings(group.studentIds)
      return !memberIds.some((memberId) => studentGroupIdentifierCandidates.includes(memberId))
    })
  }, [allGroups, studentGroupIdentifierCandidates])

  const fetchStudentDetails = async () => {
    if (!studentSlug) return

    const fetchId = activeFetchIdRef.current + 1
    activeFetchIdRef.current = fetchId
    let coreStudentLoaded = false

    try {
      setLoading(true)
      setLoadingLinkedParents(true)
      setAssignments([])
      setGroups([])
      setActivities([])
      setProgressData([])
      setLinkedParents([])

      // Fetch student details by slug
      const studentRes = await client.get(`/students/by-slug/${studentSlug}`)
      if (fetchId !== activeFetchIdRef.current || !isMountedRef.current) return

      if (studentRes.error || !studentRes.data) {
        throw new Error(studentRes.error || 'Student not found')
      }

      const userData = studentRes.data as any
      const studentDbId = String(userData._id || '')
      const studentClerkId = String(userData.clerk_id || '')
      const studentApiId = studentClerkId || studentDbId
      const progressLookupId = studentClerkId || studentApiId
      const groupLookupId = studentDbId || studentApiId

      if (!studentApiId) {
        throw new Error('Student identifier is missing')
      }

      setStudent({
        id: studentApiId,
        clerkId: studentClerkId || undefined,
        dbId: studentDbId || undefined,
        name: userData.name,
        email: userData.email,
        phone: userData.student_profile?.phone,
        avatar: userData.avatar_url,
        joinedDate: userData.created_at,
        studentId: userData._id?.slice(-6).toUpperCase() || 'ST84321',
        grade: userData.student_profile?.grade || '10th Grade',
        parentEmail: userData.student_profile?.parentEmail,
        parentName: userData.student_profile?.parentName || 'Sarah Reed',
        notes: userData.student_profile?.notes,
        averageScore: userData.student_profile?.averageScore || 0,
        completionRate: userData.student_profile?.completionRate || 0,
        totalAssignments: userData.student_profile?.totalAssignments || 0,
        completedAssignments: userData.student_profile?.completedAssignments || 0
      })
      coreStudentLoaded = true

      // Render the page as soon as core student profile is loaded.
      setLoading(false)

      // Fetch additional sections in parallel, without blocking the full page render.
      const [progressResult, assignmentsResult, groupsResult, activityResult, parentsResult] = await Promise.allSettled([
        client.get(`/progress/student/${progressLookupId}/analytics`),
        client.get(`/assignments/student/${progressLookupId}?status=pending`),
        client.get(`/groups/student/${groupLookupId}`),
        client.get(`/activity/student/${progressLookupId}`),
        client.get(`/students/${studentApiId}/parents`)
      ])

      if (fetchId !== activeFetchIdRef.current || !isMountedRef.current) return

      // Process progress data
      if (progressResult.status === 'fulfilled' && !progressResult.value.error) {
        const monthlyScores = asCollection(progressResult.value.data?.monthly_scores)
        const mappedProgress = monthlyScores
          .map((entry: any) => ({
            month: String(entry.month || ''),
            score: Number(entry.score ?? 0),
          }))
          .filter((entry: ProgressData) => entry.month)

        setProgressData(mappedProgress)
      } else {
        if (progressResult.status === 'rejected') {
          console.error('Failed to fetch progress data:', progressResult.reason)
        } else if (progressResult.status === 'fulfilled' && progressResult.value.error) {
          console.error('Failed to fetch progress data:', progressResult.value.error)
        }
        setProgressData([])
      }

      // Process assignments data
      if (assignmentsResult.status === 'fulfilled' && !assignmentsResult.value.error) {
        const assignmentRows = asCollection(assignmentsResult.value.data)
        const mappedAssignments = assignmentRows.map((assignment: any, index: number) => {
          const status = assignment.status === 'completed' || assignment.status === 'overdue'
            ? assignment.status
            : 'pending'

          return {
            id: String(assignment._id || assignment.id || assignment.title || `assignment-${index}`),
            title: assignment.title || 'Untitled assignment',
            subject: assignment.subject_id?.name || assignment.subject?.name || assignment.subject || 'Unknown',
            dueDate: assignment.due_date || assignment.dueDate || '',
            status,
          }
        })

        setAssignments(mappedAssignments)
      } else {
        if (assignmentsResult.status === 'rejected') {
          console.error('Failed to fetch assignments:', assignmentsResult.reason)
        } else if (assignmentsResult.status === 'fulfilled' && assignmentsResult.value.error) {
          console.error('Failed to fetch assignments:', assignmentsResult.value.error)
        }
        setAssignments([])
      }

      // Process groups data
      if (groupsResult.status === 'fulfilled' && !groupsResult.value.error) {
        const mappedGroups = mapGroupOptions(groupsResult.value.data).map((group) => ({
          id: group.id,
          name: group.name,
          color: group.color,
        }))

        setGroups(mappedGroups)
      } else {
        if (groupsResult.status === 'rejected') {
          console.error('Failed to fetch groups:', groupsResult.reason)
        } else if (groupsResult.status === 'fulfilled' && groupsResult.value.error) {
          console.error('Failed to fetch groups:', groupsResult.value.error)
        }
        setGroups([])
      }

      // Process activity data
      if (activityResult.status === 'fulfilled' && !activityResult.value.error) {
        const activityRows = asCollection(activityResult.value.data)
        const mappedActivities = activityRows.map((activity: any, index: number) => {
          const rawType = String(activity.type || activity.activity_type || '').toLowerCase()
          const normalizedType: Activity['type'] = rawType.includes('completed') ? 'completed' : 'submitted'

          return {
            id: String(activity._id || activity.id || `${rawType || 'activity'}-${index}`),
            type: normalizedType,
            title: activity.title || activity.description || 'Activity',
            timestamp: activity.timestamp || activity.created_at || new Date().toISOString(),
            score: activity.score ? String(activity.score) : undefined,
          }
        })

        setActivities(mappedActivities)
      } else {
        if (activityResult.status === 'rejected') {
          console.error('Failed to fetch activity:', activityResult.reason)
        } else if (activityResult.status === 'fulfilled' && activityResult.value.error) {
          console.error('Failed to fetch activity:', activityResult.value.error)
        }
        setActivities([])
      }

      // Process parents data
      if (parentsResult.status === 'fulfilled' && !parentsResult.value.error) {
        setLinkedParents(mapLinkedParents(parentsResult.value.data))
      } else {
        if (parentsResult.status === 'rejected') {
          console.error('Failed to fetch linked parents:', parentsResult.reason)
        } else if (parentsResult.status === 'fulfilled' && parentsResult.value.error) {
          console.error('Failed to fetch linked parents:', parentsResult.value.error)
        }
        setLinkedParents([])
      }
      setLoadingLinkedParents(false)
    } catch (err: any) {
      if (fetchId !== activeFetchIdRef.current || !isMountedRef.current) return

      console.error('Failed to fetch student details:', err)
      const now = Date.now()
      if (now - lastLoadErrorToastAtRef.current > 2500) {
        toast.error('Failed to load student details')
        lastLoadErrorToastAtRef.current = now
      }
      if (!coreStudentLoaded) {
        setStudent(null)
      }
      setLoadingLinkedParents(false)
      setLoading(false)
    }
  }

  const fetchAvailableParents = async () => {
    try {
      setLoadingParents(true)
      const res = await client.get('/parents')
      if (res.error) throw new Error(res.error)

      setAvailableParents(mapLinkedParents(res.data))
    } catch (error) {
      console.error('Failed to load parents list:', error)
      setAvailableParents([])
    } finally {
      setLoadingParents(false)
    }
  }

  const fetchAllGroups = async () => {
    try {
      setLoadingAllGroups(true)
      const response = await client.get('/groups?limit=200')
      if (response.error) {
        throw new Error(response.error)
      }

      setAllGroups(mapGroupOptions(response.data))
    } catch (error: any) {
      console.error('Failed to load groups list:', error)
      setAllGroups([])
      toast.error('Failed to load groups', {
        description: error.message || 'Please try again.',
      })
    } finally {
      setLoadingAllGroups(false)
    }
  }

  const handleAssignToGroup = async (event: React.FormEvent) => {
    event.preventDefault()

    if (!student || !selectedGroupId) {
      return
    }

    const targetGroup = allGroups.find((group) => group.id === selectedGroupId)
    if (!targetGroup) {
      toast.error('Selected group not found')
      return
    }

    const studentMembershipId = student.dbId || student.id
    if (!studentMembershipId) {
      toast.error('Unable to assign group', {
        description: 'Student ID is missing. Refresh and try again.',
      })
      return
    }

    try {
      setAssigningGroup(true)

      const updatedStudentIds = toUniqueStrings([
        ...targetGroup.studentIds,
        studentMembershipId,
      ])

      const response = await client.put(`/groups/${targetGroup.id}`, {
        studentIds: updatedStudentIds,
      })

      if (response.error) {
        throw new Error(response.error)
      }

      setAllGroups((previous) =>
        previous.map((group) =>
          group.id === targetGroup.id
            ? {
                ...group,
                studentIds: updatedStudentIds,
              }
            : group
        )
      )

      setGroups((previous) => {
        if (previous.some((group) => group.id === targetGroup.id)) {
          return previous
        }

        return [
          ...previous,
          {
            id: targetGroup.id,
            name: targetGroup.name,
            color: targetGroup.color,
          },
        ]
      })

      queryClient.invalidateQueries({ queryKey: ['groups'] })

      toast.success('Student assigned to group', {
        description: `${student.name} was added to ${targetGroup.name}.`,
      })

      setAssignGroupModalOpen(false)
      setSelectedGroupId('')
    } catch (error: any) {
      console.error('Failed to assign student to group:', error)
      toast.error('Failed to assign group', {
        description: error.message || 'Please try again.',
      })
    } finally {
      setAssigningGroup(false)
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

    // Check if this email is already linked to this student (client-side validation)
    const emailLower = parentEmail.trim().toLowerCase()
    const alreadyLinked = linkedParents.some(p => p.email.toLowerCase() === emailLower)
    if (alreadyLinked) {
      toast.warning('Parent already linked', {
        description: `A parent with email "${parentEmail}" is already linked to this student.`
      })
      return
    }

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
      if (parentsRes.error) {
        throw new Error(parentsRes.error)
      }
      if (parentsRes.data) {
        setLinkedParents(mapLinkedParents(parentsRes.data))
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
      // Provide more specific error messages based on the error
      const errorMessage = error.message || ''
      if (errorMessage.includes('already linked')) {
        toast.warning('Parent already linked', {
          description: `This parent is already linked to ${student.name}.`
        })
      } else {
        toast.error('Failed to link parent', {
          description: errorMessage || 'Please try again or contact support.'
        })
      }
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
    isMountedRef.current = true

    return () => {
      isMountedRef.current = false
      activeFetchIdRef.current += 1
    }
  }, [])

  useEffect(() => {
    if (studentSlug) {
      void fetchStudentDetails()
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

  useEffect(() => {
    if (assignGroupModalOpen) {
      void fetchAllGroups()
    } else {
      setSelectedGroupId('')
    }
  }, [assignGroupModalOpen])

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
    if (!student) {
      return
    }

    setEditProfileName(student.name)
    setEditProfileEmail(student.email)
    setEditProfileGrade(student.grade || '')
    setEditProfilePhone(student.phone || '')
    setEditProfileParentName(student.parentName || '')
    setEditProfileParentEmail(student.parentEmail || '')
    setEditProfileNotes(student.notes || '')
    setEditProfileModalOpen(true)
  }

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!student) {
      return
    }

    const name = editProfileName.trim()
    const email = editProfileEmail.trim().toLowerCase()
    const grade = editProfileGrade.trim()
    const phone = editProfilePhone.trim()
    const parentName = editProfileParentName.trim()
    const parentEmail = editProfileParentEmail.trim().toLowerCase()
    const notes = editProfileNotes.trim()

    if (!name || !email) {
      toast.error('Name and email are required')
      return
    }

    try {
      setSavingProfile(true)

      const response = await client.put(`/students/${student.id}`, {
        name,
        email,
        student_profile: {
          grade: grade || null,
          phone: phone || null,
          parentName: parentName || null,
          parentEmail: parentEmail || null,
          notes: notes || null,
        },
      })

      if (response.error) {
        throw new Error(response.error)
      }

      const updatedStudent = response.data as any

      setStudent((previous) => {
        if (!previous) {
          return previous
        }

        const updatedProfile = updatedStudent?.student_profile || {}

        return {
          ...previous,
          name: updatedStudent?.name || name,
          email: updatedStudent?.email || email,
          grade: updatedProfile.grade || grade || previous.grade,
          phone: updatedProfile.phone || phone || undefined,
          parentName: updatedProfile.parentName || parentName || undefined,
          parentEmail: updatedProfile.parentEmail || parentEmail || undefined,
          notes: updatedProfile.notes || notes || undefined,
        }
      })

      queryClient.invalidateQueries({ queryKey: ['students'] })
      toast.success('Student profile updated')
      setEditProfileModalOpen(false)

      const nextSlug = updatedStudent?.slug
      if (nextSlug && studentSlug && nextSlug !== studentSlug) {
        navigate(`/dashboard/students/${nextSlug}`, { replace: true })
      }
    } catch (error: any) {
      console.error('Failed to update student profile:', error)
      toast.error('Failed to update profile', {
        description: error.message || 'Please try again.',
      })
    } finally {
      setSavingProfile(false)
    }
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
                  className="bg-[#5c4a38] text-white hover:bg-[#4a3c2e] dark:bg-[#C8A882] dark:text-white dark:hover:bg-[#B89872] border-0"
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
                    <Avatar className="h-20 w-20 border-4 border-[#5c4a38]/20 dark:border-[#C8A882]/20">
                      {student.avatar ? (
                        <AvatarImage src={student.avatar} alt={student.name} />
                      ) : (
                        <AvatarFallback className="bg-gradient-to-br from-[#5c4a38] to-[#4a3c2e] dark:from-[#C8A882] dark:to-[#B89872] text-white text-2xl font-semibold">
                          {getInitials(student.name)}
                        </AvatarFallback>
                      )}
                    </Avatar>
                    <div>
                      <div className="flex items-center gap-3">
                        <h1 className="text-3xl font-bold text-foreground">{student.name}</h1>
                        <Badge variant="outline" className="border-[#5c4a38] text-[#5c4a38] dark:border-[#C8A882] dark:text-[#C8A882]">
                          <GraduationCap className="h-3 w-3 mr-1" />
                          {student.grade}
                        </Badge>
                      </div>
                      <p className="text-muted-foreground mt-1 flex items-center gap-2">
                        <Calendar className="h-4 w-4" />
                        Joined {(() => {
                        const date = new Date(student.joinedDate)
                        return isValid(date) ? format(date, 'MMMM dd, yyyy') : 'Join date unknown'
                      })()}
                      </p>
                      <p className="text-muted-foreground text-sm flex items-center gap-2 mt-1">
                        <Mail className="h-3 w-3" />
                        {student.email}
                      </p>
                      {student.phone && (
                        <p className="text-muted-foreground text-sm flex items-center gap-2 mt-1">
                          <Phone className="h-3 w-3" />
                          {student.phone}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <Button
                      variant="outline"
                      onClick={handleSendMessage}
                      className="border-[#5c4a38] border-2 text-[#5c4a38] bg-transparent hover:bg-[#5c4a38] hover:text-white dark:border-[#C8A882] dark:text-[#C8A882] dark:hover:bg-[#C8A882] dark:hover:text-white"
                    >
                      <MessageCircle className="h-4 w-4 mr-2" />
                      Send Message
                    </Button>
                    <Button
                      onClick={handleEditProfile}
                      className="bg-[#5c4a38] text-white hover:bg-[#4a3c2e] border-0 dark:bg-[#C8A882] dark:hover:bg-[#B89872]"
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
                    <BarChart3 className="h-5 w-5 text-[#5c4a38] dark:text-[#C8A882]" />
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
                          stroke="#5c4a38"
                          strokeWidth={3}
                          dot={{ fill: '#5c4a38', r: 5, strokeWidth: 2, stroke: '#fff' }}
                          activeDot={{ r: 7, stroke: '#5c4a38', strokeWidth: 2 }}
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
                    <ActivityIcon className="h-5 w-5 text-blue-500" />
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
                                {(() => {
                                  const date = new Date(activity.timestamp)
                                  return isValid(date) ? format(date, 'PPp') : 'Invalid date'
                                })()}
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
                        <ActivityIcon className="h-8 w-8 text-muted-foreground" />
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
                    <Users className="h-5 w-5 text-[#5c4a38] dark:text-[#C8A882]" />
                    Linked Parents
                  </CardTitle>
                  <Button
                    size="sm"
                    onClick={() => setLinkParentModalOpen(true)}
                    className="bg-[#5c4a38] text-white hover:bg-[#4a3c2e] h-8 border-0 dark:bg-[#C8A882] dark:hover:bg-[#B89872]"
                  >
                    <UserPlus className="h-4 w-4 mr-1" />
                    Link
                  </Button>
                </CardHeader>
                <CardContent className="space-y-3">
                  {loadingLinkedParents ? (
                    <div className="flex items-center justify-center py-6 text-muted-foreground text-sm gap-2">
                      <LoadingSpinner size="sm" className="text-muted-foreground" />
                      Loading linked parents...
                    </div>
                  ) : linkedParents.length > 0 ? (
                    linkedParents.map((parent) => (
                      <div
                        key={parent.id}
                        className="flex items-center justify-between p-3 rounded-lg bg-muted/50 border border-border hover:bg-muted/70 transition-colors"
                      >
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <div className="h-9 w-9 rounded-full bg-[#5c4a38]/10 dark:bg-[#C8A882]/10 flex items-center justify-center flex-shrink-0">
                            <User className="h-4 w-4 text-[#5c4a38] dark:text-[#C8A882]" />
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
                            <LoadingSpinner size="sm" className="text-destructive" />
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
                        
                        // Validate dueDate is a valid date
                        const isValidDate = !isNaN(dueDate.getTime())
                        const diffMs = isValidDate ? dueDate.getTime() - now.getTime() : NaN
                        const diffDays = isValidDate ? Math.ceil(diffMs / (1000 * 60 * 60 * 24)) : NaN

                        let dueDateText = ''
                        let dueDateColor = 'text-muted-foreground'
                        let badgeVariant: 'outline' | 'destructive' | 'secondary' = 'outline'

                        if (!isValidDate || isNaN(diffDays)) {
                          dueDateText = 'No due date'
                          dueDateColor = 'text-muted-foreground'
                          badgeVariant = 'outline'
                        } else if (diffDays < 0) {
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
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
                  <CardTitle className="text-foreground flex items-center gap-2 text-base">
                    <Users className="h-5 w-5 text-purple-500" />
                    Study Groups
                    {groups.length > 0 && (
                      <Badge variant="secondary" className="text-xs">
                        {groups.length}
                      </Badge>
                    )}
                  </CardTitle>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setAssignGroupModalOpen(true)}
                    className="h-8"
                  >
                    <UserPlus className="h-4 w-4 mr-1" />
                    Assign
                  </Button>
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

      {/* Edit Profile Modal */}
      <Dialog open={editProfileModalOpen} onOpenChange={setEditProfileModalOpen}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Edit className="h-5 w-5 text-primary" />
              Edit Student Profile
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSaveProfile} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-student-name">Full Name *</Label>
              <Input
                id="edit-student-name"
                value={editProfileName}
                onChange={(e) => setEditProfileName(e.target.value)}
                placeholder="Student name"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-student-email">Email *</Label>
              <Input
                id="edit-student-email"
                type="email"
                value={editProfileEmail}
                onChange={(e) => setEditProfileEmail(e.target.value)}
                placeholder="student@example.com"
                required
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="edit-student-grade">Grade</Label>
                <Input
                  id="edit-student-grade"
                  value={editProfileGrade}
                  onChange={(e) => setEditProfileGrade(e.target.value)}
                  placeholder="e.g. 10th Grade"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit-student-phone">Phone</Label>
                <Input
                  id="edit-student-phone"
                  value={editProfilePhone}
                  onChange={(e) => setEditProfilePhone(e.target.value)}
                  placeholder="+1 555 0100"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="edit-parent-name">Parent Name</Label>
                <Input
                  id="edit-parent-name"
                  value={editProfileParentName}
                  onChange={(e) => setEditProfileParentName(e.target.value)}
                  placeholder="Parent or guardian"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit-parent-email">Parent Email</Label>
                <Input
                  id="edit-parent-email"
                  type="email"
                  value={editProfileParentEmail}
                  onChange={(e) => setEditProfileParentEmail(e.target.value)}
                  placeholder="parent@example.com"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-student-notes">Notes</Label>
              <Textarea
                id="edit-student-notes"
                value={editProfileNotes}
                onChange={(e) => setEditProfileNotes(e.target.value)}
                placeholder="Notes about learning preferences or support"
                rows={4}
              />
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditProfileModalOpen(false)}
                disabled={savingProfile}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={savingProfile || !editProfileName.trim() || !editProfileEmail.trim()}
                className="bg-[#5c4a38] text-white hover:bg-[#4a3c2e] border-0 dark:bg-[#C8A882] dark:hover:bg-[#B89872]"
              >
                {savingProfile ? (
                  <>
                    <LoadingSpinner size="sm" className="mr-2 text-white" />
                    Saving...
                  </>
                ) : (
                  'Save Changes'
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

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
                  <LoadingSpinner size="sm" className="text-muted-foreground" />
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
                className="border-[#5c4a38] border-2 text-[#5c4a38] bg-transparent hover:bg-[#5c4a38] hover:text-white dark:border-[#C8A882] dark:text-[#C8A882] dark:hover:bg-[#C8A882] dark:hover:text-white"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={linkingParent || !parentEmail.trim() || !parentName.trim()}
                className="bg-[#5c4a38] text-white hover:bg-[#4a3c2e] disabled:bg-[#5c4a38]/50 border-0 dark:bg-[#C8A882] dark:hover:bg-[#B89872] dark:disabled:bg-[#C8A882]/50"
              >
                {linkingParent ? (
                  <>
                    <LoadingSpinner size="sm" className="mr-2 text-white" />
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

      {/* Assign Group Modal */}
      <Dialog open={assignGroupModalOpen} onOpenChange={setAssignGroupModalOpen}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="h-5 w-5 text-primary" />
              Assign {student?.name} to Group
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleAssignToGroup} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="assign-student-group">Available Groups</Label>
              <Select
                value={selectedGroupId}
                onValueChange={setSelectedGroupId}
                disabled={loadingAllGroups || assigningGroup}
              >
                <SelectTrigger id="assign-student-group">
                  <SelectValue
                    placeholder={loadingAllGroups ? 'Loading groups...' : 'Select a group'}
                  />
                </SelectTrigger>
                <SelectContent>
                  {assignableGroups.map((group) => (
                    <SelectItem key={group.id} value={group.id}>
                      {group.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {!loadingAllGroups && assignableGroups.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No assignable groups available. Create a group or manage memberships from the Groups page.
                </p>
              )}
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setAssignGroupModalOpen(false)}
                disabled={assigningGroup}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={
                  assigningGroup ||
                  loadingAllGroups ||
                  assignableGroups.length === 0 ||
                  !selectedGroupId
                }
                className="bg-[#5c4a38] text-white hover:bg-[#4a3c2e] border-0 dark:bg-[#C8A882] dark:hover:bg-[#B89872]"
              >
                {assigningGroup ? (
                  <>
                    <LoadingSpinner size="sm" className="mr-2 text-white" />
                    Assigning...
                  </>
                ) : (
                  'Assign to Group'
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

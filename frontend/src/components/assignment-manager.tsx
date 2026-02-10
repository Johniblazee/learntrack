import { useState, useEffect, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Plus, Calendar, Users, BookOpen, Clock, CheckCircle, AlertCircle, Edit, Trash2, Eye, Search } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useApiClient } from "@/lib/api-client"
import { toast } from "@/contexts/ToastContext"
import { useSubjects } from "@/hooks/useQueries"

interface Assignment {
  id: string
  title: string
  subject: string
  topic: string
  dueDate: string
  status: 'draft' | 'published' | 'completed'
  studentCount: number
  completedCount: number
  questionCount: number
  averageScore?: number
}

export default function AssignmentManager() {
  const [searchTerm, setSearchTerm] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")
  const [subjectFilter, setSubjectFilter] = useState("all")
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const client = useApiClient()
  const { data: subjectsData } = useSubjects()

  // Get unique subjects from API data
  const subjectOptions = useMemo(() => {
    if (!subjectsData || !Array.isArray(subjectsData)) return []
    return subjectsData.map((s: any) => s.name)
  }, [subjectsData])

  // Fetch assignments from API
  useEffect(() => {
    const fetchAssignments = async () => {
      try {
        setLoading(true)
        setError(null)
        const response = await client.get('/assignments/')
        if (response.error) {
          throw new Error(response.error)
        }
        // Map API response to Assignment interface - API returns paginated response with items array
        const rawData = (response.data?.items as any[]) || (Array.isArray(response.data) ? response.data : [])
        const assignmentsData = rawData.map((assignment: any) => ({
          id: assignment._id,
          title: assignment.title,
          subject: assignment.subject_id?.name || "Unknown",
          topic: assignment.topic || "General",
          dueDate: assignment.due_date ? new Date(assignment.due_date).toISOString().split('T')[0] : "N/A",
          status: assignment.status || 'draft',
          studentCount: assignment.assigned_students?.length || 0,
          completedCount: 0, // TODO: Calculate from progress
          questionCount: assignment.questions?.length || 0,
          averageScore: assignment.average_score || undefined
        }))
        setAssignments(assignmentsData)
      } catch (err: any) {
        console.error('Failed to fetch assignments:', err)
        setError(err.message || 'Failed to load assignments')
        toast.error('Failed to load assignments')
      } finally {
        setLoading(false)
      }
    }

    fetchAssignments()
  }, [])

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'published':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-400'
      case 'completed':
        return 'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400'
      case 'draft':
        return 'bg-gray-100 text-gray-800 dark:bg-gray-900/20 dark:text-gray-400'
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-900/20 dark:text-gray-400'
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'published':
        return <Clock className="w-4 h-4" />
      case 'completed':
        return <CheckCircle className="w-4 h-4" />
      case 'draft':
        return <Edit className="w-4 h-4" />
      default:
        return <AlertCircle className="w-4 h-4" />
    }
  }

  const filteredAssignments = assignments.filter(assignment => {
    const matchesSearch = assignment.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         assignment.subject.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         assignment.topic.toLowerCase().includes(searchTerm.toLowerCase())
    const matchesStatus = statusFilter === "all" || assignment.status === statusFilter
    const matchesSubject = subjectFilter === "all" || assignment.subject === subjectFilter

    return matchesSearch && matchesStatus && matchesSubject
  })

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Assignment Manager</h1>
          <p className="text-gray-600 dark:text-slate-400 mt-1">Create, manage, and track student assignments</p>
        </div>
        <Button className="bg-gradient-to-r from-purple-500 to-purple-600 hover:from-purple-600 hover:to-purple-700 text-white border-0 shadow-lg">
          <Plus className="w-4 h-4 mr-2" />
          Create Assignment
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card className="bg-gradient-to-br from-blue-500 to-blue-600 text-white border-0 shadow-lg">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-blue-100 text-sm font-medium">Total Assignments</p>
                <p className="text-3xl font-bold">{assignments.length}</p>
              </div>
              <BookOpen className="w-8 h-8 text-blue-200" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-green-500 to-green-600 text-white border-0 shadow-lg">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-green-100 text-sm font-medium">Active</p>
                <p className="text-3xl font-bold">{assignments.filter(a => a.status === 'published').length}</p>
              </div>
              <Clock className="w-8 h-8 text-green-200" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-orange-500 to-orange-600 text-white border-0 shadow-lg">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-orange-100 text-sm font-medium">Completed</p>
                <p className="text-3xl font-bold">{assignments.filter(a => a.status === 'completed').length}</p>
              </div>
              <CheckCircle className="w-8 h-8 text-orange-200" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-purple-500 to-purple-600 text-white border-0 shadow-lg">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-purple-100 text-sm font-medium">Avg. Score</p>
                <p className="text-3xl font-bold">
                  {Math.round(assignments.filter(a => a.averageScore).reduce((acc, a) => acc + (a.averageScore || 0), 0) / assignments.filter(a => a.averageScore).length)}%
                </p>
              </div>
              <Users className="w-8 h-8 text-purple-200" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters and Search */}
      <Card className="shadow-lg">
        <CardContent className="p-6">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                <Input
                  placeholder="Search assignments..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full md:w-[180px]">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="published">Published</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
              </SelectContent>
            </Select>
            <Select value={subjectFilter} onValueChange={setSubjectFilter}>
              <SelectTrigger className="w-full md:w-[180px]">
                <SelectValue placeholder="Filter by subject" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Subjects</SelectItem>
                {subjectOptions.map((subject: string) => (
                  <SelectItem key={subject} value={subject}>{subject}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Assignments List */}
      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle className="flex items-center">
            <BookOpen className="w-5 h-5 mr-2 text-primary" />
            Assignments ({filteredAssignments.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            // Loading skeleton
            <div className="space-y-4">
              {Array.from({ length: 3 }).map((_, index) => (
                <div key={index} className="p-4 bg-muted rounded-lg animate-pulse">
                  <div className="space-y-3">
                    <div className="h-4 bg-muted-foreground/20 rounded w-1/3"></div>
                    <div className="h-3 bg-muted-foreground/20 rounded w-1/2"></div>
                    <div className="h-3 bg-muted-foreground/20 rounded w-3/4"></div>
                  </div>
                </div>
              ))}
            </div>
          ) : error ? (
            // Error state
            <div className="text-center py-12">
              <p className="text-red-600 dark:text-red-400 mb-4">{error}</p>
              <Button onClick={() => window.location.reload()}>Retry</Button>
            </div>
          ) : filteredAssignments.length === 0 ? (
            // Empty state
            <div className="text-center py-12">
              <BookOpen className="w-16 h-16 mx-auto text-gray-400 mb-4" />
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">No assignments found</h3>
              <p className="text-gray-600 dark:text-slate-400 mb-4">
                {searchTerm || statusFilter !== "all" || subjectFilter !== "all"
                  ? "Try adjusting your filters"
                  : "Get started by creating your first assignment"}
              </p>
              <Button>
                <Plus className="w-4 h-4 mr-2" />
                Create Assignment
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              {filteredAssignments.map((assignment) => (
              <div key={assignment.id} className="p-4 bg-card border border-border rounded-lg hover:bg-sidebar-accent hover:text-sidebar-accent-foreground hover:shadow-md transition-all duration-200 cursor-pointer">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="font-semibold text-gray-900 dark:text-white">{assignment.title}</h3>
                      <Badge className={`border-0 ${getStatusColor(assignment.status)}`}>
                        <div className="flex items-center gap-1">
                          {getStatusIcon(assignment.status)}
                          {assignment.status}
                        </div>
                      </Badge>
                    </div>
                    <div className="flex items-center gap-4 text-sm text-gray-600 dark:text-slate-400 mb-3">
                      <span className="flex items-center gap-1">
                        <BookOpen className="w-4 h-4" />
                        {assignment.subject} - {assignment.topic}
                      </span>
                      <span className="flex items-center gap-1">
                        <Calendar className="w-4 h-4" />
                        Due: {new Date(assignment.dueDate).toLocaleDateString()}
                      </span>
                      <span className="flex items-center gap-1">
                        <Users className="w-4 h-4" />
                        {assignment.studentCount} students
                      </span>
                    </div>

                    {assignment.status === 'published' && (
                      <div className="mb-3">
                        <div className="flex items-center justify-between text-sm mb-1">
                          <span className="text-gray-600 dark:text-slate-400">
                            Progress: {assignment.completedCount}/{assignment.studentCount} completed
                          </span>
                          <span className="text-gray-600 dark:text-slate-400">
                            {Math.round((assignment.completedCount / assignment.studentCount) * 100)}%
                          </span>
                        </div>
                        <Progress value={(assignment.completedCount / assignment.studentCount) * 100} className="h-2" />
                      </div>
                    )}

                    {assignment.averageScore && (
                      <div className="text-sm text-gray-600 dark:text-slate-400">
                        Average Score: <span className="font-semibold text-green-600">{assignment.averageScore}%</span>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2 ml-4">
                    <Button variant="outline" size="sm" className="hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-all duration-200">
                      <Eye className="w-4 h-4" />
                    </Button>
                    <Button variant="outline" size="sm" className="hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-all duration-200">
                      <Edit className="w-4 h-4" />
                    </Button>
                    <Button variant="outline" size="sm" className="hover:bg-destructive hover:text-destructive-foreground transition-all duration-200 text-destructive">
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

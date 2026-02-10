import { useState, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Skeleton } from "@/components/ui/skeleton"
import { Plus, BookOpen, Users, FileText, Target, Search, Edit, Trash2, Eye, Tag, TrendingUp } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useSubjects, useTopics } from "@/hooks/useQueries"

interface Subject {
  id: string
  name: string
  description: string
  color: string
  topics: string[]
  studentCount: number
  questionCount: number
  assignmentCount: number
  averageScore: number
  isActive: boolean
  createdDate: string
  lastUpdated: string
}

interface Topic {
  id: string
  name: string
  subjectId: string
  questionCount: number
  assignmentCount: number
  difficulty: 'beginner' | 'intermediate' | 'advanced'
  completionRate: number
}

// Color palette for subjects
const subjectColors = [
  'bg-blue-500',
  'bg-green-500',
  'bg-purple-500',
  'bg-orange-500',
  'bg-red-500',
  'bg-pink-500',
  'bg-indigo-500',
  'bg-teal-500',
]

export default function IntegratedSubjectsManager() {
  const [searchTerm, setSearchTerm] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")
  const [activeTab, setActiveTab] = useState("subjects")

  // Fetch subjects from API
  const { data: subjectsData, isLoading: subjectsLoading } = useSubjects()
  const { data: topicsData, isLoading: topicsLoading } = useTopics()

  // Transform API data to component format
  const subjects: Subject[] = useMemo(() => {
    if (!subjectsData || !Array.isArray(subjectsData)) return []

    return subjectsData.map((subject: any, index: number) => ({
      id: subject.id || subject._id,
      name: subject.name || 'Unnamed Subject',
      description: subject.description || '',
      color: subjectColors[index % subjectColors.length],
      topics: subject.topics || [],
      studentCount: subject.student_count || 0,
      questionCount: subject.question_count || 0,
      assignmentCount: subject.assignment_count || 0,
      averageScore: subject.average_score || 0,
      isActive: subject.is_active !== false,
      createdDate: subject.created_at ? new Date(subject.created_at).toISOString().split('T')[0] : '',
      lastUpdated: subject.updated_at ? new Date(subject.updated_at).toISOString().split('T')[0] : ''
    }))
  }, [subjectsData])

  // Transform topics data
  const topics: Topic[] = useMemo(() => {
    if (!topicsData || !Array.isArray(topicsData)) return []

    return topicsData.map((topic: any) => ({
      id: topic.id || topic._id,
      name: topic.name || 'Unnamed Topic',
      subjectId: topic.subject_id || '',
      questionCount: topic.question_count || 0,
      assignmentCount: topic.assignment_count || 0,
      difficulty: topic.difficulty || 'intermediate',
      completionRate: topic.completion_rate || 0
    }))
  }, [topicsData])

  const getDifficultyColor = (difficulty: string) => {
    switch (difficulty) {
      case 'beginner':
        return 'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400'
      case 'intermediate':
        return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-400'
      case 'advanced':
        return 'bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400'
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-900/20 dark:text-gray-400'
    }
  }

  const filteredSubjects = subjects.filter(subject => {
    const matchesSearch = subject.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         subject.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         subject.topics.some(topic => topic.toLowerCase().includes(searchTerm.toLowerCase()))
    const matchesStatus = statusFilter === "all" ||
                         (statusFilter === "active" && subject.isActive) ||
                         (statusFilter === "inactive" && !subject.isActive)

    return matchesSearch && matchesStatus
  })

  const filteredTopics = topics.filter(topic => {
    const subject = subjects.find(s => s.id === topic.subjectId)
    const matchesSearch = topic.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         (subject && subject.name.toLowerCase().includes(searchTerm.toLowerCase()))
    return matchesSearch
  })

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Subjects Manager</h1>
          <p className="text-muted-foreground mt-1">Organize subjects, topics, and educational content</p>
        </div>
        <Button className="bg-primary text-primary-foreground hover:bg-primary/90">
          <Plus className="w-4 h-4 mr-2" />
          Add Subject
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card className="bg-card border border-border shadow-sm">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-muted-foreground text-sm font-medium">Total Subjects</p>
                <p className="text-3xl font-bold text-foreground">{subjects.length}</p>
              </div>
              <div className="p-3 bg-primary/10 rounded-lg">
                <BookOpen className="w-6 h-6 text-primary" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border border-border shadow-sm">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-muted-foreground text-sm font-medium">Active Subjects</p>
                <p className="text-3xl font-bold text-foreground">{subjects.filter(s => s.isActive).length}</p>
              </div>
              <div className="p-3 bg-green-500/10 rounded-lg">
                <Target className="w-6 h-6 text-green-600 dark:text-green-400" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border border-border shadow-sm">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-muted-foreground text-sm font-medium">Total Topics</p>
                <p className="text-3xl font-bold text-foreground">{topics.length}</p>
              </div>
              <div className="p-3 bg-accent/30 rounded-lg">
                <Tag className="w-6 h-6 text-accent-foreground" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border border-border shadow-sm">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-muted-foreground text-sm font-medium">Total Questions</p>
                <p className="text-3xl font-bold text-foreground">{subjects.reduce((acc, s) => acc + s.questionCount, 0)}</p>
              </div>
              <div className="p-3 bg-primary/10 rounded-lg">
                <FileText className="w-6 h-6 text-primary" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs for Subjects and Topics */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="subjects">Subjects</TabsTrigger>
          <TabsTrigger value="topics">Topics</TabsTrigger>
        </TabsList>

        {/* Subjects Tab */}
        <TabsContent value="subjects" className="space-y-6">
          {/* Filters and Search */}
          <Card className="shadow-sm border border-border bg-card">
            <CardContent className="p-6">
              <div className="flex flex-col md:flex-row gap-4">
                <div className="flex-1">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
                    <Input
                      placeholder="Search subjects..."
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
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {/* Subjects List */}
          <Card className="shadow-sm border border-border bg-card">
            <CardHeader>
              <CardTitle className="flex items-center">
                <BookOpen className="w-5 h-5 mr-2 text-primary" />
                Subjects ({subjectsLoading ? '...' : filteredSubjects.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {subjectsLoading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {Array.from({ length: 6 }).map((_, index) => (
                    <Card key={index} className="border border-border bg-muted/30">
                      <CardContent className="p-6">
                        <div className="flex items-start justify-between mb-4">
                          <div className="flex items-center gap-3">
                            <Skeleton className="w-4 h-4 rounded-full" />
                            <Skeleton className="h-5 w-24" />
                          </div>
                          <Skeleton className="h-5 w-16" />
                        </div>
                        <Skeleton className="h-4 w-full mb-2" />
                        <Skeleton className="h-4 w-3/4 mb-4" />
                        <div className="space-y-3">
                          <Skeleton className="h-4 w-full" />
                          <Skeleton className="h-4 w-full" />
                          <Skeleton className="h-4 w-full" />
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              ) : filteredSubjects.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <BookOpen className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p className="text-lg font-medium">No subjects found</p>
                  <p className="text-sm mt-1">Create your first subject to get started</p>
                </div>
              ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {filteredSubjects.map((subject) => (
                  <Card key={subject.id} className="hover:shadow-lg transition-all duration-200 border border-border bg-muted/30">
                    <CardContent className="p-6">
                      <div className="flex items-start justify-between mb-4">
                        <div className="flex items-center gap-3">
                          <div className={`w-4 h-4 rounded-full ${subject.color}`}></div>
                          <h3 className="font-semibold text-foreground">{subject.name}</h3>
                        </div>
                        <Badge className={subject.isActive ? 'bg-green-500/10 text-green-600 dark:text-green-400 border-0' : 'bg-red-500/10 text-red-600 dark:text-red-400 border-0'}>
                          {subject.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                      </div>

                      <p className="text-sm text-muted-foreground mb-4 line-clamp-2">
                        {subject.description}
                      </p>

                      <div className="space-y-3 mb-4">
                        <div className="flex items-center justify-between text-sm">
                          <span className="flex items-center gap-2 text-muted-foreground">
                            <Users className="w-4 h-4" />
                            Students
                          </span>
                          <span className="font-semibold text-foreground">{subject.studentCount}</span>
                        </div>
                        <div className="flex items-center justify-between text-sm">
                          <span className="flex items-center gap-2 text-muted-foreground">
                            <FileText className="w-4 h-4" />
                            Questions
                          </span>
                          <span className="font-semibold text-foreground">{subject.questionCount}</span>
                        </div>
                        <div className="flex items-center justify-between text-sm">
                          <span className="flex items-center gap-2 text-muted-foreground">
                            <Target className="w-4 h-4" />
                            Avg. Score
                          </span>
                          <span className="font-semibold text-green-600 dark:text-green-400">{subject.averageScore}%</span>
                        </div>
                      </div>

                      <div className="mb-4">
                        <p className="text-xs text-muted-foreground mb-2">Topics ({subject.topics.length})</p>
                        <div className="flex flex-wrap gap-1">
                          {subject.topics.slice(0, 3).map((topic, index) => (
                            <Badge key={index} variant="outline" className="text-xs">
                              {topic}
                            </Badge>
                          ))}
                          {subject.topics.length > 3 && (
                            <Badge variant="outline" className="text-xs">
                              +{subject.topics.length - 3} more
                            </Badge>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <Button variant="outline" size="sm" className="flex-1 hover:bg-accent/50">
                          <Eye className="w-4 h-4 mr-1" />
                          View
                        </Button>
                        <Button variant="outline" size="sm" className="hover:bg-accent/50">
                          <Edit className="w-4 h-4" />
                        </Button>
                        <Button variant="outline" size="sm" className="hover:bg-destructive/10 text-destructive">
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Topics Tab */}
        <TabsContent value="topics" className="space-y-6">
          {/* Topics Search */}
          <Card className="shadow-sm border border-border bg-card">
            <CardContent className="p-6">
              <div className="flex flex-col md:flex-row gap-4">
                <div className="flex-1">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
                    <Input
                      placeholder="Search topics..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-10"
                    />
                  </div>
                </div>
                <Button className="bg-primary text-primary-foreground hover:bg-primary/90">
                  <Plus className="w-4 h-4 mr-2" />
                  Add Topic
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Topics List */}
          <Card className="shadow-sm border border-border bg-card">
            <CardHeader>
              <CardTitle className="flex items-center">
                <Tag className="w-5 h-5 mr-2 text-primary" />
                Topics ({topicsLoading ? '...' : filteredTopics.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {topicsLoading ? (
                <div className="space-y-4">
                  {Array.from({ length: 4 }).map((_, index) => (
                    <div key={index} className="p-4 bg-muted/30 rounded-lg border border-border">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-2">
                            <Skeleton className="h-5 w-32" />
                            <Skeleton className="h-5 w-20" />
                          </div>
                          <div className="grid grid-cols-3 gap-4 mb-3">
                            <Skeleton className="h-4 w-24" />
                            <Skeleton className="h-4 w-24" />
                            <Skeleton className="h-4 w-24" />
                          </div>
                          <Skeleton className="h-2 w-full" />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : filteredTopics.length === 0 ? (
                <div className="text-center py-8">
                  <Tag className="w-12 h-12 text-muted-foreground/50 mx-auto mb-4" />
                  <p className="text-muted-foreground">No topics found</p>
                  <p className="text-sm text-muted-foreground mt-1">Create topics within your subjects</p>
                </div>
              ) : (
              <div className="space-y-4">
                {filteredTopics.map((topic) => {
                  const subject = subjects.find(s => s.id === topic.subjectId)
                  return (
                    <div key={topic.id} className="p-4 bg-muted/30 rounded-lg border border-border hover:shadow-md transition-all duration-200">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-2">
                            <h3 className="font-semibold text-foreground">{topic.name}</h3>
                            <Badge className={getDifficultyColor(topic.difficulty)}>
                              {topic.difficulty}
                            </Badge>
                            {subject && (
                              <Badge variant="outline" className="text-xs">
                                {subject.name}
                              </Badge>
                            )}
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm text-muted-foreground mb-3">
                            <div className="flex items-center gap-2">
                              <FileText className="w-4 h-4" />
                              {topic.questionCount} questions
                            </div>
                            <div className="flex items-center gap-2">
                              <BookOpen className="w-4 h-4" />
                              {topic.assignmentCount} assignments
                            </div>
                            <div className="flex items-center gap-2">
                              <TrendingUp className="w-4 h-4" />
                              {topic.completionRate}% completion rate
                            </div>
                          </div>

                          <div className="mb-3">
                            <div className="flex items-center justify-between text-sm mb-1">
                              <span className="text-muted-foreground">Completion Progress</span>
                              <span className="text-muted-foreground">{topic.completionRate}%</span>
                            </div>
                            <Progress value={topic.completionRate} className="h-2" />
                          </div>
                        </div>

                        <div className="flex items-center gap-2 ml-4">
                          <Button variant="outline" size="sm" className="hover:bg-accent/50">
                            <Eye className="w-4 h-4" />
                          </Button>
                          <Button variant="outline" size="sm" className="hover:bg-accent/50">
                            <Edit className="w-4 h-4" />
                          </Button>
                          <Button variant="outline" size="sm" className="hover:bg-destructive/10 text-destructive">
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}

"use client"

import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { ArrowLeft, BookOpen, Clock, CheckCircle, Star, Calendar, Trophy, Target } from "lucide-react"
import { toast } from "@/contexts/ToastContext"


import { ThemeToggle } from '@/components/ui/theme-toggle'
import { Skeleton } from '@/components/ui/skeleton'
import { useMyAssignments, useStudentDashboardStats, useStudentProgressAnalytics } from '@/hooks/useQueries'
import { useUser } from '@clerk/clerk-react'

interface StudentDashboardProps {
  onBack?: () => void
}

interface Assignment {
  id: string
  title: string
  subject: string
  topic: string
  dueDate: Date
  questionCount: number
  completedQuestions: number
  status: "pending" | "in-progress" | "completed"
  score?: number
}

interface Question {
  id: string
  question: string
  type: "multiple-choice" | "short-answer"
  options?: string[]
  userAnswer?: string
  isCorrect?: boolean
}

export default function StudentDashboard({ onBack }: StudentDashboardProps) {
  // Get user info from Clerk
  const { user } = useUser()
  const studentName = user?.fullName || user?.firstName || "Student"

  // Use React Query for assignments
  const { data: assignments = [], isLoading: loading } = useMyAssignments()

  // Fetch dashboard stats
  const { data: dashboardStats, isLoading: statsLoading } = useStudentDashboardStats()

  // Fetch progress analytics
  const { data: progressAnalytics, isLoading: analyticsLoading } = useStudentProgressAnalytics()

  // All assignments now come from API
  const displayAssignments = assignments as Assignment[]

  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0)
  const [selectedAnswer, setSelectedAnswer] = useState("")
  const [showingQuestion, setShowingQuestion] = useState(false)

  // Placeholder function for submitting an answer
  const submitAnswer = () => {
    handleNextQuestion();
  };

  // Questions should come from backend; empty default here
  const activeAssignmentQuestions: Question[] = []

  const startAssignment = (assignmentId: string) => {
    // Assignment runner flow will be connected to backend assignment questions.
    // Keep this state-safe while surfacing intent to the user.
    if (!assignmentId || activeAssignmentQuestions.length === 0) {
      toast.info('Assignment workspace is coming soon')
      return
    }
    setShowingQuestion(true)
    setCurrentQuestionIndex(0)
  }

  const handleNextQuestion = () => {
    if (currentQuestionIndex < activeAssignmentQuestions.length - 1) {
      setCurrentQuestionIndex(currentQuestionIndex + 1)
    } else {
      // End of assignment
      setShowingQuestion(false)
      toast.success("Assignment submitted successfully!")
    }
  }

  const currentQuestion = activeAssignmentQuestions[currentQuestionIndex]

  if (showingQuestion) {
    return (
      <div className="min-h-screen bg-background text-foreground p-4">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <Button variant="ghost" onClick={() => setShowingQuestion(false)}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Dashboard
            </Button>
            <div className="text-sm text-gray-500">Question 8 of 10</div>
          </div>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Algebra Practice Set 1</CardTitle>
                  <CardDescription>Mathematics • Algebra</CardDescription>
                </div>
                <Badge variant="outline">Due: Dec 25</Badge>
              </div>
              <Progress value={70} className="mt-4" />
              <p className="text-sm text-gray-600">7 of 10 questions completed</p>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <h3 className="text-lg font-semibold mb-4">{currentQuestion.question}</h3>

                {currentQuestion.type === "multiple-choice" && currentQuestion.options && (
                  <RadioGroup value={selectedAnswer} onValueChange={setSelectedAnswer}>
                    <div className="space-y-3">
                      {currentQuestion.options.map((option, index) => (
                        <div key={index} className="flex items-center space-x-2">
                          <RadioGroupItem value={option} id={`option-${index}`} />
                          <Label htmlFor={`option-${index}`} className="text-base">
                            {option}
                          </Label>
                        </div>
                      ))}
                    </div>
                  </RadioGroup>
                )}

                {currentQuestion.type === "short-answer" && (
                  <Textarea
                    placeholder="Enter your answer here..."
                    value={selectedAnswer}
                    onChange={(e) => setSelectedAnswer(e.target.value)}
                    rows={4}
                  />
                )}
              </div>

              <div className="flex justify-between">
                <Button variant="outline" onClick={() => alert("Going to the previous question is not yet implemented.")}>Previous Question</Button>
                <Button onClick={submitAnswer} disabled={!selectedAnswer}>
                  Next Question
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-blue-50/30 dark:from-gray-900 dark:via-gray-800 dark:to-slate-900">
      {/* Header */}
      <div className="bg-white dark:bg-slate-900 shadow-sm border-b border-gray-200 dark:border-slate-700 p-4 sm:p-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center w-full sm:w-auto">
            {onBack && (
              <Button variant="ghost" onClick={onBack} className="mr-2 sm:mr-4">
                <ArrowLeft className="h-4 w-4 mr-2" />
                <span className="hidden sm:inline">Back</span>
              </Button>
            )}
            <div className="flex-1 min-w-0">
              <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-gray-900 dark:text-white truncate">Student Dashboard</h1>
              <p className="text-sm sm:text-base text-gray-600 dark:text-slate-400 mt-1 hidden sm:block">Welcome back, {studentName}! Ready to learn?</p>
            </div>
          </div>
          <div className="flex items-center space-x-3 sm:space-x-4 w-full sm:w-auto justify-end">
            <ThemeToggle />
            <div className="text-right">
              <p className="text-xs sm:text-sm font-medium text-gray-900 dark:text-white">{studentName}</p>
              <p className="text-xs text-gray-600 dark:text-slate-400">Student</p>
            </div>
          </div>
        </div>
      </div>

      <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
        {/* Stats Overview Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {/* Overall Average Card */}
          <Card className="bg-gradient-to-br from-purple-500 to-purple-600 text-white border-0 shadow-lg">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-purple-100 text-sm font-medium">Overall Average</p>
                  <p className="text-3xl font-bold">
                    {statsLoading ? (
                      <Skeleton className="h-9 w-16" />
                    ) : (
                      `${dashboardStats?.overall_average || 0}%`
                    )}
                  </p>
                  <p className="text-purple-100 text-xs mt-1">
                    Grade: {dashboardStats?.current_grade || '--'}
                  </p>
                </div>
                <Target className="w-8 h-8 text-purple-200" />
              </div>
            </CardContent>
          </Card>

          {/* Completed Assignments Card */}
          <Card className="bg-gradient-to-br from-green-500 to-green-600 text-white border-0 shadow-lg">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-green-100 text-sm font-medium">Completed</p>
                  <p className="text-3xl font-bold">
                    {statsLoading ? (
                      <Skeleton className="h-9 w-12" />
                    ) : (
                      dashboardStats?.completed || 0
                    )}
                  </p>
                  <p className="text-green-100 text-xs mt-1">assignments</p>
                </div>
                <CheckCircle className="w-8 h-8 text-green-200" />
              </div>
            </CardContent>
          </Card>

          {/* Pending Tasks Card */}
          <Card className="bg-gradient-to-br from-orange-500 to-orange-600 text-white border-0 shadow-lg">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-orange-100 text-sm font-medium">Pending</p>
                  <p className="text-3xl font-bold">
                    {statsLoading ? (
                      <Skeleton className="h-9 w-10" />
                    ) : (
                      dashboardStats?.pending || 0
                    )}
                  </p>
                  <p className="text-orange-100 text-xs mt-1">tasks due</p>
                </div>
                <Clock className="w-8 h-8 text-orange-200" />
              </div>
            </CardContent>
          </Card>

          {/* Total Assignments Card */}
          <Card className="bg-gradient-to-br from-blue-500 to-blue-600 text-white border-0 shadow-lg">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-blue-100 text-sm font-medium">Total Assignments</p>
                  <p className="text-3xl font-bold">
                    {statsLoading ? (
                      <Skeleton className="h-9 w-12" />
                    ) : (
                      dashboardStats?.total_assignments || 0
                    )}
                  </p>
                  <p className="text-blue-100 text-xs mt-1">all time</p>
                </div>
                <BookOpen className="w-8 h-8 text-blue-200" />
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column - Main Content */}
          <div className="lg:col-span-2 space-y-6">
            {/* Upcoming Assignments */}
            <Card className="shadow-lg border-0">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-xl font-bold text-gray-900 dark:text-white">Upcoming Assignments</CardTitle>
                  <Button variant="outline" size="sm">View All</Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {loading ? (
                    // Loading skeleton
                    Array.from({ length: 3 }).map((_, index) => (
                      <div key={index} className="p-4 bg-gray-50 dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700">
                        <div className="flex items-center justify-between mb-3">
                          <div className="space-y-2">
                            <Skeleton className="h-5 w-32" />
                            <Skeleton className="h-4 w-24" />
                          </div>
                          <Skeleton className="h-6 w-16" />
                        </div>
                        <Skeleton className="h-8 w-full mt-3" />
                      </div>
                    ))
                  ) : displayAssignments.length === 0 ? (
                    <div className="text-center py-8 text-gray-500 dark:text-slate-400">
                      <BookOpen className="w-12 h-12 mx-auto mb-3 opacity-50" />
                      <p>No assignments yet</p>
                      <p className="text-sm">Your assignments will appear here</p>
                    </div>
                  ) : (
                    displayAssignments.slice(0, 5).map((assignment) => {
                      const dueDate = new Date(assignment.dueDate)
                      const now = new Date()
                      const isToday = dueDate.toDateString() === now.toDateString()
                      const isTomorrow = dueDate.toDateString() === new Date(now.getTime() + 86400000).toDateString()
                      const dueDateLabel = isToday ? 'Today' : isTomorrow ? 'Tomorrow' : dueDate.toLocaleDateString()
                      const progress = assignment.questionCount > 0
                        ? Math.round((assignment.completedQuestions / assignment.questionCount) * 100)
                        : 0

                      return (
                        <div key={assignment.id} className="p-4 bg-gray-50 dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700">
                          <div className="flex items-center justify-between mb-3">
                            <div>
                              <h3 className="font-semibold text-gray-900 dark:text-white">{assignment.title}</h3>
                              <p className="text-sm text-gray-600 dark:text-slate-400">{assignment.subject}</p>
                            </div>
                            <div className="text-right">
                              <Badge
                                variant={isToday ? 'destructive' : isTomorrow ? 'default' : 'secondary'}
                                className="mb-1"
                              >
                                {dueDateLabel}
                              </Badge>
                              <p className="text-xs text-gray-500 dark:text-slate-500">
                                {assignment.questionCount} questions
                              </p>
                            </div>
                          </div>
                          {progress > 0 && (
                            <div className="space-y-1">
                              <div className="flex justify-between text-sm">
                                <span className="text-gray-600 dark:text-slate-400">Progress</span>
                                <span className="text-gray-900 dark:text-white">{progress}%</span>
                              </div>
                              <Progress value={progress} className="h-2" />
                            </div>
                          )}
                          <div className="flex justify-between items-center mt-3">
                            <Badge
                              variant={assignment.status === 'pending' ? 'outline' : assignment.status === 'completed' ? 'default' : 'secondary'}
                              className="text-xs"
                            >
                              {assignment.status === 'pending' ? 'Not Started' : assignment.status === 'completed' ? 'Completed' : 'In Progress'}
                            </Badge>
                            <Button size="sm" variant="outline" onClick={() => startAssignment(assignment.id)}>
                              {assignment.status === 'pending' ? 'Start' : assignment.status === 'completed' ? 'Review' : 'Continue'}
                            </Button>
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Subject Progress */}
            <Card className="shadow-lg border-0">
              <CardHeader>
                <CardTitle className="text-lg font-semibold">Subject Progress</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {analyticsLoading ? (
                    // Loading skeleton
                    Array.from({ length: 3 }).map((_, index) => (
                      <div key={index} className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Skeleton className="h-5 w-24" />
                          <Skeleton className="h-5 w-16" />
                        </div>
                        <Skeleton className="h-2 w-full" />
                      </div>
                    ))
                  ) : !progressAnalytics?.subject_performance?.length ? (
                    <div className="text-center py-6 text-gray-500 dark:text-slate-400">
                      <Target className="w-10 h-10 mx-auto mb-2 opacity-50" />
                      <p className="text-sm">No subject data yet</p>
                    </div>
                  ) : (
                    progressAnalytics.subject_performance.map((subject, index) => {
                      const colors = ['bg-blue-500', 'bg-green-500', 'bg-primary', 'bg-orange-500', 'bg-pink-500']
                      const color = colors[index % colors.length]
                      const grade = subject.score >= 90 ? 'A' : subject.score >= 85 ? 'A-' : subject.score >= 80 ? 'B+' : subject.score >= 75 ? 'B' : 'C'

                      return (
                        <div key={index} className="space-y-2">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center space-x-3">
                              <div className={`w-3 h-3 rounded-full ${color}`}></div>
                              <span className="font-medium text-gray-900 dark:text-white">{subject.subject}</span>
                            </div>
                            <div className="flex items-center space-x-2">
                              <Badge variant="outline" className="text-xs">{grade}</Badge>
                              <span className="text-sm text-gray-600 dark:text-slate-400">{subject.score}%</span>
                            </div>
                          </div>
                          <Progress value={subject.score} className="h-2" />
                        </div>
                      )
                    })
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Right Sidebar */}
          <div className="space-y-6">
            {/* Recent Achievements */}
            <Card className="shadow-lg border-0 bg-white dark:bg-slate-900">
              <CardHeader>
                <CardTitle className="text-lg font-semibold flex items-center">
                  <Trophy className="w-5 h-5 mr-2 text-yellow-500" />
                  Recent Achievements
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-center py-6 text-gray-500 dark:text-slate-400">
                  <Trophy className="w-10 h-10 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No achievements yet</p>
                  <p className="text-xs mt-1">Complete assignments to earn achievements!</p>
                </div>
              </CardContent>
            </Card>

            {/* Recent Grades */}
            <Card className="shadow-lg border-0 bg-white dark:bg-slate-900">
              <CardHeader>
                <CardTitle className="text-lg font-semibold flex items-center">
                  <Target className="w-5 h-5 mr-2 text-blue-600" />
                  Recent Grades
                </CardTitle>
              </CardHeader>
              <CardContent>
                {analyticsLoading ? (
                  <div className="space-y-3">
                    {Array.from({ length: 3 }).map((_, index) => (
                      <div key={index} className="flex items-center justify-between p-3 bg-muted rounded-lg">
                        <div className="space-y-1">
                          <Skeleton className="h-4 w-24" />
                          <Skeleton className="h-3 w-16" />
                        </div>
                        <Skeleton className="h-6 w-10" />
                      </div>
                    ))}
                  </div>
                ) : !progressAnalytics?.recent_submissions?.length ? (
                  <div className="text-center py-6 text-gray-500 dark:text-slate-400">
                    <Target className="w-10 h-10 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">No grades yet</p>
                    <p className="text-xs mt-1">Complete assignments to see your grades</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {progressAnalytics.recent_submissions.slice(0, 4).map((submission: any, index: number) => {
                      const score = submission.score || 0
                      const grade = score >= 90 ? 'A' : score >= 85 ? 'A-' : score >= 80 ? 'B+' : score >= 75 ? 'B' : score >= 70 ? 'B-' : 'C'
                      const colorClass = score >= 85
                        ? 'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400'
                        : score >= 75
                        ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-400'
                        : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-400'

                      return (
                        <div key={index} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-slate-800 rounded-lg hover:shadow-md transition-all duration-200">
                          <div className="flex-1">
                            <p className="font-semibold text-gray-900 dark:text-white text-sm">{submission.assignment_title || 'Assignment'}</p>
                            <p className="text-xs text-gray-600 dark:text-slate-400">{submission.subject || 'Subject'}</p>
                          </div>
                          <div className="text-right">
                            <Badge className={`mb-1 border-0 ${colorClass}`}>
                              {grade}
                            </Badge>
                            <p className="text-xs text-gray-500 dark:text-slate-500 font-medium">{score}%</p>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Quick Actions */}
            <Card className="shadow-lg border-0 bg-white dark:bg-slate-900">
              <CardHeader>
                <CardTitle className="text-lg font-semibold flex items-center">
                  <Star className="w-5 h-5 mr-2 text-purple-600" />
                  Quick Actions
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button className="w-full justify-start bg-gradient-to-r from-purple-500 to-purple-600 hover:from-purple-600 hover:to-purple-700 text-white border-0 shadow-md hover:shadow-lg transition-all duration-200">
                  <BookOpen className="w-4 h-4 mr-2" />
                  Start Study Session
                </Button>
                <Button variant="outline" className="w-full justify-start hover:bg-gray-50 dark:hover:bg-slate-800 transition-all duration-200">
                  <Calendar className="w-4 h-4 mr-2" />
                  View Schedule
                </Button>
                <Button variant="outline" className="w-full justify-start hover:bg-gray-50 dark:hover:bg-slate-800 transition-all duration-200">
                  <Trophy className="w-4 h-4 mr-2" />
                  View Achievements
                </Button>
                <Button variant="outline" className="w-full justify-start hover:bg-gray-50 dark:hover:bg-slate-800 transition-all duration-200">
                  <Target className="w-4 h-4 mr-2" />
                  Set Goals
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}

"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Heart, Users, BookOpen, TrendingUp } from "lucide-react"
import { useUser } from "@clerk/clerk-react"
import { useParentProgress } from "@/hooks/useQueries"

export default function ParentDashboard() {
  const { user } = useUser()
  const parentName = user?.fullName || user?.firstName || "Parent"
  
  // Fetch parent's children progress
  const { data: progressData, isLoading } = useParentProgress()
  const children = progressData?.children || []

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <div className="p-3 bg-primary/10 rounded-full">
            <Heart className="w-8 h-8 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-foreground">Welcome, {parentName}!</h1>
            <p className="text-muted-foreground">Monitor your children's learning progress</p>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Children</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{children.length}</div>
              <p className="text-xs text-muted-foreground">Linked students</p>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Assignments</CardTitle>
              <BookOpen className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {isLoading ? "..." : progressData?.total_assignments || 0}
              </div>
              <p className="text-xs text-muted-foreground">Active assignments</p>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Overall Progress</CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {isLoading ? "..." : `${progressData?.average_progress || 0}%`}
              </div>
              <p className="text-xs text-muted-foreground">Average completion</p>
            </CardContent>
          </Card>
        </div>

        {/* Children List */}
        <Card>
          <CardHeader>
            <CardTitle>Your Children</CardTitle>
            <CardDescription>View learning progress for each child</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              </div>
            ) : children.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Users className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>No children linked yet</p>
                <p className="text-sm">Ask your child's tutor to link your account</p>
              </div>
            ) : (
              <div className="space-y-4">
                {children.map((child: any) => (
                  <div key={child.id} className="flex items-center justify-between p-4 border rounded-lg">
                    <div>
                      <h3 className="font-medium">{child.name}</h3>
                      <p className="text-sm text-muted-foreground">{child.email}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-medium">{child.progress || 0}%</p>
                      <p className="text-xs text-muted-foreground">Progress</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}


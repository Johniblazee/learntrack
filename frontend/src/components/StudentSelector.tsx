/**
 * StudentSelector Component
 * Multi-select interface for selecting individual students
 * Used in assignment creation to assign to specific students
 */

import { useState, useEffect } from 'react'
import { useApiClient } from "@/lib/api-client"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Search, Users, AlertCircle } from "lucide-react"

interface Student {
  _id?: string
  clerk_id?: string | null
  name: string
  email: string
  avatar?: string
  subject_ids?: string[]
  account_status?: 'provisioned' | 'invited' | 'claimed' | null
}

interface StudentSelectorProps {
  selectedStudents: string[]
  onChange: (studentIds: string[]) => void
}

export default function StudentSelector({ selectedStudents, onChange }: StudentSelectorProps) {
  const client = useApiClient()
  const [students, setStudents] = useState<Student[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')

  useEffect(() => {
    const fetchStudents = async () => {
      try {
        setLoading(true)
        setError(null)
        const collectedStudents: Student[] = []
        let page = 1
        let hasNext = true

        while (hasNext) {
          const response = await client.get(`/students?page=${page}&per_page=100`)

          if (response.error) {
            throw new Error(response.error)
          }

          const items = (response.data?.items || response.data || []) as Student[]
          collectedStudents.push(...items)
          hasNext = Boolean(response.data?.meta?.has_next)
          page += 1
        }

        setStudents(
          collectedStudents.filter(
            (student) => student.account_status === 'claimed' && Boolean(student.clerk_id),
          ),
        )
      } catch (err: any) {
        console.error('Failed to fetch students:', err)
        setError(err.message || 'Failed to load students')
      } finally {
        setLoading(false)
      }
    }

    fetchStudents()
  }, [])

  const filteredStudents = students.filter(student =>
    student.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    student.email?.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const getStudentIdentifier = (student: Student) => String(student.clerk_id || '')

  const handleToggleStudent = (studentId: string) => {
    if (selectedStudents.includes(studentId)) {
      onChange(selectedStudents.filter(id => id !== studentId))
    } else {
      onChange([...selectedStudents, studentId])
    }
  }

  const handleSelectAll = () => {
    if (selectedStudents.length === filteredStudents.length) {
      onChange([])
    } else {
      onChange(filteredStudents.map(getStudentIdentifier))
    }
  }

  const getInitials = (name: string) => {
    return name?.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || '?'
  }

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-full" />
        <div className="space-y-2">
          {[1, 2, 3].map(i => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-4 border border-red-200 dark:border-red-800 rounded-lg bg-red-50 dark:bg-red-900/20">
        <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
          <AlertCircle className="h-5 w-5" />
          <p className="text-sm font-medium">{error}</p>
        </div>
      </div>
    )
  }

  if (students.length === 0) {
    return (
      <div className="p-8 text-center border border-border rounded-lg">
        <Users className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
        <p className="text-muted-foreground">No students found</p>
        <p className="text-sm text-muted-foreground mt-1">
          Invite or create students, then wait for them to claim their account before assigning work.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Search and Select All */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search students..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>
        <button
          type="button"
          onClick={handleSelectAll}
          className="text-sm text-primary hover:underline"
        >
          {selectedStudents.length === filteredStudents.length ? 'Deselect All' : 'Select All'}
        </button>
      </div>

      {/* Selected count */}
      <div className="flex items-center gap-2">
        <Badge variant="secondary">
          {selectedStudents.length} student{selectedStudents.length !== 1 ? 's' : ''} selected
        </Badge>
      </div>

      {/* Student list */}
      <ScrollArea className="h-[300px] border border-border rounded-lg">
        <div className="p-2 space-y-1">
          {filteredStudents.map(student => {
            const studentId = getStudentIdentifier(student)
            return (
            <div
              key={studentId}
              onClick={() => handleToggleStudent(studentId)}
              className={`
                flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors
                ${selectedStudents.includes(studentId)
                  ? 'bg-primary/10 border border-primary/30'
                  : 'hover:bg-muted border border-transparent'
                }
              `}
            >
              <Checkbox
                checked={selectedStudents.includes(studentId)}
                onCheckedChange={() => handleToggleStudent(studentId)}
                onClick={(e) => e.stopPropagation()}
              />
              <Avatar className="h-10 w-10">
                <AvatarImage src={student.avatar} alt={student.name} />
                <AvatarFallback className="bg-primary/20 text-primary">
                  {getInitials(student.name)}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-foreground truncate">
                  {student.name}
                </p>
                <p className="text-sm text-muted-foreground truncate">
                  {student.email}
                </p>
                </div>
            </div>
            )
          })}
          {filteredStudents.length === 0 && (
            <div className="p-4 text-center text-muted-foreground">
              No students match your search
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}


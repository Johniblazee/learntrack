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
  clerk_id: string
  name: string
  email: string
  avatar?: string
  subject_ids?: string[]
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
        const response = await client.get('/students/?per_page=100')

        if (response.error) {
          throw new Error(response.error)
        }

        const items = response.data?.items || response.data || []
        setStudents(items)
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
      onChange(filteredStudents.map(s => s.clerk_id))
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
      <div className="p-8 text-center border border-gray-200 dark:border-gray-700 rounded-lg">
        <Users className="h-12 w-12 text-gray-400 mx-auto mb-4" />
        <p className="text-gray-600 dark:text-gray-400">No students found</p>
        <p className="text-sm text-gray-500 dark:text-gray-500 mt-1">
          Invite students to get started
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Search and Select All */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
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
      <ScrollArea className="h-[300px] border border-gray-200 dark:border-gray-700 rounded-lg">
        <div className="p-2 space-y-1">
          {filteredStudents.map(student => (
            <div
              key={student.clerk_id}
              onClick={() => handleToggleStudent(student.clerk_id)}
              className={`
                flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors
                ${selectedStudents.includes(student.clerk_id)
                  ? 'bg-primary/10 border border-primary/30'
                  : 'hover:bg-gray-100 dark:hover:bg-gray-800 border border-transparent'
                }
              `}
            >
              <Checkbox
                checked={selectedStudents.includes(student.clerk_id)}
                onCheckedChange={() => handleToggleStudent(student.clerk_id)}
                onClick={(e) => e.stopPropagation()}
              />
              <Avatar className="h-10 w-10">
                <AvatarImage src={student.avatar} alt={student.name} />
                <AvatarFallback className="bg-primary/20 text-primary">
                  {getInitials(student.name)}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-gray-900 dark:text-white truncate">
                  {student.name}
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-400 truncate">
                  {student.email}
                </p>
              </div>
            </div>
          ))}
          {filteredStudents.length === 0 && (
            <div className="p-4 text-center text-gray-500 dark:text-gray-400">
              No students match your search
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}


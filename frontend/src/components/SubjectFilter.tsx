import { useMemo, useEffect } from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { BookOpen } from 'lucide-react'
import { useSubjects, useStudents } from '@/hooks/useQueries'

interface Subject {
  _id: string
  name: string
  description?: string
}

interface SubjectFilterProps {
  selectedSubject: string
  onChange: (subjectId: string) => void
  onStudentCountChange?: (count: number) => void
  showStudentCount?: boolean
}

export default function SubjectFilter({
  selectedSubject,
  onChange,
  onStudentCountChange,
  showStudentCount = true
}: SubjectFilterProps) {
  const { data: subjectsData, isLoading } = useSubjects()
  const { data: studentsData } = useStudents(1, 200)

  const subjects: Subject[] = Array.isArray(subjectsData) ? subjectsData : []

  const studentCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    const items = studentsData?.items || []
    items.forEach((student: any) => {
      if (student.subjects && Array.isArray(student.subjects)) {
        student.subjects.forEach((subjectId: string) => {
          counts[subjectId] = (counts[subjectId] || 0) + 1
        })
      }
    })
    return counts
  }, [studentsData])

  useEffect(() => {
    if (selectedSubject && studentCounts[selectedSubject] !== undefined) {
      onStudentCountChange?.(studentCounts[selectedSubject])
    } else {
      onStudentCountChange?.(0)
    }
  }, [selectedSubject, studentCounts])

  const selectedSubjectData = subjects.find(s => s._id === selectedSubject)

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-foreground">
          Assign by Subject
        </p>
        {selectedSubject && (
          <button
            onClick={() => onChange('')}
            className="text-xs text-purple-600 hover:text-purple-700 dark:text-purple-400"
          >
            Clear
          </button>
        )}
      </div>

      <Select value={selectedSubject} onValueChange={onChange} disabled={isLoading}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder={isLoading ? "Loading subjects..." : "Select a subject"} />
        </SelectTrigger>
        <SelectContent>
          {subjects.map((subject) => (
            <SelectItem key={subject._id} value={subject._id}>
              <div className="flex items-center justify-between w-full">
                <span>{subject.name}</span>
                {showStudentCount && studentCounts[subject._id] !== undefined && (
                  <Badge variant="secondary" className="ml-2 text-xs">
                    {studentCounts[subject._id]} students
                  </Badge>
                )}
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {selectedSubject && selectedSubjectData && (
        <div className="p-3 bg-blue-50 dark:bg-blue-900/10 rounded-lg">
          <div className="flex items-start gap-2">
            <BookOpen className="w-4 h-4 text-blue-600 dark:text-blue-400 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-medium text-blue-900 dark:text-blue-300">
                {selectedSubjectData.name}
              </p>
              {selectedSubjectData.description && (
                <p className="text-xs text-blue-700 dark:text-blue-400 mt-1">
                  {selectedSubjectData.description}
                </p>
              )}
              {showStudentCount && studentCounts[selectedSubject] !== undefined && (
                <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">
                  Will be assigned to <strong>{studentCounts[selectedSubject]}</strong> student
                  {studentCounts[selectedSubject] !== 1 ? 's' : ''}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {!isLoading && subjects.length === 0 && (
        <div className="text-center py-4 text-muted-foreground">
          <BookOpen className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">No subjects found</p>
        </div>
      )}
    </div>
  )
}

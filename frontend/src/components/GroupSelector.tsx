import { useState, useEffect } from 'react'
import { useAuth } from '@clerk/clerk-react'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Card, CardContent } from '@/components/ui/card'
import { LoadingState } from '@/components/ui/loading-state'
import { Users } from 'lucide-react'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api/v1'

interface StudentGroup {
  _id: string
  name: string
  description: string
  studentIds: string[]
  subjects: string[]
  color: string
}

interface GroupSelectorProps {
  selectedGroups: string[]
  onChange: (groupIds: string[]) => void
  onStudentCountChange?: (count: number) => void
}

export default function GroupSelector({ selectedGroups, onChange, onStudentCountChange }: GroupSelectorProps) {
  const { getToken } = useAuth()
  const [groups, setGroups] = useState<StudentGroup[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchGroups()
  }, [])

  useEffect(() => {
    // Calculate total unique students when selection changes
    const uniqueStudents = new Set<string>()
    groups.forEach(group => {
      if (selectedGroups.includes(group._id)) {
        group.studentIds.forEach(studentId => uniqueStudents.add(studentId))
      }
    })
    onStudentCountChange?.(uniqueStudents.size)
  }, [selectedGroups, groups])

  const fetchGroups = async () => {
    try {
      setLoading(true)
      const token = await getToken()
      const response = await fetch(`${API_BASE_URL}/groups/`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })

      if (response.ok) {
        const data = await response.json()
        setGroups(data)
      }
    } catch (error) {
      console.error('Failed to fetch groups:', error)
    } finally {
      setLoading(false)
    }
  }

  const toggleGroup = (groupId: string) => {
    if (selectedGroups.includes(groupId)) {
      onChange(selectedGroups.filter(id => id !== groupId))
    } else {
      onChange([...selectedGroups, groupId])
    }
  }

  const getColorClass = (color: string) => {
    const colorMap: Record<string, string> = {
      blue: 'bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-400',
      green: 'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400',
      purple: 'bg-purple-100 text-purple-800 dark:bg-purple-900/20 dark:text-purple-400',
      red: 'bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400',
      yellow: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-400',
      pink: 'bg-pink-100 text-pink-800 dark:bg-pink-900/20 dark:text-pink-400',
    }
    return colorMap[color] || colorMap.blue
  }

  if (loading) {
    return <LoadingState message="Loading groups..." size="lg" className="py-4" />
  }

  if (groups.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <Users className="w-12 h-12 mx-auto mb-2 opacity-50" />
        <p>No student groups found</p>
        <p className="text-sm mt-1">Create groups in the Groups section</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-foreground">
        Select Student Groups
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {groups.map((group) => (
          <Card
            key={group._id}
            className={`cursor-pointer transition-all duration-200 ${
              selectedGroups.includes(group._id)
                ? 'ring-2 ring-primary bg-primary/5'
                : 'hover:shadow-md'
            }`}
            onClick={() => toggleGroup(group._id)}
          >
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <Checkbox
                  checked={selectedGroups.includes(group._id)}
                  onCheckedChange={() => toggleGroup(group._id)}
                  className="mt-1"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h4 className="font-medium text-gray-900 dark:text-white truncate">
                      {group.name}
                    </h4>
                    <Badge className={getColorClass(group.color)}>
                      {group.studentIds.length} students
                    </Badge>
                  </div>
                  {group.description && (
                    <p className="text-sm text-gray-600 dark:text-slate-400 line-clamp-2">
                      {group.description}
                    </p>
                  )}
                  {group.subjects.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {group.subjects.slice(0, 3).map((subject, idx) => (
                        <Badge key={idx} variant="outline" className="text-xs">
                          {subject}
                        </Badge>
                      ))}
                      {group.subjects.length > 3 && (
                        <Badge variant="outline" className="text-xs">
                          +{group.subjects.length - 3} more
                        </Badge>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      {selectedGroups.length > 0 && (
        <div className="mt-4 p-3 bg-purple-50 dark:bg-purple-900/10 rounded-lg">
          <p className="text-sm text-purple-900 dark:text-purple-300">
            <strong>{selectedGroups.length}</strong> group{selectedGroups.length !== 1 ? 's' : ''} selected
          </p>
        </div>
      )}
    </div>
  )
}


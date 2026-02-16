import { useCallback, useEffect, useMemo, useState } from 'react'
import { useApiClient } from '@/lib/api-client'
import { toast } from '@/contexts/ToastContext'

export interface GroupMemberStudent {
  _id: string
  clerk_id: string
  name: string
  email: string
  avatar_url?: string
}

interface UseGroupMembersOptions {
  open: boolean
  initialMemberIds: string[]
}

export function getStudentInitials(name: string) {
  return name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

export function useGroupMembers({ open, initialMemberIds }: UseGroupMembersOptions) {
  const [loadingStudents, setLoadingStudents] = useState(false)
  const [allStudents, setAllStudents] = useState<GroupMemberStudent[]>([])
  const [memberIds, setMemberIds] = useState<string[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const client = useApiClient()

  const fetchAllStudents = useCallback(async () => {
    try {
      setLoadingStudents(true)
      const response = await client.get('/students?per_page=100')

      if (response.error) {
        throw new Error(response.error)
      }

      setAllStudents(response.data?.items || [])
    } catch (error) {
      console.error('Failed to fetch students:', error)
      toast.error('Failed to load students')
    } finally {
      setLoadingStudents(false)
    }
  }, [client])

  useEffect(() => {
    if (!open) {
      return
    }

    const validStudentIds = (initialMemberIds || []).filter(
      (id): id is string => id != null && id !== ''
    )
    setMemberIds(validStudentIds)
    void fetchAllStudents()
  }, [fetchAllStudents, initialMemberIds, open])

  const currentMembers = useMemo(() => {
    return allStudents.filter((student) => memberIds.includes(student._id))
  }, [allStudents, memberIds])

  const filteredAvailableStudents = useMemo(() => {
    const availableStudents = allStudents.filter((student) => !memberIds.includes(student._id))

    if (!searchTerm.trim()) {
      return availableStudents
    }

    const term = searchTerm.toLowerCase()
    return availableStudents.filter(
      (student) =>
        student.name.toLowerCase().includes(term) ||
        student.email.toLowerCase().includes(term)
    )
  }, [allStudents, memberIds, searchTerm])

  return {
    allStudents,
    loadingStudents,
    memberIds,
    setMemberIds,
    currentMembers,
    filteredAvailableStudents,
    searchTerm,
    setSearchTerm,
  }
}

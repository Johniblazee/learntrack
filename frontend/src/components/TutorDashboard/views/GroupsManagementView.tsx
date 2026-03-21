import { useState, useCallback } from 'react'
import { useQueryClient, useMutation } from '@tanstack/react-query'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Search, Plus, Pencil, Trash2, Users, BookOpen, RefreshCw, X } from 'lucide-react'
import { toast } from '@/contexts/ToastContext'
import { CreateGroupModal } from '@/components/modals/CreateGroupModal'
import { EditGroupModal } from '@/components/modals/EditGroupModal'
import { ViewGroupDetailsModal } from '@/components/modals/ViewGroupDetailsModal'
import { ConfirmDeleteModal } from '@/components/modals/ConfirmDeleteModal'
import { Badge } from '@/components/ui/badge'
import { useApiClient } from '@/lib/api-client'
import { LoadingSpinner } from '@/components/ui/loading-state'
import { useGroups } from '@/hooks/useQueries'

interface StudentGroup {
  _id: string
  name: string
  description: string
  studentIds: string[]
  subjects: string[]
  color: string
  imageUrl?: string
  averageScore?: number
}

export default function GroupsManagementView() {
  const client = useApiClient()
  const queryClient = useQueryClient()
  const { data: groupsData, isLoading } = useGroups()
  const [searchTerm, setSearchTerm] = useState('')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [showViewModal, setShowViewModal] = useState(false)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [selectedGroup, setSelectedGroup] = useState<StudentGroup | null>(null)
  const [regeneratingImage, setRegeneratingImage] = useState<string | null>(null)
  const [removingImage, setRemovingImage] = useState<string | null>(null)

  const groups: StudentGroup[] = Array.isArray(groupsData) ? groupsData : []

  const invalidateGroups = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['groups'] })
  }, [queryClient])

  const deleteGroupMutation = useMutation({
    mutationFn: async (groupId: string) => {
      const response = await client.delete(`/groups/${groupId}`)
      if (response.error) throw new Error(response.error)
      return response.data
    },
    onSuccess: () => {
      invalidateGroups()
      toast.success('Group deleted successfully')
      setShowDeleteModal(false)
      setSelectedGroup(null)
    },
    onError: (error: any) => {
      toast.error('Failed to delete group', {
        description: error.message || 'Please try again'
      })
    },
  })

  const handleDeleteGroup = async () => {
    if (!selectedGroup) return
    deleteGroupMutation.mutate(selectedGroup._id)
  }

  const handleRegenerateImage = async (group: StudentGroup) => {
    try {
      setRegeneratingImage(group._id)
      const response = await client.post(`/groups/${group._id}/regenerate-image`, {})

      if (response.error) {
        throw new Error(response.error)
      }

      toast.success('Cover image updated!')
      invalidateGroups()
    } catch (error: any) {
      console.error('Failed to regenerate image:', error)
      toast.error('Failed to update image', {
        description: error.message || 'Please try again'
      })
    } finally {
      setRegeneratingImage(null)
    }
  }

  const handleRemoveImage = async (group: StudentGroup) => {
    try {
      setRemovingImage(group._id)
      const response = await client.delete(`/groups/${group._id}/image`)

      if (response.error) {
        throw new Error(response.error)
      }

      toast.success('Cover image removed')
      invalidateGroups()
    } catch (error: any) {
      console.error('Failed to remove image:', error)
      toast.error('Failed to remove image', {
        description: error.message || 'Please try again'
      })
    } finally {
      setRemovingImage(null)
    }
  }

  const openDeleteModal = (group: StudentGroup) => {
    setSelectedGroup(group)
    setShowDeleteModal(true)
  }

  const handleEditGroup = (group: StudentGroup) => {
    setSelectedGroup(group)
    setShowEditModal(true)
  }

  const handleViewDetails = (group: StudentGroup) => {
    setSelectedGroup(group)
    setShowViewModal(true)
  }

  // Filter groups by search term
  const filteredGroups = groups.filter(group => {
    const searchLower = searchTerm.toLowerCase()
    return group.name.toLowerCase().includes(searchLower) ||
           group.description.toLowerCase().includes(searchLower)
  })

  // Get initials for avatar fallback
  const getInitials = (name: string) => {
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
  }

  // Get color class based on group color
  const getColorClass = (color: string) => {
    const colorMap: Record<string, string> = {
      'blue': 'bg-blue-100 text-blue-700',
      'green': 'bg-emerald-100 text-emerald-700',
      'purple': 'bg-purple-100 text-purple-700',
      'orange': 'bg-orange-100 text-orange-700',
      'red': 'bg-red-100 text-red-700',
      'pink': 'bg-pink-100 text-pink-700',
      'yellow': 'bg-yellow-100 text-yellow-700',
      'indigo': 'bg-indigo-100 text-indigo-700',
    }
    return colorMap[color] || 'bg-muted text-foreground'
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground">
            Manage Student Groups
          </h1>
          <p className="text-muted-foreground mt-1">
            Organize your students into groups for better management
          </p>
        </div>
        <Button
          onClick={() => setShowCreateModal(true)}
          className="bg-[#5c4a38] hover:bg-[#4a3c2e] text-white"
        >
          <Plus className="w-4 h-4 mr-2" />
          Create New Group
        </Button>
      </div>

      {/* Search Bar */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
        <Input
          placeholder="Search groups by name or description..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="pl-10 bg-muted/50"
        />
      </div>

      {/* Groups Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, index) => (
            <Card key={index} className="border shadow-sm bg-card overflow-hidden">
              <div className="aspect-[16/9] bg-muted animate-pulse" />
              <CardContent className="p-4">
                <div className="space-y-3">
                  <div className="h-5 bg-muted rounded w-3/4 animate-pulse"></div>
                  <div className="h-4 bg-muted rounded w-1/2 animate-pulse"></div>
                  <div className="h-8 bg-muted rounded w-full animate-pulse"></div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : filteredGroups.length === 0 ? (
        <Card className="border shadow-sm bg-card">
          <CardContent className="py-16">
            <div className="text-center">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-muted mb-4">
                <Users className="h-8 w-8 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2">
                No groups found
              </h3>
              <p className="text-sm text-muted-foreground max-w-sm mx-auto mb-6">
                {searchTerm
                  ? "Try adjusting your search terms to find what you're looking for."
                  : "Create your first group to start organizing your students and tracking their progress together."
                }
              </p>
              {!searchTerm && (
                <Button
                  onClick={() => setShowCreateModal(true)}
                  className="bg-[#5c4a38] hover:bg-[#4a3c2e] text-white"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Create Your First Group
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredGroups.map((group) => (
            <Card
              key={group._id}
              className="border shadow-sm bg-card hover:shadow-md transition-shadow overflow-hidden group"
            >
              {/* Image Section - Smaller 16:9 aspect ratio */}
              <div className="relative aspect-[16/9] overflow-hidden bg-gradient-to-br from-[#5c4a38]/10 to-[#8b7355]/10">
                {group.imageUrl ? (
                  <>
                    <img
                      src={group.imageUrl}
                      alt={group.name}
                      className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none'
                      }}
                    />
                    {/* Hover overlay with regenerate and remove buttons */}
                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col items-center justify-center gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => handleRegenerateImage(group)}
                        disabled={regeneratingImage === group._id}
                        className="bg-white/90 hover:bg-white"
                      >
                        {regeneratingImage === group._id ? (
                          <LoadingSpinner size="sm" className="text-foreground" />
                        ) : (
                          <RefreshCw className="h-4 w-4" />
                        )}
                        <span className="ml-1">New Image</span>
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => handleRemoveImage(group)}
                        disabled={removingImage === group._id}
                        className="bg-red-600/90 hover:bg-red-600"
                      >
                        {removingImage === group._id ? (
                          <LoadingSpinner size="sm" className="text-white" />
                        ) : (
                          <X className="h-4 w-4" />
                        )}
                        <span className="ml-1">Remove</span>
                      </Button>
                    </div>
                  </>
                ) : (
                  <div className="flex items-center justify-center h-full">
                    <div className={`w-16 h-16 rounded-full flex items-center justify-center text-xl font-bold ${getColorClass(group.color)}`}>
                      {getInitials(group.name)}
                    </div>
                  </div>
                )}
              </div>

              <CardContent className="p-4">
                <div className="space-y-3">
                  {/* Group Header */}
                  <div>
                    <h3 className="text-base font-bold text-foreground truncate group-hover:text-[#5c4a38] transition-colors">
                      {group.name}
                    </h3>
                    {group.description && (
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                        {group.description}
                      </p>
                    )}
                  </div>

                  {/* Stats Row - Compact */}
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <Users className="h-3.5 w-3.5" />
                      <span>
                        {group.studentIds.length} Student{group.studentIds.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                    {group.subjects && group.subjects.length > 0 && (
                      <div className="flex items-center gap-1">
                        <BookOpen className="h-3.5 w-3.5" />
                        <span>{group.subjects.length} Subject{group.subjects.length !== 1 ? 's' : ''}</span>
                      </div>
                    )}
                  </div>

                  {/* Subject Badges - Compact */}
                  {group.subjects && group.subjects.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {group.subjects.slice(0, 2).map((subject, idx) => (
                        <Badge key={idx} variant="secondary" className="text-[10px] px-1.5 py-0 bg-[#5c4a38]/10 text-[#5c4a38] hover:bg-[#5c4a38]/20">
                          {subject}
                        </Badge>
                      ))}
                      {group.subjects.length > 2 && (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                          +{group.subjects.length - 2}
                        </Badge>
                      )}
                    </div>
                  )}

                  {/* Action Buttons - Compact */}
                  <div className="flex gap-1.5 pt-1">
                    <Button
                      onClick={() => handleViewDetails(group)}
                      className="flex-1 bg-[#5c4a38] hover:bg-[#4a3c2e] text-white text-xs h-8"
                    >
                      View
                    </Button>
                    <Button
                      onClick={() => handleEditGroup(group)}
                      variant="outline"
                      size="icon"
                      className="h-8 w-8"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      onClick={() => openDeleteModal(group)}
                      variant="outline"
                      size="icon"
                      className="h-8 w-8 text-red-600 hover:text-red-700 hover:bg-red-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Modals */}
      <CreateGroupModal
        open={showCreateModal}
        onOpenChange={setShowCreateModal}
        onGroupCreated={invalidateGroups}
      />

      <EditGroupModal
        open={showEditModal}
        onOpenChange={setShowEditModal}
        group={selectedGroup}
        onGroupUpdated={invalidateGroups}
      />

      <ViewGroupDetailsModal
        open={showViewModal}
        onOpenChange={setShowViewModal}
        group={selectedGroup}
        onGroupUpdated={invalidateGroups}
      />

      <ConfirmDeleteModal
        open={showDeleteModal}
        onOpenChange={setShowDeleteModal}
        onConfirm={handleDeleteGroup}
        title="Delete Group?"
        description="Are you sure you want to delete this group? This action cannot be undone."
        itemName={selectedGroup?.name}
        loading={deleteGroupMutation.isPending}
      />
    </div>
  )
}

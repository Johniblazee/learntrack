import { Download, ExternalLink, Filter, Library, Search } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"

import type { MaterialFilter, StudentMaterialItem } from "../types"
import { MATERIAL_FILTER_LABELS } from "../constants"
import { formatBytes, formatDueDate } from "../utils"

interface LibraryViewProps {
  filteredMaterials: StudentMaterialItem[]
  materialCounts: { total: number; pdf: number; video: number; link: number }
  materialsLoading: boolean
  materialsErrorMessage: string | null
  materialSearchTerm: string
  materialFilter: MaterialFilter
  onSearchChange: (value: string) => void
  onFilterChange: (value: MaterialFilter) => void
  onOpenMaterial: (material: StudentMaterialItem) => void
}

export default function LibraryView({
  filteredMaterials,
  materialCounts,
  materialsLoading,
  materialsErrorMessage,
  materialSearchTerm,
  materialFilter,
  onSearchChange,
  onFilterChange,
  onOpenMaterial,
}: LibraryViewProps) {
  if (materialsErrorMessage) {
    return (
      <Card className="border-destructive/30 bg-destructive/5 shadow-sm">
        <CardContent className="space-y-2 p-6">
          <p className="font-semibold text-foreground">Unable to load your library</p>
          <p className="text-sm text-muted-foreground">{materialsErrorMessage}</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Library</h1>
          <p className="mt-1 text-sm text-muted-foreground">Access study resources shared by your tutor.</p>
        </div>

        <div className="flex w-full flex-col gap-2 sm:flex-row lg:w-auto">
          <div className="relative sm:w-72">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={materialSearchTerm}
              onChange={(event) => onSearchChange(event.target.value)}
              className="pl-9"
              placeholder="Search resources"
            />
          </div>
          <Select value={materialFilter} onValueChange={(value) => onFilterChange(value as MaterialFilter)}>
            <SelectTrigger className="sm:w-40">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(MATERIAL_FILTER_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <Card className="border-0 bg-card shadow-sm">
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Resources</p>
            <p className="text-2xl font-bold">{materialCounts.total}</p>
          </CardContent>
        </Card>
        <Card className="border-0 bg-card shadow-sm">
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">PDF</p>
            <p className="text-2xl font-bold">{materialCounts.pdf}</p>
          </CardContent>
        </Card>
        <Card className="border-0 bg-card shadow-sm">
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Video</p>
            <p className="text-2xl font-bold">{materialCounts.video}</p>
          </CardContent>
        </Card>
        <Card className="border-0 bg-card shadow-sm">
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Links</p>
            <p className="text-2xl font-bold">{materialCounts.link}</p>
          </CardContent>
        </Card>
      </div>

      {materialsLoading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <Card key={index} className="border-0 bg-card shadow-sm">
              <CardContent className="space-y-3 p-5">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-3 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : filteredMaterials.length === 0 ? (
        <Card className="border-0 bg-card shadow-sm">
          <CardContent className="p-8 text-center">
            <Library className="mx-auto mb-2 h-10 w-10 text-muted-foreground/60" />
            <p className="font-medium">No resources found</p>
            <p className="text-sm text-muted-foreground">Try another search or check back after your tutor shares materials.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredMaterials.map((material) => (
            <Card key={material.id} className="border border-border bg-card shadow-sm">
              <CardContent className="space-y-4 p-5">
                <div className="flex items-start justify-between gap-2">
                  <Badge variant="outline">{MATERIAL_FILTER_LABELS[material.materialType]}</Badge>
                  <p className="text-xs text-muted-foreground">{formatBytes(material.fileSize)}</p>
                </div>

                <div>
                  <p className="line-clamp-2 text-base font-semibold">{material.title}</p>
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{material.description}</p>
                </div>

                <div className="text-xs text-muted-foreground">
                  <p>Subject: {material.subject}</p>
                  <p>Topic: {material.topic || "General"}</p>
                  <p>Added: {material.createdAt ? formatDueDate(material.createdAt) : "Recently"}</p>
                </div>

                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onOpenMaterial(material)}
                  disabled={!material.fileUrl}
                >
                  {material.fileUrl ? (
                    <>
                      <ExternalLink className="mr-2 h-4 w-4" />
                      Open Resource
                    </>
                  ) : (
                    <>
                      <Download className="mr-2 h-4 w-4" />
                      Unavailable
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

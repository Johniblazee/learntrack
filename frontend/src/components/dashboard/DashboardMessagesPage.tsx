import { useMemo } from "react"
import { useSearchParams } from "react-router-dom"

import ConversationsView from "@/components/TutorDashboard/views/ConversationsView"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"

type MessageMode = "chat" | "email"

interface DashboardMessagesPageProps {
  title: string
  description: string
}

function normalizeMessageMode(value: string | null): MessageMode {
  return value === "email" ? "email" : "chat"
}

export function DashboardMessagesPage({
  title,
  description,
}: DashboardMessagesPageProps) {
  const [searchParams, setSearchParams] = useSearchParams()
  const mode = useMemo(
    () => normalizeMessageMode(searchParams.get("mode")),
    [searchParams]
  )

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">{title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>

        <Tabs
          value={mode}
          onValueChange={(nextValue) => {
            const nextMode = normalizeMessageMode(nextValue)
            const nextSearchParams = new URLSearchParams(searchParams)
            nextSearchParams.set("mode", nextMode)
            setSearchParams(nextSearchParams, { replace: true })
          }}
        >
          <TabsList className="grid w-full grid-cols-2 sm:w-[240px]">
            <TabsTrigger value="chat">Chats</TabsTrigger>
            <TabsTrigger value="email">Emails</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <ConversationsView routeMode={mode === "email" ? "emails" : "chats"} />
    </div>
  )
}

"use client"

import { CopyIcon, RefreshCcwIcon, ThumbsDownIcon, ThumbsUpIcon } from "lucide-react"
import type { ComponentProps } from "react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

export type ActionsProps = ComponentProps<"div">

export const Actions = ({ className, children, ...props }: ActionsProps) => (
  <div className={cn("flex items-center gap-1", className)} {...props}>
    {children}
  </div>
)

export type ActionProps = ComponentProps<typeof Button> & {
  tooltip?: string
  label?: string
}

export const Action = ({
  tooltip,
  children,
  label,
  className,
  variant = "ghost",
  size = "sm",
  ...props
}: ActionProps) => {
  const button = (
    <Button
      className={cn("size-9 p-1.5 text-muted-foreground hover:text-foreground", className)}
      size={size}
      type="button"
      variant={variant}
      {...props}
    >
      {children}
      <span className="sr-only">{label || tooltip}</span>
    </Button>
  )

  if (tooltip) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>{button}</TooltipTrigger>
          <TooltipContent>
            <p>{tooltip}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }

  return button
}

// Pre-built action buttons for common AI actions
export const ActionCopy = ({ onClick, ...props }: Omit<ActionProps, 'tooltip' | 'children'> & { onClick: () => void }) => (
  <Action onClick={onClick} tooltip="Copy to clipboard" {...props}>
    <CopyIcon className="size-4" />
  </Action>
)

export const ActionRegenerate = ({ onClick, ...props }: Omit<ActionProps, 'tooltip' | 'children'> & { onClick: () => void }) => (
  <Action onClick={onClick} tooltip="Regenerate response" {...props}>
    <RefreshCcwIcon className="size-4" />
  </Action>
)

export const ActionThumbsUp = ({ onClick, ...props }: Omit<ActionProps, 'tooltip' | 'children'> & { onClick: () => void }) => (
  <Action onClick={onClick} tooltip="Good response" {...props}>
    <ThumbsUpIcon className="size-4" />
  </Action>
)

export const ActionThumbsDown = ({ onClick, ...props }: Omit<ActionProps, 'tooltip' | 'children'> & { onClick: () => void }) => (
  <Action onClick={onClick} tooltip="Bad response" {...props}>
    <ThumbsDownIcon className="size-4" />
  </Action>
)

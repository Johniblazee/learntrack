"use client";

import { ArrowRight, Bot, Check, ChevronDown } from "lucide-react";
import { useState, useRef, useCallback, useEffect } from "react";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { motion, AnimatePresence } from "framer-motion";
import { AI_PROVIDERS } from "@/components/question-generator/SettingsModal";

// Flatten all models from AI_PROVIDERS for the dropdown
const ALL_MODELS = AI_PROVIDERS.flatMap(provider => 
  provider.models.map(model => ({
    id: model,
    label: model,
    provider: provider.id,
    providerLabel: provider.label,
  }))
);

// Model to provider mapping for icons
const MODEL_PROVIDER_MAP: Record<string, string> = {};
AI_PROVIDERS.forEach(provider => {
  provider.models.forEach(model => {
    MODEL_PROVIDER_MAP[model] = provider.id;
  });
});

interface UseAutoResizeTextareaProps {
    minHeight: number;
    maxHeight?: number;
}

function useAutoResizeTextarea({
    minHeight,
    maxHeight,
}: UseAutoResizeTextareaProps) {
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    const adjustHeight = useCallback(
        (reset?: boolean) => {
            const textarea = textareaRef.current;
            if (!textarea) return;

            if (reset) {
                textarea.style.height = `${minHeight}px`;
                return;
            }

            textarea.style.height = `${minHeight}px`;

            const newHeight = Math.max(
                minHeight,
                Math.min(
                    textarea.scrollHeight,
                    maxHeight ?? Number.POSITIVE_INFINITY
                )
            );

            textarea.style.height = `${newHeight}px`;
        },
        [minHeight, maxHeight]
    );

    useEffect(() => {
        const textarea = textareaRef.current;
        if (textarea) {
            textarea.style.height = `${minHeight}px`;
        }
    }, [minHeight]);

    useEffect(() => {
        const handleResize = () => adjustHeight();
        window.addEventListener("resize", handleResize);
        return () => window.removeEventListener("resize", handleResize);
    }, [adjustHeight]);

    return { textareaRef, adjustHeight };
}

const OPENAI_ICON = (
    <>
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 256 260"
            aria-label="OpenAI Icon"
            className="w-4 h-4 dark:hidden block"
        >
            <title>OpenAI Icon Light</title>
            <path d="M239.184 106.203a64.716 64.716 0 0 0-5.576-53.103C219.452 28.459 191 15.784 163.213 21.74A65.586 65.586 0 0 0 52.096 45.22a64.716 64.716 0 0 0-43.23 31.36c-14.31 24.602-11.061 55.634 8.033 76.74a64.665 64.665 0 0 0 5.525 53.102c14.174 24.65 42.644 37.324 70.446 31.36a64.72 64.72 0 0 0 48.754 21.744c28.481.025 53.714-18.361 62.414-45.481a64.767 64.767 0 0 0 43.229-31.36c14.137-24.558 10.875-55.423-8.083-76.483Zm-97.56 136.338a48.397 48.397 0 0 1-31.105-11.255l1.535-.87 51.67-29.825a8.595 8.595 0 0 0 4.247-7.367v-72.85l21.845 12.636c.218.111.37.32.409.563v60.367c-.056 26.818-21.783 48.545-48.601 48.601Zm-104.466-44.61a48.345 48.345 0 0 1-5.781-32.589l1.534.921 51.722 29.826a8.339 8.339 0 0 0 8.441 0l63.181-36.425v25.221a.87.87 0 0 1-.358.665l-52.335 30.184c-23.257 13.398-52.97 5.431-66.404-17.803ZM23.549 85.38a48.499 48.499 0 0 1 25.58-21.333v61.39a8.288 8.288 0 0 0 4.195 7.316l62.874 36.272-21.845 12.636a.819.819 0 0 1-.767 0L41.353 151.53c-23.211-13.454-31.171-43.144-17.804-66.405v.256Zm179.466 41.695-63.08-36.63L161.73 77.86a.819.819 0 0 1 .768 0l52.233 30.184a48.6 48.6 0 0 1-7.316 87.635v-61.391a8.544 8.544 0 0 0-4.4-7.213Zm21.742-32.69-1.535-.922-51.619-30.081a8.39 8.39 0 0 0-8.492 0L99.98 99.808V74.587a.716.716 0 0 1 .307-.665l52.233-30.133a48.652 48.652 0 0 1 72.236 50.391v.205ZM88.061 139.097l-21.845-12.585a.87.87 0 0 1-.41-.614V65.685a48.652 48.652 0 0 1 79.757-37.346l-1.535.87-51.67 29.825a8.595 8.595 0 0 0-4.246 7.367l-.051 72.697Zm11.868-25.58 28.138-16.217 28.188 16.218v32.434l-28.086 16.218-28.188-16.218-.052-32.434Z" />
        </svg>
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 256 260"
            aria-label="OpenAI Icon"
            className="w-4 h-4 hidden dark:block"
        >
            <title>OpenAI Icon Dark</title>
            <path
                fill="#fff"
                d="M239.184 106.203a64.716 64.716 0 0 0-5.576-53.103C219.452 28.459 191 15.784 163.213 21.74A65.586 65.586 0 0 0 52.096 45.22a64.716 64.716 0 0 0-43.23 31.36c-14.31 24.602-11.061 55.634 8.033 76.74a64.665 64.665 0 0 0 5.525 53.102c14.174 24.65 42.644 37.324 70.446 31.36a64.72 64.72 0 0 0 48.754 21.744c28.481.025 53.714-18.361 62.414-45.481a64.767 64.767 0 0 0 43.229-31.36c14.137-24.558 10.875-55.423-8.083-76.483Zm-97.56 136.338a48.397 48.397 0 0 1-31.105-11.255l1.535-.87 51.67-29.825a8.595 8.595 0 0 0 4.247-7.367v-72.85l21.845 12.636c.218.111.37.32.409.563v60.367c-.056 26.818-21.783 48.545-48.601 48.601Zm-104.466-44.61a48.345 48.345 0 0 1-5.781-32.589l1.534.921 51.722 29.826a8.339 8.339 0 0 0 8.441 0l63.181-36.425v25.221a.87.87 0 0 1-.358.665l-52.335 30.184c-23.257 13.398-52.97 5.431-66.404-17.803ZM23.549 85.38a48.499 48.499 0 0 1 25.58-21.333v61.39a8.288 8.288 0 0 0 4.195 7.316l62.874 36.272-21.845 12.636a.819.819 0 0 1-.767 0L41.353 151.53c-23.211-13.454-31.171-43.144-17.804-66.405v.256Zm179.466 41.695-63.08-36.63L161.73 77.86a.819.819 0 0 1 .768 0l52.233 30.184a48.6 48.6 0 0 1-7.316 87.635v-61.391a8.544 8.544 0 0 0-4.4-7.213Zm21.742-32.69-1.535-.922-51.619-30.081a8.39 8.39 0 0 0-8.492 0L99.98 99.808V74.587a.716.716 0 0 1 .307-.665l52.233-30.133a48.652 48.652 0 0 1 72.236 50.391v.205ZM88.061 139.097l-21.845-12.585a.87.87 0 0 1-.41-.614V65.685a48.652 48.652 0 0 1 79.757-37.346l-1.535.87-51.67 29.825a8.595 8.595 0 0 0-4.246 7.367l-.051 72.697Zm11.868-25.58 28.138-16.217 28.188 16.218v32.434l-28.086 16.218-28.188-16.218-.052-32.434Z"
            />
        </svg>
    </>
);

interface AIInputProps {
    value: string;
    onChange: (value: string) => void;
    onSubmit: () => void;
    placeholder?: string;
    disabled?: boolean;
    selectedModel?: string;
    onModelChange?: (model: string) => void;
    aiProvider?: string;
}

export function AIInput({
    value,
    onChange,
    onSubmit,
    placeholder = "Type instructions...",
    disabled = false,
    selectedModel: externalSelectedModel,
    onModelChange,
    aiProvider,
}: AIInputProps) {
    // Initialize with first model from the provider if available
    const defaultModel = aiProvider 
        ? AI_PROVIDERS.find(p => p.id === aiProvider)?.models[0] || ALL_MODELS[0].id
        : ALL_MODELS[0].id;
    
    const [internalSelectedModel, setInternalSelectedModel] = useState(defaultModel);
    const selectedModel = externalSelectedModel || internalSelectedModel;
    const setSelectedModel = onModelChange || setInternalSelectedModel;
    
    const { textareaRef, adjustHeight } = useAutoResizeTextarea({
        minHeight: 72,
        maxHeight: 300,
    });

    // Filter models by provider if specified
    const availableModels = aiProvider
        ? ALL_MODELS.filter(m => m.provider === aiProvider)
        : ALL_MODELS;

    // Provider icons mapping
    const PROVIDER_ICONS: Record<string, React.ReactNode> = {
        openai: OPENAI_ICON,
        gemini: (
            <svg
                height="1em"
                className="w-4 h-4"
                viewBox="0 0 24 24"
                xmlns="http://www.w3.org/2000/svg"
            >
                <title>Gemini</title>
                <defs>
                    <linearGradient
                        id="gemini-fill"
                        x1="0%"
                        x2="68.73%"
                        y1="100%"
                        y2="30.395%"
                    >
                        <stop offset="0%" stopColor="#1C7DFF" />
                        <stop offset="52.021%" stopColor="#1C69FF" />
                        <stop offset="100%" stopColor="#F0DCD6" />
                    </linearGradient>
                </defs>
                <path
                    d="M12 24A14.304 14.304 0 000 12 14.304 14.304 0 0012 0a14.305 14.305 0 0012 12 14.305 14.305 0 00-12 12"
                    fill="url(#gemini-fill)"
                    fillRule="nonzero"
                />
            </svg>
        ),
        anthropic: (
            <>
                <svg
                    fill="#000"
                    fillRule="evenodd"
                    className="w-4 h-4 dark:hidden block"
                    viewBox="0 0 24 24"
                    width="1em"
                    xmlns="http://www.w3.org/2000/svg"
                >
                    <title>Anthropic Icon Light</title>
                    <path d="M13.827 3.52h3.603L24 20h-3.603l-6.57-16.48zm-7.258 0h3.767L16.906 20h-3.674l-1.343-3.461H5.017l-1.344 3.46H0L6.57 3.522zm4.132 9.959L8.453 7.687 6.205 13.48H10.7z" />
                </svg>
                <svg
                    fill="#fff"
                    fillRule="evenodd"
                    className="w-4 h-4 hidden dark:block"
                    viewBox="0 0 24 24"
                    width="1em"
                    xmlns="http://www.w3.org/2000/svg"
                >
                    <title>Anthropic Icon Dark</title>
                    <path d="M13.827 3.52h3.603L24 20h-3.603l-6.57-16.48zm-7.258 0h3.767L16.906 20h-3.674l-1.343-3.461H5.017l-1.344 3.46H0L6.57 3.522zm4.132 9.959L8.453 7.687 6.205 13.48H10.7z" />
                </svg>
            </>
        ),
        groq: (
            <svg
                viewBox="0 0 24 24"
                className="w-4 h-4"
                fill="currentColor"
            >
                <title>Groq</title>
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 15h-2v-2h2v2zm0-4h-2V7h2v6zm4 4h-2v-2h2v2zm0-4h-2V7h2v6z"/>
            </svg>
        ),
    };

    const getModelIcon = (modelId: string) => {
        const provider = MODEL_PROVIDER_MAP[modelId];
        return PROVIDER_ICONS[provider] || <Bot className="w-4 h-4 opacity-50" />;
    };

    const getModelLabel = (modelId: string) => {
        const model = ALL_MODELS.find(m => m.id === modelId);
        return model?.label || modelId;
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === "Enter" && !e.shiftKey && value.trim()) {
            e.preventDefault();
            onSubmit();
            adjustHeight(true);
        }
    };

    return (
        <div className="bg-muted/30 border border-border rounded-lg p-3">
            <div className="relative">
                <div className="relative flex flex-col">
                    <div
                        className="overflow-y-auto"
                        style={{ maxHeight: "400px" }}
                    >
                        <Textarea
                            value={value}
                            placeholder={placeholder}
                            className={cn(
                                "w-full rounded-lg px-3 py-2 bg-background border-none resize-none focus-visible:ring-0 focus-visible:ring-offset-0",
                                "min-h-[72px] text-sm"
                            )}
                            ref={textareaRef}
                            onKeyDown={handleKeyDown}
                            onChange={(e) => {
                                onChange(e.target.value);
                                adjustHeight();
                            }}
                            disabled={disabled}
                        />
                    </div>

                    <div className="h-10 bg-muted/50 rounded-b-lg flex items-center mt-1">
                        <div className="absolute left-2 right-2 bottom-2 flex items-center justify-between w-[calc(100%-16px)]">
                            <div className="flex items-center gap-2">
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className="flex items-center gap-1.5 h-7 px-2 text-xs rounded-md hover:bg-accent focus-visible:ring-1 focus-visible:ring-offset-0 focus-visible:ring-ring"
                                            disabled={disabled}
                                        >
                                            <AnimatePresence mode="wait">
                                                <motion.div
                                                    key={selectedModel}
                                                    initial={{
                                                        opacity: 0,
                                                        y: -5,
                                                    }}
                                                    animate={{
                                                        opacity: 1,
                                                        y: 0,
                                                    }}
                                                    exit={{
                                                        opacity: 0,
                                                        y: 5,
                                                    }}
                                                    transition={{
                                                        duration: 0.15,
                                                    }}
                                                    className="flex items-center gap-1.5"
                                                >
                                                    {getModelIcon(selectedModel)}
                                                    <span className="hidden sm:inline max-w-[120px] truncate">{getModelLabel(selectedModel)}</span>
                                                    <ChevronDown className="w-3 h-3 opacity-50" />
                                                </motion.div>
                                            </AnimatePresence>
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent
                                        align="start"
                                        className={cn(
                                            "min-w-[200px] max-h-[300px] overflow-y-auto",
                                            "border-border bg-popover"
                                        )}
                                    >
                                        {AI_PROVIDERS.map((provider) => (
                                            <div key={provider.id}>
                                                <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                                                    {provider.label}
                                                </div>
                                                {provider.models.map((model) => (
                                                    <DropdownMenuItem
                                                        key={model}
                                                        onSelect={() => setSelectedModel(model)}
                                                        className="flex items-center justify-between gap-2 text-sm"
                                                    >
                                                        <div className="flex items-center gap-2">
                                                            {getModelIcon(model)}
                                                            <span className="truncate">{model}</span>
                                                        </div>
                                                        {selectedModel === model && (
                                                            <Check className="w-4 h-4 text-primary" />
                                                        )}
                                                    </DropdownMenuItem>
                                                ))}
                                            </div>
                                        ))}
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            </div>
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className={cn(
                                    "h-7 w-7 rounded-md",
                                    "hover:bg-accent",
                                    "disabled:opacity-30 disabled:cursor-not-allowed"
                                )}
                                aria-label="Send message"
                                disabled={!value.trim() || disabled}
                                onClick={() => {
                                    if (!value.trim()) return;
                                    onSubmit();
                                    adjustHeight(true);
                                }}
                            >
                                <ArrowRight
                                    className={cn(
                                        "w-4 h-4 transition-opacity duration-200",
                                        value.trim() && !disabled
                                            ? "opacity-100"
                                            : "opacity-30"
                                    )}
                                />
                            </Button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

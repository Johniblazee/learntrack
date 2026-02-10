'use client';

import { useId, CSSProperties, ReactNode } from 'react'
import { motion } from 'motion/react';
import { cn } from '@/lib/utils';

interface EtherealShadowProps {
    style?: CSSProperties;
    className?: string;
    children?: ReactNode;
    fadeTop?: boolean;
    fadeBottom?: boolean;
}

export function EtherealShadow({
    style,
    className,
    children,
    fadeTop = true,
    fadeBottom = true,
}: EtherealShadowProps) {
    const id = useId().replace(/:/g, "");

    return (
        <div
            className={cn("overflow-hidden relative w-full h-full", className)}
            style={style}
        >
            {/* Animated gradient blobs */}
            <div className="absolute inset-0 overflow-hidden">
                {/* Primary blob - top right */}
                <motion.div
                    className="absolute -top-1/4 -right-1/4 w-[70%] h-[70%] rounded-full bg-primary opacity-30 blur-[100px]"
                    animate={{
                        x: [0, 120, -40, 0],
                        y: [0, 80, -60, 0],
                        scale: [1, 1.4, 0.8, 1],
                    }}
                    transition={{
                        duration: 12,
                        repeat: Infinity,
                        ease: "easeInOut",
                    }}
                />

                {/* Secondary blob - bottom left */}
                <motion.div
                    className="absolute -bottom-1/4 -left-1/4 w-[60%] h-[60%] rounded-full bg-accent opacity-40 blur-[120px]"
                    animate={{
                        x: [0, -80, 100, 0],
                        y: [0, -120, 60, 0],
                        scale: [1, 1.5, 0.7, 1],
                    }}
                    transition={{
                        duration: 15,
                        repeat: Infinity,
                        ease: "easeInOut",
                        delay: 1,
                    }}
                />

                {/* Tertiary blob - center */}
                <motion.div
                    className="absolute top-1/4 left-1/4 w-[50%] h-[50%] rounded-full bg-primary opacity-20 blur-[80px]"
                    animate={{
                        x: [0, 100, -80, 40, 0],
                        y: [0, -80, 60, -40, 0],
                        scale: [1, 0.6, 1.3, 0.8, 1],
                    }}
                    transition={{
                        duration: 18,
                        repeat: Infinity,
                        ease: "easeInOut",
                        delay: 2,
                    }}
                />

                {/* Fourth accent blob */}
                <motion.div
                    className="absolute top-1/2 right-1/4 w-[35%] h-[35%] rounded-full bg-accent opacity-30 blur-[90px]"
                    animate={{
                        x: [0, -100, 80, -60, 0],
                        y: [0, 100, -80, 40, 0],
                        scale: [1, 1.6, 0.6, 1.2, 1],
                    }}
                    transition={{
                        duration: 20,
                        repeat: Infinity,
                        ease: "easeInOut",
                        delay: 0.5,
                    }}
                />
            </div>

            {/* SVG noise texture overlay */}
            <svg className="absolute inset-0 w-full h-full opacity-[0.03] pointer-events-none">
                <defs>
                    <filter id={`noise-${id}`}>
                        <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="4" stitchTiles="stitch"/>
                    </filter>
                </defs>
                <rect width="100%" height="100%" filter={`url(#noise-${id})`}/>
            </svg>

            {/* Top fade gradient */}
            {fadeTop && (
                <div
                    className="absolute top-0 left-0 right-0 h-32 bg-gradient-to-b from-background to-transparent pointer-events-none z-20"
                />
            )}

            {/* Bottom fade gradient */}
            {fadeBottom && (
                <div
                    className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-background to-transparent pointer-events-none z-20"
                />
            )}

            {/* Content overlay */}
            <div className="relative z-10 w-full h-full">
                {children}
            </div>
        </div>
    );
}

export default EtherealShadow;


"use client"

import { motion } from "framer-motion"
import { Link2Off } from "lucide-react"
import Link from "next/link"
import type { NotFoundView } from "@/Themes/contract"

/**
 * The 404 page.
 *
 * Presentation only. The report that feeds the admin panel's broken-link
 * screen is sent by core's `NotFoundReporter`, which `src/app/not-found.tsx`
 * renders alongside this — so a site keeps collecting 404s no matter which
 * theme is installed.
 *
 * The brand line reads the configured site name; it used to be the literal
 * string "FlowCMS", which told every visitor of every install the name of the
 * software rather than the name of the site they were on.
 */

const PARTICLES = [
  { x: 8,  y: 75, delay: 0,    dur: 3.2 },
  { x: 18, y: 85, delay: 0.7,  dur: 2.8 },
  { x: 30, y: 65, delay: 1.4,  dur: 3.6 },
  { x: 42, y: 90, delay: 0.3,  dur: 2.5 },
  { x: 55, y: 80, delay: 1.9,  dur: 3.1 },
  { x: 67, y: 70, delay: 0.9,  dur: 2.9 },
  { x: 78, y: 88, delay: 2.3,  dur: 3.4 },
  { x: 88, y: 60, delay: 0.5,  dur: 2.7 },
  { x: 23, y: 50, delay: 2.8,  dur: 3.8 },
  { x: 93, y: 78, delay: 1.1,  dur: 3.0 },
  { x: 50, y: 55, delay: 2.1,  dur: 2.6 },
  { x: 62, y: 92, delay: 0.4,  dur: 3.3 },
]

export default function NotFound({ brand }: NotFoundView) {
  return (
    <div className="min-h-screen bg-[#09090B] flex flex-col items-center justify-center relative overflow-hidden select-none">

      {/* -- Ambient glow blobs -- */}
      <motion.div
        animate={{ scale: [1, 1.12, 1], opacity: [0.18, 0.28, 0.18] }}
        transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[500px] rounded-full bg-violet-700/30 blur-[120px] pointer-events-none"
      />
      <motion.div
        animate={{ scale: [1, 1.08, 1], opacity: [0.1, 0.18, 0.1] }}
        transition={{ duration: 7, repeat: Infinity, ease: "easeInOut", delay: 2 }}
        className="absolute top-1/4 right-1/4 w-[300px] h-[300px] rounded-full bg-purple-500/20 blur-[80px] pointer-events-none"
      />

      {/* -- Dot grid -- */}
      <div
        className="absolute inset-0 opacity-[0.04] pointer-events-none"
        style={{
          backgroundImage: "radial-gradient(circle, #a78bfa 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      />

      {/* -- Floating particles -- */}
      {PARTICLES.map((p, i) => (
        <motion.span
          key={i}
          className="absolute w-[3px] h-[3px] rounded-full bg-violet-400 pointer-events-none"
          style={{ left: `${p.x}%`, top: `${p.y}%` }}
          animate={{ y: [-10, -90], opacity: [0, 0.7, 0], scale: [0.5, 1, 0.5] }}
          transition={{ duration: p.dur, repeat: Infinity, delay: p.delay, ease: "easeOut" }}
        />
      ))}

      {/* -- Content -- */}
      <div className="relative flex flex-col items-center text-center px-6">

        {/* Icon */}
        <motion.div
          initial={{ y: -50, opacity: 0, scale: 0.7 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          transition={{ type: "spring", stiffness: 200, damping: 18, duration: 0.9 }}
          className="relative mb-8"
        >
          <motion.div
            animate={{ y: [0, -8, 0] }}
            transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
            className="relative"
          >
            {/* Glow ring */}
            <motion.div
              animate={{ opacity: [0.3, 0.7, 0.3], scale: [1, 1.15, 1] }}
              transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
              className="absolute inset-0 rounded-2xl bg-violet-500/30 blur-2xl scale-125 pointer-events-none"
            />
            <div className="w-20 h-20 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-sm flex items-center justify-center">
              <Link2Off className="w-8 h-8 text-violet-400" strokeWidth={1.5} />
            </div>
          </motion.div>
        </motion.div>

        {/* 404 */}
        <motion.div
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 180, damping: 20, delay: 0.15 }}
          className="relative mb-6 leading-none"
        >
          {/* Glow layer */}
          <span
            aria-hidden
            className="absolute inset-0 text-[9rem] sm:text-[11rem] font-black leading-none text-violet-500 opacity-40 blur-3xl pointer-events-none"
          >
            404
          </span>
          {/* Main text */}
          <span className="relative text-[9rem] sm:text-[11rem] font-black leading-none bg-gradient-to-b from-white via-white/80 to-white/10 bg-clip-text text-transparent">
            404
          </span>
        </motion.div>

        {/* Title */}
        <motion.h1
          initial={{ y: 24, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.35, duration: 0.55, ease: "easeOut" }}
          className="text-lg sm:text-xl font-bold text-white/90 mb-2"
        >
          Page not found
        </motion.h1>

        {/* A way out. The previous version was a dead end — the only route off
            this page was the browser's back button. */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5, duration: 0.5 }}
        >
          <Link
            href="/"
            className="text-sm text-violet-300 underline-offset-4 hover:text-violet-200 hover:underline"
          >
            Back to {brand.siteName}
          </Link>
        </motion.div>

        {/* Divider */}
        <motion.div
          initial={{ scaleX: 0, opacity: 0 }}
          animate={{ scaleX: 1, opacity: 1 }}
          transition={{ delay: 0.6, duration: 0.6, ease: "easeOut" }}
          className="mt-10 w-20 h-px bg-gradient-to-r from-transparent via-violet-500/60 to-transparent"
        />

        {/* Brand */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.75, duration: 0.5 }}
          className="mt-4 text-[11px] font-medium tracking-widest text-white/20 uppercase"
        >
          {brand.siteName}
        </motion.p>
      </div>

    </div>
  )
}

'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence, useMotionValue, useAnimationFrame, animate } from 'framer-motion'
import { Gem, Plus, Minus, Maximize2 } from 'lucide-react'
import { extractLinks } from '../Values/contentStats'
import type { BlogPost } from '../Types'

// Logical simulation space — independent of the container's actual rendered
// size, which is measured separately and only used for the viewport/camera.
const WORLD_WIDTH = 1100
const WORLD_HEIGHT = 700

const MIN_ZOOM = 0.4
const MAX_ZOOM = 4
const FOCUS_ZOOM = 2.4
const MAX_FIT_ZOOM = 1.5
const SPRING = { type: 'spring', stiffness: 190, damping: 28 } as const

// Hover-card sizing, used only to keep it clear of the canvas edges — see
// the flip/clamp logic below. A fixed height estimate (rather than
// measuring the actual element) avoids a forced-reflow read every frame.
const CARD_WIDTH = 256
const CARD_HEIGHT_ESTIMATE = 190
const CARD_MARGIN = 10

// Dark-mode categorical steps from the design system's validated palette —
// fixed order, never cycled per-render, so a category keeps its colour as
// the post list changes. Beyond 8 categories the rest fold into OTHER_COLOR
// rather than generating a 9th hue.
const CATEGORY_COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767']
const OTHER_COLOR = '#8b93a7'

const EDGE_COLOR = {
  linking: 'rgba(52, 211, 153, 0.6)',
  'not-linking': 'rgba(250, 178, 25, 0.45)',
  series: 'rgba(147, 197, 253, 0.4)',
} as const

const EDGE_IDEAL_LEN = {
  linking: 62,
  'not-linking': 105,
  series: 85,
} as const

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** Deterministic FNV-1a string hash → [0, 1). Used to jitter the initial
 *  layout per-node so same-shaped clusters don't all render as a perfect
 *  symmetric asterisk — stays pure (no Math.random) so it's safe to run
 *  during render. */
function hashToUnit(input: string): number {
  let h = 2166136261
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 100000) / 100000
}

interface GraphNode {
  id: string
  post: BlogPost
  categoryId: string
  categoryName: string
  color: string
  isCornerstone: boolean
  r: number
  x: number
  y: number
  vx: number
  vy: number
}

interface GraphEdge {
  source: string
  target: string
  kind: 'linking' | 'not-linking' | 'series'
}

/** Primary category, with the deterministic fallback the public side uses:
 *  the alphabetically-first linked category. Never "whichever row came back
 *  first", which can change between deploys. */
function clusterKeyOf(post: BlogPost): { id: string; name: string } | null {
  if (post.primaryCategoryId) {
    const primary = post.categories.find((category) => category.id === post.primaryCategoryId)
    if (primary) return primary
  }
  const sorted = [...post.categories].sort((a, b) => a.name.localeCompare(b.name))
  return sorted[0] ?? null
}

function buildGraph(posts: BlogPost[]) {
  // Sorted by name, not query order, so a category's colour slot doesn't
  // jitter between renders when the list re-fetches in a different order.
  const categoryNameById = new Map<string, string>()
  for (const post of posts) {
    for (const category of post.categories) categoryNameById.set(category.id, category.name)
  }
  const categories = Array.from(categoryNameById.entries())
    .sort((a, b) => a[1].localeCompare(b[1]))
    .map(([id, name], i) => ({ id, name, color: CATEGORY_COLORS[i % CATEGORY_COLORS.length] ?? OTHER_COLOR }))
  const colorByCategoryId = new Map(categories.map((c) => [c.id, c.color]))

  const groups = new Map<string, { name: string; posts: BlogPost[] }>()
  let uncategorisedCount = 0
  for (const post of posts) {
    const key = clusterKeyOf(post)
    if (!key) {
      uncategorisedCount++
      continue
    }
    const group = groups.get(key.id) ?? { name: key.name, posts: [] }
    group.posts.push(post)
    groups.set(key.id, group)
  }

  /** Slugs each post links to, restricted to `/blog/...` — reused from the
   *  same link extractor the flat cluster list used. */
  const outboundBySlug = new Map<string, Set<string>>()
  for (const post of posts) {
    const slugs = new Set(
      extractLinks(post.content)
        .map((link) => link.href.match(/\/blog\/([^/?#]+)/)?.[1])
        .filter((slug): slug is string => !!slug)
    )
    outboundBySlug.set(post.id, slugs)
  }

  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []
  const missingCornerstone: string[] = []

  for (const [categoryId, group] of groups) {
    const color = colorByCategoryId.get(categoryId) ?? OTHER_COLOR
    const cornerstones = group.posts.filter((post) => post.isCornerstone)
    if (cornerstones.length === 0) missingCornerstone.push(group.name)

    for (const post of group.posts) {
      const inboundCount = group.posts.filter(
        (other) => other.id !== post.id && outboundBySlug.get(other.id)?.has(post.slug)
      ).length
      nodes.push({
        id: post.id,
        post,
        categoryId,
        categoryName: group.name,
        color,
        isCornerstone: post.isCornerstone,
        r: (post.isCornerstone ? 15 : 7) + Math.min(inboundCount, 4) * 1.4,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
      })
    }

    // The actionable edge: every other post in the category, coloured by
    // whether it actually links to the pillar — the same distinction the
    // flat list drew as two columns. Linking posts get pulled in tighter
    // (see EDGE_IDEAL_LEN) so "engaged with the pillar" reads as physically
    // closer, not just green.
    for (const cornerstone of cornerstones) {
      for (const post of group.posts) {
        if (post.id === cornerstone.id) continue
        const linking = outboundBySlug.get(post.id)?.has(cornerstone.slug) ?? false
        edges.push({ source: post.id, target: cornerstone.id, kind: linking ? 'linking' : 'not-linking' })
      }
    }
  }

  // Series chains, independent of category — a part 2 sits beside its part 1
  // even when they're in different clusters.
  const postsBySeries = new Map<string, BlogPost[]>()
  for (const post of posts) {
    if (!post.seriesId) continue
    const list = postsBySeries.get(post.seriesId) ?? []
    list.push(post)
    postsBySeries.set(post.seriesId, list)
  }
  for (const seriesPosts of postsBySeries.values()) {
    const ordered = [...seriesPosts].sort((a, b) => (a.seriesPosition ?? 0) - (b.seriesPosition ?? 0))
    for (let i = 0; i < ordered.length - 1; i++) {
      edges.push({ source: ordered[i].id, target: ordered[i + 1].id, kind: 'series' })
    }
  }

  return { nodes, edges, categories, uncategorisedCount, missingCornerstone }
}

/**
 * Force-directed layout, computed once per graph rather than animated live.
 *
 * A from-scratch Fruchterman-Reingold-style simulation rather than pulling in
 * d3-force or a graph library for one screen: repulsion between every pair,
 * a spring per edge (its rest length set by EDGE_IDEAL_LEN, by kind), a weak
 * pull toward the shared centre, and a pull toward each node's own category
 * centroid — that last one is what turns a set of category hub-and-spoke
 * stars into visually distinct colour blobs. A deterministic per-node
 * angle/radius jitter (see hashToUnit) keeps same-shaped clusters from all
 * rendering as an identical perfect asterisk.
 */
function simulate(nodes: GraphNode[], edges: GraphEdge[]): GraphNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const center = { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 }

  nodes.forEach((n, i) => {
    const baseAngle = (i / nodes.length) * Math.PI * 2
    const jitterAngle = (hashToUnit(n.id) - 0.5) * 1.1
    const jitterRadius = 0.7 + hashToUnit(`${n.id}:r`) * 0.6
    const radius = Math.min(WORLD_WIDTH, WORLD_HEIGHT) * 0.32 * jitterRadius
    n.x = center.x + Math.cos(baseAngle + jitterAngle) * radius
    n.y = center.y + Math.sin(baseAngle + jitterAngle) * radius
    n.vx = 0
    n.vy = 0
  })

  const REPULSION = 3200
  const SPRING_K = 0.02
  const CENTER_PULL = 0.006
  const CLUSTER_PULL = 0.02
  const DAMPING = 0.85
  const ITERATIONS = 360

  for (let iter = 0; iter < ITERATIONS; iter++) {
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i]
        const b = nodes[j]
        let dx = a.x - b.x
        let dy = a.y - b.y
        let distSq = dx * dx + dy * dy
        if (distSq < 1) {
          dx = i % 2 === 0 ? 0.5 : -0.5
          dy = j % 2 === 0 ? 0.5 : -0.5
          distSq = 1
        }
        const dist = Math.sqrt(distSq)
        const force = REPULSION / distSq
        const fx = (dx / dist) * force
        const fy = (dy / dist) * force
        a.vx += fx
        a.vy += fy
        b.vx -= fx
        b.vy -= fy
      }
    }

    for (const edge of edges) {
      const a = byId.get(edge.source)
      const b = byId.get(edge.target)
      if (!a || !b) continue
      const dx = b.x - a.x
      const dy = b.y - a.y
      const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1)
      const force = SPRING_K * (dist - EDGE_IDEAL_LEN[edge.kind])
      const fx = (dx / dist) * force
      const fy = (dy / dist) * force
      a.vx += fx
      a.vy += fy
      b.vx -= fx
      b.vy -= fy
    }

    const centroids = new Map<string, { x: number; y: number; count: number }>()
    for (const n of nodes) {
      const c = centroids.get(n.categoryId) ?? { x: 0, y: 0, count: 0 }
      c.x += n.x
      c.y += n.y
      c.count++
      centroids.set(n.categoryId, c)
    }
    for (const n of nodes) {
      const c = centroids.get(n.categoryId)!
      n.vx += (c.x / c.count - n.x) * CLUSTER_PULL
      n.vy += (c.y / c.count - n.y) * CLUSTER_PULL
      n.vx += (center.x - n.x) * CENTER_PULL
      n.vy += (center.y - n.y) * CENTER_PULL
    }

    for (const n of nodes) {
      n.vx *= DAMPING
      n.vy *= DAMPING
      n.x += n.vx
      n.y += n.vy
      const margin = n.r + 20
      n.x = clamp(n.x, margin, WORLD_WIDTH - margin)
      n.y = clamp(n.y, margin, WORLD_HEIGHT - margin)
    }
  }

  return nodes
}

/** Quadratic-curve control point, offset perpendicular to the edge by a
 *  fraction of its own length — derived purely from node positions, so the
 *  curve is stable across re-renders instead of jittering with Math.random(). */
function curvedPath(a: { x: number; y: number }, b: { x: number; y: number }): string {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.sqrt(dx * dx + dy * dy) || 1
  const curvature = 0.15
  const cx = (a.x + b.x) / 2 - (dy / len) * len * curvature
  const cy = (a.y + b.y) / 2 + (dx / len) * len * curvature
  return `M ${a.x} ${a.y} Q ${cx} ${cy} ${b.x} ${b.y}`
}

function publishBadge(post: BlogPost): { text: string; className: string } {
  if (post.isPublished) return { text: 'Published', className: 'bg-emerald-400/15 text-emerald-300' }
  if (post.scheduledPublishAt) return { text: 'Scheduled', className: 'bg-amber-400/15 text-amber-300' }
  return { text: 'Draft', className: 'bg-slate-400/20 text-slate-300' }
}

function reviewBadge(status: BlogPost['reviewStatus']): { text: string; className: string } | null {
  switch (status) {
    case 'pending':
      return { text: 'Pending review', className: 'bg-sky-400/15 text-sky-300' }
    case 'approved':
      return { text: 'Approved', className: 'bg-emerald-400/15 text-emerald-300' }
    case 'rejected':
      return { text: 'Changes requested', className: 'bg-rose-400/15 text-rose-300' }
    default:
      return null
  }
}

export default function BlogClusterGraph({
  posts,
  onOpen,
}: {
  posts: BlogPost[]
  onOpen: (post: BlogPost) => void
}) {
  const { nodes: rawNodes, edges, categories, uncategorisedCount, missingCornerstone } = useMemo(
    () => buildGraph(posts),
    [posts]
  )
  // `simulate` is a pure function of nodes/edges (no Math.random, no
  // Date.now), so the layout is safe to compute during render rather than
  // deferred to an effect.
  const nodes = useMemo(
    () => (rawNodes.length === 0 ? [] : simulate(rawNodes.map((n) => ({ ...n })), edges)),
    [rawNodes, edges]
  )
  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes])

  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const containerRef = useRef<HTMLDivElement>(null)
  const [viewport, setViewport] = useState({ width: 960, height: 540 })

  const panX = useMotionValue(0)
  const panY = useMotionValue(0)
  const scale = useMotionValue(1)

  const cardWrapperRef = useRef<HTMLDivElement>(null)

  // The pan/zoom transform is applied imperatively to a plain (non-motion)
  // <g> rather than through motion.g's own style.transform: framer-motion
  // unconditionally stamps `transform-box: fill-box; transform-origin: 50%
  // 50%` on SVG motion components (its default for scaling icons around
  // their own centre), which silently overrides an explicit `transformOrigin:
  // '0px 0px'` and breaks the translate+scale math below — the content
  // renders scaled around its own bounding-box centre instead of world
  // (0,0), so it drifts off-screen at any real zoom level.
  const worldGroupRef = useRef<SVGGElement>(null)
  useAnimationFrame(() => {
    const el = worldGroupRef.current
    if (!el) return
    el.style.transform = `translate(${panX.get()}px, ${panY.get()}px) scale(${scale.get()})`
  })

  // -- Measure the container so screen pixels map 1:1 to SVG user units,
  // independent of the fixed WORLD_WIDTH/HEIGHT the simulation runs in. -----
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const update = () => {
      const rect = el.getBoundingClientRect()
      setViewport({ width: rect.width, height: rect.height })
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // -- Wheel-to-zoom, centred on the cursor. Native + non-passive so we can
  // actually stop the page from scrolling underneath the canvas. -----------
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    function handleWheel(e: WheelEvent) {
      e.preventDefault()
      const rect = el!.getBoundingClientRect()
      const px = e.clientX - rect.left
      const py = e.clientY - rect.top
      const s0 = scale.get()
      const s1 = clamp(s0 * (1 - e.deltaY * 0.0016), MIN_ZOOM, MAX_ZOOM)
      const worldX = (px - panX.get()) / s0
      const worldY = (py - panY.get()) / s0
      scale.set(s1)
      panX.set(px - worldX * s1)
      panY.set(py - worldY * s1)
    }
    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => el.removeEventListener('wheel', handleWheel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // -- Fit-to-content: the camera framing that shows the whole graph. ------
  const fit = useMemo(() => {
    if (nodes.length === 0) {
      return { scale: 1, x: viewport.width / 2, y: viewport.height / 2 }
    }
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const n of nodes) {
      minX = Math.min(minX, n.x - n.r)
      maxX = Math.max(maxX, n.x + n.r)
      minY = Math.min(minY, n.y - n.r)
      maxY = Math.max(maxY, n.y + n.r)
    }
    const contentW = Math.max(maxX - minX, 1)
    const contentH = Math.max(maxY - minY, 1)
    const padding = 56
    const s = clamp(
      Math.min((viewport.width - padding * 2) / contentW, (viewport.height - padding * 2) / contentH),
      MIN_ZOOM,
      MAX_FIT_ZOOM
    )
    const cx = (minX + maxX) / 2
    const cy = (minY + maxY) / 2
    return { scale: s, x: viewport.width / 2 - cx * s, y: viewport.height / 2 - cy * s }
  }, [nodes, viewport])

  function resetView() {
    animate(scale, fit.scale, SPRING)
    animate(panX, fit.x, SPRING)
    animate(panY, fit.y, SPRING)
    setSelectedId(null)
  }

  function focusNode(node: GraphNode) {
    const s = Math.min(FOCUS_ZOOM, MAX_ZOOM)
    animate(scale, s, SPRING)
    animate(panX, viewport.width / 2 - node.x * s, SPRING)
    animate(panY, viewport.height / 2 - node.y * s, SPRING)
    setSelectedId(node.id)
  }

  function stepZoom(factor: number) {
    const cx = viewport.width / 2
    const cy = viewport.height / 2
    const s0 = scale.get()
    const s1 = clamp(s0 * factor, MIN_ZOOM, MAX_ZOOM)
    const worldX = (cx - panX.get()) / s0
    const worldY = (cy - panY.get()) / s0
    animate(scale, s1, SPRING)
    animate(panX, cx - worldX * s1, SPRING)
    animate(panY, cy - worldY * s1, SPRING)
  }

  // Applies the fit framing once per dataset: instantly on first mount (no
  // pop-from-nowhere), then smoothly animated if the underlying post list
  // changes later (a filter, a refetch).
  const didFitRef = useRef(false)
  useEffect(() => {
    didFitRef.current = false
  }, [nodes])
  useEffect(() => {
    if (viewport.width === 0) return
    if (!didFitRef.current) {
      panX.set(fit.x)
      panY.set(fit.y)
      scale.set(fit.scale)
      didFitRef.current = true
    } else {
      animate(scale, fit.scale, SPRING)
      animate(panX, fit.x, SPRING)
      animate(panY, fit.y, SPRING)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fit, viewport.width])

  // -- Drag-to-pan on empty canvas; a background click with no drag resets
  // the selection instead of panning. ---------------------------------------
  const dragRef = useRef({ dragging: false, moved: false, startX: 0, startY: 0, startPanX: 0, startPanY: 0 })

  function onBackgroundPointerDown(e: React.PointerEvent) {
    dragRef.current = {
      dragging: true,
      moved: false,
      startX: e.clientX,
      startY: e.clientY,
      startPanX: panX.get(),
      startPanY: panY.get(),
    }
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
  }
  function onBackgroundPointerMove(e: React.PointerEvent) {
    const info = dragRef.current
    if (!info.dragging) return
    const dx = e.clientX - info.startX
    const dy = e.clientY - info.startY
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) info.moved = true
    panX.set(info.startPanX + dx)
    panY.set(info.startPanY + dy)
  }
  function onBackgroundPointerUp() {
    const info = dragRef.current
    dragRef.current.dragging = false
    if (!info.moved && selectedId) resetView()
  }

  // -- Click vs double-click on a node: click focuses/toggles, double-click
  // opens the editor. A short delay lets a second click cancel the first. --
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  function onNodeClick(node: GraphNode) {
    if (clickTimer.current) clearTimeout(clickTimer.current)
    clickTimer.current = setTimeout(() => {
      if (selectedId === node.id) resetView()
      else focusNode(node)
      clickTimer.current = null
    }, 220)
  }
  function onNodeDoubleClick(node: GraphNode) {
    if (clickTimer.current) {
      clearTimeout(clickTimer.current)
      clickTimer.current = null
    }
    onOpen(node.post)
  }

  // -- The hover card tracks its target node's on-screen position every
  // frame, so it stays glued to the node through the pan/zoom spring instead
  // of jumping once the animation settles. It also flips below the node and
  // clamps horizontally near the edges, so the canvas's own overflow-hidden
  // never clips it (as it did anchored unconditionally above the node). ----
  const activeId = hoveredId ?? selectedId
  const activeNode = activeId ? nodeById.get(activeId) : undefined
  useAnimationFrame(() => {
    const el = cardWrapperRef.current
    if (!activeNode || !el) return
    const s = scale.get()
    const screenX = panX.get() + activeNode.x * s
    const screenY = panY.get() + activeNode.y * s
    const gap = activeNode.r + 16
    const flipBelow = screenY - gap < CARD_HEIGHT_ESTIMATE
    const clampedX = clamp(screenX, CARD_WIDTH / 2 + CARD_MARGIN, viewport.width - CARD_WIDTH / 2 - CARD_MARGIN)
    el.style.left = `${clampedX}px`
    el.style.top = `${flipBelow ? screenY + gap : screenY - gap}px`
    el.style.transform = flipBelow ? 'translate(-50%, 0%)' : 'translate(-50%, -100%)'
  })

  if (rawNodes.length === 0) {
    return (
      <div className="p-5">
        <p className="text-sm text-muted-foreground">No posts with categories yet.</p>
      </div>
    )
  }

  const publish = activeNode ? publishBadge(activeNode.post) : null
  const review = activeNode ? reviewBadge(activeNode.post.reviewStatus) : null

  return (
    <div className="flex flex-col gap-4 p-5">
      <p className="text-xs text-muted-foreground">
        Posts grouped by primary category and pulled into clusters by shared category and series.
        Green lines are posts that link to their cluster&apos;s cornerstone; amber lines are posts
        that don&apos;t — the actionable gap. Scroll or use the controls to zoom, drag to pan. Hover a
        node for details, click to focus, double-click to edit.
      </p>

      <div
        ref={containerRef}
        className="relative h-[560px] w-full touch-none overflow-hidden rounded-xl border border-border select-none"
        style={{ background: '#0a0e1a' }}
      >
        <svg width={viewport.width} height={viewport.height} viewBox={`0 0 ${viewport.width} ${viewport.height}`}>
          <defs>
            <radialGradient id="cluster-bg" cx="50%" cy="42%" r="75%">
              <stop offset="0%" stopColor="#141a2e" />
              <stop offset="100%" stopColor="#0a0e1a" />
            </radialGradient>
          </defs>
          <rect
            x={0}
            y={0}
            width={viewport.width}
            height={viewport.height}
            fill="url(#cluster-bg)"
            className="cursor-grab active:cursor-grabbing"
            onPointerDown={onBackgroundPointerDown}
            onPointerMove={onBackgroundPointerMove}
            onPointerUp={onBackgroundPointerUp}
          />

          <g ref={worldGroupRef} style={{ transformOrigin: '0px 0px' }}>
            <g fill="none">
              {edges.map((edge, i) => {
                const a = nodeById.get(edge.source)
                const b = nodeById.get(edge.target)
                if (!a || !b) return null
                const dimmed = activeId && activeId !== a.id && activeId !== b.id
                return (
                  <motion.path
                    key={`${edge.source}-${edge.target}-${i}`}
                    d={curvedPath(a, b)}
                    stroke={EDGE_COLOR[edge.kind]}
                    strokeWidth={edge.kind === 'series' ? 1.25 : 1.5}
                    strokeDasharray={
                      edge.kind === 'not-linking' ? '4 3' : edge.kind === 'series' ? '2 3' : undefined
                    }
                    initial={{ pathLength: 0, opacity: 0 }}
                    animate={{ pathLength: 1, opacity: dimmed ? 0.12 : 1 }}
                    transition={{ pathLength: { duration: 0.7, ease: 'easeOut' }, opacity: { duration: 0.2 } }}
                  />
                )
              })}
            </g>

            <g>
              {nodes.map((node) => {
                const isActive = activeId === node.id
                const dimmed = activeId ? !isActive : false
                return (
                  <g key={node.id} transform={`translate(${node.x}, ${node.y})`}>
                    <motion.g
                      initial={{ opacity: 0, scale: 0 }}
                      animate={{ opacity: dimmed ? 0.35 : 1, scale: isActive ? 1.18 : 1 }}
                      transition={SPRING}
                      onMouseEnter={() => setHoveredId(node.id)}
                      onMouseLeave={() => setHoveredId((current) => (current === node.id ? null : current))}
                      onClick={(e) => {
                        e.stopPropagation()
                        onNodeClick(node)
                      }}
                      onDoubleClick={(e) => {
                        e.stopPropagation()
                        onNodeDoubleClick(node)
                      }}
                      className="cursor-pointer"
                    >
                      {node.isCornerstone && (
                        <motion.circle
                          r={node.r + 8}
                          fill={node.color}
                          animate={{ opacity: [0.14, 0.32, 0.14] }}
                          transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
                        />
                      )}
                      <circle
                        r={node.r}
                        fill={node.color}
                        stroke={node.isCornerstone ? '#ffffff' : 'rgba(255,255,255,0.3)'}
                        strokeWidth={node.isCornerstone ? 2 : 1}
                      />
                      {isActive && (
                        <circle r={node.r + 4} fill="none" stroke="#ffffff" strokeWidth={1.25} opacity={0.55} />
                      )}
                    </motion.g>
                  </g>
                )
              })}
            </g>
          </g>
        </svg>

        {/* Zoom controls */}
        <div className="pointer-events-auto absolute bottom-3 right-3 flex flex-col gap-0.5 rounded-lg border border-white/10 bg-black/50 p-1 backdrop-blur-sm">
          <button
            type="button"
            title="Zoom in"
            onClick={() => stepZoom(1.35)}
            className="flex size-7 items-center justify-center rounded-md text-white/70 transition-colors hover:bg-white/10 hover:text-white"
          >
            <Plus size={14} />
          </button>
          <button
            type="button"
            title="Zoom out"
            onClick={() => stepZoom(1 / 1.35)}
            className="flex size-7 items-center justify-center rounded-md text-white/70 transition-colors hover:bg-white/10 hover:text-white"
          >
            <Minus size={14} />
          </button>
          <div className="h-px bg-white/10" />
          <button
            type="button"
            title="Fit to view"
            onClick={resetView}
            className="flex size-7 items-center justify-center rounded-md text-white/70 transition-colors hover:bg-white/10 hover:text-white"
          >
            <Maximize2 size={13} />
          </button>
        </div>

        {/* Hover / selection detail card. Position (left/top/transform) is
            driven imperatively by the useAnimationFrame above rather than
            through React state or a motion style — it needs to flip and
            clamp every frame during a pan/zoom, and a plain ref sidesteps
            both a re-render storm and framer-motion's SVG-only transform
            quirks (see worldGroupRef above). */}
        <AnimatePresence>
          {activeNode && (
            <div key={activeNode.id} ref={cardWrapperRef} className="pointer-events-none absolute left-0 top-0 z-10">
                <motion.div
                  initial={{ opacity: 0, scale: 0.92, y: 4 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.92, y: 4 }}
                  transition={{ duration: 0.15 }}
                  className="w-64 rounded-lg border border-white/10 bg-[#12172b]/95 p-3 shadow-2xl backdrop-blur-sm"
                >
                  <div className="flex items-center gap-1.5">
                  <span className="inline-block size-2 rounded-full" style={{ backgroundColor: activeNode.color }} />
                  <span className="text-[10px] font-medium tracking-wide text-white/50 uppercase">
                    {activeNode.categoryName}
                  </span>
                  {activeNode.isCornerstone && (
                    <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-amber-400/15 px-1.5 py-0.5 text-[9px] font-medium text-amber-300">
                      <Gem size={9} />
                      Pillar
                    </span>
                  )}
                </div>

                <p className="mt-1.5 line-clamp-2 text-[13px] font-semibold leading-snug text-white">
                  {activeNode.post.title}
                </p>

                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {publish && (
                    <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-medium ${publish.className}`}>
                      {publish.text}
                    </span>
                  )}
                  {review && (
                    <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-medium ${review.className}`}>
                      {review.text}
                    </span>
                  )}
                </div>

                {(activeNode.post.wordCount != null ||
                  activeNode.post.seoScore != null ||
                  activeNode.post.series) && (
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-white/50">
                    {activeNode.post.wordCount != null && <span>{activeNode.post.wordCount} words</span>}
                    {activeNode.post.seoScore != null && <span>SEO {activeNode.post.seoScore}</span>}
                    {activeNode.post.series && (
                      <span>
                        {activeNode.post.series.name}
                        {activeNode.post.seriesPosition != null ? ` #${activeNode.post.seriesPosition}` : ''}
                      </span>
                    )}
                  </div>
                )}

                <p className="mt-2 text-[9px] text-white/35">
                  {selectedId === activeNode.id ? 'Double-click to edit' : 'Click to focus · Double-click to edit'}
                </p>
                </motion.div>
            </div>
          )}
        </AnimatePresence>
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        {categories.map((category) => (
          <span key={category.id} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="inline-block size-2.5 rounded-full" style={{ backgroundColor: category.color }} />
            {category.name}
          </span>
        ))}
        <span className="mx-1 h-3 w-px bg-border" />
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="inline-block h-0.5 w-4 rounded-full bg-success" />
          Links to pillar
        </span>
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="inline-block h-0 w-4 border-t-2 border-dashed border-warning" />
          Doesn&apos;t link
        </span>
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="inline-block h-0 w-4 border-t-2 border-dashed border-info" />
          Same series
        </span>
      </div>

      {missingCornerstone.length > 0 && (
        <p className="text-xs text-warning">
          No cornerstone post yet in: {missingCornerstone.join(', ')}. A cluster with no pillar has
          nothing to point at.
        </p>
      )}
      {uncategorisedCount > 0 && (
        <p className="text-xs text-muted-foreground">
          {uncategorisedCount} post{uncategorisedCount === 1 ? '' : 's'} have no category and belong to
          no cluster.
        </p>
      )}
    </div>
  )
}

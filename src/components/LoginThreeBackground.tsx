'use client'

import { useEffect, useRef } from 'react'
import * as THREE from 'three'

const PARTICLE_COUNT = 160
const CONNECTION_DISTANCE = 120
const FIELD_SIZE = 600

export default function LoginThreeBackground() {
  const mountRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

    // Scene
    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#060d1f')
    scene.fog = new THREE.Fog('#060d1f', 400, 900)

    // Camera
    const camera = new THREE.PerspectiveCamera(60, mount.clientWidth / mount.clientHeight, 0.1, 2000)
    camera.position.set(0, 0, 380)

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(mount.clientWidth, mount.clientHeight)
    mount.appendChild(renderer.domElement)

    // Particles
    const positions: THREE.Vector3[] = []
    const velocities: THREE.Vector3[] = []

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      positions.push(
        new THREE.Vector3(
          (Math.random() - 0.5) * FIELD_SIZE,
          (Math.random() - 0.5) * FIELD_SIZE,
          (Math.random() - 0.5) * FIELD_SIZE * 0.5,
        ),
      )
      velocities.push(
        new THREE.Vector3(
          (Math.random() - 0.5) * 0.18,
          (Math.random() - 0.5) * 0.18,
          (Math.random() - 0.5) * 0.06,
        ),
      )
    }

    // Particle dots
    const dotGeo = new THREE.BufferGeometry()
    const dotPositions = new Float32Array(PARTICLE_COUNT * 3)
    positions.forEach((p, i) => {
      dotPositions[i * 3] = p.x
      dotPositions[i * 3 + 1] = p.y
      dotPositions[i * 3 + 2] = p.z
    })
    dotGeo.setAttribute('position', new THREE.BufferAttribute(dotPositions, 3))

    const dotMat = new THREE.PointsMaterial({
      color: '#7dd3fc',
      size: 2.8,
      transparent: true,
      opacity: 0.85,
      sizeAttenuation: true,
    })
    const dots = new THREE.Points(dotGeo, dotMat)
    scene.add(dots)

    // Connection lines (dynamic LineSegments)
    const maxLines = PARTICLE_COUNT * PARTICLE_COUNT
    const linePositions = new Float32Array(maxLines * 6)
    const lineColors = new Float32Array(maxLines * 6)
    const lineGeo = new THREE.BufferGeometry()
    lineGeo.setAttribute('position', new THREE.BufferAttribute(linePositions, 3).setUsage(THREE.DynamicDrawUsage))
    lineGeo.setAttribute('color', new THREE.BufferAttribute(lineColors, 3).setUsage(THREE.DynamicDrawUsage))

    const lineMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.55,
    })
    const lines = new THREE.LineSegments(lineGeo, lineMat)
    scene.add(lines)

    // Accent orb — soft glowing sphere in the background
    const orbGeo = new THREE.SphereGeometry(80, 32, 32)
    const orbMat = new THREE.MeshBasicMaterial({
      color: '#1e3a5f',
      transparent: true,
      opacity: 0.18,
    })
    const orb = new THREE.Mesh(orbGeo, orbMat)
    orb.position.set(-120, 60, -200)
    scene.add(orb)

    // Second accent orb
    const orb2Geo = new THREE.SphereGeometry(50, 32, 32)
    const orb2Mat = new THREE.MeshBasicMaterial({
      color: '#312e81',
      transparent: true,
      opacity: 0.2,
    })
    const orb2 = new THREE.Mesh(orb2Geo, orb2Mat)
    orb2.position.set(160, -80, -150)
    scene.add(orb2)

    // Mouse parallax
    const mouse = { x: 0, y: 0 }
    const handleMouseMove = (e: MouseEvent) => {
      mouse.x = (e.clientX / window.innerWidth - 0.5) * 2
      mouse.y = -(e.clientY / window.innerHeight - 0.5) * 2
    }
    window.addEventListener('mousemove', handleMouseMove)

    // Resize
    const handleResize = () => {
      if (!mount) return
      camera.aspect = mount.clientWidth / mount.clientHeight
      camera.updateProjectionMatrix()
      renderer.setSize(mount.clientWidth, mount.clientHeight)
    }
    window.addEventListener('resize', handleResize)

    // Colour helpers
    const nearColor = new THREE.Color('#38bdf8')   // sky-400
    const farColor = new THREE.Color('#1e40af')    // blue-800

    let animId: number

    const animate = () => {
      animId = requestAnimationFrame(animate)

      // Update particle positions
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        positions[i].add(velocities[i])

        const half = FIELD_SIZE / 2
        if (Math.abs(positions[i].x) > half) velocities[i].x *= -1
        if (Math.abs(positions[i].y) > half) velocities[i].y *= -1
        if (Math.abs(positions[i].z) > FIELD_SIZE * 0.25) velocities[i].z *= -1

        dotPositions[i * 3] = positions[i].x
        dotPositions[i * 3 + 1] = positions[i].y
        dotPositions[i * 3 + 2] = positions[i].z
      }
      dotGeo.attributes.position.needsUpdate = true

      // Build connection segments
      let segIdx = 0
      for (let a = 0; a < PARTICLE_COUNT; a++) {
        for (let b = a + 1; b < PARTICLE_COUNT; b++) {
          const dist = positions[a].distanceTo(positions[b])
          if (dist < CONNECTION_DISTANCE) {
            const t = 1 - dist / CONNECTION_DISTANCE
            const col = nearColor.clone().lerp(farColor, 1 - t)

            linePositions[segIdx * 6] = positions[a].x
            linePositions[segIdx * 6 + 1] = positions[a].y
            linePositions[segIdx * 6 + 2] = positions[a].z
            linePositions[segIdx * 6 + 3] = positions[b].x
            linePositions[segIdx * 6 + 4] = positions[b].y
            linePositions[segIdx * 6 + 5] = positions[b].z

            lineColors[segIdx * 6] = col.r * t
            lineColors[segIdx * 6 + 1] = col.g * t
            lineColors[segIdx * 6 + 2] = col.b * t
            lineColors[segIdx * 6 + 3] = col.r * t
            lineColors[segIdx * 6 + 4] = col.g * t
            lineColors[segIdx * 6 + 5] = col.b * t

            segIdx++
          }
        }
      }
      lineGeo.setDrawRange(0, segIdx * 2)
      lineGeo.attributes.position.needsUpdate = true
      lineGeo.attributes.color.needsUpdate = true

      // Slow camera drift + mouse parallax
      const time = Date.now() * 0.0002
      camera.position.x += (mouse.x * 30 - camera.position.x) * 0.03
      camera.position.y += (mouse.y * 20 - camera.position.y) * 0.03
      camera.position.z = 380 + Math.sin(time) * 20
      camera.lookAt(0, 0, 0)

      renderer.render(scene, camera)
    }

    animate()

    return () => {
      cancelAnimationFrame(animId)
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('resize', handleResize)
      renderer.dispose()
      if (mount.contains(renderer.domElement)) {
        mount.removeChild(renderer.domElement)
      }
    }
  }, [])

  return <div ref={mountRef} className="absolute inset-0" />
}

export interface RedisStatus {
  connected: boolean
  latencyMs: number | null
  dbSize: number | null
  usedMemoryHuman: string | null
  uptimeSeconds: number | null
  connectedClients: number | null
  keyspaceHits: number | null
  keyspaceMisses: number | null
  hitRatePercent: number | null
  appKeyCount: number | null
}

export interface KeySummary extends Record<string, unknown> {
  key: string
  type: string
  ttlSeconds: number | null
}

export interface ScanPage {
  keys: KeySummary[]
  nextCursor: string
  done: boolean
}

export interface KeyDetail {
  key: string
  type: string
  ttlSeconds: number | null
  approxBytes: number | null
  value: unknown
}

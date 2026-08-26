import type { BingKeyword, BingKeywordStatsPoint } from "@/Framework/Integrations/BingWebmaster/keywords"

export type { BingKeyword, BingKeywordStatsPoint }

export interface BingKeywordsSummary {
  status: "ok" | "not_connected" | "prompt"
  reason: string | null
  query: string
  stats: BingKeywordStatsPoint[]
  related: BingKeyword[]
}

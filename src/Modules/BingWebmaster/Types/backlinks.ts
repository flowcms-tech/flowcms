export interface BingBacklinksLinkRow extends Record<string, unknown> {
  url: string
  count: number
}

export interface BingBacklinksConnectedPage {
  url: string
}

export interface BingBacklinksSummary {
  status: "ok" | "not_connected"
  reason: string | null
  siteUrl: string
  links: BingBacklinksLinkRow[]
  totalPages: number
  connectedPages: BingBacklinksConnectedPage[]
}

export interface BingUrlLinkRow {
  url: string
  anchorText: string
}

export interface BingUrlLinksDetail {
  status: "ok" | "not_connected"
  reason: string | null
  url: string
  details: BingUrlLinkRow[]
  totalPages: number
}

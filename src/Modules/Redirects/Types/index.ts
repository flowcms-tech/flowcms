export interface Redirect extends Record<string, unknown> {
  id: string
  fromPath: string
  toPath: string
  statusCode: number
  isAutomatic: boolean
  createdAt: string
}

export interface RedirectPayload {
  fromPath: string
  toPath: string
  statusCode?: number
  alsoTrashSourcePost?: boolean
}

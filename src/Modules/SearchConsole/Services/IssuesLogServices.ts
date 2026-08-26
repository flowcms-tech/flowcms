import BAPI from '@/Framework/API_Layer'
import type { SearchConsoleIssue } from '../Types'
import type { CreateIssueFormValues, UpdateIssueFormValues } from '../Values/Validations'

interface ApiResponse<T> { data: T; message: string | string[] }

export const IssuesLogServices = {
  async list(): Promise<SearchConsoleIssue[]> {
    const res = await BAPI.get<ApiResponse<SearchConsoleIssue[]>>(
      '/api/search-console-issues',
      { showGlobalError: true, showGlobalSuccess: false }
    )
    return res.data
  },

  async store(payload: CreateIssueFormValues): Promise<SearchConsoleIssue> {
    const res = await BAPI.post<ApiResponse<SearchConsoleIssue>>(
      '/api/search-console-issues',
      payload,
      { showGlobalError: false, showGlobalSuccess: true }
    )
    return res.data
  },

  async update(id: string, payload: UpdateIssueFormValues): Promise<SearchConsoleIssue> {
    const res = await BAPI.patch<ApiResponse<SearchConsoleIssue>>(
      `/api/search-console-issues/${id}`,
      payload,
      { showGlobalError: false, showGlobalSuccess: true }
    )
    return res.data
  },

  async delete(id: string): Promise<void> {
    await BAPI.delete<ApiResponse<null>>(
      `/api/search-console-issues/${id}`,
      undefined,
      { showGlobalError: true, showGlobalSuccess: true }
    )
  },
}

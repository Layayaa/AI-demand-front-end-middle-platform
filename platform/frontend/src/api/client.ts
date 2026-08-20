import type {
  HealthResponse,
  LlmStatus,
  ProjectListResponse,
  PublicSettings,
  RagflowStatus,
  ReadyResponse,
} from './types'

const apiBase = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')

export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(`${apiBase}${path}`)
  if (!response.ok) {
    let detail = response.statusText || `HTTP ${response.status}`
    try {
      const body = (await response.json()) as { detail?: unknown }
      if (typeof body.detail === 'string') {
        detail = body.detail
      }
    } catch {
      // Keep status text when the body is not JSON.
    }
    throw new ApiError(response.status, detail)
  }
  return (await response.json()) as T
}

export const api = {
  health: () => apiGet<HealthResponse>('/api/health'),
  ready: () => apiGet<ReadyResponse>('/api/ready'),
  publicSettings: () => apiGet<PublicSettings>('/api/settings/public'),
  projects: () => apiGet<ProjectListResponse>('/api/projects'),
  llmStatus: () => apiGet<LlmStatus>('/api/integrations/llm/status'),
  ragflowStatus: () => apiGet<RagflowStatus>('/api/integrations/ragflow/status'),
}

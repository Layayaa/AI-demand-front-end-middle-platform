import type {
  AuthSession,
  AuthUser,
  ClarificationSession,
  ClarificationStreamEvent,
  GeneratedDocument,
  HealthResponse,
  LlmStatus,
  LlmTestResponse,
  KnowledgeFile,
  KnowledgeFileListResponse,
  Project,
  ProjectAssessment,
  ProjectCreateRequest,
  ProjectListResponse,
  PublicSettings,
  RagflowStatus,
  ReadyResponse,
  ReviewFeedback,
  SourceFile,
  SourceFileListResponse,
} from './types'
import { currentAccessToken, currentTestRole } from '../auth'

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
  const response = await fetch(`${apiBase}${path}`, {
    headers: authHeaders(),
  })
  if (!response.ok) {
    let detail = response.statusText || `HTTP ${response.status}`
    try {
      const body = (await response.json()) as { detail?: unknown }
      if (typeof body.detail === 'string') {
        detail = body.detail
      }
    } catch {
      // Keep the status text when the error body is not JSON.
    }
    throw new ApiError(response.status, detail)
  }
  return (await response.json()) as T
}

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    let detail = response.statusText || `HTTP ${response.status}`
    try {
      const payload = (await response.json()) as { detail?: unknown }
      if (typeof payload.detail === 'string') {
        detail = payload.detail
      }
    } catch {
      // Keep the status text when the error body is not JSON.
    }
    throw new ApiError(response.status, detail)
  }
  return (await response.json()) as T
}

async function apiPut<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    method: 'PUT',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    let detail = response.statusText || `HTTP ${response.status}`
    try {
      const payload = (await response.json()) as { detail?: unknown }
      if (typeof payload.detail === 'string') detail = payload.detail
    } catch {
      // Keep the status text when the error body is not JSON.
    }
    throw new ApiError(response.status, detail)
  }
  return (await response.json()) as T
}

async function apiUpload<T>(path: string, file: File): Promise<T> {
  const formData = new FormData()
  formData.append('file', file)
  const response = await fetch(`${apiBase}${path}`, {
    method: 'POST',
    headers: authHeaders(),
    body: formData,
  })
  if (!response.ok) {
    let detail = response.statusText || `HTTP ${response.status}`
    try {
      const payload = (await response.json()) as { detail?: unknown }
      if (typeof payload.detail === 'string') {
        detail = payload.detail
      }
    } catch {
      // Keep the status text when the error body is not JSON.
    }
    throw new ApiError(response.status, detail)
  }
  return (await response.json()) as T
}

async function apiBlob(path: string): Promise<Blob> {
  const response = await fetch(`${apiBase}${path}`, {
    headers: authHeaders(),
  })
  if (!response.ok) {
    let detail = response.statusText || `HTTP ${response.status}`
    try {
      const payload = (await response.json()) as { detail?: unknown }
      if (typeof payload.detail === 'string') detail = payload.detail
    } catch {
      // Keep the status text when the error body is not JSON.
    }
    throw new ApiError(response.status, detail)
  }
  return response.blob()
}

async function apiPostStream<T>(
  path: string,
  body: unknown,
  onEvent: (event: ClarificationStreamEvent) => void,
): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    method: 'POST',
    headers: {
      ...authHeaders(),
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify(body),
  })
  if (!response.ok || !response.body) {
    let detail = response.statusText || `HTTP ${response.status}`
    try {
      const payload = (await response.json()) as { detail?: unknown }
      if (typeof payload.detail === 'string') detail = payload.detail
    } catch {
      // Keep the status text when the error body is not JSON.
    }
    throw new ApiError(response.status, detail)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let session: T | null = null

  const handleLine = (line: string) => {
    if (!line.startsWith('data:')) return
    const raw = line.slice(5).trim()
    if (!raw) return
    const event = JSON.parse(raw) as ClarificationStreamEvent
    if (event.type === 'error') {
      throw new ApiError(event.status ?? 500, event.message)
    }
    onEvent(event)
    if (event.type === 'complete') {
      session = event.session as T
    }
  }

  while (true) {
    const { value, done } = await reader.read()
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) handleLine(line.trimEnd())
    if (done) break
  }
  if (buffer.trim()) handleLine(buffer.trim())
  if (session === null) throw new ApiError(502, '流式响应未返回完整结果')
  return session
}

function authHeaders(): Record<string, string> {
  const testRole = currentTestRole()
  if (testRole) return { 'X-Test-Role': testRole }
  const token = currentAccessToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export const api = {
  health: () => apiGet<HealthResponse>('/api/health'),
  register: (payload: { display_name: string; username: string; password: string }) =>
    apiPost<AuthSession>('/api/auth/register', payload),
  login: (payload: { username: string; password: string }) =>
    apiPost<AuthSession>('/api/auth/login', payload),
  me: () => apiGet<AuthUser>('/api/auth/me'),
  ready: () => apiGet<ReadyResponse>('/api/ready'),
  publicSettings: () => apiGet<PublicSettings>('/api/settings/public'),
  projects: () => apiGet<ProjectListResponse>('/api/projects'),
  project: (projectId: string) => apiGet<Project>(`/api/projects/${encodeURIComponent(projectId)}`),
  createProject: (payload: ProjectCreateRequest) => apiPost<Project>('/api/projects', payload),
  projectFiles: (projectId: string) =>
    apiGet<SourceFileListResponse>(`/api/projects/${encodeURIComponent(projectId)}/files`),
  projectFileBlob: (projectId: string, fileId: string) =>
    apiBlob(
      `/api/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(fileId)}/download`,
    ),
  uploadProjectFile: (projectId: string, file: File) =>
    apiUpload<SourceFile>(`/api/projects/${encodeURIComponent(projectId)}/files`, file),
  knowledgeFiles: () => apiGet<KnowledgeFileListResponse>('/api/knowledge/files'),
  uploadKnowledgeFile: (file: File) => apiUpload<KnowledgeFile>('/api/knowledge/files', file),
  clarification: (projectId: string) =>
    apiGet<ClarificationSession>(`/api/projects/${encodeURIComponent(projectId)}/clarification`),
  resolveMaterialCandidate: (
    projectId: string,
    payload: { candidate_id: string; action: 'accept' | 'edit' | 'reject'; value?: unknown },
  ) =>
    apiPost<ClarificationSession>(
      `/api/projects/${encodeURIComponent(projectId)}/material-candidates/resolve`,
      payload,
    ),
  sendClarificationMessage: (
    projectId: string,
    content: string,
    metadata: {
      inputMode?: 'manual' | 'suggestion' | 'confirm'
      questionKey?: string | null
      attachmentIds?: string[]
    } = {},
  ) =>
    apiPost<ClarificationSession>(
      `/api/projects/${encodeURIComponent(projectId)}/clarification/messages`,
      {
        content,
        input_mode: metadata.inputMode,
        question_key: metadata.questionKey,
        attachment_ids: metadata.attachmentIds ?? [],
      },
    ),
  sendClarificationMessageStream: (
    projectId: string,
    content: string,
    metadata: {
      inputMode?: 'manual' | 'suggestion' | 'confirm'
      questionKey?: string | null
      attachmentIds?: string[]
    } = {},
    onEvent: (event: ClarificationStreamEvent) => void,
  ) =>
    apiPostStream<ClarificationSession>(
      `/api/projects/${encodeURIComponent(projectId)}/clarification/messages/stream`,
      {
        content,
        input_mode: metadata.inputMode,
        question_key: metadata.questionKey,
        attachment_ids: metadata.attachmentIds ?? [],
      },
      onEvent,
    ),
  projectAssessment: (projectId: string) =>
    apiGet<ProjectAssessment>(`/api/projects/${encodeURIComponent(projectId)}/assessment`),
  projectDocuments: (projectId: string) =>
    apiGet<{ items: GeneratedDocument[] }>(`/api/projects/${encodeURIComponent(projectId)}/documents`),
  projectDocumentBlob: (projectId: string, documentId: string) =>
    apiBlob(
      `/api/projects/${encodeURIComponent(projectId)}/documents/${encodeURIComponent(documentId)}/download`,
    ),
  generateProjectDocuments: (projectId: string) =>
    apiPost<{ items: GeneratedDocument[] }>(`/api/projects/${encodeURIComponent(projectId)}/documents/generate`, {}),
  reviewProject: (projectId: string, payload: { action: 'request_info' | 'approve'; note: string }) =>
    apiPost<{ project: Project }>(`/api/projects/${encodeURIComponent(projectId)}/review`, payload),
  reviewFeedback: (projectId: string) =>
    apiGet<{ items: ReviewFeedback[] }>(`/api/projects/${encodeURIComponent(projectId)}/review-feedback`),
  llmStatus: () => apiGet<LlmStatus>('/api/integrations/llm/status'),
  activateLlmProfile: (profileId: string) =>
    apiPost<LlmStatus>(
      `/api/integrations/llm/profiles/${encodeURIComponent(profileId)}/activate`,
      {},
    ),
  saveLlmProfile: (payload: {
    profile_id?: string
    profile_name: string
    provider: string
    base_url: string
    model: string
    quality_model: string
    api_key?: string
    clear_api_key?: boolean
    timeout_seconds: number
    document_timeout_seconds: number
  }) => apiPost<LlmStatus>('/api/integrations/llm/profiles', payload),
  testLlm: (mode: 'default' | 'quality' = 'default') =>
    apiPost<LlmTestResponse>('/api/integrations/llm/test', { mode }),
  updateLlmConfig: (payload: {
    provider: string
    base_url: string
    model: string
    quality_model: string
    api_key?: string
    clear_api_key?: boolean
    timeout_seconds: number
    document_timeout_seconds: number
  }) => apiPut<LlmStatus>('/api/integrations/llm/config', payload),
  ragflowStatus: () => apiGet<RagflowStatus>('/api/integrations/ragflow/status'),
}

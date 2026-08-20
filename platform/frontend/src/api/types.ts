export type HealthResponse = {
  ok: boolean
  name: string
  version: string
  time: string
}

export type DatabaseStatus = {
  ready: boolean
  error: string
}

export type ReadyResponse = {
  ready: boolean
  database: DatabaseStatus
  llmApiKeyConfigured: boolean
  ragflowEnabled: boolean
  ragflowApiKeyConfigured: boolean
}

export type PublicSettings = {
  app: {
    name: string
    version: string
    environment: string
    runtimeMode: string
  }
  llm: {
    provider: string
    baseUrl: string
    model: string
    apiKeyConfigured: boolean
  }
  embedding: {
    provider: string
    baseUrl: string
    model: string
    apiKeyConfigured: boolean
  }
  rerank: {
    provider: string
    baseUrl: string
    model: string
    apiKeyConfigured: boolean
  }
  ragflow: {
    enabled: boolean
    baseUrl: string
    apiKeyConfigured: boolean
  }
  database: {
    host: string
    port: number
    name: string
    user: string
  }
  knowledge: {
    localPath: string
    similarityThreshold: number
    pageSize: number
    maxContextChars: number
  }
}

export type ProjectSummary = {
  id: string
  title: string
  status: string
  current_stage: string
  priority: string | null
  value_score: number | null
  project_size: string | null
  risk_level: string | null
  effort_min_pm: number | string | null
  effort_max_pm: number | string | null
  updated_at: string
}

export type ProjectListResponse = {
  items: ProjectSummary[]
}

export type LlmStatus = {
  provider: string
  baseUrl: string
  model: string
  apiKeyConfigured: boolean
  runtimeMode: string
}

export type RagflowStatus = {
  enabled: boolean
  baseUrl: string
  apiKeyConfigured: boolean
  timeoutSeconds: number
}

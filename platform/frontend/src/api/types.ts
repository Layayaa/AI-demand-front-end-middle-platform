export type HealthResponse = {
  ok: boolean
  name: string
  version: string
  time: string
}

export type UserRole = 'requester' | 'reviewer'

export type AuthUser = {
  id: string
  displayName: string
  username: string
  role: UserRole
}

export type AuthSession = {
  accessToken: string
  user: AuthUser
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
  auth: {
    requesterRegistrationEnabled: boolean
  }
  llm: {
    provider: string
    baseUrl: string
    model: string
    qualityModel: string
    timeoutSeconds: number
    documentTimeoutSeconds: number
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
    uploadDir: string
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

export type Project = ProjectSummary & {
  summary: string | null
  department: string | null
  requirement_type: 'decision' | 'sop' | null
  confidence: string | null
  created_at: string
}

export type ProjectListResponse = {
  items: ProjectSummary[]
}

export type ProjectCreateRequest = {
  title: string
  summary?: string
  department?: string
  requirement_type?: 'decision' | 'sop'
}

export type SourceFile = {
  id: string
  project_id: string
  original_filename: string
  storage_path: string
  mime_type: string | null
  file_size: number
  file_sha256: string | null
  parser_type: string | null
  parse_status: string
  page_count: number | null
  parser_metadata: Record<string, unknown> | null
  text_length: number
  text_preview: string
  created_at: string
  updated_at: string
}

export type SourceFileListResponse = {
  items: SourceFile[]
}

export type KnowledgeFile = {
  id: string
  original_filename: string
  storage_name: string
  file_size: number
  parser_type: string | null
  parse_status: string
  page_count: number | null
  parser_metadata: Record<string, unknown> | null
  text_length: number
  text_preview: string
  created_at: string
  updated_at: string
}

export type KnowledgeFileListResponse = {
  items: KnowledgeFile[]
}

export type ConversationTurn = {
  id: string
  project_id: string
  role: 'user' | 'assistant' | 'reviewer'
  content: string
  source_type: string
  source_refs: Array<Record<string, unknown>> | null
  created_at: string
}

export type ClarificationPrompt = {
  content: string
  chips: string[]
  stage: 'business_context' | 'type' | 'clarifying' | 'confirm' | 'done'
  questionKey?: string
}

export type BusinessContext = {
  company: string
  businessChain: string
  candidateBusinessChain: string
  candidateSignals: string[]
  businessObject: string
  scope: string
  currentProcess: string
  dataDefinition: string
  systemLandscape: string
  approvalBoundary: string
  successMetric: string
}

export type RequirementProfile = {
  type: 'decision' | 'sop' | null
  stage: 'clarifying' | 'done' | string
  completeness: number
  businessContext: BusinessContext
  decision: Record<string, unknown>
  sop: Record<string, unknown>
  notes: string[]
  sourceEvidence: Array<{
    field: string
    source: string
    locator: string
    excerpt: string
  }>
}

export type RequirementGap = {
  key: string
  label: string
  severity: 'high' | 'medium'
  reason: string
}

export type ClarificationSession = {
  projectId: string
  projectStatus: string
  projectStage: string
  profile: RequirementProfile
  profileId: string | null
  gaps: RequirementGap[]
  next: ClarificationPrompt
  messages: ConversationTurn[]
  assessmentReady?: boolean
}

export type ClarificationStreamEvent =
  | { type: 'status'; message: string }
  | { type: 'assistant_delta'; content: string }
  | { type: 'assistant_reset'; content: string }
  | { type: 'complete'; session: ClarificationSession }
  | { type: 'error'; status?: number; message: string }

export type ProjectAssessment = {
  id: string
  project_id: string
  profile_id: string
  version: number
  value_score: number
  priority: string
  project_size: string
  risk_level: string
  effort_min_pm: number
  effort_max_pm: number
  confidence: string
  assessment_source: 'llm' | 'rules_fallback' | string
  assessment_model: string | null
  business_criticality: string
  assessment_rationale: string[]
  assessment_evidence_gaps: string[]
  dimensions: Array<{
    name: string
    score: number
    level: string
    evidence: string
  }>
  gaps: string[]
  summary: string
  created_at: string
}

export type GeneratedDocument = {
  id: string
  project_id: string
  profile_id?: string | null
  tier: 'requirement_explanation' | 'semi_auto' | 'full_auto'
  document_type: 'explanation' | 'product' | 'tech'
  version: number
  title: string
  status: string
  markdown_content: string
  storage_path?: string | null
  model_name?: string | null
  prompt_version?: string | null
  knowledge_refs?: Array<Record<string, unknown>>
  created_at: string
  updated_at: string
}

export type ReviewFeedback = {
  id: string
  project_id: string
  reviewer_user_id: string
  reviewer_name: string
  action: 'request_info' | 'approve'
  note: string
  created_at: string
}

export type LlmStatus = {
  provider: string
  baseUrl: string
  model: string
  qualityModel: string
  timeoutSeconds: number
  documentTimeoutSeconds: number
  apiKeyConfigured: boolean
  runtimeMode: string
  presets?: LlmPreset[]
  profiles?: LlmProfile[]
}

export type LlmProfile = {
  id: string
  name: string
  provider: string
  baseUrl: string
  model: string
  qualityModel: string
  timeoutSeconds: number
  documentTimeoutSeconds: number
  apiKeyConfigured: boolean
  active: boolean
}

export type LlmPreset = {
  id: string
  label: string
  description: string
  baseUrl: string
  model: string
  qualityModel: string
  docsUrl: string
}

export type LlmTestResponse = {
  ok: boolean
  provider: string
  model: string
  reply: string
  latencyMs: number
  usage: Record<string, number> | null
}

export type RagflowStatus = {
  enabled: boolean
  baseUrl: string
  apiKeyConfigured: boolean
  timeoutSeconds: number
}

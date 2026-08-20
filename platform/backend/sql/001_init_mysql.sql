-- AI 需求前置分析中台业务数据库初始化脚本
-- 适用版本：MySQL 8.0+
-- 注意：这里不保存任何模型或 RAGFlow API Key，密钥只放后端 .env/Secret。

CREATE DATABASE IF NOT EXISTS ai_requirement_hub
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;

USE ai_requirement_hub;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version VARCHAR(64) NOT NULL,
  description VARCHAR(255) NOT NULL,
  applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (version)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS projects (
  id CHAR(36) NOT NULL,
  title VARCHAR(180) NOT NULL,
  summary TEXT NULL,
  department VARCHAR(120) NULL,
  requirement_type VARCHAR(32) NULL,
  status VARCHAR(40) NOT NULL DEFAULT 'submitted',
  current_stage VARCHAR(40) NOT NULL DEFAULT 'intake',
  priority VARCHAR(16) NULL,
  value_score TINYINT UNSIGNED NULL,
  project_size VARCHAR(32) NULL,
  risk_level VARCHAR(32) NULL,
  effort_min_pm DECIMAL(10,2) NULL,
  effort_max_pm DECIMAL(10,2) NULL,
  confidence VARCHAR(32) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_projects_status_updated (status, updated_at),
  KEY idx_projects_priority_score (priority, value_score),
  CONSTRAINT chk_projects_score CHECK (value_score IS NULL OR value_score <= 100)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS source_files (
  id CHAR(36) NOT NULL,
  project_id CHAR(36) NOT NULL,
  original_filename VARCHAR(255) NOT NULL,
  storage_path VARCHAR(600) NOT NULL,
  mime_type VARCHAR(120) NULL,
  file_size BIGINT UNSIGNED NOT NULL DEFAULT 0,
  file_sha256 CHAR(64) NULL,
  parser_type VARCHAR(32) NULL,
  parse_status VARCHAR(32) NOT NULL DEFAULT 'pending',
  page_count INT UNSIGNED NULL,
  extracted_text LONGTEXT NULL,
  parser_metadata JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_source_files_project (project_id, created_at),
  UNIQUE KEY uk_source_files_storage_path (storage_path),
  CONSTRAINT fk_source_files_project
    FOREIGN KEY (project_id) REFERENCES projects (id)
    ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS requirement_profiles (
  id CHAR(36) NOT NULL,
  project_id CHAR(36) NOT NULL,
  version INT UNSIGNED NOT NULL,
  title VARCHAR(180) NOT NULL,
  requirement_type VARCHAR(32) NOT NULL,
  completeness TINYINT UNSIGNED NOT NULL DEFAULT 0,
  profile_json JSON NOT NULL,
  source_refs JSON NULL,
  is_current BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_profiles_project_version (project_id, version),
  KEY idx_profiles_current (project_id, is_current),
  CONSTRAINT fk_profiles_project
    FOREIGN KEY (project_id) REFERENCES projects (id)
    ON DELETE CASCADE,
  CONSTRAINT chk_profiles_completeness CHECK (completeness <= 100)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS conversation_turns (
  id CHAR(36) NOT NULL,
  project_id CHAR(36) NOT NULL,
  role VARCHAR(24) NOT NULL,
  content TEXT NOT NULL,
  source_type VARCHAR(32) NOT NULL DEFAULT 'chat',
  source_refs JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_conversation_project_created (project_id, created_at),
  CONSTRAINT fk_conversation_project
    FOREIGN KEY (project_id) REFERENCES projects (id)
    ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS requirement_gaps (
  id CHAR(36) NOT NULL,
  project_id CHAR(36) NOT NULL,
  profile_id CHAR(36) NULL,
  category VARCHAR(80) NOT NULL,
  question VARCHAR(500) NOT NULL,
  reason TEXT NULL,
  severity VARCHAR(24) NOT NULL DEFAULT 'medium',
  status VARCHAR(24) NOT NULL DEFAULT 'open',
  answer_text TEXT NULL,
  options_json JSON NULL,
  source_refs JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  resolved_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY idx_gaps_project_status (project_id, status),
  KEY idx_gaps_profile (profile_id),
  CONSTRAINT fk_gaps_project
    FOREIGN KEY (project_id) REFERENCES projects (id)
    ON DELETE CASCADE,
  CONSTRAINT fk_gaps_profile
    FOREIGN KEY (profile_id) REFERENCES requirement_profiles (id)
    ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS project_assessments (
  id CHAR(36) NOT NULL,
  project_id CHAR(36) NOT NULL,
  profile_id CHAR(36) NULL,
  version INT UNSIGNED NOT NULL,
  value_score TINYINT UNSIGNED NOT NULL,
  priority VARCHAR(16) NOT NULL,
  project_size VARCHAR(32) NOT NULL,
  risk_level VARCHAR(32) NOT NULL,
  effort_min_pm DECIMAL(10,2) NOT NULL,
  effort_max_pm DECIMAL(10,2) NOT NULL,
  confidence VARCHAR(32) NOT NULL,
  dimensions_json JSON NULL,
  gaps_json JSON NULL,
  summary TEXT NULL,
  is_current BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_assessments_project_version (project_id, version),
  KEY idx_assessments_current (project_id, is_current),
  CONSTRAINT fk_assessments_project
    FOREIGN KEY (project_id) REFERENCES projects (id)
    ON DELETE CASCADE,
  CONSTRAINT fk_assessments_profile
    FOREIGN KEY (profile_id) REFERENCES requirement_profiles (id)
    ON DELETE SET NULL,
  CONSTRAINT chk_assessments_value_score CHECK (value_score <= 100)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS generated_documents (
  id CHAR(36) NOT NULL,
  project_id CHAR(36) NOT NULL,
  profile_id CHAR(36) NULL,
  tier VARCHAR(24) NOT NULL,
  document_type VARCHAR(24) NOT NULL,
  version INT UNSIGNED NOT NULL,
  title VARCHAR(220) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'draft',
  markdown_content LONGTEXT NULL,
  storage_path VARCHAR(600) NULL,
  model_name VARCHAR(255) NULL,
  prompt_version VARCHAR(80) NULL,
  knowledge_refs JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_documents_project_kind_version (project_id, tier, document_type, version),
  KEY idx_documents_project_status (project_id, status),
  CONSTRAINT fk_documents_project
    FOREIGN KEY (project_id) REFERENCES projects (id)
    ON DELETE CASCADE,
  CONSTRAINT fk_documents_profile
    FOREIGN KEY (profile_id) REFERENCES requirement_profiles (id)
    ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS knowledge_connectors (
  id CHAR(36) NOT NULL,
  provider VARCHAR(32) NOT NULL,
  display_name VARCHAR(120) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  base_url VARCHAR(500) NULL,
  dataset_id VARCHAR(255) NULL,
  local_path VARCHAR(600) NULL,
  config_json JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_knowledge_provider_enabled (provider, enabled)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS audit_logs (
  id CHAR(36) NOT NULL,
  actor VARCHAR(120) NULL,
  action VARCHAR(120) NOT NULL,
  resource_type VARCHAR(80) NOT NULL,
  resource_id VARCHAR(80) NULL,
  summary TEXT NULL,
  metadata_json JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_audit_resource (resource_type, resource_id),
  KEY idx_audit_created (created_at)
) ENGINE=InnoDB;

INSERT INTO schema_migrations (version, description)
VALUES ('001', 'initial AI requirement hub schema')
ON DUPLICATE KEY UPDATE description = VALUES(description);


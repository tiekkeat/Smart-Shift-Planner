CREATE TABLE IF NOT EXISTS roster_lock (
  id INT PRIMARY KEY
);
INSERT IGNORE INTO roster_lock (id) VALUES (1);

CREATE TABLE IF NOT EXISTS users (
  id CHAR(36) PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(254) NOT NULL UNIQUE,
  phone VARCHAR(20),
  dingtalk_id VARCHAR(120),
  color VARCHAR(16),
  role ENUM('admin','manager','engineer','viewer') NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  deleted_at BIGINT,
  active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash CHAR(64) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  expires_at BIGINT NOT NULL,
  INDEX (expires_at),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS shifts (
  id CHAR(36) PRIMARY KEY,
  engineer_id CHAR(36) NOT NULL,
  template_id CHAR(36) NULL,
  starts_at BIGINT NOT NULL,
  ends_at BIGINT NOT NULL,
  note VARCHAR(500) NOT NULL,
  color VARCHAR(16),
  cancelled BOOLEAN NOT NULL DEFAULT FALSE,
  group_id CHAR(36),
  occurrence_date CHAR(10),
  is_exception BOOLEAN NOT NULL DEFAULT FALSE,
  display_order DOUBLE NOT NULL DEFAULT 0,
  version INT NOT NULL DEFAULT 1,
  CHECK (ends_at > starts_at),
  INDEX (cancelled, starts_at, ends_at),
  INDEX (engineer_id, cancelled, starts_at),
  FOREIGN KEY (engineer_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS change_requests (
  id CHAR(36) PRIMARY KEY,
  shift_id CHAR(36) NOT NULL,
  requester_id CHAR(36) NOT NULL,
  engineer_id CHAR(36) NOT NULL,
  starts_at BIGINT NOT NULL,
  ends_at BIGINT NOT NULL,
  original_shift JSON NOT NULL,
  proposed_template_id CHAR(36) NULL,
  template_proposed BOOLEAN NOT NULL DEFAULT FALSE,
  swap_shift_id CHAR(36) NULL,
  swap_shift JSON NULL,
  reverted_at BIGINT NULL,
  reverted_by CHAR(36) NULL,
  revert_note VARCHAR(400) NULL,
  reason VARCHAR(500) NOT NULL,
  status ENUM('pending','approved','rejected','withdrawn') NOT NULL DEFAULT 'pending',
  reviewer_id CHAR(36),
  review_note VARCHAR(500),
  created_at BIGINT NOT NULL,
  reviewed_at BIGINT,
  INDEX (requester_id, created_at),
  INDEX (shift_id, status),
  FOREIGN KEY (requester_id) REFERENCES users(id),
  FOREIGN KEY (engineer_id) REFERENCES users(id),
  FOREIGN KEY (reviewer_id) REFERENCES users(id),
  FOREIGN KEY (shift_id) REFERENCES shifts(id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  title VARCHAR(160) NOT NULL,
  body VARCHAR(700) NOT NULL,
  created_at BIGINT NOT NULL,
  read_at BIGINT,
  INDEX (user_id, created_at),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id CHAR(36) PRIMARY KEY,
  actor_id CHAR(36) NOT NULL,
  action VARCHAR(40) NOT NULL,
  entity_id CHAR(36) NOT NULL,
  detail JSON NOT NULL,
  created_at BIGINT NOT NULL,
  INDEX (created_at),
  FOREIGN KEY (actor_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS api_tokens (
  id CHAR(36) PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  scopes JSON NOT NULL,
  expires_at BIGINT NOT NULL,
  revoked_at BIGINT,
  last_used_at BIGINT,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS webhooks (
  id CHAR(36) PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  url VARCHAR(2048) NOT NULL,
  encrypted_secret VARCHAR(255) NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id CHAR(36) PRIMARY KEY,
  webhook_id CHAR(36) NOT NULL,
  payload JSON NOT NULL,
  state ENUM('queued','sent','failed','cancelled') NOT NULL DEFAULT 'queued',
  attempts INT NOT NULL DEFAULT 0,
  next_attempt BIGINT NOT NULL,
  lease_until BIGINT,
  lease_id CHAR(36),
  last_error VARCHAR(255),
  created_at BIGINT NOT NULL,
  INDEX (state, next_attempt),
  INDEX (webhook_id, created_at),
  FOREIGN KEY (webhook_id) REFERENCES webhooks(id)
);

CREATE TABLE IF NOT EXISTS app_settings (
  id INT PRIMARY KEY,
  payload MEDIUMTEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS holiday_feeds (
  id CHAR(36) PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  url VARCHAR(2048) NOT NULL,
  color CHAR(7) NOT NULL,
  calendar_data MEDIUMTEXT NOT NULL,
  refreshed_at BIGINT,
  attempted_at BIGINT NOT NULL,
  last_error VARCHAR(255)
);

CREATE TABLE IF NOT EXISTS shift_templates (
  id CHAR(36) PRIMARY KEY,
  name VARCHAR(80) NOT NULL,
  start_time CHAR(5) NOT NULL,
  end_time CHAR(5) NOT NULL,
  end_day_offset INT NOT NULL,
  archived_at BIGINT NULL
);

CREATE TABLE IF NOT EXISTS duty_groups (
  id CHAR(36) PRIMARY KEY,
  rule_json JSON NOT NULL,
  version INT NOT NULL DEFAULT 1,
  cancelled BOOLEAN NOT NULL DEFAULT FALSE,
  display_order DOUBLE NOT NULL,
  source_shift_id CHAR(36)
);

CREATE TABLE IF NOT EXISTS teams (
 id CHAR(36) PRIMARY KEY,
 name VARCHAR(80) NOT NULL,
 color VARCHAR(16) NOT NULL
);
CREATE TABLE IF NOT EXISTS user_teams (
 user_id CHAR(36) NOT NULL,
 team_id CHAR(36) NOT NULL,
 PRIMARY KEY (user_id,team_id),
 FOREIGN KEY (user_id) REFERENCES users(id),
 FOREIGN KEY (team_id) REFERENCES teams(id)
);

CREATE TABLE IF NOT EXISTS leave_settings (
  id INT PRIMARY KEY,
  starts_on CHAR(10) NOT NULL,
  activated_at BIGINT NOT NULL,
  activated_by CHAR(36) NOT NULL
);
CREATE TABLE IF NOT EXISTS leave_rules (
  id CHAR(36) PRIMARY KEY,
  template_id CHAR(36) NOT NULL,
  effective_on CHAR(10) NOT NULL,
  units INT NOT NULL,
  created_by CHAR(36) NOT NULL,
  created_at BIGINT NOT NULL,
  UNIQUE (template_id, effective_on),
  FOREIGN KEY (template_id) REFERENCES shift_templates(id)
);
CREATE TABLE IF NOT EXISTS leave_ledger (
  id CHAR(36) PRIMARY KEY,
  engineer_id CHAR(36) NOT NULL,
  units INT NOT NULL,
  kind VARCHAR(32) NOT NULL,
  source_key VARCHAR(160) NOT NULL UNIQUE,
  reason VARCHAR(500) NOT NULL,
  actor_id CHAR(36),
  created_at BIGINT NOT NULL,
  FOREIGN KEY (engineer_id) REFERENCES users(id),
  FOREIGN KEY (actor_id) REFERENCES users(id),
  INDEX (engineer_id, created_at)
);
CREATE TABLE IF NOT EXISTS leave_duty_credits (
  shift_id CHAR(36) PRIMARY KEY,
  engineer_id CHAR(36) NOT NULL,
  units INT NOT NULL,
  rule_id CHAR(36),
  revision INT NOT NULL,
  FOREIGN KEY (shift_id) REFERENCES shifts(id)
);
CREATE TABLE IF NOT EXISTS leave_requests (
  id CHAR(36) PRIMARY KEY,
  engineer_id CHAR(36) NOT NULL,
  reason VARCHAR(500) NOT NULL,
  status VARCHAR(20) NOT NULL,
  units INT NOT NULL,
  selection_json JSON NOT NULL,
  snapshot_json JSON NOT NULL,
  version INT NOT NULL DEFAULT 1,
  created_at BIGINT NOT NULL,
  reviewed_by CHAR(36),
  review_note VARCHAR(500) NOT NULL DEFAULT '',
  reviewed_at BIGINT,
  FOREIGN KEY (engineer_id) REFERENCES users(id),
  INDEX (engineer_id, status)
);
CREATE TABLE IF NOT EXISTS leave_intervals (
  id CHAR(36) PRIMARY KEY,
  request_id CHAR(36) NOT NULL,
  engineer_id CHAR(36) NOT NULL,
  starts_at BIGINT NOT NULL,
  ends_at BIGINT NOT NULL,
  FOREIGN KEY (request_id) REFERENCES leave_requests(id),
  INDEX (engineer_id, starts_at, ends_at)
);

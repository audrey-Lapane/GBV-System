-- GBV consent system: metadata only. No reporter identity is stored anywhere.
-- Apply with: mysql -u root -p < db/schema.sql   (creates the database and a least-privilege user)

CREATE DATABASE IF NOT EXISTS gbv_consent CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE gbv_consent;

-- Staff and the administrator. Each person has exactly one account (staff_number is unique).
CREATE TABLE IF NOT EXISTS institutional_users (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  staff_number     VARCHAR(32)  NOT NULL UNIQUE,
  name             VARCHAR(120) NOT NULL,
  work_email       VARCHAR(160) NOT NULL,
  role             ENUM('gbv_office','legal','health','social_worker','admin') NOT NULL,
  status           ENUM('pending','approved','suspended') NOT NULL DEFAULT 'pending',
  password_hash    VARCHAR(100) NOT NULL,
  failed_attempts  INT NOT NULL DEFAULT 0,
  locked_until     DATETIME NULL,
  requested_wallet CHAR(42) NULL,             -- address the staff member gave at registration (not yet bound)
  wallet_address   CHAR(42) NULL UNIQUE,      -- bound on-chain by the administrator at approval
  staff_ref        CHAR(66) NULL UNIQUE,      -- HMAC-SHA256 of staff_number; the only staff value on-chain
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- One row per report. report_id is the anonymous bytes32 chosen in the reporter's browser.
CREATE TABLE IF NOT EXISTS reports_index (
  report_id    CHAR(66) PRIMARY KEY,
  category     TINYINT NOT NULL,
  report_date  DATE NOT NULL,                  -- day only, never a time
  status       ENUM('active','withdrawn') NOT NULL DEFAULT 'active',
  created_at   DATE NOT NULL                   -- day only, to avoid timing links
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS report_items (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  report_id     CHAR(66) NOT NULL,
  chain_index   INT NOT NULL,                   -- position of this item in ReportRegistry
  section       ENUM('summary','details','evidence') NOT NULL,
  ipfs_cid      VARCHAR(100) NOT NULL,
  content_hash  CHAR(66) NOT NULL,              -- SHA-256 of the ciphertext, as on-chain
  mime_type     VARCHAR(60) NOT NULL,
  size_bytes    INT NOT NULL,
  status        ENUM('active','shredded') NOT NULL DEFAULT 'active',
  created_at    DATE NOT NULL,
  UNIQUE KEY uq_item (report_id, chain_index),
  CONSTRAINT fk_item_report FOREIGN KEY (report_id) REFERENCES reports_index(report_id)
) ENGINE=InnoDB;

-- Each item has its own content key, stored only in wrapped form (AES-256-GCM under MASTER_KEY).
-- Deleting the row is the crypto-shredding step: the ciphertext can no longer be decrypted.
CREATE TABLE IF NOT EXISTS report_keys (
  item_id        INT PRIMARY KEY,
  wrapped_key    VARBINARY(128) NOT NULL,       -- wrapIv(12) || wrapTag(16) || encryptedKey(32)
  content_iv     BINARY(12) NOT NULL,
  CONSTRAINT fk_key_item FOREIGN KEY (item_id) REFERENCES report_items(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS access_requests (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  report_id    CHAR(66) NOT NULL,
  staff_ref    CHAR(66) NOT NULL,
  role         VARCHAR(20) NOT NULL,
  sections     TINYINT NOT NULL,               -- bit mask: 1 summary, 2 details, 4 evidence
  decision     ENUM('pending','approved','denied') NOT NULL DEFAULT 'pending',
  tx_hash      CHAR(66) NOT NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_req_report FOREIGN KEY (report_id) REFERENCES reports_index(report_id)
) ENGINE=InnoDB;

-- Mirror of on-chain actions for fast queries. The chain is authoritative; reconcile compares them.
CREATE TABLE IF NOT EXISTS audit_cache (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  report_id     CHAR(66) NOT NULL,
  action        VARCHAR(32) NOT NULL,
  staff_ref     CHAR(66) NULL,
  role          TINYINT NULL,
  sections      TINYINT NULL,
  permitted     TINYINT(1) NULL,
  tx_hash       CHAR(66) NOT NULL,
  log_index     INT NOT NULL,
  block_number  INT NOT NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_audit_event (tx_hash, log_index),
  CONSTRAINT fk_audit_report FOREIGN KEY (report_id) REFERENCES reports_index(report_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS notifications (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  report_id    CHAR(66) NOT NULL UNIQUE,
  office_role  TINYINT NOT NULL,
  category     TINYINT NOT NULL,
  report_date  DATE NOT NULL,
  status       ENUM('new','seen','actioned') NOT NULL DEFAULT 'new',
  tx_hash      CHAR(66) NOT NULL,
  created_at   DATE NOT NULL,
  CONSTRAINT fk_note_report FOREIGN KEY (report_id) REFERENCES reports_index(report_id)
) ENGINE=InnoDB;

-- Every resolution of a staff reference to a person is itself logged.
CREATE TABLE IF NOT EXISTS staff_lookups (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  looked_up_by  INT NOT NULL,
  staff_ref     CHAR(66) NOT NULL,
  reason        VARCHAR(200) NOT NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_lookup_user FOREIGN KEY (looked_up_by) REFERENCES institutional_users(id)
) ENGINE=InnoDB;

-- Last block processed by the event listener, so no event is missed after a restart.
CREATE TABLE IF NOT EXISTS sync_state (
  name        VARCHAR(40) PRIMARY KEY,
  last_block  INT NOT NULL
) ENGINE=InnoDB;

-- Least-privilege application user: data manipulation only, no schema changes.
CREATE USER IF NOT EXISTS 'gbv_app'@'localhost' IDENTIFIED BY 'Gbv-App-2026';
GRANT SELECT, INSERT, UPDATE, DELETE ON gbv_consent.* TO 'gbv_app'@'localhost';
FLUSH PRIVILEGES;

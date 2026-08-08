-- SpriteNote database schema
--
-- Usage: replace CHANGE_ME below with a real generated password (e.g. `openssl rand -hex 16`),
-- put the same value in DB_PASSWORD in your .env, then: sudo mariadb -u root < init-db.sql

CREATE DATABASE IF NOT EXISTS spritenote CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE USER IF NOT EXISTS 'spritenote'@'localhost' IDENTIFIED BY 'CHANGE_ME';
GRANT ALL PRIVILEGES ON spritenote.* TO 'spritenote'@'localhost';
FLUSH PRIVILEGES;

USE spritenote;

CREATE TABLE IF NOT EXISTS users (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  email         VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  is_admin      TINYINT(1) NOT NULL DEFAULT 0,
  -- Per-user UI preferences as a JSON object; see server/user-settings.js. NULL = all defaults.
  settings      TEXT NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sessions (
  token      CHAR(64) PRIMARY KEY,
  user_id    INT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS nodes (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  user_id           INT NOT NULL,
  parent_id         INT NULL,
  type              ENUM('folder','link','text','doc') NOT NULL,
  name              TEXT NOT NULL,
  description       TEXT NULL,
  url               VARCHAR(2048) NULL,
  content           MEDIUMTEXT NULL,
  file_path         VARCHAR(500) NULL,
  file_size         BIGINT NULL,
  file_original_name VARCHAR(255) NULL,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_id) REFERENCES nodes(id) ON DELETE CASCADE,
  INDEX idx_user_parent (user_id, parent_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS admin_notepad (
  id         INT PRIMARY KEY DEFAULT 1,
  content    MEDIUMTEXT,
  updated_at DATETIME
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO admin_notepad (id, content, updated_at) VALUES (1, '', NOW());

CREATE TABLE IF NOT EXISTS `groups` (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  slug VARCHAR(140) NOT NULL,
  invite_code VARCHAR(24) NOT NULL,
  owner_user_id INT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_groups_slug (slug),
  UNIQUE KEY uq_groups_invite_code (invite_code)
);

CREATE TABLE IF NOT EXISTS `group_members` (
  id INT AUTO_INCREMENT PRIMARY KEY,
  group_id INT NOT NULL,
  user_id INT NOT NULL,
  role VARCHAR(24) NOT NULL DEFAULT 'employee',
  status VARCHAR(24) NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_group_members_group_user (group_id, user_id),
  KEY idx_group_members_user (user_id),
  KEY idx_group_members_group_status (group_id, status)
);

CREATE TABLE IF NOT EXISTS `group_join_requests` (
  id INT AUTO_INCREMENT PRIMARY KEY,
  group_id INT NOT NULL,
  user_id INT NOT NULL,
  requested_role VARCHAR(24) NOT NULL DEFAULT 'employee',
  status VARCHAR(24) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TIMESTAMP NULL DEFAULT NULL,
  reviewed_by_user_id INT NULL DEFAULT NULL,
  UNIQUE KEY uq_group_join_request_open (group_id, user_id, status),
  KEY idx_group_join_requests_group_status (group_id, status),
  KEY idx_group_join_requests_user (user_id)
);

ALTER TABLE expenses
ADD COLUMN group_id INT NULL AFTER user_id;

CREATE INDEX idx_expenses_group_id ON expenses (group_id);
CREATE INDEX idx_expenses_group_status ON expenses (group_id, status);

-- The admin audit log can only be added to: no change or deletion, by anyone, from anywhere.
CREATE TRIGGER `admin_audit_log_no_update` BEFORE UPDATE ON `admin_audit_log`
BEGIN
  SELECT RAISE(ABORT, 'admin_audit_log is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `admin_audit_log_no_delete` BEFORE DELETE ON `admin_audit_log`
BEGIN
  SELECT RAISE(ABORT, 'admin_audit_log is append-only');
END;
--> statement-breakpoint
-- The admin role is granted only by a database command (docs/runbooks/grant-admin-role.md), so
-- the database itself records every change of role in the audit log.
CREATE TRIGGER `user_role_change_audited` AFTER UPDATE OF `role` ON `user`
WHEN coalesce(OLD.`role`, '') <> coalesce(NEW.`role`, '')
BEGIN
  INSERT INTO `admin_audit_log` (`id`, `admin_user_id`, `action`, `target_user_id`, `details`, `created_at`)
  VALUES (
    lower(hex(randomblob(16))),
    'database',
    'admin.role_changed',
    NEW.`id`,
    json_object('from', OLD.`role`, 'to', NEW.`role`, 'email', NEW.`email`),
    cast(unixepoch('subsecond') * 1000 as integer)
  );
END;
--> statement-breakpoint
-- Removing an admin's passkeys (runbook) is recorded too.
CREATE TRIGGER `admin_passkey_removal_audited` AFTER DELETE ON `passkey`
WHEN (SELECT `role` FROM `user` WHERE `id` = OLD.`user_id`) = 'admin'
BEGIN
  INSERT INTO `admin_audit_log` (`id`, `admin_user_id`, `action`, `target_user_id`, `details`, `created_at`)
  VALUES (
    lower(hex(randomblob(16))),
    'database',
    'admin.passkey_removed',
    OLD.`user_id`,
    json_object('passkey', OLD.`name`),
    cast(unixepoch('subsecond') * 1000 as integer)
  );
END;

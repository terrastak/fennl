import { createAccessControl } from "better-auth/plugins/access";
import { defaultStatements } from "better-auth/plugins/admin/access";

/**
 * Admin permissions for Better Auth's admin plugin. Deliberately without "set-role": the admin
 * role is granted only by a direct database command (docs/runbooks/grant-admin-role.md), never
 * from inside the app (CLAUDE.md, "Admin console"). The plugin's HTTP endpoints are also closed
 * (worker/index.ts); Fennl's own /api/admin routes call it from the server when needed.
 */
export const adminAccessControl = createAccessControl(defaultStatements);

export const adminRoles = {
  admin: adminAccessControl.newRole({
    user: ["list", "get", "ban", "impersonate", "set-password", "update"],
    session: ["list", "revoke", "delete"],
  }),
  user: adminAccessControl.newRole({ user: [], session: [] }),
};

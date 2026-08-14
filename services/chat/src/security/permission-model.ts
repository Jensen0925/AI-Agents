export type AgentRole = "planner" | "researcher" | "coder" | "executor" | "reviewer" | "admin";
export type ResourceType = "file" | "database" | "email" | "calendar" | "api" | "code_execution" | "network" | "secret" | "tool";
export type ActionType = "read" | "write" | "delete" | "execute" | "send";
export interface Permission { resource: ResourceType; action: ActionType; }

export class PermissionDeniedError extends Error {
  constructor(public readonly role: AgentRole, public readonly permission: Permission) {
    super(`权限拒绝：角色 ${role} 不具备 ${permission.resource}:${permission.action} 权限`);
    this.name = "PermissionDeniedError";
  }
}

type PolicyMap = Record<AgentRole, Permission[]>;

const DEFAULT_POLICY: PolicyMap = {
  planner: [{ resource: "tool", action: "read" }],
  researcher: [{ resource: "network", action: "read" }, { resource: "file", action: "read" }, { resource: "database", action: "read" }],
  coder: [{ resource: "code_execution", action: "execute" }, { resource: "file", action: "read" }, { resource: "file", action: "write" }],
  executor: [{ resource: "tool", action: "execute" }, { resource: "file", action: "read" }, { resource: "api", action: "read" }],
  reviewer: [{ resource: "file", action: "read" }, { resource: "database", action: "read" }],
  admin: [
    { resource: "file", action: "read" }, { resource: "file", action: "write" }, { resource: "file", action: "delete" },
    { resource: "database", action: "read" }, { resource: "database", action: "write" }, { resource: "database", action: "delete" },
    { resource: "email", action: "read" }, { resource: "email", action: "send" }, { resource: "api", action: "read" },
    { resource: "api", action: "execute" }, { resource: "code_execution", action: "execute" }, { resource: "network", action: "read" },
    { resource: "tool", action: "read" }, { resource: "tool", action: "execute" }, { resource: "secret", action: "read" },
  ],
};

export class PermissionPolicy {
  private readonly grants = new Map<string, Set<string>>();

  constructor(policy: PolicyMap = DEFAULT_POLICY) {
    Object.entries(policy).forEach(([role, permissions]) => this.grants.set(role, new Set(permissions.map((permission) => `${permission.resource}:${permission.action}`))));
  }

  check(role: AgentRole, permission: Permission): boolean { return this.grants.get(role)?.has(`${permission.resource}:${permission.action}`) ?? false; }
  assert(role: AgentRole, permission: Permission): void { if (!this.check(role, permission)) throw new PermissionDeniedError(role, permission); }
  checkAll(role: AgentRole, permissions: Permission[]): { granted: Permission[]; denied: Permission[] } {
    return permissions.reduce<{ granted: Permission[]; denied: Permission[] }>((result, permission) => {
      result[this.check(role, permission) ? "granted" : "denied"].push(permission);
      return result;
    }, { granted: [], denied: [] });
  }
  listPermissions(role: AgentRole): Permission[] {
    return [...(this.grants.get(role) ?? [])].map((key) => {
      const [resource, action] = key.split(":") as [ResourceType, ActionType];
      return { resource, action };
    });
  }
  listRoles(): AgentRole[] { return [...this.grants.keys()] as AgentRole[]; }
}

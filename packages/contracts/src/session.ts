/**
 * 前端本地会话存储约定。
 *
 * chat-web 与 admin-web 可能部署在同一域名下，localStorage 是按 origin 共享的，
 * 因此键名必须带应用前缀：否则两个应用会互相覆盖对方的会话，出现「登录 A 应用后
 * B 应用拿着 A 的令牌」这种跨应用串号。
 */

export interface SessionStorageKeys {
  /** 存放 Session 的键名。 */
  session: string;
  /** 标记当前为演示会话的键名。 */
  demo: string;
}

/** 各客户端自己的存储键，前缀与所属应用严格对应。 */
export const SESSION_STORAGE_KEYS = {
  chatWeb: {
    session: "cloudsage.chat.session",
    demo: "cloudsage.chat.demo",
  },
  adminWeb: {
    session: "cloudsage.admin.session",
    demo: "cloudsage.admin.demo",
  },
} as const satisfies Record<string, SessionStorageKeys>;

/**
 * 演示会话共用的权限集合。
 *
 * 演示账号需要能走完两个客户端的全部界面，因此权限取并集；两个应用各自截取
 * 自身控件需要的那部分，避免出现「同一个演示账号在某个页面看不到入口」。
 */
export const DEMO_SESSION_PERMISSIONS = [
  "users:read",
  "users:create",
  "users:update",
  "users:delete",
  "roles:read",
  "roles:create",
  "roles:update",
  "roles:delete",
  "permissions:read",
  "profile:read",
  "profile:update",
] as const;

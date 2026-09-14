import { api } from "./api"
import { clearSession, getSession } from "./auth"

/**
 * 登出：先尽力撤销服务端 refresh token，再清掉本地会话。
 *
 * 只做 `clearSession()` 会让服务端的 refresh token 继续有效直到自然过期，
 * 令牌一旦泄漏仍可静默续期。撤销失败（令牌已过期、服务端不可达）不能阻塞
 * 登出流程，因此这里吞掉异常。
 */
export async function logoutSession(): Promise<void> {
  const refreshToken = getSession()?.refreshToken

  if (refreshToken && refreshToken !== "demo") {
    try {
      await api.post("/auth/logout", { refreshToken })
    } catch {
      // 忽略：本地会话仍必须清掉。
    }
  }

  clearSession()
}

/**
 * 登录失败节流器（进程内）。
 *
 * 目的：让撞库/暴力破解有成本。否则 `/api/auth/login` 可以被无限次尝试，
 * 配合「用户不存在时提前返回、不跑 argon2」的耗时差异还能枚举有效邮箱。
 *
 * 局限：状态存在进程内存里，多实例部署时每个实例各自计数。要做全局精确限流
 * 需要共享存储（Redis）或用网关层限流；此处先堵住单实例可用性最强的攻击面。
 */
export interface LoginThrottleOptions {
  /** 统计窗口内允许的失败次数，超出即锁定。 */
  maxAttempts: number;
  /** 失败计数窗口长度。 */
  windowMs: number;
  /** 触发锁定后的等待时长。 */
  lockoutMs: number;
}

const DEFAULT_OPTIONS: LoginThrottleOptions = {
  maxAttempts: 5,
  windowMs: 5 * 60 * 1000,
  lockoutMs: 15 * 60 * 1000,
};

/** 单次清扫的触发阈值，避免 Map 随被攻击的 key 数量无界增长。 */
const SWEEP_THRESHOLD = 1_000;

interface BucketEntry {
  count: number;
  windowStart: number;
  lockedUntil: number;
}

export class LoginThrottle {
  private readonly buckets = new Map<string, BucketEntry>();
  private readonly options: LoginThrottleOptions;
  private readonly now: () => number;

  constructor(options: Partial<LoginThrottleOptions> = {}, now: () => number = Date.now) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.now = now;
  }

  private read(key: string): BucketEntry {
    const current = this.now();
    const existing = this.buckets.get(key);
    if (!existing) return { count: 0, windowStart: current, lockedUntil: 0 };
    if (existing.lockedUntil > current) return existing;
    // 锁定已过期，或窗口已滑出，则视为重新开始计数。
    if (current - existing.windowStart > this.options.windowMs) {
      return { count: 0, windowStart: current, lockedUntil: 0 };
    }
    return existing;
  }

  /** 返回需要等待的毫秒数；0 表示当前允许继续尝试。 */
  retryAfterMs(keys: readonly string[]): number {
    const current = this.now();
    let longest = 0;
    for (const key of keys) {
      const entry = this.buckets.get(key);
      if (!entry) continue;
      if (entry.lockedUntil > current) {
        longest = Math.max(longest, entry.lockedUntil - current);
        continue;
      }
      // 未锁但已超出窗口上限（例如窗口内刚好打满），同样要求等待。
      if (
        current - entry.windowStart <= this.options.windowMs &&
        entry.count >= this.options.maxAttempts
      ) {
        longest = Math.max(longest, entry.windowStart + this.options.windowMs - current);
      }
    }
    return longest;
  }

  /** 记录一次失败；达到上限即锁定。 */
  recordFailure(keys: readonly string[]): void {
    const current = this.now();
    for (const key of keys) {
      const entry = this.read(key);
      const count = entry.count + 1;
      this.buckets.set(key, {
        count,
        windowStart: entry.windowStart,
        lockedUntil:
          count >= this.options.maxAttempts
            ? current + this.options.lockoutMs
            : entry.lockedUntil,
      });
    }
    this.sweepIfNeeded();
  }

  /** 登录成功后清空计数，避免正常用户被自己的历史失败次数拖累。 */
  clear(keys: readonly string[]): void {
    for (const key of keys) this.buckets.delete(key);
  }

  /** 只保留仍然有效的条目，防止被大量伪造 key 撑爆内存。 */
  private sweepIfNeeded(): void {
    if (this.buckets.size <= SWEEP_THRESHOLD) return;
    const current = this.now();
    for (const [key, entry] of this.buckets) {
      const expired =
        entry.lockedUntil < current &&
        current - entry.windowStart > this.options.windowMs;
      if (expired) this.buckets.delete(key);
    }
  }
}

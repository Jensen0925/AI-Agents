import type { Runnable } from "@langchain/core/runnables";

/**
 * 把 Runnable 的构造推迟到首次实际调用。
 *
 * `createChatModel()` 会在构造时同步读取 `OPENAI_API_KEY` 等环境变量。若在
 * 模块顶层调用，*导入阶段* 就会触发读取，带来两个问题：
 *   1. 缺少环境变量时 import 本身抛错——应用启动、以及任何间接触达这些模块的
 *      测试套件都会在加载期崩溃，报错无法被 Nest 的异常过滤器接住；
 *   2. 多个 chain 共享一个在导入期就固化的模型实例，无法按需替换或注入。
 *
 * 这里返回一个 Proxy，把 `invoke` / `stream` / `batch` 等方法透传给惰性创建的
 * 真实实例，因此**保留原生流式能力**（不同于用 RunnableLambda 包装，后者会把
 * stream 退化成一次性缓冲）。
 */
export function lazyRunnable<T extends Runnable>(factory: () => T): T {
  let instance: T | undefined;

  const resolve = (): T => (instance ??= factory());

  return new Proxy({} as T, {
    get(_target, property) {
      const resolved = resolve();
      const value = Reflect.get(resolved, property) as unknown;
      // 必须把方法绑定到真实实例上：Runnable 内部使用了私有字段，
      // 以 Proxy 作为 receiver 调用会直接抛错。
      return typeof value === "function" ? value.bind(resolved) : value;
    },
    has(_target, property) {
      return property in resolve();
    },
  });
}

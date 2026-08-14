import { spawn, type SpawnOptions } from "node:child_process";
import { resolve } from "node:path";

export class PathEscapeError extends Error {
  constructor(public readonly attemptedPath: string, public readonly allowedRoot: string) {
    super(`路径越界：${attemptedPath} 不在允许的根目录 ${allowedRoot} 内`);
    this.name = "PathEscapeError";
  }
}

export class PathValidator {
  private readonly roots: string[];

  constructor(allowedRoots: string[]) {
    this.roots = allowedRoots.map((root) => resolve(root));
  }

  validate(targetPath: string): void {
    const target = resolve(targetPath);
    if (!this.roots.some((root) => target === root || target.startsWith(`${root}/`))) {
      throw new PathEscapeError(targetPath, this.roots.join(", "));
    }
  }

  validateAll(paths: string[]): void {
    paths.forEach((path) => this.validate(path));
  }
}

const sensitiveEnvParts = ["key", "secret", "token", "password", "credential", "auth", "private", "database_url", "db_url", "connection_string"];

export class EnvironmentFilter {
  private readonly patterns: string[];

  constructor(additionalPatterns: string[] = []) {
    this.patterns = [...sensitiveEnvParts, ...additionalPatterns].map((pattern) => pattern.toLowerCase());
  }

  isSensitive(name: string): boolean {
    const normalized = name.toLowerCase();
    return this.patterns.some((pattern) => normalized.includes(pattern));
  }

  filter(source: Record<string, string | undefined> = process.env, allow: string[] = []): Record<string, string> {
    const allowed = new Set(["PATH", "HOME", "LANG", "TERM", ...allow]);
    return Object.fromEntries(Object.entries(source).filter(([key, value]) => value !== undefined && (allowed.has(key) || !this.isSensitive(key)))) as Record<string, string>;
  }
}

export class SandboxTimeoutError extends Error {
  constructor(public readonly command: string, public readonly timeoutMs: number) {
    super(`沙箱执行超时：${command}（${timeoutMs}ms）`);
    this.name = "SandboxTimeoutError";
  }
}

export interface SandboxConfig {
  workDir: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  allowedEnvVars?: string[];
  sensitivePatterns?: string[];
}

export interface SandboxResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  killed: boolean;
}

/** A process boundary, not a container boundary. Use a container runtime for hostile code. */
export class ProcessSandbox {
  readonly config: Required<Pick<SandboxConfig, "workDir" | "timeoutMs" | "maxOutputBytes">> & SandboxConfig;
  private readonly filter: EnvironmentFilter;
  private readonly paths: PathValidator;

  constructor(config: SandboxConfig) {
    this.config = { ...config, timeoutMs: config.timeoutMs ?? 10_000, maxOutputBytes: config.maxOutputBytes ?? 1024 * 1024 };
    this.filter = new EnvironmentFilter(config.sensitivePatterns);
    this.paths = new PathValidator([config.workDir]);
  }

  execute(command: string, args: string[] = [], stdin?: string): Promise<SandboxResult> {
    return new Promise((resolveResult, reject) => {
      const startedAt = Date.now();
      const options: SpawnOptions = { cwd: this.config.workDir, env: this.filter.filter(process.env, this.config.allowedEnvVars), stdio: ["pipe", "pipe", "pipe"] };
      const child = spawn(command, args, options);
      let stdout = "";
      let stderr = "";
      let bytes = 0;
      let killedForOutput = false;
      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, this.config.timeoutMs);
      const append = (target: "stdout" | "stderr", chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > this.config.maxOutputBytes) {
          killedForOutput = true;
          child.kill("SIGKILL");
          return;
        }
        if (target === "stdout") stdout += chunk.toString(); else stderr += chunk.toString();
      };
      child.stdout?.on("data", (chunk: Buffer) => append("stdout", chunk));
      child.stderr?.on("data", (chunk: Buffer) => append("stderr", chunk));
      child.on("error", (error) => { clearTimeout(timeout); reject(error); });
      child.on("close", (code) => {
        clearTimeout(timeout);
        if (timedOut || killedForOutput) {
          reject(new SandboxTimeoutError(`${command} ${args.join(" ")}`, this.config.timeoutMs));
          return;
        }
        resolveResult({ stdout, stderr, exitCode: code ?? 1, durationMs: Date.now() - startedAt, killed: false });
      });
      child.stdin?.end(stdin);
    });
  }

  runPython(code: string): Promise<SandboxResult> { return this.execute("python3", ["-c", code]); }
  runNode(code: string): Promise<SandboxResult> { return this.execute(process.execPath, ["-e", code]); }
  validatePath(targetPath: string): void { this.paths.validate(targetPath); }
}

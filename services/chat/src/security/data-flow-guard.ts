import { createHash } from "node:crypto";

export type DataSensitivity = "public" | "internal" | "confidential" | "secret";
export type DataSource = "user_input" | "file" | "database" | "email" | "web" | "api";
export type DataTarget = "user_output" | "file" | "database" | "email" | "web" | "api" | "log";
export interface ClassificationResult { sensitivity: DataSensitivity; matchedPatterns: string[]; }

const levels: DataSensitivity[] = ["public", "internal", "confidential", "secret"];
const rules: Array<{ id: string; sensitivity: DataSensitivity; pattern: RegExp }> = [
  { id: "api_key", sensitivity: "secret", pattern: /(?:sk|pk|api[_-]?key)[_-][\w]{16,}/i },
  { id: "private_key", sensitivity: "secret", pattern: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/i },
  { id: "aws_secret", sensitivity: "secret", pattern: /(?:AKIA|ASIA)[A-Z0-9]{16}/i },
  { id: "password_field", sensitivity: "secret", pattern: /(?:password|passwd|pwd)\s*[:=]\s*\S+/i },
  { id: "email_address", sensitivity: "confidential", pattern: /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g },
  { id: "phone_cn", sensitivity: "confidential", pattern: /1[3-9]\d{9}/g },
  { id: "id_card_cn", sensitivity: "confidential", pattern: /\d{17}[\dXx]/g },
  { id: "credit_card", sensitivity: "confidential", pattern: /\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}/g },
  { id: "internal_url", sensitivity: "internal", pattern: /https?:\/\/(?:10\.|172\.(?:1[6-9]|2\d|3[01])\.|192\.168\.)\S+/g },
  { id: "db_connection", sensitivity: "internal", pattern: /(?:postgres|mysql|mongodb):\/\/\S+/gi },
];

export class DataClassifier {
  classify(content: string): ClassificationResult {
    let sensitivity: DataSensitivity = "public";
    const matchedPatterns: string[] = [];
    rules.forEach((rule) => {
      if (rule.pattern.test(content)) { matchedPatterns.push(rule.id); if (levels.indexOf(rule.sensitivity) > levels.indexOf(sensitivity)) sensitivity = rule.sensitivity; }
      rule.pattern.lastIndex = 0;
    });
    return { sensitivity, matchedPatterns };
  }
}

export interface FlowRule { minSensitivity: DataSensitivity; blockedTargets: DataTarget[]; }
const defaultFlowRules: FlowRule[] = [
  { minSensitivity: "secret", blockedTargets: ["web", "email", "log", "user_output"] },
  { minSensitivity: "confidential", blockedTargets: ["web", "log"] },
  { minSensitivity: "internal", blockedTargets: ["web"] },
];

export class DataFlowViolation extends Error {
  constructor(public readonly sensitivity: DataSensitivity, public readonly target: DataTarget, public readonly matchedPatterns: string[]) {
    super(`数据流违规：${sensitivity} 级数据不允许流向 ${target}（命中：${matchedPatterns.join(", ")}）`);
    this.name = "DataFlowViolation";
  }
}

export class DataFlowGuard {
  private readonly classifier = new DataClassifier();
  constructor(private readonly flowRules: FlowRule[] = defaultFlowRules) {}
  checkBeforeSend(content: string, target: DataTarget): ClassificationResult {
    const classified = this.classifier.classify(content);
    const blocked = this.flowRules.some((rule) => rule.blockedTargets.includes(target) && levels.indexOf(classified.sensitivity) >= levels.indexOf(rule.minSensitivity));
    if (blocked) throw new DataFlowViolation(classified.sensitivity, target, classified.matchedPatterns);
    return classified;
  }
  isAllowed(content: string, target: DataTarget): boolean { try { this.checkBeforeSend(content, target); return true; } catch { return false; } }
}

export interface LineageStep { agentId: string; action: "read" | "transform" | "summarize" | "forward"; timestamp: string; }
export interface DataLineageRecord { id: string; source: DataSource; sourceSensitivity: DataSensitivity; contentHash: string; steps: LineageStep[]; }

export class DataLineageTracker {
  private readonly records = new Map<string, DataLineageRecord>();
  private readonly classifier = new DataClassifier();
  private readonly guard = new DataFlowGuard();
  private nextId = 0;
  recordRead(source: DataSource, content: string, agentId: string): string {
    const id = `lineage-${++this.nextId}`;
    this.records.set(id, { id, source, sourceSensitivity: this.classifier.classify(content).sensitivity, contentHash: createHash("sha256").update(content).digest("hex").slice(0, 16), steps: [{ agentId, action: "read", timestamp: new Date().toISOString() }] });
    return id;
  }
  recordStep(lineageId: string, agentId: string, action: LineageStep["action"]): void { this.records.get(lineageId)?.steps.push({ agentId, action, timestamp: new Date().toISOString() }); }
  getLineage(lineageId: string): DataLineageRecord | undefined { return this.records.get(lineageId); }
  checkLineage(lineageId: string, target: DataTarget): { allowed: boolean; reason?: string } {
    const record = this.records.get(lineageId); if (!record) return { allowed: true };
    const representative = record.sourceSensitivity === "secret" ? "sk-abcdefghijklmnopqrst" : record.sourceSensitivity === "confidential" ? "person@example.com" : record.sourceSensitivity === "internal" ? "http://192.168.1.1/internal" : "public";
    if (this.guard.isAllowed(representative, target)) return { allowed: true };
    return { allowed: false, reason: `来源 ${record.source} 敏感度 ${record.sourceSensitivity}，不允许流向 ${target}` };
  }
}

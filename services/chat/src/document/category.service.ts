import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, asc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { DatabaseService } from "../database/database.service";
import { categories, documents } from "../database/schema";

const MAX_CATEGORY_NAME_LENGTH = 30;
const MAX_CATEGORIES_PER_USER = 50;

/** 删除自定义分类后，原先归属该分类的文档回落到这个内置分类。 */
const FALLBACK_CATEGORY = "product";

export type UserCategory = {
  id: string;
  name: string;
  createdAt: string;
};

@Injectable()
export class CategoryService {
  constructor(private readonly database: DatabaseService) {}

  async list(userId: string): Promise<UserCategory[]> {
    const rows = await this.database.db
      .select({
        id: categories.id,
        name: categories.name,
        createdAt: categories.createdAt,
      })
      .from(categories)
      .where(eq(categories.userId, userId))
      .orderBy(asc(categories.createdAt));

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async create(userId: string, name: string): Promise<UserCategory> {
    const normalized = (name ?? "").trim();
    if (!normalized) {
      throw new BadRequestException("分类名称不能为空");
    }
    if (normalized.length > MAX_CATEGORY_NAME_LENGTH) {
      throw new BadRequestException(
        `分类名称不能超过 ${MAX_CATEGORY_NAME_LENGTH} 个字符`,
      );
    }

    const existing = await this.list(userId);
    if (existing.some((category) => category.name === normalized)) {
      throw new BadRequestException("该分类已存在");
    }
    if (existing.length >= MAX_CATEGORIES_PER_USER) {
      throw new BadRequestException(
        `每个账号最多创建 ${MAX_CATEGORIES_PER_USER} 个自定义分类`,
      );
    }

    const [created] = await this.database.db
      .insert(categories)
      .values({ id: randomUUID(), userId, name: normalized })
      .returning({
        id: categories.id,
        name: categories.name,
        createdAt: categories.createdAt,
      });

    return {
      id: created.id,
      name: created.name,
      createdAt: created.createdAt.toISOString(),
    };
  }

  /**
   * 删除分类，并把仍在使用它的文档回落到内置分类，避免留下悬空的分类引用。
   * 返回受影响的文档数量，便于前端提示。
   */
  async remove(userId: string, id: string): Promise<{ reassigned: number }> {
    const normalizedId = id?.trim();
    if (!normalizedId) {
      throw new BadRequestException("id must be a non-empty string");
    }

    const reassigned = await this.database.db
      .update(documents)
      .set({ category: FALLBACK_CATEGORY })
      .where(
        and(
          eq(documents.userId, userId),
          eq(documents.category, normalizedId),
        ),
      )
      .returning({ id: documents.id });

    const deleted = await this.database.db
      .delete(categories)
      .where(and(eq(categories.id, normalizedId), eq(categories.userId, userId)))
      .returning({ id: categories.id });

    if (deleted.length === 0) {
      throw new NotFoundException("分类不存在");
    }

    return { reassigned: reassigned.length };
  }

  /** 自定义分类 id 是否属于该用户，用于校验文档归类时的取值。 */
  async belongsToUser(userId: string, value: string): Promise<boolean> {
    const normalized = value?.trim();
    if (!normalized) return false;

    const [row] = await this.database.db
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.id, normalized), eq(categories.userId, userId)))
      .limit(1);

    return Boolean(row);
  }
}

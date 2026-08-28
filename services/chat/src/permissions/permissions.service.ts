import { Injectable } from "@nestjs/common";
import { asc, ilike, or } from "drizzle-orm";
import { DatabaseService } from "../database/database.service";
import { permissions } from "../database/schema";

@Injectable()
export class PermissionsService {
  constructor(private readonly database: DatabaseService) {}

  async list(query = "") {
    const q = query.trim();
    return this.database.db.select().from(permissions)
      .where(q ? or(ilike(permissions.code, `%${q}%`), ilike(permissions.name, `%${q}%`), ilike(permissions.module, `%${q}%`)) : undefined)
      .orderBy(asc(permissions.module), asc(permissions.code));
  }
}

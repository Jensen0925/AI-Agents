import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type Database = NodePgDatabase<typeof schema>;

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  readonly pool: Pool;
  readonly db: Database;

  constructor() {
    const connectionString = process.env["DATABASE_URL"];
    if (!connectionString) {
      throw new Error("DATABASE_URL is required to initialize the database");
    }

    this.pool = new Pool({ connectionString });
    this.db = drizzle(this.pool, { schema });
  }

  async onModuleInit(): Promise<void> {
    await this.pool.query("SELECT 1");
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }

  async connect(): Promise<void> {
    await this.pool.query("SELECT 1");
  }

  async disconnect(): Promise<void> {
    await this.pool.end();
  }
}

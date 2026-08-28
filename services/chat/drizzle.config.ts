import { defineConfig } from "drizzle-kit";

const connectionString = process.env["DATABASE_URL"];

if (!connectionString) {
  throw new Error("DATABASE_URL is required for Drizzle migrations");
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/database/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: connectionString },
  strict: true,
  verbose: true,
});

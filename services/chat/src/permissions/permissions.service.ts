import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class PermissionsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query = "") {
    const q = query.trim();
    return this.prisma.permission.findMany({
      where: q ? { OR: [{ code: { contains: q, mode: "insensitive" } }, { name: { contains: q, mode: "insensitive" } }, { module: { contains: q, mode: "insensitive" } }] } : undefined,
      orderBy: [{ module: "asc" }, { code: "asc" }],
    });
  }
}

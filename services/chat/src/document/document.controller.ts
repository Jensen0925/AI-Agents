import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Patch,
  Req,
  Res,
  StreamableFile,
  UnsupportedMediaTypeException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { memoryStorage } from "multer";
import {
  type AuthenticatedRequest,
  JwtAuthGuard,
} from "../auth/jwt-auth.guard";
import {
  ALLOWED_DOCUMENT_MIME_TYPES,
  buildFileResponseHeaders,
  DocumentService,
  MAX_DOCUMENT_SIZE,
  type UploadedDocumentFile,
} from "./document.service";

function currentUserId(request: AuthenticatedRequest): string {
  if (!request.user) {
    throw new BadRequestException("Authenticated user is unavailable");
  }

  return request.user.userId;
}

function requireId(value: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BadRequestException("id must be a non-empty string");
  }

  return value.trim();
}

@UseGuards(JwtAuthGuard)
@Controller("api/documents")
export class DocumentController {
  constructor(private readonly documentService: DocumentService) {}

  @Post("upload")
  @UseInterceptors(
    FileInterceptor("file", {
      storage: memoryStorage(),
      limits: { fileSize: MAX_DOCUMENT_SIZE },
      fileFilter: (_request, file, callback) => {
        if (!ALLOWED_DOCUMENT_MIME_TYPES.has(file.mimetype)) {
          callback(
            new UnsupportedMediaTypeException(
              `Unsupported file type: ${file.mimetype}`,
            ),
            false,
          );
          return;
        }

        callback(null, true);
      },
    }),
  )
  upload(
    @Req() request: AuthenticatedRequest,
    @UploadedFile() file: UploadedDocumentFile | undefined,
    @Body("filename") filename?: string,
    @Body("category") category?: string,
  ) {
    if (!file) {
      throw new BadRequestException("file is required");
    }
    if (filename !== undefined && typeof filename !== "string") {
      throw new BadRequestException("filename must be a string");
    }
    // 只做类型校验：内置分类与用户自定义分类的合法性由 DocumentService 判定。
    if (category !== undefined && typeof category !== "string") {
      throw new BadRequestException("category must be a string");
    }

    return this.documentService.upload(
      currentUserId(request),
      file,
      filename?.trim() || file.originalname,
      category,
    );
  }

  @Patch(":id/category")
  updateCategory(
    @Req() request: AuthenticatedRequest,
    @Param("id") documentId: string,
    @Body("category") category?: string,
  ) {
    if (typeof category !== "string" || !category.trim()) {
      throw new BadRequestException("category must be a non-empty string");
    }

    return this.documentService.updateCategory(
      requireId(documentId),
      currentUserId(request),
      category,
    );
  }

  @Post(":id/process")
  @HttpCode(HttpStatus.ACCEPTED)
  process(
    @Req() request: AuthenticatedRequest,
    @Param("id") documentId: string,
  ) {
    return this.documentService.process(
      requireId(documentId),
      currentUserId(request),
    );
  }

  @Get()
  findByUser(@Req() request: AuthenticatedRequest) {
    return this.documentService.findByUser(currentUserId(request));
  }

  @Get(":id/preview")
  async preview(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
    @Param("id") documentId: string,
  ): Promise<StreamableFile> {
    const preview = await this.documentService.getPreview(
      requireId(documentId),
      currentUserId(request),
    );

    // 同 attachment 端点：可执行脚本的类型不允许内联返回。
    response.set(
      buildFileResponseHeaders({
        mimeType: preview.mimeType,
        filename: preview.filename,
        size: preview.buffer.length,
      }),
    );

    return new StreamableFile(preview.buffer);
  }

  @Get(":id")
  findById(
    @Req() request: AuthenticatedRequest,
    @Param("id") documentId: string,
  ) {
    return this.documentService.findById(
      requireId(documentId),
      currentUserId(request),
    );
  }

  @Delete(":id")
  async delete(
    @Req() request: AuthenticatedRequest,
    @Param("id") documentId: string,
  ): Promise<{ ok: true; id: string }> {
    const id = requireId(documentId);
    await this.documentService.delete(id, currentUserId(request));
    return { ok: true, id };
  }
}

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
  Req,
  UnsupportedMediaTypeException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { memoryStorage } from "multer";
import {
  type AuthenticatedRequest,
  JwtAuthGuard,
} from "../auth/jwt-auth.guard";
import {
  ALLOWED_DOCUMENT_MIME_TYPES,
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
  ) {
    if (!file) {
      throw new BadRequestException("file is required");
    }
    if (filename !== undefined && typeof filename !== "string") {
      throw new BadRequestException("filename must be a string");
    }

    return this.documentService.upload(
      currentUserId(request),
      file,
      filename?.trim() || file.originalname,
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

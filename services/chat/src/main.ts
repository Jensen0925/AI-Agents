import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: (process.env.CORS_ORIGINS ?? "http://localhost:3002").split(","),
    credentials: true,
  });
  const port = Number(process.env.PORT ?? 3001);

  await app.listen(port, "0.0.0.0");
}

void bootstrap();

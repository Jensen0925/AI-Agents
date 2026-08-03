import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "CloudSage AI 需求分析助理",
  description: "CloudSage AI 需求分析工作区",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var theme=localStorage.getItem("cloudsage.theme");var resolved=theme==="light"?"light":"dark";document.documentElement.dataset.cloudsageTheme=resolved;document.documentElement.classList.toggle("dark",resolved==="dark")}catch{document.documentElement.dataset.cloudsageTheme="dark";document.documentElement.classList.add("dark")}`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}

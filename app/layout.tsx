import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CLPNICE — 컨테이너 적재 계획",
  description: "수출 콘솔 화물의 컨테이너 적재 계획(CLP) 자동화",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}

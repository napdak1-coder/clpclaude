import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "clp노블코코",
  description: "수출 콘솔 화물 합적 자동화",
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

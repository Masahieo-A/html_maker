import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Viewpoint — 教材オーサリング",
  description:
    "英語の複雑な文構造を、樹形図・色分け・注釈で視覚的に理解させる教材を作り、HTMLで即共有できるWebアプリのMVP。",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}

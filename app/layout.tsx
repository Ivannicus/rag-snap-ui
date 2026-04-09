import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RAG Snap UI",
  description: "Browse and filter RAG Q&A results",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-gray-50 dark:bg-gray-950 min-h-screen antialiased">
        {children}
      </body>
    </html>
  );
}

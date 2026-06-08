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
      <body className="bg-gray-50 dark:bg-gray-950 min-h-screen antialiased pb-10">
        {children}
        <div className="fixed bottom-0 inset-x-0 z-50 bg-amber-50 dark:bg-gray-800 border-t border-amber-200 dark:border-gray-700">
          <p className="text-center text-xs text-amber-800 dark:text-gray-400 py-2 px-4">
            This tool uses AI and can make mistakes. Please double-check responses.
          </p>
        </div>
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ANAR & CO. | POS",
  description: "ANAR & CO. point of sale"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

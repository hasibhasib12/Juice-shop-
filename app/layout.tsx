import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Juice Shop POS",
  description: "Staff-facing point of sale for a juice shop"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Crowd Remix",
  description: "Live AI visuals for DJs with crowd-driven remixing."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="bg-ink text-white">
      <body>{children}</body>
    </html>
  );
}

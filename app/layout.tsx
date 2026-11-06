import type { Metadata, Viewport } from "next";
import { Geist_Mono, Instrument_Sans, Instrument_Serif } from "next/font/google";
import "./globals.css";

const display = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-display",
  display: "swap"
});

const sans = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap"
});

const mono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap"
});

const title = "Dream Sequence: live AI visuals, written by the crowd";
const description =
  "You write the first scene. Your audience decides what happens next. Dream Sequence turns their ideas into one continuing film, generated live on your screens.";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "https://dream-sequence.vercel.app"),
  title,
  description,
  openGraph: {
    title,
    description,
    type: "website",
    images: [{ url: "/landing/hero.jpg", width: 1440, height: 716 }]
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/landing/hero.jpg"]
  }
};

export const viewport: Viewport = {
  themeColor: "#08080a"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable} bg-ink text-white`}>
      <body>{children}</body>
    </html>
  );
}

import type { Metadata } from "next";
import { Figtree, DM_Sans, Syne_Mono } from "next/font/google";
import "./globals.css";

const figtree = Figtree({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
});

const dmSans = DM_Sans({
  variable: "--font-serif",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  style: ["normal", "italic"],
  display: "swap",
});

const syneMono = Syne_Mono({
  variable: "--font-display",
  subsets: ["latin"],
  weight: "400",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Soundscribe — visual soundwaves from image & text",
  description:
    "A browser-native tool for turning photographs and text into visual soundwave art. No backend, no tracking.",
  openGraph: {
    title: "Soundscribe",
    description:
      "Turn images and text into visual soundwaves. Runs entirely in your browser.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${figtree.variable} ${dmSans.variable} ${syneMono.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}

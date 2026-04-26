import type { Metadata } from "next";
import "./globals.css";

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
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://api.fontshare.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://api.fontshare.com/v2/css?f[]=switzer@200,300,400,500,600,700,800,400i,500i,600i&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}

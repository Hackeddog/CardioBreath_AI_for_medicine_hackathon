import type { Metadata } from "next";
import { Inter, Silkscreen } from "next/font/google";
import "./globals.css";

// Inter: every heading, number and label, so clinical values stay legible on a projector.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
// Silkscreen: decoration only (the wordmark, small labels, the scene's sheep counter); never clinical values.
const pixel = Silkscreen({ subsets: ["latin"], variable: "--font-pixel", weight: ["400", "700"] });

export const metadata: Metadata = {
  title: "CardioBreath: sleep apnea screening from a single-lead ECG",
  description:
    "Screening aid that estimates overnight apnea burden (eAHI) from a single-lead ECG, with signal-quality gating and explainable model attention. Not a diagnosis.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${pixel.variable}`} suppressHydrationWarning>
      <body className="font-sans min-h-screen">{children}</body>
    </html>
  );
}

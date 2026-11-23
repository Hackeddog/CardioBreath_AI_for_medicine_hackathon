import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "CardioBreath — Single-Lead ECG Sleep Apnea Screener",
  description:
    "Explainable single-lead ECG sleep apnea pre-screening via cardiopulmonary coupling (EDR + RRI), 5-fold calibrated ONNX ensemble, and 1D Grad-CAM saliency.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`}>
      <body className="font-sans min-h-screen">{children}</body>
    </html>
  );
}

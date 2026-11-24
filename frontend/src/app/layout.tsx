import type { Metadata } from "next";
import { Inter, Silkscreen, VT323 } from "next/font/google";
import "./globals.css";

// Inter: body copy and dense clinical labels stay easy to read over a long review session.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
// Silkscreen: a classic caps-only pixel face for headlines; its open C keeps "ECG" from reading as "EOG".
const pixel = Silkscreen({ subsets: ["latin"], variable: "--font-pixel", weight: ["400", "700"] });
// VT323: monospaced terminal numerals for the HUD and clinical values, so digits line up.
const hud = VT323({ subsets: ["latin"], variable: "--font-hud", weight: "400" });

export const metadata: Metadata = {
  title: "CardioBreath: sleep apnea screening from a single-lead ECG",
  description:
    "Screening aid that estimates overnight apnea burden (eAHI) from a single-lead ECG, with signal-quality gating and explainable model attention. Not a diagnosis.",
};

// Runs before paint so a saved CRT preference applies without a flash.
const crtScript = `try{if(localStorage.getItem("cb-crt")==="off")document.documentElement.dataset.crt="off"}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${pixel.variable} ${hud.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: crtScript }} />
      </head>
      <body className="font-sans min-h-screen">{children}</body>
    </html>
  );
}

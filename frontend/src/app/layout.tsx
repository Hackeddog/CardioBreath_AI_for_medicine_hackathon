import type { Metadata } from "next";
import { Inter, Source_Serif_4 } from "next/font/google";
import "./globals.css";

// Inter: tabular numerals and legibility at small sizes for dense clinical data.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
// Source Serif: headlines in the register of a medical journal, which reads as research, not a SaaS ad.
const serif = Source_Serif_4({ subsets: ["latin"], variable: "--font-serif", weight: ["500", "600"] });

export const metadata: Metadata = {
  title: "CardioBreath: sleep apnea screening from a single-lead ECG",
  description:
    "Screening aid that estimates overnight apnea burden (eAHI) from a single-lead ECG, with signal-quality gating and explainable model attention. Not a diagnosis.",
};

// Runs before paint so the saved or system theme applies without a flash.
const themeScript = `try{var t=localStorage.getItem("cb-theme");if(t!=="light"&&t!=="dark")t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${serif.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="font-sans min-h-screen">{children}</body>
    </html>
  );
}

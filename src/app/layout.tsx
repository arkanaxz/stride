import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Stride — Running Dashboard",
  description: "A private running log and training dashboard.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: "(()=>{try{const stored=localStorage.getItem('stride-theme');const theme=stored==='light'||stored==='dark'?stored:(window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark');document.documentElement.dataset.theme=theme;}catch{document.documentElement.dataset.theme='dark';}})();" }} /></head><body>{children}</body></html>;
}

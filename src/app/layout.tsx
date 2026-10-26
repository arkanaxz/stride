import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Stride — Running Dashboard",
  description: "A private running log and training dashboard.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}

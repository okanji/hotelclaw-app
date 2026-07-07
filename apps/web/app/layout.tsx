import type { Metadata, Viewport } from "next";
import { Inter, Geist_Mono, Lato } from "next/font/google";
import "./globals.css";
import "stream-chat-react/dist/css/index.css";
import "./stream-chat-overrides.css";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryProvider } from "@/components/providers/query-provider";
import { ThemeProvider } from "@/components/providers/theme-provider";

const inter = Inter({
  variable: "--font-sans-inter",
  subsets: ["latin"],
  axes: ["opsz"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Lato is used only for the chat surface (`--slack-chat-font-family`).
// Slack's web client uses Lato as its primary face — including all weights
// the chat metadata + body need.
const lato = Lato({
  variable: "--font-lato",
  subsets: ["latin"],
  weight: ["400", "700", "900"],
});

export const metadata: Metadata = {
  title: "Hotelclaw",
  description:
    "AI-first productivity and communications platform for hotels and restaurants.",
};

// Brand-aubergine browser theme color (mobile address bar / PWA chrome).
export const viewport: Viewport = {
  themeColor: "#4a154b",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${geistMono.variable} ${lato.variable} h-full antialiased`}
    >
      <body className="h-full flex flex-col overflow-hidden">
        <ThemeProvider>
          <QueryProvider>
            <TooltipProvider>{children}</TooltipProvider>
          </QueryProvider>
          <Toaster richColors position="top-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}

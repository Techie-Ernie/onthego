import type { Metadata, Viewport } from "next";
import { Chivo, Chivo_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SwRegister } from "@/components/SwRegister";
import { AppNav } from "@/components/AppNav";
import { activeSubject } from "@/subjects";
import "./globals.css";

const chivo = Chivo({ variable: "--font-chivo", subsets: ["latin"], display: "swap" });
const chivoMono = Chivo_Mono({ variable: "--font-chivo-mono", subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: { default: `onthego · ${activeSubject.shortName} MCQ practice`, template: "%s · onthego" },
  description: activeSubject.tagline,
  applicationName: "onthego",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "onthego", statusBarStyle: "default" },
  icons: { icon: "/icons/icon.svg", apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f7f5" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
};

// Applies the saved theme before paint (no flash). Settings store mirrors it to localStorage.
const themeScript = `try{var t=localStorage.getItem('otg-theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${chivo.variable} ${chivoMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-dvh antialiased">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 btn btn--secondary">
          Skip to content
        </a>
        <div className="mx-auto flex min-h-dvh w-full max-w-[720px] flex-col">
          <main id="main" className="flex-1 px-4 pb-[calc(88px+var(--safe-b))] pt-4 sm:px-6">
            {children}
          </main>
        </div>
        <AppNav />
        <SwRegister />
        <Analytics />
      </body>
    </html>
  );
}

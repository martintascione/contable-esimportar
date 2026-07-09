import type { Metadata, Viewport } from "next";
import "./globals.css";
import { BRAND } from "@/components/ui/Brand";

export const metadata: Metadata = {
  title: {
    default: `${BRAND.fullName}`,
    template: `%s · ${BRAND.company}`
  },
  description: `${BRAND.tagline} — ${BRAND.company}.`,
  icons: {
    icon: BRAND.logoUrl,
    shortcut: BRAND.logoUrl,
    apple: BRAND.logoUrl
  },
  applicationName: BRAND.fullName,
  authors: [{ name: BRAND.company }],
  openGraph: {
    title: BRAND.fullName,
    description: BRAND.tagline,
    siteName: BRAND.company,
    images: [BRAND.logoUrl]
  },
  manifest: undefined
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: "#0071e3",
  viewportFit: "cover"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}

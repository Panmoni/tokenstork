import { GeistSans, GeistMono } from "geist/font";
import type { Metadata, Viewport } from "next";
import HelloBar from "./components/HelloBar";
import Footer from "./components/Footer";
import Navbar from "./components/Header2";
import GoogleAnalytics from "./components/GoogleAnalytics";
import { BCHPriceProvider } from "./providers/bchpriceclientprovider";
import "./globals.css";
import "@fortawesome/fontawesome-svg-core/styles.css";
import { config } from "@fortawesome/fontawesome-svg-core";
config.autoAddCss = false;

// TODO: add inner pages https://www.tremor.so/docs/components/tracker, https://storybook.tremor.so/?path=/docs/components-list-table--docs

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#4f359b",
};

export const metadata: Metadata = {
  metadataBase: new URL("https://tokenstork.com"),
  title:
    "Token Stork: Discover, Track and Analyze BCH Cash Tokens (0.0.1 beta)",
  description: "Track BCH CashTokens market cap and more with TokenStork.",
  icons: {
    icon: "favicon-32x32.png",
    shortcut: "favicon.ico",
    apple: [
      { url: "apple-touch-icon.png" },
      { url: "favicon-32x32.png", sizes: "32x32", type: "image/png" },
    ],
  },
  manifest: "site.webmanifest",
  openGraph: {
    title:
      "Token Stork: Discover, Track and Analyze BCH Cash Tokens (0.0.1 beta)",
    siteName: "Token Stork",
    description: "Track BCH CashTokens market cap and more with TokenStork.",
    url: "https://tokenstork.com/",
    locale: "en_US",
    type: "website",
    images: [
      {
        url: "fb.png",
        width: 1200,
        height: 630,
        alt: "Token Stork",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Token Stork: Discover, Track and Analyze BCH Cash Tokens",
    description: "Track BCH CashTokens market cap and more with TokenStork.",
    creator: "@bitcoincashsite",
    images: {
      url: "tw.png",
      alt: "Token Stork",
    },
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
  tokenId?: string;
}) {
  return (
    <BCHPriceProvider>
      <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
        <body className="container mx-auto">
          <HelloBar />
          <Navbar />
          {children}
          <Footer />
          <GoogleAnalytics />
        </body>
      </html>
    </BCHPriceProvider>
  );
}

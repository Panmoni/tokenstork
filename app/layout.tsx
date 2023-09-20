import "./globals.css";
import { Inter } from "next/font/google";
import type { Metadata } from "next";
import HelloBar from "./hellobar";
import Footer from "./footer";
import Header from "./header";
import GoogleAnalytics from "./GoogleAnalytics";
import "@fortawesome/fontawesome-svg-core/styles.css";
import { config } from "@fortawesome/fontawesome-svg-core";
config.autoAddCss = false;
import { BCHPriceProvider } from "./bchpriceclientprovider";
// import TokenDataProvider from "./providers/tokendataprovider";

const bodyFont = Inter({
  subsets: ["latin"],
  variable: "--body-font",
});

// const headingFont = bodyFont;

export const metadata: Metadata = {
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
      {/* <TokenDataProvider tokenId={tokenId}> */}
      <html lang="en" className={`${bodyFont.variable} font-sans`}>
        <body>
          <HelloBar />
          <Header />
          {children}
          <Footer />
          <GoogleAnalytics />
        </body>
      </html>
      {/* </TokenDataProvider> */}
    </BCHPriceProvider>
  );
}

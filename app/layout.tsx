import type { Metadata, Viewport } from "next";
import "@fontsource-variable/fraunces";
import "@fontsource-variable/nunito";
import "./globals.css";

export const metadata: Metadata = {
  title: "Shape Stencil Lab",
  description:
    "Train a tiny neural network on triangles, squares and circles, right in your browser, and watch random stencils turn into edge detectors.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f6f0e4",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

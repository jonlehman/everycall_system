import "./globals.css";

export const metadata = {
  title: "EveryCall",
  description: "EveryCall web app"
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
        <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&display=swap" rel="stylesheet" />
        <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0,0" rel="stylesheet" />
        <link rel="stylesheet" href="/assets/app.css" />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
      </head>
      <body>{children}</body>
    </html>
  );
}

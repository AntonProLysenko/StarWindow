import type { PropsWithChildren } from 'react';
import { ScrollViewStyleReset, useServerDocumentContext } from 'expo-router/html';

const APP_NAME = 'StarWindow';
const THEME_COLOR = '#020810';

export default function Root({ children }: PropsWithChildren) {
  const { htmlAttributes, bodyAttributes, headNodes, bodyNodes } = useServerDocumentContext();

  return (
    <html {...htmlAttributes} lang="en">
      <head>
        <ScrollViewStyleReset />
        {headNodes}
        <title>{APP_NAME}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="application-name" content={APP_NAME} />
        <meta name="apple-mobile-web-app-title" content={APP_NAME} />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black" />
        <meta name="theme-color" content={THEME_COLOR} />
        <link rel="icon" type="image/png" sizes="48x48" href="/favicon.png?v=starwindow-20260810" />
        <link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png?v=starwindow-20260810" />
        <link rel="icon" type="image/png" sizes="512x512" href="/icon-512.png?v=starwindow-20260810" />
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link rel="shortcut icon" href="/favicon.ico" />
        <link rel="manifest" href="/manifest.webmanifest?v=starwindow-20260810" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png?v=starwindow-20260810" />
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon-180.png?v=starwindow-20260810" />
      </head>
      <body {...bodyAttributes}>
        {children}
        {bodyNodes}
      </body>
    </html>
  );
}

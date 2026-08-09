const fs = require('fs');
const http = require('http');
const path = require('path');

const port = Number(process.env.PORT) || 8080;
const host = process.env.HOST || '0.0.0.0';
const publicDir = path.join(__dirname, 'dist');
const indexPath = path.join(publicDir, 'index.html');

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function getCacheControl(filePath, status) {
  if (status !== 200) return 'no-store';

  const extension = path.extname(filePath).toLowerCase();
  const basename = path.basename(filePath).toLowerCase();

  if (
    extension === '.html' ||
    basename === 'manifest.webmanifest' ||
    basename === 'assetlinks.json' ||
    basename === 'apple-app-site-association'
  ) {
    return 'no-store, no-cache, must-revalidate, proxy-revalidate';
  }

  if (filePath.includes(`${path.sep}_expo${path.sep}static${path.sep}`)) {
    return 'public, max-age=31536000, immutable';
  }

  return 'public, max-age=3600, must-revalidate';
}

function send(res, status, body, contentType = 'text/plain; charset=utf-8', filePath = '') {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Cache-Control': getCacheControl(filePath, status),
  });
  res.end(body);
}

function resolveStaticPath(urlPath) {
  const decodedPath = decodeURIComponent(urlPath.split('?')[0]);
  const normalizedPath = path.normalize(decodedPath).replace(/^(\.\.[/\\])+/, '');
  const candidatePath = path.join(publicDir, normalizedPath);

  if (!candidatePath.startsWith(publicDir)) {
    return null;
  }

  return candidatePath;
}

const server = http.createServer((req, res) => {
  if (!fs.existsSync(indexPath)) {
    send(
      res,
      500,
      'Missing static export. Run `npm run build` before starting the server.',
    );
    return;
  }

  const requestPath = new URL(req.url || '/', `http://${req.headers.host}`).pathname;
  const staticPath = resolveStaticPath(requestPath);

  if (!staticPath) {
    send(res, 403, 'Forbidden');
    return;
  }

  fs.stat(staticPath, (statError, stat) => {
    const filePath = !statError && stat.isFile() ? staticPath : indexPath;
    const extension = path.extname(filePath).toLowerCase();
    const contentType = mimeTypes[extension] || 'application/octet-stream';

    fs.readFile(filePath, (readError, data) => {
      if (readError) {
        send(res, 500, 'Unable to read static asset.');
        return;
      }

      send(res, 200, data, contentType, filePath);
    });
  });
});

server.listen(port, host, () => {
  console.log(`Serving Expo web export from ${publicDir}`);
  console.log(`Listening on http://${host}:${port}`);
});

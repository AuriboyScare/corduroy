import { app, BrowserWindow, net, protocol } from 'electron';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.join(root, 'dist');
const devUrl = process.env.CORDUROY_DEV_URL;

// The packaged game is served from app:// so it gets the cross-origin isolation
// headers SharedArrayBuffer needs; file:// cannot provide them.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

function serveDist() {
  protocol.handle('app', async (request) => {
    const { pathname } = new URL(request.url);
    const file = path.normalize(
      path.join(dist, decodeURIComponent(pathname === '/' ? '/index.html' : pathname)),
    );
    if (!file.startsWith(dist + path.sep)) return new Response('Forbidden', { status: 403 });
    const response = await net.fetch(pathToFileURL(file).toString());
    const headers = new Headers(response.headers);
    headers.set('Cross-Origin-Opener-Policy', 'same-origin');
    headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
    return new Response(response.body, { status: response.status, headers });
  });
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1600,
    height: 900,
    backgroundColor: '#0b1016',
    title: 'Corduroy',
    webPreferences: {
      preload: path.join(root, 'electron', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const query = process.env.CORDUROY_QUERY ?? '';
  window.loadURL((devUrl ?? 'app://corduroy/') + query);
}

app.whenReady().then(() => {
  if (!devUrl) serveDist();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => app.quit());

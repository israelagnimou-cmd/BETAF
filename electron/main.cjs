const { app, BrowserWindow } = require('electron');
const path = require('path');

if (process.argv.includes('--betaf-server')) {
  const dataDirIndex = process.argv.indexOf('--betaf-data-dir');
  const configuredDataDir = dataDirIndex >= 0 ? process.argv[dataDirIndex + 1] : '';
  process.env.BETAF_DATA_DIR = configuredDataDir || process.env.BETAF_DATA_DIR || path.join(app.getPath('appData'), 'BETAF Studio', 'data');
  require(path.join(__dirname, '..', 'server', 'server.cjs'));
} else {
function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1120,
    minHeight: 720,
    backgroundColor: '#f5f7fb',
    icon: path.join(__dirname, '..', 'build', 'betaf.ico'),
    webPreferences: { contextIsolation: true, sandbox: true }
  });
  win.webContents.on('did-fail-load', (_event, code, description) => {
    console.error(`BETAF Studio failed to load (${code}): ${description}`);
  });
  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html')).catch(error => {
    console.error('BETAF Studio could not open the application:', error);
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}

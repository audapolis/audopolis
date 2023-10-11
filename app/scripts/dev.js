const { createServer, build } = require('vite');
const electronPath = require('electron');
const { spawn } = require('child_process');
const mode = (process.env.MODE = process.env.MODE || 'development');
const sharedConfig = {
  mode,
  build: {
    watch: {},
  },
  logLevel: 'warn',
};

const getWatcher = ({ name, configFile, writeBundle }) => {
  return build({
    ...sharedConfig,
    configFile,
    plugins: [{ name, writeBundle }],
  });
};

const setupMainPackageWatcher = (viteDevServer) => {
  // Write a value to an environment variable to pass it to the main process.
  {
    const protocol = `http${viteDevServer.config.server.https ? 's' : ''}:`;
    const host = viteDevServer.config.server.host || 'localhost';
    const port = viteDevServer.config.server.port;
    const path = '/';
    process.env.VITE_DEV_SERVER_URL = `${protocol}//${host}:${port}${path}`;
  }

  let spawnProcess = null;

  return getWatcher({
    name: 'reload-app-on-main-package-change',
    configFile: 'main_process/vite_main.config.js',
    writeBundle({ dir }) {
      if (spawnProcess !== null) {
        spawnProcess.kill('SIGINT');
        spawnProcess = null;
      }

      spawnProcess = spawn(
        String(electronPath),
        [`${dir}/start.cjs.js`, `--remote-debugging-port=${process.env.DEBUGGER_PORT}`],
        { stdio: 'inherit' }
      );
    },
  });
};

(async () => {
  try {
    const viteDevServer = await createServer({
      ...sharedConfig,
      configFile: 'src/vite_renderer.config.js',
    });

    // we start with a random port in test mode because spawning multiple audapolis instances could
    // be racy. this reduces the flakiness of puppeteer tests
    const basePort = mode === 'test' ? 1000 + Math.round(Math.random() * 5000) : 3000;
    await viteDevServer.listen(basePort);

    await setupMainPackageWatcher(viteDevServer);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();

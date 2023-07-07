// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getVersion, getBuildVersion, getGithubSafeVersion } = require('./get_version.js');

/**
 * @type {import('electron-builder').Configuration}
 * @see https://www.electron.build/configuration/configuration
 */
const config = {
  directories: {
    output: 'dist',
    buildResources: './assets/',
  },
  files: ['build/**', './server/**', './generated/**'],
  extraMetadata: {
    version: getVersion(),
  },
  buildVersion: getBuildVersion(),
  mac: {
    category: 'public.app-category.productivity', // this is also where libreoffice lives
    darkModeSupport: true,
    artifactName: `\${name}-mac-\${arch}-${getGithubSafeVersion()}.\${ext}`,
    target: [
      {
        target: 'dmg',
        arch: ['x64', 'arm64'],
      },
      {
        target: 'zip',
        arch: ['x64', 'arm64'],
      },
    ],
  },
  win: {
    artifactName: `\${name}-win-\${arch}-${getGithubSafeVersion()}.\${ext}`,
  },
  linux: {
    target: [
      'AppImage',
      // 'snap',
      'deb',
      'rpm',
      'pacman',
    ],
    category: 'Audio',
    artifactName: `\${name}-linux-\${arch}-${getGithubSafeVersion()}.\${ext}`,
  },
  // extraResources: ['./server/**', './generated/**'],
  asar: true,
  asarUnpack: ['node_modules/ffmpeg-static/**'],
};

module.exports = config;

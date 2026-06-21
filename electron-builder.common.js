const path = require('path')

module.exports = function createConfig(output) {
  return {
    appId: 'com.ghzplugin.zapbotia',
    productName: 'ZapBot IA',
    directories: {
      output
    },
    files: [
      'package.json',
      'main.js',
      'index.html',
      'gerador-zapbot.html',
      'logo.ico',
      'logo.png',
      'LEIA-ME_CHROME.txt',
      'css/**/*',
      'js/**/*',
      'pages/**/*',
      'node_modules/**/*',
      '!node_modules/.cache/**/*',
      '!node_modules/electron/**/*',
      '!node_modules/electron-builder/**/*'
    ],
    win: {
      executableName: 'ZapBotIA',
      target: [
        {
          target: 'nsis',
          arch: ['x64']
        }
      ],
      icon: path.join(__dirname, 'logo.ico')
    },
    nsis: {
      oneClick: false,
      allowToChangeInstallationDirectory: true,
      createDesktopShortcut: true,
      createStartMenuShortcut: true,
      shortcutName: 'ZapBot IA',
      runAfterFinish: true
    },
    asarUnpack: [
      'node_modules/puppeteer/.local-chromium/**/*',
      'node_modules/puppeteer-core/.local-chromium/**/*',
      'node_modules/@puppeteer/browsers/**/*',
      'node_modules/puppeteer/**/*.node',
      'node_modules/whatsapp-web.js/**/*'
    ]
  }
}

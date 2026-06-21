const createConfig = require('./electron-builder.common')

const config = createConfig('dist_base')

config.extraResources = [
  {
    from: 'vendor/ollama/runtime/',
    to: 'ollama-runtime/'
  },
  {
    from: 'vendor/ollama/models-pack/',
    to: 'ollama-models-pack/'
  }
]

config.nsis.customNsisBinary = {
  url: 'https://github.com/SoundSafari/NSISBI-ElectronBuilder/releases/download/1.0.0/nsisbi-electronbuilder-3.10.3.7z',
  checksum: 'WRmZUsACjIc2s7bvsFGFRofK31hfS7riPlcfI1V9uFB2Q8s7tidgI/9U16+X0I9X2ZhNxi8N7Z3gKvm6ojvLvg=='
}
config.nsis.warningsAsErrors = false

module.exports = config

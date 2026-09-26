// Loads the addon on macOS. Returns null elsewhere or if it failed to build.
let addon = null
if (process.platform === 'darwin') {
  try {
    addon = require('./build/Release/webkit_view.node')
  } catch {
    addon = null
  }
}
module.exports = addon


const getUptime = () => {
  const uptime = process.uptime()
  const seconds = require('pretty-seconds')
  return seconds(uptime)
}

module.exports = {
  getUptime
}

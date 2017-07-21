'use strict'
const discord = require('discord.js')
const winston = require('winston')
const botUtils = require('./util.js')
const config = require('./config.json')

const prefix = config.bot.prefix

let dispatcher = null

const logger = new winston.Logger({
  transports: [
    new winston.transports.Console({
      colorize: true
    })
  ],
  level: process.env.LOG_LEVEL || config.log.level
})

config.bot.token = process.env.BOT_TOKEN

// Create a new bot
const bot = new discord.Client()

bot.on('ready', () => {
  logger.log('info', 'bot ready')
  logger.log('verbose', 'Serving %d users in %d guilds', bot.users.size, bot.guilds.size)
  logger.log('info', require('ffmpeg-binaries').ffmpegPath())
})

bot.on('message', message => {
  // Check if the author is another bot
  if (message.author.bot) {
    // Bots sending direct messages ?!
    if (message.channel instanceof discord.DMChannel && message.author.id !== bot.user.id) {
      logger.log('warn', 'Recieved message from a bot !', {
        author: message.author.tag,
        id: message.author.id,
        content: message.content
      })
    }
    // Don't reply to other bots which includes self
    return
  }

  const msgPrefixed = message.content.indexOf(prefix) === 0
  const msgMentioned = message.content.indexOf(bot.user.toString()) === 0
  const msgNicknameMentioned = message.content.indexOf(`<@!${bot.user.id}>`) === 0

  // If the message is not prefixed don't care about the message
  if (!(msgPrefixed || msgMentioned || msgNicknameMentioned)) {
    return
  }

  logger.log('verbose', 'Message Recieved', {
    author: `${message.author.username}#${message.author.discriminator}`,
    id: message.author.id,
    content: message.content,
    channel: message.channel.id,
    context: (message.guild) ? 'guild' : 'dm'
  })

  let command
  let args
  let type

  if (msgPrefixed) {
    args = message.content.trim().substr(prefix.length).split(' ')
    command = args.shift().toLowerCase()
    command = (command === '') ? false : command
    type = 'prefix'
  } else if (msgMentioned || msgNicknameMentioned) {
    args = message.content.split(' ')
    args.shift() // Remove the mention
    const remaining = args.join(' ')
    args = remaining.trim().split(' ')
    command = args.shift()
    command = command ? command.toLowerCase() : false
    type = 'mention'
  }
  args = args.filter(v => v !== '')
  logger.log('info', 'Message Parsed', {command, args, type})

  if (!command && type === 'mention') {
    // Just a mention
    message.channel.send(':mega: Yes ?')
    return
  }
    // Run the command
  if (command === 'uptime') {
    message.channel.send(`:mega: I've been alive for ${botUtils.getUptime()}`)
    return
  }

  if (command === 'ping') {
    message.channel.send(':mega: Pong.')
    return
  }

  if (command === 'pong') {
    message.channel.send(':mega: Hmm? Ping ?!')
    return
  }

  if (command === 'info') {
    message.channel.send({embed: {
      color: 3447003,
      author: {
        icon_url: bot.user.displayAvatarURL, // eslint-disable-line camelcase
        name: `${bot.user.tag} (${bot.user.id})`
      },
      timestamp: new Date(),
      fields: [
          {name: 'Servers', value: bot.guilds.size, inline: true},
          {name: 'Users', value: bot.users.size, inline: true}
      ],
      footer: {text: `Online for ${botUtils.getUptime()}`}
    }})
    return
  }

  if (command === 'uinfo') {
    let user

      // If it has mentions find the first user
    if (message.mentions.members.size !== 0) {
      user = message.mentions.members.find(v => v.user.toString() === args[0] || `<@!${v.user.id}>` === args[0])
    }
      // If user not found using mentions try username
    if (!user) {
      user = message.guild.members.find(v => v.user.username.toLowerCase() === args.join(' ').toLowerCase())
    }
      // No luck send not found message
    if (!user) {
      message.channel.send(':mega: no user specified')
      return
    }

    const getRolesString = roles => {
      let str = ''
      roles.forEach(v => {
        str = str + ' ' + v.toString()
      })
      return str.trim()
    }
    message.channel.send({embed: {
      color: user.colorRole ? user.colorRole.color : 0xFFFFFF,
      author: {
        icon_url: user.user.displayAvatarURL, // eslint-disable-line camelcase
        name: user.user.tag + (user.nickname ? ` (${user.nickname})` : '')
      },
      // Timestamp: new Date(),
      fields: [
          {name: 'Id', value: user.user.id, inline: true},
          {name: 'Joined At', value: user.joinedAt.toDateString(), inline: true},
          {name: 'Roles', value: getRolesString(user.roles)}
      ]
    }})
    return
  }

  if (command === 'summon') {
      // Only try to join the sender's voice channel if they are in one themselves
    const m = message.channel.send(':mega: attempting to join voice channel ...')
    if (message.member.voiceChannel) {
      message.member.voiceChannel.join()
          .then(() => {
            m.then(message => message.edit(':mega: I have successfully connected to the channel!'))
          })
          .catch(err => {
            logger.log('error', err)
            m.then(message => message.edit(':mega: Error encountered.\nMessage: ```' + err.message + '```'))
          })
      return
    }

        // If already in a channel
    if (bot.voiceConnections.get(message.channel.guild.id)) {
      m.then(message => message.edit(':mega: Already in a voice channel.'))
      return
    }

    let voiceChannels = message.guild.channels.sort((a, b) => {
      return a.position > b.position
    }).filter(channel => {
      if (channel.type === 'voice' && channel.joinable) {
        if (message.guild.afkChannelID) {
          if (message.guild.afkChannelID === channel.id) {
            return false
          }
          return true
        }
        return true
      }
      return false
    })

    if (voiceChannels.size === 0) {
      m.then(message => message.edit(':mega: No joinable Voice Channels found!'))
      return
    }

    voiceChannels = voiceChannels.array()
      // Can simplify
    const attemptJoin = (i, attemptJoin) => {
      voiceChannels[i].join().then(() => {
        m.then(message => message.edit(':mega: I have successfully connected to the channel!'))
      }).catch(err => {
        logger.log('error', err)
        if (i === voiceChannels.length - 1) {
          m.then(message => message.edit(':mega: No joinable Voice Channels found!'))
        } else {
          attemptJoin(i + 1)
        }
      })
    }
    attemptJoin(0)
    return
  }

  // Must simplify
  if (command === 'play') {
    if (bot.voiceConnections.size === 0) {
      message.channel.send(':mega: Invite the bot to a voice channel first!')
      return
    }
    const vc = bot.voiceConnections.get(message.channel.guild.id)
    const url = args[0]
    const ytdl = require('ytdl-core')
    const streamOptions = {seek: 0, volume: 0.05}
    ytdl.getInfo(url).then(() => {
      let stream
      try {
        stream = ytdl(url, {filter: 'audioonly'})
      } catch (e) {
        message.channel.send(':mega: cant play this shit ' + url)
        return
      }
      dispatcher = vc.playStream(stream, streamOptions)
    }).catch(err => {
      logger.log('error', err)
      const ytseatch = require('youtube-search')
      const opts = {
        maxResults: 1,
        key: process.env.YOUTUBE_API_KEY
      }
      ytseatch(args.join(' '), opts, (err, results) => {
        if (err) {
          return logger.log('error', err)
        }
        let stream
        if (results.length === 0) {
          message.channel.send(':mega: no videos found')
          return
        }
        try {
          stream = ytdl(results[0].link, {filter: 'audioonly'})
        } catch (e) {
          message.channel.send(':mega: cant play this shit ' + url)
          return
        }
        message.channel.send(':mega: Playing ' + results[0].link)
        dispatcher = vc.playStream(stream, streamOptions)
      })
    })
    return
  }

  if (command === 'playfile') {
    if (bot.voiceConnections.size === 0) {
      message.channel.send(':mega: Invite the bot to a voice channel first!')
      return
    }

    const vc = bot.voiceConnections.get(message.channel.guild.id)
    const url = args[0].trim()
    const urlpattern = /^(https?:\/\/)?((([a-z\d]([a-z\d-]*[a-z\d])*)\.)+[a-z]{2,}|((\d{1,3}\.){3}\d{1,3}))(:\d+)?(\/[-a-z\d%_.~+]*)*(\?[;&a-z\d%_.~+=-]*)?$/i
    if (!urlpattern.test(url)) {
      message.channel.send(':mega: nope not a valid url')
      return
    }

    dispatcher = vc.playArbitraryInput(url)
    return
  }

  if (command === 'volume') {
    if (!dispatcher) {
      return
    }
    if (parseInt(args[0], 10) <= 200 && parseInt(args[0], 10) >= 0) {
      dispatcher.setVolume(parseInt(args[0], 10) / 100)
    }
    return
  }

  if (command === 'pause') {
    if (!dispatcher) {
      return
    }
    dispatcher.pause()
    return
  }

  if (command === 'resume') {
    if (!dispatcher) {
      return
    }
    dispatcher.resume()
  }
})

bot.login(config.bot.token)

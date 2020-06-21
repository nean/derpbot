'use strict'
const discord = require('discord.js')
const {createLogger: CreateLogger, transports: {Console: ConsoleTransport}} = require('winston')
const botUtils = require('./util.js')
const {format} = require('winston')

let config

if (process.env.NODE_ENV === 'production') {
  config = require('./config/config-prod.json')
} else {
  config = require('./config/config-dev.json')
}

const {prefix} = config.bot

let dispatcher = null

const logger = new CreateLogger({
  format: format.combine(
    format.splat(),
    format.simple()
  ),
  transports: [
    new ConsoleTransport()
  ],
  level: config.log.level
})

config.bot.token = process.env.BOT_TOKEN

// Create a new bot
const bot = new discord.Client()

bot.on('ready', () => {
  logger.log('info', 'bot ready')
  logger.log('verbose', 'Serving %d users in %d guilds', bot.users.size, bot.guilds.size)
})

bot.on('message', async message => {
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

  const messagePrefixed = message.content.indexOf(prefix) === 0
  const messageMentioned = message.content.indexOf(bot.user.toString()) === 0
  const messageNicknameMentioned = message.content.indexOf(`<@!${bot.user.id}>`) === 0

  // If the message is not prefixed don't care about the message
  if (!(messagePrefixed || messageMentioned || messageNicknameMentioned)) {
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

  if (messagePrefixed) {
    args = message.content.trim().slice(prefix.length).split(' ')
    command = args.shift().toLowerCase()
    command = (command === '') ? false : command
    type = 'prefix'
  } else if (messageMentioned || messageNicknameMentioned) {
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
        {name: 'Servers', value: bot.guilds.cache.size, inline: true},
        {name: 'Users', value: bot.users.cache.size, inline: true}
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
      try {
        user = await message.guild.members.fetch({auery: args.join(' '), limit: 1})
        user = user.first()
      } catch {}
    }

    // No luck send not found message
    if (!user) {
      message.channel.send(':mega: no user specified')
      return
    }

    const getRolesString = roles => {
      let string = ''
      roles.forEach(v => {
        string = string + ' ' + v.toString()
      })
      return string.trim()
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
        {name: 'Roles', value: getRolesString(user.roles.cache)}
      ]
    }})
    return
  }

  if (command === 'summon' || command === 'join') {
    // Only try to join the sender's voice channel if they are in one themselves
    const m = await message.channel.send(':mega: attempting to join voice channel ...')
    if (message.member.voice.channel) {
      try {
        await message.member.voice.channel.join()
        m.edit(':mega: I have successfully connected to the channel!')
      } catch (error) {
        m.edit(':mega: Error encountered.\nMessage: ```' + error.message + '```')
      }

      return
    }

    console.log(bot.voice.voiceChannels)

    // If already in a channel
    if (bot.voice.connections.get(message.channel.guild.id)) {
      m.edit(':mega: Already in a voice channel.')
      return
    }

    let voiceChannels = message.guild.channels.cache.sort((a, b) => {
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
      m.edit(':mega: No joinable Voice Channels found!')
      return
    }

    voiceChannels = voiceChannels.array()
    // Can simplify
    const attemptJoin = async i => {
      try {
        await voiceChannels[i].join()
        m.edit(':mega: I have successfully connected to the channel!')
      } catch (error) {
        logger.log('error', error)
        if (i === voiceChannels.length - 1) {
          m.edit(':mega: No joinable Voice Channels found!')
        } else {
          attemptJoin(i + 1)
        }
      }
    }

    await attemptJoin(0)
    return
  }

  // Must simplify
  if (command === 'play') {
    if (bot.voice.connections.size === 0) {
      message.channel.send(':mega: Invite the bot to a voice channel first!')
      return
    }

    const vc = bot.voice.connections.get(message.channel.guild.id)
    const url = args[0]
    const ytdl = require('discord-ytdl-core')
    const streamOptions = {seek: 0, type: 'opus'}
    let stream

    try {
      await ytdl.getInfo(url)

      try {
        stream = ytdl(url, {filter: 'audioonly', opusEncoded: true, encoderArgs: ['-af', 'bass=g=10,dynaudnorm=f=200']})
      } catch {
        message.channel.send(':mega: cant play this shit ' + url)
        return
      }

      dispatcher = vc.play(stream, streamOptions)
    } catch (error) {
      logger.log('error', error)
      const ytseatch = require('youtube-search')
      const options = {
        maxResults: 1,
        key: process.env.YOUTUBE_API_KEY
      }
      ytseatch(args.join(' '), options, (err, results) => {
        if (err) {
          return logger.log('error', err)
        }

        if (results.length === 0) {
          message.channel.send(':mega: no videos found')
          return
        }

        try {
          stream = ytdl(results[0].link, {filter: 'audioonly', opusEncoded: true, encoderArgs: ['-af', 'bass=g=10,dynaudnorm=f=200']})
        } catch {
          message.channel.send(':mega: cant play this shit ' + url)
          return
        }

        message.channel.send(':mega: Playing ' + results[0].link)
        dispatcher = vc.play(stream, streamOptions)
      })
    }

    return
  }

  if (command === 'volume') {
    if (!dispatcher) {
      return
    }

    if (Number.parseInt(args[0], 10) <= 200 && Number.parseInt(args[0], 10) >= 0) {
      dispatcher.setVolume(Number.parseInt(args[0], 10) / 100)
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

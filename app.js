const {Client, Intents, MessageEmbed, DMChannel} = require('discord.js')
const {createLogger: CreateLogger, transports: {Console: ConsoleTransport}} = require('winston')
const {format} = require('winston')
const ytdl = require('ytdl-core-discord')
const {YouTube} = require('popyt')
const {generateDependencyReport, joinVoiceChannel, getVoiceConnection, createAudioResource, createAudioPlayer, StreamType, entersState, AudioPlayerStatus} = require('@discordjs/voice')
const botUtils = require('./util.js')

console.log(generateDependencyReport())

const configFile = process.env.NODE_ENV === 'production' ? './config/config-prod.json' : './config/config-dev.json'
const config = require(configFile)

const {prefix} = config.bot

const logger = new CreateLogger({
  format: format.combine(
    format.splat(),
    format.simple(),
  ),
  transports: [
    new ConsoleTransport(),
  ],
  level: config.log.level,
})

const youtube = new YouTube(process.env.YOUTUBE_API_KEY)

config.bot.token = process.env.BOT_TOKEN

// Create a new bot
const bot = new Client({intents: [Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_MESSAGES, Intents.FLAGS.GUILD_VOICE_STATES]})

bot.on('ready', () => {
  logger.log('info', 'bot ready')

  setInterval(() => {
    bot.user.setActivity(`${bot.users.cache.size} user${bot.users.cache.size !== 1 ? 's' : ''}`, {type: 'LISTENING'})
  }, 1000)

  logger.log('verbose', 'Serving %d users in %d guilds', bot.users.cache.size, bot.guilds.cache.size)
})

bot.on('messageCreate', async message => {
  // Check if the author is another bot
  if (message.author.bot) {
    // Bots sending direct messages ?!
    if (message.channel instanceof DMChannel && message.author.id !== bot.user.id) {
      logger.log('warn', 'Recieved message from a bot !', {
        author: message.author.tag,
        id: message.author.id,
        content: message.content,
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
    context: (message.guild) ? 'guild' : 'dm',
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
    const info = new MessageEmbed()
      .setColor(3_447_003)
      .setAuthor(`${bot.user.tag} (${bot.user.id})`, bot.user.displayAvatarURL())
      .setTimestamp()
      .addFields(
        {name: 'Servers', value: String(bot.guilds.cache.size), inline: true},
        {name: 'Users', value: String(bot.users.cache.size), inline: true},
      )
      .setFooter(`Online for ${botUtils.getUptime()}`)

    message.channel.send({embeds: [info]})

    return
  }

  if (command === 'uinfo') {
    let user

    // If it has mentions find the first user
    if (message.mentions.members.size > 0) {
      user = message.mentions.members.find(v => v.user.toString() === args[0] || `<@!${v.user.id}>` === args[0])
    }

    // If user not found using mentions try username
    if (!user) {
      try {
        user = await message.guild.members.fetch({query: args.join(' '), limit: 1})
        user = user.first()
      } catch {}
    }

    // No luck send not found message
    if (!user) {
      message.channel.send(':mega: no user specified')
      return
    }

    const getRolesString = roles => roles.map(r => r.toString()).join(' ')

    const uinfo = new MessageEmbed()
      .setColor(user.displayColor ? user.displayColor : 0xFF_FF_FF)
      .setAuthor(user.user.tag + (user.nickname ? ` (${user.nickname})` : ''), user.user.displayAvatarURL())
      .setTimestamp()
      .addFields(
        {name: 'Id', value: user.user.id, inline: true},
        {name: 'Joined At', value: user.joinedAt.toDateString(), inline: true},
        {name: 'Roles', value: getRolesString(user.roles.cache)},
      )

    message.channel.send({embeds: [uinfo]})

    return
  }

  if (command === 'summon' || command === 'join') {
    // Only try to join the sender's voice channel if they are in one themselves
    const m = await message.channel.send(':mega: attempting to join voice channel ...')

    const userVoiceChannel = message.member.voice.channel

    if (userVoiceChannel) {
      const permissions = userVoiceChannel.permissionsFor(message.client.user)
      if (!permissions.has('CONNECT') || !permissions.has('SPEAK')) {
        return m.edit(
          ':mega: I need the permissions to join and speak in your voice channel!',
        )
      }

      const connection = getVoiceConnection(userVoiceChannel.guild.id)

      if (connection) {
        return m.edit(
          ':mega: I am already in a voice channel',
        )
      }

      try {
        joinVoiceChannel({
          channelId: userVoiceChannel.id,
          guildId: userVoiceChannel.guild.id,
          adapterCreator: userVoiceChannel.guild.voiceAdapterCreator,
        })

        return m.edit(':mega: I have successfully connected to the channel!')
      } catch (error) {
        return m.edit(':mega: Error encountered.\nMessage: ```' + error.message + '```')
      }
    }

    m.edit(':mega: You should try this command after you join a voice channel.')

    return
  }

  // Must simplify
  if (command === 'play') {
    const vc = getVoiceConnection(message.channel.guild.id)

    if (!vc) {
      message.channel.send(':mega: Invite the bot to a voice channel first!')
      return
    }

    const player = createAudioPlayer({
      debug: true,
    })
    const subscription = vc.subscribe(player)

    const url = args[0]

    try {
      const stream = await ytdl(url, {filter: 'audioonly', opusEncoded: true, encoderArgs: ['-af', 'bass=g=10,dynaudnorm=f=200']})
      const resource = createAudioResource(stream, {
        inlineVolume: true,
      })

      player.play(resource)

      return entersState(player, AudioPlayerStatus.Playing, 5e3)
    } catch (error) {
      logger.log('error', error)

      let videos

      try {
        videos = await youtube.searchVideos(args.join(' '))
      } catch (error_) {
        console.log(error_)
        return message.channel.send(':mega: cant play this shit ' + args.join(' '))
      }

      if (videos && videos.results.length === 0) {
        message.channel.send(':mega: no videos found')
        return
      }

      try {
        message.channel.send(':mega: playing ' + videos.results[0].title)
        const stream = await ytdl(videos.results[0].id, {filter: 'audioonly', opusEncoded: true, encoderArgs: ['-af', 'bass=g=10,dynaudnorm=f=200']})

        const resource = createAudioResource(stream, {
          inlineVolume: true,
        })

        player.play(resource)

        return entersState(player, AudioPlayerStatus.Playing, 5e3)
      } catch (error_) {
        console.log(error_)
        message.channel.send(':mega: cant play this shit ' + videos.results[0].title)
      }
    }
  }
})

bot.login(config.bot.token)

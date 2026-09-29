import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  MessageFlags,
  EmbedBuilder,
} from 'discord.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { PVP_MODES, buildPanel, setupGuild, joinQueue, leaveQueue, getQueueStatus, createParty, inviteParty, acceptPartyInvite, leaveParty, getProfile, getLeaderboard, getActiveMatch, recordResult, cancelMatch, getConfig } from '../../services/pvpMatchmakingService.js';

function modeChoices(subcommand) {
  return subcommand.addStringOption(option =>
    option
      .setName('mode')
      .setDescription('Queue mode')
      .setRequired(true)
      .addChoices(
        ...Object.entries(PVP_MODES).map(([value, m]) => ({
          name: `${m.emoji} ${m.label}`,
          value,
        }))
      )
  );
}
export default {
  data: new SlashCommandBuilder()
    .setName('pvp')
    .setDescription('Discord-only PvP matchmaking')
    .setDMPermission(false)
    .addSubcommand(s => s.setName('setup').setDescription('Configure the PvP matchmaking system')
      .addChannelOption(o => o.setName('category').setDescription('Category for private match rooms').setRequired(true).addChannelTypes(ChannelType.GuildCategory))
      .addChannelOption(o => o.setName('log_channel').setDescription('Channel for match logs').setRequired(false).addChannelTypes(ChannelType.GuildText))
      .addStringOption(o => o.setName('banner').setDescription('Optional image URL for the matchmaking panel').setRequired(false)))
    .addSubcommand(s => s.setName('panel').setDescription('Post the Anon Matchmaking Queue panel in this channel'))
    .addSubcommand(s => modeChoices(s.setName('join').setDescription('Join a PvP matchmaking queue').addStringOption(o => o.setName('mode').setDescription('Queue mode').setRequired(true))))
    .addSubcommand(s => s.setName('leave').setDescription('Leave your current matchmaking queue'))
    .addSubcommand(s => s.setName('status').setDescription('Show live matchmaking queue counts'))
    .addSubcommand(s => s.setName('match').setDescription('Show your current match'))
    .addSubcommand(s => s.setName('profile').setDescription('Show your PvP profile'))
    .addSubcommand(s => s.setName('leaderboard').setDescription('Show the PvP MMR leaderboard'))
    .addSubcommand(s => s.setName('party-create').setDescription('Create a PvP party'))
    .addSubcommand(s => s.setName('party-invite').setDescription('Invite a player to your PvP party').addUserOption(o => o.setName('user').setDescription('Player to invite').setRequired(true)))
    .addSubcommand(s => s.setName('party-accept').setDescription('Accept a PvP party invite').addStringOption(o => o.setName('party_id').setDescription('Party ID from the invite').setRequired(true)))
    .addSubcommand(s => s.setName('party-leave').setDescription('Leave your PvP party'))
    .addSubcommand(s => s.setName('party-info').setDescription('Show your PvP party'))
    .addSubcommand(s => s.setName('result').setDescription('Record a completed match result')
      .addStringOption(o => o.setName('match_id').setDescription('Match ID').setRequired(true))
      .addStringOption(o => o.setName('winner').setDescription('Winning team').setRequired(true).addChoices({ name: 'Team A', value: 'A' }, { name: 'Team B', value: 'B' })))
    .addSubcommand(s => s.setName('cancel').setDescription('Cancel an active/accepting match')
      .addStringOption(o => o.setName('match_id').setDescription('Match ID').setRequired(true))),

  async execute(interaction, config, client) {
    if (!interaction.guild) return interaction.reply({ content: 'This system can only be used in a server.', flags: MessageFlags.Ephemeral });
    const sub = interaction.options.getSubcommand();
    if (['setup', 'result', 'cancel'].includes(sub) && !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ content: '❌ You need **Manage Server** permission for that action.', flags: MessageFlags.Ephemeral });
    }
    await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
    try {
      if (sub === 'setup') {
        const category = interaction.options.getChannel('category');
        const logChannel = interaction.options.getChannel('log_channel');
        const banner = interaction.options.getString('banner');
        const cfg = await setupGuild(client, interaction.guild.id, { categoryId: category.id, logChannelId: logChannel?.id || null, bannerUrl: banner || null });
        return interaction.editReply(`✅ PvP matchmaking configured.\nMatch category: ${category}\nLog channel: ${logChannel || 'Disabled'}\nPanel banner: ${cfg.bannerUrl ? 'Enabled' : 'Disabled'}`);
      }
      if (sub === 'panel') {
        const cfg = await getConfig(client, interaction.guild.id);
        if (!cfg.categoryId) return interaction.editReply('❌ Run `/pvp setup` first so the bot knows where to create match rooms.');
        const panel = await interaction.channel.send(buildPanel(cfg));
        await setupGuild(client, interaction.guild.id, { });
        return interaction.editReply(`✅ PvP matchmaking panel posted: ${panel}`);
      }
      if (sub === 'join') {
        const mode = interaction.options.getString('mode', true);
        const result = await joinQueue(client, interaction.guild, interaction.user.id, mode);
        return interaction.editReply(`✅ You joined **${result.mode.label}**.\nQueue position: **${result.position}**\n\nThe bot will automatically search for an opponent.`);
      }
      if (sub === 'leave') return interaction.editReply(await leaveQueue(client, interaction.guild, interaction.user.id) ? '✅ You left the matchmaking queue.' : 'ℹ️ You are not currently in a queue.');
      if (sub === 'status') {
        const status = await getQueueStatus(client, interaction.guild.id);
        const desc = Object.values(status).map(m => `${m.emoji} **${m.label}** — ${m.players} player(s) queued`).join('\n');
        return interaction.editReply({ embeds: [new EmbedBuilder().setTitle('🔴 PvP Queue Status').setDescription(desc).setColor(0x8b0000).setTimestamp()] });
      }
      if (sub === 'match') {
        const match = await getActiveMatch(client, interaction.guild.id, interaction.user.id);
        if (!match) return interaction.editReply('ℹ️ You do not have an active match.');
        return interaction.editReply({ embeds: [new EmbedBuilder().setTitle(`⚔️ Match ${match.id}`).setDescription(`Mode: **${match.modeLabel}**\nStatus: **${match.status}**\nMatch room: ${match.channelId ? `<#${match.channelId}>` : 'Waiting for acceptance'}`).setColor(0x8b0000)] });
      }
      if (sub === 'profile') {
        const p = await getProfile(client, interaction.guild.id, interaction.user.id);
        const wr = p.matches ? ((p.wins / p.matches) * 100).toFixed(1) : '0.0';
        return interaction.editReply({ embeds: [new EmbedBuilder().setTitle(`⚔️ ${interaction.member.displayName} — PvP Profile`).addFields({ name: 'MMR', value: String(p.mmr), inline: true }, { name: 'Wins', value: String(p.wins), inline: true }, { name: 'Losses', value: String(p.losses), inline: true }, { name: 'Win Rate', value: `${wr}%`, inline: true }, { name: 'Streak', value: String(p.streak), inline: true }).setColor(0x8b0000)] });
      }
      if (sub === 'leaderboard') {
        const rows = await getLeaderboard(client, interaction.guild.id);
        const text = rows.length ? rows.map(([id, p], i) => `**${i + 1}.** <@${id}> — **${p.mmr} MMR** • ${p.wins}-${p.losses}`).join('\n') : 'No ranked players yet.';
        return interaction.editReply({ embeds: [new EmbedBuilder().setTitle('🏆 PvP Leaderboard').setDescription(text).setColor(0x8b0000)] });
      }
      if (sub === 'party-create') { const party = await createParty(client, interaction.guild, interaction.user.id); return interaction.editReply(`✅ Party created. Your party ID is **${party.id}**. Use /pvp party-invite to add players.`); }
      if (sub === 'party-invite') {
        const user = interaction.options.getUser('user', true);
        const party = await inviteParty(client, interaction.guild, interaction.user.id, user.id);
        await user.send(`🎮 You were invited to a PvP party in **${interaction.guild.name}** by <@${interaction.user.id}>. Use /pvp party-accept and enter party ID ${party.id}.`).catch(() => {});
        return interaction.editReply(`✅ Invited ${user} to party **${party.id}**.`);
      }
      if (sub === 'party-accept') return interaction.editReply(`✅ You joined party **${(await acceptPartyInvite(client, interaction.guild, interaction.user.id, interaction.options.getString('party_id', true))).id}**.`);
      if (sub === 'party-leave') { await leaveParty(client, interaction.guild, interaction.user.id); return interaction.editReply('✅ You left your PvP party.'); }
      if (sub === 'party-info') {
        const state = await import('../../services/pvpMatchmakingService.js');
        const raw = await state.loadGuildState(client, interaction.guild.id);
        const party = Object.values(raw.parties).find(p => p.members.includes(interaction.user.id));
        if (!party) return interaction.editReply('ℹ️ You are not in a party.');
        return interaction.editReply({ embeds: [new EmbedBuilder().setTitle(`🎮 PvP Party ${party.id}`).setDescription(`Leader: <@${party.leaderId}>\nMembers:\n${party.members.map(id => `• <@${id}>`).join('\n')}`).setColor(0x8b0000)] });
      }
      if (sub === 'result') { await recordResult(client, interaction.guild, interaction.member, interaction.options.getString('match_id', true), interaction.options.getString('winner', true)); return interaction.editReply('🏆 Match result recorded and MMR updated.'); }
      if (sub === 'cancel') { await cancelMatch(client, interaction.guild, interaction.member, interaction.options.getString('match_id', true)); return interaction.editReply('🛑 Match cancelled.'); }
    } catch (error) {
      return interaction.editReply(`❌ ${error.message || 'Something went wrong.'}`);
    }
  },
};

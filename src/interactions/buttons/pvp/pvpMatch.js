import { MessageFlags } from 'discord.js';
import { acceptMatch, declineMatch, recordResult, cancelMatch } from '../../../services/pvpMatchmakingService.js';

export default [
  {
    name: 'pvp_accept',
    async execute(interaction, client, args) {
      const [guildId, matchId] = args;
      const guild = await client.guilds.fetch(guildId).catch(() => null);
      if (!guild) return interaction.reply({ content: '❌ The matchmaking server could not be found.', flags: MessageFlags.Ephemeral });
      try {
        const result = await acceptMatch(client, guild, interaction.user.id, matchId);
        if (result.complete) {
          return interaction.update({ content: `✅ Match **${matchId}** accepted. The private match room is ready.`, components: [] });
        }
        return interaction.update({ content: `✅ Match **${matchId}** accepted. Waiting for the other players (${result.match.accepted.length}/${result.match.players.length}).`, components: interaction.message.components });
      } catch (error) {
        return interaction.reply({ content: `❌ ${error.message}`, flags: MessageFlags.Ephemeral });
      }
    },
  },
  {
    name: 'pvp_decline',
    async execute(interaction, client, args) {
      const [guildId, matchId] = args;
      const guild = await client.guilds.fetch(guildId).catch(() => null);
      if (!guild) return interaction.reply({ content: '❌ The matchmaking server could not be found.', flags: MessageFlags.Ephemeral });
      try {
        await declineMatch(client, guild, interaction.user.id, matchId);
        return interaction.update({ content: `❌ Match **${matchId}** declined. Players have been returned to the queue.`, components: [] });
      } catch (error) {
        return interaction.reply({ content: `❌ ${error.message}`, flags: MessageFlags.Ephemeral });
      }
    },
  },
  {
    name: 'pvp_result',
    async execute(interaction, client, args) {
      const [matchId, winner] = args;
      try {
        await recordResult(client, interaction.guild, interaction.member, matchId, winner);
        await interaction.reply({ content: `🏆 Team **${winner}** recorded as the winner. MMR has been updated.`, flags: MessageFlags.Ephemeral });
      } catch (error) {
        await interaction.reply({ content: `❌ ${error.message}`, flags: MessageFlags.Ephemeral });
      }
    },
  },
  {
    name: 'pvp_cancel',
    async execute(interaction, client, args) {
      const [matchId] = args;
      try {
        await cancelMatch(client, interaction.guild, interaction.member, matchId);
        await interaction.reply({ content: `🛑 Match **${matchId}** cancelled.`, flags: MessageFlags.Ephemeral });
      } catch (error) {
        await interaction.reply({ content: `❌ ${error.message}`, flags: MessageFlags.Ephemeral });
      }
    },
  },
];

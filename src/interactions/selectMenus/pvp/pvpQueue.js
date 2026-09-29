import { joinQueue, PVP_MODES } from '../../../services/pvpMatchmakingService.js';

export default {
  name: 'pvp_queue',
  async execute(interaction, client) {
    const mode = interaction.values[0];
    const spec = PVP_MODES[mode];
    if (!spec || !interaction.guild) return interaction.reply({ content: '❌ Invalid matchmaking option.', ephemeral: true });
    try {
      const result = await joinQueue(client, interaction.guild, interaction.user.id, mode);
      await interaction.reply({
        content: `✅ You joined **${result.mode.label}**.\nQueue position: **${result.position}**\n\nThe bot is searching for an opponent now.`,
        ephemeral: true,
      });
    } catch (error) {
      await interaction.reply({ content: `❌ ${error.message || 'Unable to join the queue.'}`, ephemeral: true });
    }
  },
};

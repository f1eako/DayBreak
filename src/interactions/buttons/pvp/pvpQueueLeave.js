import { leaveQueue } from '../../../services/pvpMatchmakingService.js';

export default {
  name: 'pvp_leave',
  async execute(interaction, client) {
    if (!interaction.guild) return interaction.reply({ content: 'This button only works in a server.', ephemeral: true });
    const removed = await leaveQueue(client, interaction.guild, interaction.user.id);
    await interaction.reply({ content: removed ? '✅ You left the PvP queue.' : 'ℹ️ You are not currently queued.', ephemeral: true });
  },
};

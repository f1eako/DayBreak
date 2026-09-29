import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
} from 'discord.js';

import { logger } from '../utils/logger.js';

const STATE_PREFIX = 'pvp:state:';
const LOCKS = new Map();

const ACCEPT_TIMEOUT_MS = 60_000;
const MATCH_INTERVAL_MS = 2_500;

export const PVP_MODES = {
  anon: {
    label: 'Anon Queue',
    short: '1v1',
    slots: 1,
    emoji: '🔴',
    description: 'Anonymous KOS matchmaking',
  },

  anon3v3: {
    label: '3v3 Anon Queue',
    short: '3v3',
    slots: 3,
    emoji: '🔴',
    description: '3v3 anonymous KOS matchmaking',
  },

  anon4v4: {
    label: '4v4 Anon Queue',
    short: '4v4',
    slots: 4,
    emoji: '🔴',
    description: '4v4 anonymous KOS matchmaking',
  },

  hopout: {
    label: 'Hop Out Queue',
    short: '2v2',
    slots: 2,
    emoji: '🔴',
    description: '2v2 Hop Out matchmaking',
  },

  gangwar: {
    label: 'Gang Rival/War Queue',
    short: '4v4',
    slots: 4,
    emoji: '🔴',
    description: '4v4 Gang Rival/War matchmaking',
  },
};

const key = guildId => `${STATE_PREFIX}${guildId}`;

const emptyState = () => ({
  version: 1,
  config: {},
  queues: {},
  parties: {},
  profiles: {},
  matches: {},
  invites: {},
});

/* ------------------------------------------------ */
/* LOCKING                                         */
/* ------------------------------------------------ */

async function lock(guildId, fn) {
  const previous = LOCKS.get(guildId) || Promise.resolve();

  let release;

  const current = new Promise(resolve => {
    release = resolve;
  });

  LOCKS.set(guildId, current);

  await previous.catch(() => {});

  try {
    return await fn();
  } finally {
    release();

    if (LOCKS.get(guildId) === current) {
      LOCKS.delete(guildId);
    }
  }
}

/* ------------------------------------------------ */
/* STATE                                            */
/* ------------------------------------------------ */

export async function loadGuildState(client, guildId) {
  const raw = await client.db.get(key(guildId), null);

  if (!raw || typeof raw !== 'object') {
    return emptyState();
  }

  return {
    ...emptyState(),
    ...raw,

    config: {
      ...(raw.config || {}),
    },

    queues: raw.queues || {},
    parties: raw.parties || {},
    profiles: raw.profiles || {},
    matches: raw.matches || {},
    invites: raw.invites || {},
  };
}

async function save(client, guildId, state) {
  await client.db.set(key(guildId), state);
}

/* ------------------------------------------------ */
/* HELPERS                                          */
/* ------------------------------------------------ */

function profile(state, userId) {
  state.profiles[userId] ||= {
    mmr: 1000,
    wins: 0,
    losses: 0,
    streak: 0,
    matches: 0,
    history: [],
  };

  return state.profiles[userId];
}

function modeOf(mode) {
  return PVP_MODES[mode];
}

function partyOf(state, userId) {
  return Object.values(state.parties).find(
    party => party.members?.includes(userId)
  );
}

function queued(state, userId) {
  return Object.values(state.queues).some(queue =>
    (queue || []).some(entry =>
      entry.members?.includes(userId)
    )
  );
}

function activeMatch(state, userId) {
  return Object.values(state.matches).find(match =>
    !['finished', 'cancelled'].includes(match.status) &&
    match.players?.includes(userId)
  );
}

function nameOf(guild, id) {
  const member = guild.members.cache.get(id);

  return (
    member?.displayName ||
    member?.user?.username ||
    `Player ${String(id).slice(-4)}`
  );
}

/* ------------------------------------------------ */
/* TEAM COMBINATIONS                                */
/* ------------------------------------------------ */

function combos(
  entries,
  target,
  start = 0,
  chosen = [],
  total = 0
) {
  if (total === target) {
    return [chosen];
  }

  if (total > target) {
    return [];
  }

  const results = [];

  for (let i = start; i < entries.length; i++) {
    const entry = entries[i];

    const nextTotal = total + entry.members.length;

    if (nextTotal > target) {
      continue;
    }

    const found = combos(
      entries,
      target,
      i + 1,
      [...chosen, entry],
      nextTotal
    );

    if (found.length) {
      results.push(...found);
    }
  }

  return results;
}

function findMatch(entries, slots) {
  const usable = entries.filter(
    entry => entry.members.length <= slots
  );

  if (usable.length < 2) {
    return null;
  }

  for (const first of usable) {
    const teamACombos = combos(usable, slots);

    const teamA = teamACombos.find(team =>
      team.some(entry => entry.groupId === first.groupId)
    );

    if (!teamA) {
      continue;
    }

    const used = new Set(
      teamA.map(entry => entry.groupId)
    );

    const remaining = usable.filter(
      entry => !used.has(entry.groupId)
    );

    const teamB = combos(remaining, slots)[0];

    if (teamB) {
      return {
        teamA,
        teamB,
      };
    }
  }

  return null;
}

/* ------------------------------------------------ */
/* BUTTONS                                          */
/* ------------------------------------------------ */

/*
 * These were missing from your old file.
 *
 * Your crash:
 * ReferenceError: acceptRows is not defined
 *
 * These functions fix that.
 */

function acceptRows(matchId) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`pvp_accept:${matchId}`)
        .setLabel('Accept Match')
        .setEmoji('✅')
        .setStyle(ButtonStyle.Success),

      new ButtonBuilder()
        .setCustomId(`pvp_decline:${matchId}`)
        .setLabel('Decline')
        .setEmoji('❌')
        .setStyle(ButtonStyle.Danger)
    ),
  ];
}

function resultRows(matchId) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`pvp_result:A:${matchId}`)
        .setLabel('Team A Won')
        .setEmoji('🔴')
        .setStyle(ButtonStyle.Danger),

      new ButtonBuilder()
        .setCustomId(`pvp_result:B:${matchId}`)
        .setLabel('Team B Won')
        .setEmoji('🔵')
        .setStyle(ButtonStyle.Primary),

      new ButtonBuilder()
        .setCustomId(`pvp_cancel:${matchId}`)
        .setLabel('Cancel Match')
        .setEmoji('🛑')
        .setStyle(ButtonStyle.Secondary)
    ),
  ];
}

/* ------------------------------------------------ */
/* MATCH EMBEDS                                     */
/* ------------------------------------------------ */

function matchEmbed(match, title = '⚔️ MATCH FOUND') {
  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(
      [
        `**${match.modeLabel}**`,
        '',
        '🔴 **TEAM A**',
        ...match.teamA.map((_, i) => `Player ${i + 1}`),
        '',
        '🔵 **TEAM B**',
        ...match.teamB.map((_, i) => `Player ${i + 1}`),
        '',
        `**Match ID:** ${match.id}`,
        `**Status:** ${
          match.status === 'accepting'
            ? '🟡 Waiting for acceptance'
            : '🟢 Ready'
        }`,
      ].join('\n')
    )
    .setColor(0x8b0000)
    .setFooter({
      text: 'DayBreak LA | PvP Matchmaking',
    })
    .setTimestamp();
}

/* ------------------------------------------------ */
/* DMs                                              */
/* ------------------------------------------------ */

async function dmMatch(guild, userId, match) {
  const user = await guild.client.users
    .fetch(userId)
    .catch(() => null);

  if (!user) {
    return false;
  }

  return user
    .send({
      embeds: [matchEmbed(match)],
      components: acceptRows(match.id),
    })
    .then(() => true)
    .catch(() => false);
}

/* ------------------------------------------------ */
/* SETUP                                            */
/* ------------------------------------------------ */

export async function setupGuild(
  client,
  guildId,
  {
    categoryId,
    logChannelId,
    bannerUrl,
  } = {}
) {
  return lock(guildId, async () => {
    const state = await loadGuildState(client, guildId);

    state.config = {
      ...state.config,

      ...(categoryId !== undefined
        ? { categoryId }
        : {}),

      ...(logChannelId !== undefined
        ? { logChannelId }
        : {}),

      ...(bannerUrl !== undefined
        ? { bannerUrl }
        : {}),
    };

    await save(client, guildId, state);

    return state.config;
  });
}

export async function getConfig(client, guildId) {
  const state = await loadGuildState(client, guildId);

  return state.config;
}

/* ------------------------------------------------ */
/* QUEUE                                            */
/* ------------------------------------------------ */

export async function joinQueue(
  client,
  guild,
  userId,
  mode
) {
  const spec = modeOf(mode);

  if (!spec) {
    throw new Error('Invalid matchmaking mode.');
  }

  return lock(guild.id, async () => {
    const state = await loadGuildState(
      client,
      guild.id
    );

    if (queued(state, userId)) {
      throw new Error(
        'You are already in a matchmaking queue.'
      );
    }

    if (activeMatch(state, userId)) {
      throw new Error(
        'You are already in an active match.'
      );
    }

    const party = partyOf(state, userId);

    if (party && party.leaderId !== userId) {
      throw new Error(
        'Only the party leader can queue the party.'
      );
    }

    const members = party
      ? [...party.members]
      : [userId];

    if (members.length > spec.slots) {
      throw new Error(
        `Your party has ${members.length} players, but **${spec.short}** only supports ${spec.slots} players per team.`
      );
    }

    for (const id of members) {
      if (queued(state, id) || activeMatch(state, id)) {
        throw new Error(
          'A party member is already queued or in a match.'
        );
      }
    }

    state.queues[mode] ||= [];

    const entry = {
      groupId: `${mode}-${userId}-${Date.now()}`,
      leaderId: userId,
      members,
      joinedAt: Date.now(),
    };

    state.queues[mode].push(entry);

    for (const id of members) {
      profile(state, id);
    }

    await save(client, guild.id, state);

    return {
      mode: spec,
      entry,
      position: state.queues[mode].length,
    };
  });
}

export async function leaveQueue(
  client,
  guild,
  userId
) {
  return lock(guild.id, async () => {
    const state = await loadGuildState(
      client,
      guild.id
    );

    let removed = false;

    for (const [mode, entries] of Object.entries(
      state.queues
    )) {
      const index = (entries || []).findIndex(
        entry => entry.members?.includes(userId)
      );

      if (index !== -1) {
        entries.splice(index, 1);
        removed = true;
        break;
      }
    }

    if (!removed) {
      return false;
    }

    await save(client, guild.id, state);

    return true;
  });
}

/* ------------------------------------------------ */
/* PARTIES                                          */
/* ------------------------------------------------ */

export async function createParty(
  client,
  guild,
  userId
) {
  return lock(guild.id, async () => {
    const state = await loadGuildState(
      client,
      guild.id
    );

    if (partyOf(state, userId)) {
      throw new Error(
        'You are already in a party.'
      );
    }

    const id = `party-${userId}-${Date.now()}`;

    state.parties[id] = {
      id,
      leaderId: userId,
      members: [userId],
      createdAt: Date.now(),
    };

    await save(client, guild.id, state);

    return state.parties[id];
  });
}

export async function inviteParty(
  client,
  guild,
  leaderId,
  targetId
) {
  return lock(guild.id, async () => {
    const state = await loadGuildState(
      client,
      guild.id
    );

    const party = partyOf(
      state,
      leaderId
    );

    if (!party || party.leaderId !== leaderId) {
      throw new Error(
        'You must be the party leader.'
      );
    }

    if (party.members.includes(targetId)) {
      throw new Error(
        'That player is already in your party.'
      );
    }

    if (party.members.length >= 4) {
      throw new Error(
        'A party can contain at most 4 players.'
      );
    }

    if (partyOf(state, targetId)) {
      throw new Error(
        'That player is already in a party.'
      );
    }

    state.invites[targetId] ||= [];

    if (!state.invites[targetId].includes(party.id)) {
      state.invites[targetId].push(party.id);
    }

    await save(client, guild.id, state);

    return party;
  });
}

export async function acceptPartyInvite(
  client,
  guild,
  userId,
  partyId
) {
  return lock(guild.id, async () => {
    const state = await loadGuildState(
      client,
      guild.id
    );

    if (partyOf(state, userId)) {
      throw new Error(
        'You are already in a party.'
      );
    }

    const party = state.parties[partyId];

    if (
      !party ||
      !(state.invites[userId] || []).includes(
        partyId
      )
    ) {
      throw new Error(
        'That party invite is invalid or expired.'
      );
    }

    if (party.members.length >= 4) {
      throw new Error(
        'That party is full.'
      );
    }

    party.members.push(userId);

    state.invites[userId] = (
      state.invites[userId] || []
    ).filter(id => id !== partyId);

    await save(client, guild.id, state);

    return party;
  });
}

export async function leaveParty(
  client,
  guild,
  userId
) {
  return lock(guild.id, async () => {
    const state = await loadGuildState(
      client,
      guild.id
    );

    const party = partyOf(
      state,
      userId
    );

    if (!party) {
      throw new Error(
        'You are not in a party.'
      );
    }

    /*
     * Do not allow ANY party member to leave
     * while the party is queued or matched.
     */
    if (
      party.members.some(
        id =>
          queued(state, id) ||
          activeMatch(state, id)
      )
    ) {
      throw new Error(
        'Your party is currently queued or in a match.'
      );
    }

    party.members = party.members.filter(
      id => id !== userId
    );

    if (
      party.leaderId === userId &&
      party.members.length
    ) {
      party.leaderId =
        party.members[0];
    }

    if (!party.members.length) {
      delete state.parties[party.id];
    }

    await save(client, guild.id, state);

    return true;
  });
}

/* ------------------------------------------------ */
/* QUEUE STATUS                                     */
/* ------------------------------------------------ */

export async function getQueueStatus(
  client,
  guildId
) {
  const state = await loadGuildState(
    client,
    guildId
  );

  return Object.fromEntries(
    Object.entries(PVP_MODES).map(
      ([mode, spec]) => [
        mode,
        {
          ...spec,

          groups:
            (state.queues[mode] || [])
              .length,

          players:
            (state.queues[mode] || [])
              .reduce(
                (total, entry) =>
                  total +
                  entry.members.length,
                0
              ),
        },
      ]
    )
  );
}

/* ------------------------------------------------ */
/* MATCH CHANNEL                                    */
/* ------------------------------------------------ */

async function createMatchRoom(
  guild,
  state,
  match
) {
  const categoryId =
    state.config.categoryId;

  const category = categoryId
    ? await guild.channels
        .fetch(categoryId)
        .catch(() => null)
    : null;

  const botId =
    guild.client.user?.id;

  const overwrites = [
    {
      id: guild.roles.everyone.id,
      deny: [
        PermissionFlagsBits.ViewChannel,
      ],
    },

    ...(botId
      ? [
          {
            id: botId,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory,
              PermissionFlagsBits.ManageChannels,
              PermissionFlagsBits.EmbedLinks,
            ],
          },
        ]
      : []),

    ...match.players.map(id => ({
      id,

      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    })),
  ];

  const channel =
    await guild.channels.create({
      name: `match-${match.id}`
        .toLowerCase()
        .slice(0, 90),

      type: ChannelType.GuildText,

      parent:
        category?.type ===
        ChannelType.GuildCategory
          ? category.id
          : undefined,

      permissionOverwrites:
        overwrites,

      topic:
        `${match.modeLabel} | Match ${match.id}`,
    });

  match.channelId =
    channel.id;

  return channel;
}

/* ------------------------------------------------ */
/* MATCH ANNOUNCEMENT                               */
/* ------------------------------------------------ */

async function announceMatch(
  guild,
  state,
  match
) {
  const channel =
    await createMatchRoom(
      guild,
      state,
      match
    );

  const embed =
    matchEmbed(
      match,
      '⚔️ MATCH READY'
    );

  await channel.send({
    content:
      '🎮 **Your Discord matchmaking match is ready.** Play your FiveM fight, then submit the result.',

    embeds: [embed],

    components:
      resultRows(match.id),
  });

  await save(
    guild.client,
    guild.id,
    state
  );

  if (state.config.logChannelId) {
    const log =
      await guild.channels
        .fetch(
          state.config.logChannelId
        )
        .catch(() => null);

    if (log?.isTextBased()) {
      await log
        .send({
          embeds: [
            new EmbedBuilder()
              .setTitle(
                '🎮 PvP Match Created'
              )
              .setDescription(
                [
                  `Match **${match.id}**`,
                  `Mode: **${match.modeLabel}**`,
                  `Players: **${match.players.length}**`,
                  `Channel: ${channel}`,
                ].join('\n')
              )
              .setColor(0x8b0000)
              .setTimestamp(),
          ],
        })
        .catch(() => {});
    }
  }
}

/* ------------------------------------------------ */
/* START MATCH                                     */
/* ------------------------------------------------ */

async function startMatch(
  guild,
  state,
  mode,
  teamAEntries,
  teamBEntries
) {
  const spec =
    modeOf(mode);

  const teamA =
    teamAEntries.flatMap(
      entry => entry.members
    );

  const teamB =
    teamBEntries.flatMap(
      entry => entry.members
    );

  const id =
    Math.random()
      .toString(36)
      .slice(2, 8)
      .toUpperCase();

  const match = {
    id,
    mode,
    modeLabel: spec.short,

    status: 'accepting',

    teamA,
    teamB,

    teamAGroupData:
      teamAEntries.map(entry => ({
        leaderId:
          entry.leaderId,

        members:
          [...entry.members],
      })),

    teamBGroupData:
      teamBEntries.map(entry => ({
        leaderId:
          entry.leaderId,

        members:
          [...entry.members],
      })),

    players: [
      ...teamA,
      ...teamB,
    ],

    accepted: [],

    createdAt:
      Date.now(),

    expiresAt:
      Date.now() +
      ACCEPT_TIMEOUT_MS,

    channelId: null,
  };

  state.matches[id] =
    match;

  const entries = [
    ...teamAEntries,
    ...teamBEntries,
  ];

  state.queues[mode] =
    (state.queues[mode] || [])
      .filter(
        entry =>
          !entries.some(
            used =>
              used.groupId ===
              entry.groupId
          )
      );

  await save(
    guild.client,
    guild.id,
    state
  );

  for (const userId of match.players) {
    const sent =
      await dmMatch(
        guild,
        userId,
        match
      );

    if (!sent) {
      const member =
        await guild.members
          .fetch(userId)
          .catch(() => null);

      if (member) {
        await member
          .send({
            content:
              `⚔️ Match **${id}** found in **${spec.short}**. Please accept the match from your DM.`,
          })
          .catch(() => {});
      }
    }
  }

  return match;
}

/* ------------------------------------------------ */
/* PROCESS QUEUES                                   */
/* ------------------------------------------------ */

export async function processQueues(
  client
) {
  for (const guild of client.guilds.cache.values()) {
    await lock(
      guild.id,
      async () => {
        const state =
          await loadGuildState(
            client,
            guild.id
          );

        let changed =
          false;

        for (
          const [
            mode,
            spec,
          ] of Object.entries(
            PVP_MODES
          )) {
          const entries =
            state.queues[mode] ||
            [];

          if (entries.length < 2) {
            continue;
          }

          const found =
            findMatch(
              entries,
              spec.slots
            );

          if (!found) {
            continue;
          }

          await startMatch(
            guild,
            state,
            mode,
            found.teamA,
            found.teamB
          );

          changed =
            true;
        }

        if (changed) {
          await save(
            client,
            guild.id,
            state
          );
        }
      }
    ).catch(error => {
      logger.error(
        `PvP queue processing failed for ${guild.id}:`,
        error
      );
    });
  }
}

/* ------------------------------------------------ */
/* ACCEPT MATCH                                    */
/* ------------------------------------------------ */

export async function acceptMatch(
  client,
  guild,
  userId,
  matchId
) {
  return lock(
    guild.id,
    async () => {
      const state =
        await loadGuildState(
          client,
          guild.id
        );

      const match =
        state.matches[matchId];

      if (
        !match ||
        match.status !==
          'accepting'
      ) {
        throw new Error(
          'That match is no longer accepting responses.'
        );
      }

      if (
        !match.players.includes(
          userId
        )
      ) {
        throw new Error(
          'You are not part of this match.'
        );
      }

      if (
        Date.now() >
        match.expiresAt
      ) {
        throw new Error(
          'The acceptance window has expired.'
        );
      }

      if (
        !match.accepted.includes(
          userId
        )
      ) {
        match.accepted.push(
          userId
        );
      }

      if (
        match.accepted.length ===
        match.players.length
      ) {
        match.status =
          'active';

        match.acceptedAt =
          Date.now();

        await save(
          client,
          guild.id,
          state
        );

        await announceMatch(
          guild,
          state,
          match
        );

        return {
          match,
          complete: true,
        };
      }

      await save(
        client,
        guild.id,
        state
      );

      return {
        match,
        complete: false,
      };
    }
  );
}

/* ------------------------------------------------ */
/* REQUEUE                                          */
/* ------------------------------------------------ */

async function requeueMatchPlayers(
  state,
  match
) {
  const sourceGroups = [
    ...(match.teamAGroupData || []),
    ...(match.teamBGroupData || []),
  ];

  const groups =
    sourceGroups.length
      ? sourceGroups.map(
          (group, index) => ({
            groupId:
              `requeue-${match.id}-${index}-${Date.now()}`,

            leaderId:
              group.leaderId ||
              group.members[0],

            members:
              [...group.members],

            joinedAt:
              Date.now(),
          })
        )
      : [
          match.teamA,
          match.teamB,
        ].map(
          (members, index) => ({
            groupId:
              `requeue-${match.id}-${index}-${Date.now()}`,

            leaderId:
              members[0],

            members:
              [...members],

            joinedAt:
              Date.now(),
          })
        );

  state.queues[match.mode] ||=
    [];

  state.queues[
    match.mode
  ].push(...groups);
}

/* ------------------------------------------------ */
/* DECLINE MATCH                                   */
/* ------------------------------------------------ */

export async function declineMatch(
  client,
  guild,
  userId,
  matchId
) {
  return lock(
    guild.id,
    async () => {
      const state =
        await loadGuildState(
          client,
          guild.id
        );

      const match =
        state.matches[matchId];

      if (
        !match ||
        match.status !==
          'accepting'
      ) {
        throw new Error(
          'That match is no longer accepting responses.'
        );
      }

      if (
        !match.players.includes(
          userId
        )
      ) {
        throw new Error(
          'You are not part of this match.'
        );
      }

      await requeueMatchPlayers(
        state,
        match
      );

      match.status =
        'cancelled';

      match.cancelledBy =
        userId;

      match.cancelReason =
        'declined';

      match.finishedAt =
        Date.now();

      await save(
        client,
        guild.id,
        state
      );

      return match;
    }
  );
}

/* ------------------------------------------------ */
/* EXPIRE MATCHES                                  */
/* ------------------------------------------------ */

export async function expireMatches(
  client
) {
  for (const guild of client.guilds.cache.values()) {
    await lock(
      guild.id,
      async () => {
        const state =
          await loadGuildState(
            client,
            guild.id
          );

        let changed =
          false;

        for (
          const match of Object.values(
            state.matches
          )
        ) {
          if (
            match.status ===
              'accepting' &&
            Date.now() >
              match.expiresAt
          ) {
            await requeueMatchPlayers(
              state,
              match
            );

            match.status =
              'cancelled';

            match.cancelReason =
              'timeout';

            match.finishedAt =
              Date.now();

            changed =
              true;
          }
        }

        if (changed) {
          await save(
            client,
            guild.id,
            state
          );
        }
      }
    ).catch(error => {
      logger.error(
        `PvP expiration failed for ${guild.id}:`,
        error
      );
    });
  }
}

/* ------------------------------------------------ */
/* RECORD RESULT                                   */
/* ------------------------------------------------ */

export async function recordResult(
  client,
  guild,
  staffMember,
  matchId,
  winningTeam
) {
  return lock(
    guild.id,
    async () => {
      const state =
        await loadGuildState(
          client,
          guild.id
        );

      const match =
        state.matches[matchId];

      if (
        !match ||
        match.status !==
          'active'
      ) {
        throw new Error(
          'That match is not active.'
        );
      }

      if (
        !staffMember.permissions.has(
          PermissionFlagsBits.ManageGuild
        )
      ) {
        throw new Error(
          'You need Manage Server permission to record a match result.'
        );
      }

      if (
        !['A', 'B'].includes(
          winningTeam
        )
      ) {
        throw new Error(
          'Invalid winning team.'
        );
      }

      const winners =
        winningTeam === 'A'
          ? match.teamA
          : match.teamB;

      const losers =
        winningTeam === 'A'
          ? match.teamB
          : match.teamA;

      const winnerAvg =
        winners.reduce(
          (total, id) =>
            total +
            profile(
              state,
              id
            ).mmr,
          0
        ) /
        winners.length;

      const loserAvg =
        losers.reduce(
          (total, id) =>
            total +
            profile(
              state,
              id
            ).mmr,
          0
        ) /
        losers.length;

      const expected =
        1 /
        (
          1 +
          10 **
            (
              (loserAvg -
                winnerAvg) /
              400
            )
        );

      const delta =
        Math.max(
          10,
          Math.round(
            32 *
              (1 -
                expected)
          )
        );

      for (
        const id of winners
      ) {
        const p =
          profile(
            state,
            id
          );

        p.mmr += delta;
        p.wins++;
        p.matches++;
        p.streak =
          Math.max(
            1,
            p.streak + 1
          );

        p.history.unshift({
          matchId,
          result: 'W',
          at: Date.now(),
          mode: match.mode,
        });

        p.history =
          p.history.slice(
            0,
            25
          );
      }

      for (
        const id of losers
      ) {
        const p =
          profile(
            state,
            id
          );

        p.mmr =
          Math.max(
            0,
            p.mmr - delta
          );

        p.losses++;
        p.matches++;

        p.streak =
          Math.min(
            0,
            p.streak - 1
          );

        p.history.unshift({
          matchId,
          result: 'L',
          at: Date.now(),
          mode: match.mode,
        });

        p.history =
          p.history.slice(
            0,
            25
          );
      }

      match.status =
        'finished';

      match.winner =
        winningTeam;

      match.finishedAt =
        Date.now();

      await save(
        client,
        guild.id,
        state
      );

      const channel =
        match.channelId
          ? await guild.channels
              .fetch(
                match.channelId
              )
              .catch(() => null)
          : null;

      if (
        channel?.isTextBased()
      ) {
        await channel
          .send({
            embeds: [
              new EmbedBuilder()
                .setTitle(
                  '🏆 Match Complete'
                )
                .setDescription(
                  [
                    `**${match.id}**`,
                    `Winning Team: **${winningTeam}**`,
                    `MMR change: **±${delta}**`,
                  ].join('\n')
                )
                .setColor(
                  0x8b0000
                )
                .setTimestamp(),
            ],
          })
          .catch(() => {});
      }

      return match;
    }
  );
}

/* ------------------------------------------------ */
/* CANCEL MATCH                                    */
/* ------------------------------------------------ */

export async function cancelMatch(
  client,
  guild,
  staffMember,
  matchId
) {
  return lock(
    guild.id,
    async () => {
      const state =
        await loadGuildState(
          client,
          guild.id
        );

      const match =
        state.matches[matchId];

      if (
        !match ||
        ![
          'accepting',
          'active',
        ].includes(
          match.status
        )
      ) {
        throw new Error(
          'That match cannot be cancelled.'
        );
      }

      if (
        !staffMember.permissions.has(
          PermissionFlagsBits.ManageGuild
        )
      ) {
        throw new Error(
          'You need Manage Server permission.'
        );
      }

      if (
        match.status ===
        'accepting'
      ) {
        await requeueMatchPlayers(
          state,
          match
        );
      }

      match.status =
        'cancelled';

      match.cancelReason =
        'staff';

      match.finishedAt =
        Date.now();

      await save(
        client,
        guild.id,
        state
      );

      if (match.channelId) {
        const channel =
          await guild.channels
            .fetch(
              match.channelId
            )
            .catch(() => null);

        if (channel) {
          await channel
            .delete(
              'PvP match cancelled'
            )
            .catch(() => {});
        }
      }

      return match;
    }
  );
}

/* ------------------------------------------------ */
/* PROFILE                                          */
/* ------------------------------------------------ */

export async function getProfile(
  client,
  guildId,
  userId
) {
  const state =
    await loadGuildState(
      client,
      guildId
    );

  return profile(
    state,
    userId
  );
}

export async function getLeaderboard(
  client,
  guildId
) {
  const state =
    await loadGuildState(
      client,
      guildId
    );

  return Object.entries(
    state.profiles
  )
    .sort(
      (a, b) =>
        (b[1].mmr || 0) -
        (a[1].mmr || 0)
    )
    .slice(0, 10);
}

export async function getActiveMatch(
  client,
  guildId,
  userId
) {
  const state =
    await loadGuildState(
      client,
      guildId
    );

  return (
    Object.values(
      state.matches
    ).find(
      match =>
        ![
          'finished',
          'cancelled',
        ].includes(
          match.status
        ) &&
        match.players?.includes(
          userId
        )
    ) || null
  );
}

/* ------------------------------------------------ */
/* SCHEDULER                                        */
/* ------------------------------------------------ */

export function startPvpScheduler(
  client
) {
  if (client.__pvpScheduler) {
    return;
  }

  client.__pvpScheduler =
    setInterval(
      async () => {
        await processQueues(
          client
        );

        await expireMatches(
          client
        );
      },
      MATCH_INTERVAL_MS
    );

  client.__pvpScheduler.unref?.();

  logger.info(
    'PvP matchmaking scheduler started.'
  );
}

/* ------------------------------------------------ */
/* INTERNALS                                        */
/* ------------------------------------------------ */

export const pvpInternals = {
  nameOf,
  modeOf,
  profile,
};

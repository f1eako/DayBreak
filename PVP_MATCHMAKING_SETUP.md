# Miracle LA Discord-Only PvP Matchmaking

This is integrated into the existing DayBreak/TitanBot project. It does **not** connect to FiveM or require an in-game resource.

## What it adds

- `Anon Queue` (1v1)
- `3v3 Anon Queue`
- `4v4 Anon Queue`
- `Hop Out Queue` (2v2)
- `Gang Rival/War Queue` (4v4)
- Native Discord dropdown panel
- Automatic team matching
- Discord party system (up to 4 players)
- 60-second match acceptance through Discord DMs
- Private Discord match rooms
- Staff result buttons
- MMR, wins, losses, streak and leaderboard
- Persistent storage through the bot's existing database wrapper
- Queue/match scheduler started automatically on `ready`

## Setup

1. Install dependencies normally:

```bash
npm install
```

2. Start the existing bot:

```bash
npm start
```

No new environment variables are required.

3. In your Discord server, create a category for match rooms and optionally a log channel.

4. As a server manager, run:

```text
/pvp setup
```

Choose the match-room category. Optionally choose a log channel and paste your Miracle LA banner URL.

5. In the channel where you want the queue panel, run:

```text
/pvp panel
```

## Player usage

Players can use the panel dropdown, or the slash commands:

```text
/pvp join mode:<mode>
/pvp leave
/pvp status
/pvp match
/pvp profile
/pvp leaderboard
```

## Party usage

```text
/pvp party-create
/pvp party-invite user:@player
/pvp party-accept party_id:<id>
/pvp party-info
/pvp party-leave
```

The party leader queues the party. A party can be up to 4 players. The bot never splits a party across opposing teams.

## Match flow

1. Players/parties select a mode.
2. The scheduler searches the queue every 2.5 seconds.
3. Two valid teams are formed.
4. Every matched player receives a Discord DM with Accept/Decline buttons.
5. Everyone has 60 seconds to accept.
6. If anyone declines or times out, the original party groups are returned to the queue.
7. Once everyone accepts, the bot creates a private Discord match channel.
8. Players fight in FiveM separately.
9. Staff records Team A or Team B as the winner using the match buttons or `/pvp result`.
10. MMR and player stats update.

## Required Discord permissions

The bot needs permission to:

- View Channels
- Send Messages
- Read Message History
- Embed Links
- Manage Channels (for private match-room creation/deletion)

Players need to be able to receive DMs from the server/bot for the 60-second acceptance step.

## Important anonymity note

The matchmaking messages mask player identities as Team A / Team B. Discord cannot hide usernames from users who have access to the private match channel, so the system should be treated as **anonymous matchmaking before the match room is created**, not identity-proof anonymity.

# PasantiasBot

Discord bot that checks the UTN FRC internship listings, stores new postings, and can send automatic announcements.

## Features

- `/scrape` checks for new internship listings and displays them.
- `/latest` lists recent saved postings, optionally filtered by engineering program.
- `/setchannel` chooses where automatic announcements are sent.
- A daily scheduled check runs at noon in the `America/Argentina/Cordoba` time zone.
- `GET /trigger-check` runs an announcement check, for use with an external scheduler.

## Setup

Requires Node.js 18 or newer and a Discord application configured with an interactions endpoint.

Create a `.env` file with:

```env
APP_ID=your_discord_application_id
DISCORD_TOKEN=your_discord_bot_token
PUBLIC_KEY=your_discord_application_public_key
PORT=3000
```

Install dependencies and register the slash commands:

```sh
npm install
npm run register
```

Start the bot:

```sh
npm start
```

Set the Discord interactions endpoint URL to `https://your-public-host/interactions`. The bot needs permission to send messages in the channel selected with `/setchannel`.

The bot stores its selected channel in `config.json` and saved internship listings in `pasantias.json`.

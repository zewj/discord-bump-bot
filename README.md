# Discord Bump Bot

A Discord selfbot that automatically bumps your server using Disboard.

## ⚠️ Important Notice

Using selfbots is against Discord's Terms of Service. Use this at your own risk.

## Setup

1. Install Node.js if you haven't already
2. Clone this repository
3. Install dependencies:
   ```bash
   npm install
   ```
4. Create a `.env` file in the root directory with the following content:
   ```
   TOKEN=your_discord_token_here
   SERVER_ID=your_server_id_here
   CHANNEL_ID=your_channel_id_here
   WEBHOOK_URL=your_webhook_url_here
   ```
   To get your token:
   - Open Discord in your browser
   - Press F12 to open Developer Tools
   - Go to the Network tab
   - Look for requests to Discord's API
   - Find the "authorization" header in the request headers

   To get your Server ID and Channel ID:
   - Enable Developer Mode in Discord (Settings > Advanced > Developer Mode)
   - Right-click on your server and select "Copy Server ID"
   - Right-click on the channel and select "Copy Channel ID"

   To get your Webhook URL:
   - Go to your server settings
   - Select "Integrations"
   - Click "Create Webhook"
   - Choose a channel for notifications
   - Copy the webhook URL

## Usage

1. Make sure you have the Disboard bot in your server
2. Run the bot:
   ```bash
   npm start
   ```

The bot will automatically:
- Send the `/bump` slash command every 2 hours in the specified channel
- Send webhook notifications about the bump status
- Log all activities to the console

## Features

- Automatically bumps your server every 2 hours using slash commands
- Targets a specific server and channel
- Webhook notifications for bump status
- Error handling and logging
- Easy to configure

## Configuration

You can modify the following variables in `index.js`:
- `BUMP_INTERVAL`: Time between bumps (default: 2 hours)

And in your `.env` file:
- `TOKEN`: Your Discord token
- `SERVER_ID`: The ID of your target server
- `CHANNEL_ID`: The ID of your target channel
- `WEBHOOK_URL`: Your Discord webhook URL for status notifications 
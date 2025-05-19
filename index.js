require('dotenv').config();
const { Client } = require('discord.js-selfbot-v13');
const fetch = require('node-fetch');

const client = new Client({
    checkUpdate: false
});

// Configuration
const BUMP_INTERVAL = (2 * 60 + 5) * 60 * 1000; // 2 hours and 5 minutes in milliseconds
const TARGET_SERVER_ID = process.env.SERVER_ID;
const TARGET_CHANNEL_ID = process.env.CHANNEL_ID;
const WEBHOOK_URL = process.env.WEBHOOK_URL;

async function sendWebhookMessage(content, color = 0x00ff00) {
    if (!WEBHOOK_URL) return;
    
    try {
        await fetch(WEBHOOK_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                embeds: [{
                    title: 'Bump Status',
                    description: content,
                    color: color,
                    timestamp: new Date().toISOString()
                }]
            })
        });
    } catch (error) {
        console.error('Error sending webhook:', error);
    }
}

client.on('ready', () => {
    console.log(`Logged in as ${client.user.tag}`);
    console.log('Bump bot is now running!');
    
    // Start the bumping loop
    startBumping();
});

async function startBumping() {
    while (true) {
        try {
            // Get the specific server
            const guild = client.guilds.cache.get(TARGET_SERVER_ID);
            if (!guild) {
                console.error('Target server not found!');
                await sendWebhookMessage('❌ Target server not found!', 0xff0000);
                return;
            }

            // Get the specific channel
            const channel = guild.channels.cache.get(TARGET_CHANNEL_ID);
            if (!channel) {
                console.error('Target channel not found!');
                await sendWebhookMessage('❌ Target channel not found!', 0xff0000);
                return;
            }

            // Find the Disboard bot in the server - try multiple methods
            let disboardBot = guild.members.cache.find(member => 
                member.user.username.toLowerCase() === 'disboard' ||
                member.user.username.toLowerCase() === 'disboard#8790' ||
                member.user.id === '302050872383242240' // Disboard's bot ID
            );

            // If not found in cache, try fetching members
            if (!disboardBot) {
                try {
                    await guild.members.fetch();
                    disboardBot = guild.members.cache.find(member => 
                        member.user.username.toLowerCase() === 'disboard' ||
                        member.user.username.toLowerCase() === 'disboard#8790' ||
                        member.user.id === '302050872383242240'
                    );
                } catch (error) {
                    console.error('Error fetching members:', error);
                }
            }

            if (disboardBot) {
                console.log(`Found Disboard bot: ${disboardBot.user.tag}`);
                console.log(`Bumping server: ${guild.name}`);
                
                try {
                    // Send slash command
                    await channel.sendSlash(disboardBot.id, 'bump');
                    console.log('Bump command sent successfully!');
                    await sendWebhookMessage(`✅ Successfully bumped server: ${guild.name}\nNext bump in 2 hours and 5 minutes`, 0x00ff00);
                } catch (error) {
                    console.error('Error sending bump command:', error);
                    await sendWebhookMessage(`❌ Failed to send bump command: ${error.message}`, 0xff0000);
                }
            } else {
                console.error('Disboard bot not found in the server!');
                console.log('Available bots in server:');
                guild.members.cache.forEach(member => {
                    if (member.user.bot) {
                        console.log(`- ${member.user.tag} (${member.user.id})`);
                    }
                });
                await sendWebhookMessage('❌ Disboard bot not found in the server!', 0xff0000);
            }
        } catch (error) {
            console.error('Error while bumping:', error);
            await sendWebhookMessage(`❌ Error while bumping: ${error.message}`, 0xff0000);
        }

        // Wait for the next bump interval
        await new Promise(resolve => setTimeout(resolve, BUMP_INTERVAL));
    }
}

// Error handling
client.on('error', error => {
    console.error('Client error:', error);
    sendWebhookMessage(`❌ Client error: ${error.message}`, 0xff0000);
});

// Login to Discord
client.login(process.env.TOKEN); 
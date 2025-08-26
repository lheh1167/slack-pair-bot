
const { App } = require('@slack/bolt');

// Initialize the app
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});

// Admin check - simplified
const isAdmin = (userId) => {
  const adminUsers = process.env.ADMIN_USERS ? process.env.ADMIN_USERS.split(',') : [];
  return adminUsers.length === 0 || adminUsers.includes(userId);
};

// Handle /pair-match command
app.command('/pair-match', async ({ command, ack, respond, client }) => {
  await ack();
  
  // Check admin access
  if (!isAdmin(command.user_id)) {
    await respond({
      text: "🔒 Access denied. Only admins can use this command.",
      response_type: 'ephemeral'
    });
    return;
  }

  // Simple modal for pairs input
  try {
    await client.views.open({
      trigger_id: command.trigger_id,
      view: {
        type: 'modal',
        callback_id: 'pair_modal',
        title: { type: 'plain_text', text: '🎯 Create Pairs' },
        submit: { type: 'plain_text', text: 'Create DMs' },
        blocks: [
          {
            type: 'input',
            block_id: 'pairs',
            element: {
              type: 'plain_text_input',
              action_id: 'pairs_list',
              multiline: true,
              placeholder: {
                type: 'plain_text',
                text: '@alice, @bob\n@charlie, @diana\nemail1@company.com, email2@company.com'
              }
            },
            label: { type: 'plain_text', text: 'Enter pairs (one per line)' }
          },
          {
            type: 'input',
            block_id: 'message',
            element: {
              type: 'plain_text_input',
              action_id: 'intro_text',
              placeholder: {
                type: 'plain_text',
                text: 'Hi! You\'ve been paired together...'
              }
            },
            label: { type: 'plain_text', text: 'Introduction message (optional)' },
            optional: true
          }
        ]
      }
    });
  } catch (error) {
    console.error('Error opening modal:', error);
    await respond('Error opening form. Please try again.');
  }
});

// Handle modal submission
app.view('pair_modal', async ({ ack, body, view, client }) => {
  await ack();
  
  const pairsText = view.state.values.pairs.pairs_list.value;
  const introMessage = view.state.values.message.intro_text.value || 
    "👋 Hi! You've been paired together. This is a great opportunity to connect!";
  
  if (!pairsText) {
    return;
  }

  const results = [];
  const lines = pairsText.split('\n').filter(line => line.trim());

  // Process each pair
  for (const line of lines) {
    const users = line.split(',').map(u => u.trim());
    
    if (users.length !== 2) {
      results.push({ success: false, pair: line, error: 'Invalid format' });
      continue;
    }

    try {
      // Find user IDs
      const userId1 = await findUser(client, users[0]);
      const userId2 = await findUser(client, users[1]);
      
      // Create DM between the two users (without admin)
      const conversation = await client.conversations.open({
        users: [userId1, userId2].join(',')
      });
      
      // Send intro message
      await client.chat.postMessage({
        channel: conversation.channel.id,
        text: introMessage
      });
      
      results.push({ success: true, pair: line });
      
      // Small delay to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 200));
      
    } catch (error) {
      console.error(`Error with pair ${line}:`, error.message);
      results.push({ success: false, pair: line, error: error.message });
    }
  }

  // Send summary to admin
  const successful = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  
  let summary = `✅ Created ${successful} pair DMs\n`;
  if (failed > 0) {
    summary += `❌ Failed: ${failed} pairs\n\nFailed pairs:\n`;
    results.filter(r => !r.success).forEach(r => {
      summary += `• ${r.pair}: ${r.error}\n`;
    });
  }
  
  await client.chat.postMessage({
    channel: body.user.id,
    text: summary
  });
});

// Helper function to find user by email or username
async function findUser(client, identifier) {
  // Remove @ symbol if present
  const cleaned = identifier.replace(/^@/, '');
  
  // If it looks like a user ID (starts with U), return it
  if (cleaned.startsWith('U')) {
    return cleaned;
  }
  
  // If it contains @, it's probably an email
  if (cleaned.includes('@')) {
    try {
      const result = await client.users.lookupByEmail({ email: cleaned });
      return result.user.id;
    } catch (error) {
      throw new Error(`Email not found: ${cleaned}`);
    }
  }
  
  // Otherwise, search by display name
  try {
    const users = await client.users.list();
    const user = users.members.find(member => 
      member.profile.display_name?.toLowerCase() === cleaned.toLowerCase() ||
      member.profile.real_name?.toLowerCase() === cleaned.toLowerCase() ||
      member.name?.toLowerCase() === cleaned.toLowerCase()
    );
    
    if (!user) {
      throw new Error(`User not found: ${cleaned}`);
    }
    
    return user.id;
  } catch (error) {
    throw new Error(`Failed to find user: ${cleaned}`);
  }
}

// Start the app - NO HEALTH CHECK to avoid errors
(async () => {
  try {
    const port = process.env.PORT || 10000;
    await app.start(port);
    console.log(`⚡️ Simple Pair Bot running on port ${port}`);
    console.log('Health: Bot is healthy and ready!');
  } catch (error) {
    console.error('Error starting bot:', error);
    process.exit(1);
  }
})();

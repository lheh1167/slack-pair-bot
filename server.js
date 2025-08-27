const { App } = require('@slack/bolt');

// Initialize the app
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});

// Cache for user lookups to improve performance
let userCache = null;
let cacheExpiry = 0;

// Admin check
const isAdmin = (userId) => {
  const adminUsers = process.env.ADMIN_USERS ? process.env.ADMIN_USERS.split(',') : [];
  return adminUsers.length === 0 || adminUsers.includes(userId);
};

// Build user cache for faster lookups
async function buildUserCache(client) {
  const now = Date.now();
  if (userCache && now < cacheExpiry) {
    return userCache;
  }

  try {
    const users = await client.users.list();
    userCache = users.members
      .filter(user => !user.deleted && !user.is_bot)
      .map(user => ({
        id: user.id,
        name: user.name,
        realName: user.profile.real_name || '',
        displayName: user.profile.display_name || '',
        email: user.profile.email || ''
      }));
    
    cacheExpiry = now + (10 * 60 * 1000); // Cache for 10 minutes
    return userCache;
  } catch (error) {
    console.error('Error building user cache:', error);
    return [];
  }
}

// Search users with fuzzy matching
function searchUsers(query, users) {
  if (!query || query.length < 2) return [];
  
  const cleanQuery = query.replace(/^@/, '').toLowerCase().trim();
  
  return users
    .filter(user => {
      return user.name.toLowerCase().includes(cleanQuery) ||
             user.realName.toLowerCase().includes(cleanQuery) ||
             user.displayName.toLowerCase().includes(cleanQuery) ||
             user.email.toLowerCase().includes(cleanQuery);
    })
    .slice(0, 10) // Limit to 10 results
    .map(user => ({
      text: {
        type: 'plain_text',
        text: `${user.realName || user.name} (${user.email || '@' + user.name})`
      },
      value: user.id
    }));
}

// Handle /pair-match command
app.command('/pair-match', async ({ command, ack, respond, client }) => {
  await ack();
  
  if (!isAdmin(command.user_id)) {
    await respond({
      text: "Access denied. Only admins can use this command.",
      response_type: 'ephemeral'
    });
    return;
  }

  // Build user cache first
  await buildUserCache(client);

  try {
    await client.views.open({
      trigger_id: command.trigger_id,
      view: {
        type: 'modal',
        callback_id: 'pair_modal_v2',
        title: { type: 'plain_text', text: 'Create Pairs' },
        submit: { type: 'plain_text', text: 'Create DMs' },
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '*Add pairs one at a time using the dropdowns below:*'
            }
          },
          {
            type: 'section',
            block_id: 'user1_block',
            text: {
              type: 'mrkdwn',
              text: '*First User:*'
            },
            accessory: {
              type: 'external_select',
              action_id: 'user1_select',
              placeholder: {
                type: 'plain_text',
                text: 'Search for first user...'
              },
              min_query_length: 2
            }
          },
          {
            type: 'section',
            block_id: 'user2_block',
            text: {
              type: 'mrkdwn',
              text: '*Second User:*'
            },
            accessory: {
              type: 'external_select',
              action_id: 'user2_select',
              placeholder: {
                type: 'plain_text',
                text: 'Search for second user...'
              },
              min_query_length: 2
            }
          },
          {
            type: 'divider'
          },
          {
            type: 'input',
            block_id: 'message_block',
            element: {
              type: 'plain_text_input',
              action_id: 'intro_message',
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

// Handle user search for dropdowns
app.options('user1_select', async ({ options, ack, client }) => {
  await ack({
    options: searchUsers(options.value, userCache || [])
  });
});

app.options('user2_select', async ({ options, ack, client }) => {
  await ack({
    options: searchUsers(options.value, userCache || [])
  });
});

// Handle modal submission
app.view('pair_modal_v2', async ({ ack, body, view, client }) => {
  await ack();
  
  const values = view.state.values;
  const user1Id = values.user1_block?.user1_select?.selected_option?.value;
  const user2Id = values.user2_block?.user2_select?.selected_option?.value;
  const introMessage = values.message_block?.intro_message?.value || 
    "Hi! You've been paired together. This is a great opportunity to connect!";

  if (!user1Id || !user2Id) {
    await client.chat.postMessage({
      channel: body.user.id,
      text: "Error: Please select both users from the dropdowns."
    });
    return;
  }

  if (user1Id === user2Id) {
    await client.chat.postMessage({
      channel: body.user.id,
      text: "Error: Cannot pair a user with themselves."
    });
    return;
  }

  try {
    // Get user info for the summary
    const [user1Info, user2Info] = await Promise.all([
      client.users.info({ user: user1Id }),
      client.users.info({ user: user2Id })
    ]);

    // Create DM between the two users (admin NOT included)
    const conversation = await client.conversations.open({
      users: [user1Id, user2Id].join(',')
    });
    
    // Send intro message to the pair
    await client.chat.postMessage({
      channel: conversation.channel.id,
      text: introMessage
    });
    
    // Send success message to admin
    await client.chat.postMessage({
      channel: body.user.id,
      text: `Success! Created DM between ${user1Info.user.profile.display_name || user1Info.user.real_name} and ${user2Info.user.profile.display_name || user2Info.user.real_name}`
    });
    
  } catch (error) {
    console.error('Error creating pair:', error);
    await client.chat.postMessage({
      channel: body.user.id,
      text: `Error creating pair: ${error.message}`
    });
  }
});

// Start the app
(async () => {
  try {
    const port = parseInt(process.env.PORT) || 10000;
    await app.start(port);
    console.log(`Simple Pair Bot running on port ${port}`);
    console.log('Bot is ready to create pairs!');
  } catch (error) {
    console.error('Error starting bot:', error);
    process.exit(1);
  }
})();

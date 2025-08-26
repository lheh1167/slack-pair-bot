const { App } = require('@slack/bolt');
const { WebClient } = require('@slack/web-api');

// Initialize your app with your bot token and signing secret
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});

class PairMatchingBot {
  constructor(slackApp) {
    this.app = slackApp;
    // Admin configuration - add your admin user IDs or emails here
    this.adminUsers = process.env.ADMIN_USERS ? process.env.ADMIN_USERS.split(',') : [];
    this.setupCommands();
  }

  async isAdmin(userId, client) {
    try {
      // If no admins configured, allow everyone (for initial setup)
      if (this.adminUsers.length === 0) {
        console.warn('No admin users configured - allowing all users');
        return true;
      }

      // Check if user ID is in admin list
      if (this.adminUsers.includes(userId)) {
        return true;
      }

      // Get user info to check email
      const userInfo = await client.users.info({ user: userId });
      const userEmail = userInfo.user.profile.email;

      // Check if email is in admin list
      if (userEmail && this.adminUsers.includes(userEmail)) {
        return true;
      }

      return false;
    } catch (error) {
      console.error('Error checking admin status:', error);
      return false;
    }
  }

  setupCommands() {
    // Slash command to initiate pair matching
    this.app.command('/pair-match', async ({ command, ack, respond, client }) => {
      await ack();
      
      try {
        // Check if user is admin
        const isAdminUser = await this.isAdmin(command.user_id, client);
        
        if (!isAdminUser) {
          await respond({
            text: "🔒 Access Denied",
            blocks: [
              {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text: '🔒 *Access Denied*\n\nOnly administrators can use the pair matching bot. If you believe this is an error, please contact your workspace admin.'
                }
              }
            ],
            response_type: 'ephemeral'
          });
          return;
        }

        // Open a modal for inputting pairs
        await client.views.open({
          trigger_id: command.trigger_id,
          view: this.getPairInputModal()
        });
      } catch (error) {
        console.error('Error opening modal:', error);
        await respond('Error opening pair matching form. Please try again.');
      }
    });

    // Handle modal submission
    this.app.view('pair_input_modal', async ({ ack, body, view, client }) => {
      await ack();
      
      try {
        const values = view.state.values;
        const pairsText = values.pairs_input.pairs_text.value;
        const introMessage = values.intro_input.intro_message.value || this.getDefaultIntroMessage();
        
        const pairs = this.parsePairs(pairsText);
        
        if (pairs.length === 0) {
          throw new Error('No valid pairs found. Please check your input format.');
        }

        await this.createPairDMs(client, pairs, introMessage, body.user.id);
        
      } catch (error) {
        console.error('Error processing pairs:', error);
        // Send error message to user
        await client.chat.postMessage({
          channel: body.user.id,
          text: `Error: ${error.message}`
        });
      }
    });
  }

  getPairInputModal() {
    return {
      type: 'modal',
      callback_id: 'pair_input_modal',
      title: {
        type: 'plain_text',
        text: '🎯 Pair Matcher',
        emoji: true
      },
      submit: {
        type: 'plain_text',
        text: '✨ Create Pairs',
        emoji: true
      },
      close: {
        type: 'plain_text',
        text: 'Cancel'
      },
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '👋 *Welcome to Pair Matcher!*\n\nEnter pairs to match using any of these formats:'
          }
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '• `@user1, @user2` - Using @ mentions\n• `user1@company.com, user2@company.com` - Using emails\n• `User One, User Two` - Using display names'
          }
        },
        {
          type: 'divider'
        },
        {
          type: 'input',
          block_id: 'pairs_input',
          element: {
            type: 'plain_text_input',
            action_id: 'pairs_text',
            multiline: true,
            placeholder: {
              type: 'plain_text',
              text: '@alice, @bob\n@charlie, @diana\njohn@company.com, jane@company.com'
            }
          },
          label: {
            type: 'plain_text',
            text: '👥 Pairs to Match (one per line)',
            emoji: true
          }
        },
        {
          type: 'input',
          block_id: 'intro_input',
          element: {
            type: 'plain_text_input',
            action_id: 'intro_message',
            multiline: true,
            placeholder: {
              type: 'plain_text',
              text: '👋 Hi! You\'ve been paired together for [purpose]. This is a great opportunity to connect!'
            }
          },
          label: {
            type: 'plain_text',
            text: '💬 Custom Introduction Message (optional)',
            emoji: true
          },
          optional: true
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: '🤖 *Tip:* Use {name1} and {name2} in your message to personalize it!'
            }
          ]
        }
      ]
    };
  }

  parsePairs(pairsText) {
    const lines = pairsText.split('\n').filter(line => line.trim());
    const pairs = [];

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (!trimmedLine) continue;

      // Split by comma and clean up
      const users = trimmedLine.split(',').map(user => user.trim());
      
      if (users.length !== 2) {
        console.warn(`Skipping invalid pair format: ${trimmedLine}`);
        continue;
      }

      pairs.push({
        user1: this.cleanUserId(users[0]),
        user2: this.cleanUserId(users[1]),
        raw: trimmedLine
      });
    }

    return pairs;
  }

  cleanUserId(userInput) {
    // Remove @ symbol if present
    let cleaned = userInput.replace(/^@/, '');
    
    // If it looks like an email, keep as is for lookup
    if (cleaned.includes('@')) {
      return cleaned;
    }
    
    // If it starts with U (Slack user ID format), keep as is
    if (cleaned.startsWith('U')) {
      return cleaned;
    }
    
    // Otherwise, it's probably a display name
    return cleaned;
  }

  async findUserByIdentifier(client, identifier) {
    try {
      // If it's already a user ID (starts with U), return it
      if (identifier.startsWith('U')) {
        return identifier;
      }

      // If it's an email, look up by email
      if (identifier.includes('@')) {
        const result = await client.users.lookupByEmail({
          email: identifier
        });
        return result.user.id;
      }

      // Otherwise, search by display name or real name
      const usersResult = await client.users.list();
      const user = usersResult.members.find(member => 
        member.profile.display_name?.toLowerCase() === identifier.toLowerCase() ||
        member.profile.real_name?.toLowerCase() === identifier.toLowerCase() ||
        member.name?.toLowerCase() === identifier.toLowerCase()
      );

      if (!user) {
        throw new Error(`User not found: ${identifier}`);
      }

      return user.id;
    } catch (error) {
      throw new Error(`Failed to find user "${identifier}": ${error.message}`);
    }
  }

  async createPairDMs(client, pairs, introMessage, requesterId) {
    const results = [];
    
    for (let i = 0; i < pairs.length; i++) {
      const pair = pairs[i];
      
      try {
        // Find user IDs
        const userId1 = await this.findUserByIdentifier(client, pair.user1);
        const userId2 = await this.findUserByIdentifier(client, pair.user2);

        // Get user info for personalized messages
        const [user1Info, user2Info] = await Promise.all([
          client.users.info({ user: userId1 }),
          client.users.info({ user: userId2 })
        ]);

        // Create group DM with both users
        const conversation = await client.conversations.open({
          users: [userId1, userId2].join(',')
        });

        // Send intro message
        const personalizedMessage = this.personalizeIntroMessage(
          introMessage, 
          user1Info.user, 
          user2Info.user
        );

        await client.chat.postMessage({
          channel: conversation.channel.id,
          text: personalizedMessage,
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `🎯 *You've been matched!*\n\n${personalizedMessage}`
              }
            },
            {
              type: 'divider'
            },
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: '💡 *Getting started:*\n• Introduce yourselves\n• Share what you\'re working on\n• Find common interests or goals\n• Schedule a time to chat further'
              }
            },
            {
              type: 'context',
              elements: [
                {
                  type: 'mrkdwn',
                  text: `🤖 Matched by <@${requesterId}> • ${new Date().toLocaleDateString()} • Powered by Pair Matcher Bot`
                }
              ]
            }
          ]
        });

        results.push({
          success: true,
          pair: `${user1Info.user.profile.display_name || user1Info.user.real_name} & ${user2Info.user.profile.display_name || user2Info.user.real_name}`,
          channelId: conversation.channel.id
        });

        // Small delay to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 100));

      } catch (error) {
        console.error(`Error creating DM for pair ${pair.raw}:`, error);
        results.push({
          success: false,
          pair: pair.raw,
          error: error.message
        });
      }
    }

    // Send summary to requester
    await this.sendSummaryToRequester(client, requesterId, results);
  }

  personalizeIntroMessage(template, user1, user2) {
    return template
      .replace(/\{user1\}/g, `<@${user1.id}>`)
      .replace(/\{user2\}/g, `<@${user2.id}>`)
      .replace(/\{name1\}/g, user1.profile.display_name || user1.real_name)
      .replace(/\{name2\}/g, user2.profile.display_name || user2.real_name);
  }

  getDefaultIntroMessage() {
    return "👋 Welcome! You've both been paired together by our matching system. This is a great opportunity to connect, collaborate, and get to know each other better!";
  }

  async sendSummaryToRequester(client, requesterId, results) {
    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);

    const summaryBlocks = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: '🎯 Pair Matching Results',
          emoji: true
        }
      },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*✅ Successful:*\n${successful.length} pairs`
          },
          {
            type: 'mrkdwn',
            text: `*❌ Failed:*\n${failed.length} pairs`
          }
        ]
      }
    ];

    if (successful.length > 0) {
      summaryBlocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*🎉 Successfully created DMs for:*\n${successful.map(r => `• ${r.pair}`).join('\n')}`
        }
      });
    }

    if (failed.length > 0) {
      summaryBlocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*⚠️ Failed to create DMs for:*\n${failed.map(r => `• ${r.pair}: ${r.error}`).join('\n')}`
        }
      });
    }

    summaryBlocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `🤖 Completed at ${new Date().toLocaleString()} • Pair Matcher Bot`
        }
      ]
    });

    await client.chat.postMessage({
      channel: requesterId,
      text: `Pair matching complete! ✅ ${successful.length} successful, ❌ ${failed.length} failed`,
      blocks: summaryBlocks
    });
  }
}

// Initialize the bot
const pairBot = new PairMatchingBot(app);

// Health check endpoint for Render
app.express.get('/health', (req, res) => {
  res.status(200).send('Bot is healthy!');
});

// Start the app
(async () => {
  try {
    const port = process.env.PORT || 3000;
    await app.start(port);
    console.log(`⚡️ Pair Matching Bot is running on port ${port}!`);
  } catch (error) {
    console.error('Error starting app:', error);
  }
})();

module.exports = { PairMatchingBot };

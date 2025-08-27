const { App } = require('@slack/bolt');

// Initialize the app
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});

// User cache for fast lookups
let userCache = null;
let cacheExpiry = 0;

// Admin check
const isAdmin = (userId) => {
  const adminUsers = process.env.ADMIN_USERS ? process.env.ADMIN_USERS.split(',') : [];
  return adminUsers.length === 0 || adminUsers.includes(userId);
};

// Build and cache user list
async function getUserCache(client) {
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
    console.error('Error getting users:', error);
    return [];
  }
}

// Find user by various identifiers
function findUserInCache(identifier, users) {
  if (!identifier) return null;
  
  const cleaned = identifier.replace(/^@/, '').toLowerCase().trim();
  
  // Try exact matches first
  let user = users.find(u => u.id === cleaned);
  if (user) return user;
  
  user = users.find(u => u.email.toLowerCase() === cleaned);
  if (user) return user;
  
  user = users.find(u => u.name.toLowerCase() === cleaned);
  if (user) return user;
  
  // Try partial matches
  user = users.find(u => 
    u.realName.toLowerCase().includes(cleaned) ||
    u.displayName.toLowerCase().includes(cleaned)
  );
  
  return user || null;
}

// Validate pairs and create validation report
function validatePairs(pairsText, users) {
  const lines = pairsText.split('\n').filter(line => line.trim());
  const validatedPairs = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    const userInputs = line.split(',').map(u => u.trim());
    
    if (userInputs.length !== 2) {
      validatedPairs.push({
        lineNumber: i + 1,
        originalLine: line,
        user1: { input: userInputs[0] || '', found: null, valid: false },
        user2: { input: userInputs[1] || '', found: null, valid: false },
        valid: false,
        error: 'Must have exactly 2 users separated by comma'
      });
      continue;
    }
    
    const user1 = findUserInCache(userInputs[0], users);
    const user2 = findUserInCache(userInputs[1], users);
    
    const isValid = user1 && user2 && user1.id !== user2.id;
    
    validatedPairs.push({
      lineNumber: i + 1,
      originalLine: line,
      user1: { 
        input: userInputs[0], 
        found: user1, 
        valid: !!user1 
      },
      user2: { 
        input: userInputs[1], 
        found: user2, 
        valid: !!user2 
      },
      valid: isValid,
      error: !user1 ? `User not found: ${userInputs[0]}` :
             !user2 ? `User not found: ${userInputs[1]}` :
             user1.id === user2.id ? 'Cannot pair user with themselves' : null
    });
  }
  
  return validatedPairs;
}

// Create validation report blocks
function createValidationBlocks(validatedPairs) {
  const blocks = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: 'Pair Validation Results'
      }
    }
  ];
  
  const validPairs = validatedPairs.filter(p => p.valid);
  const invalidPairs = validatedPairs.filter(p => !p.valid);
  
  // Summary
  blocks.push({
    type: 'section',
    fields: [
      {
        type: 'mrkdwn',
        text: `*Valid Pairs:* ${validPairs.length}`
      },
      {
        type: 'mrkdwn',
        text: `*Invalid Pairs:* ${invalidPairs.length}`
      }
    ]
  });
  
  // Show invalid pairs first
  if (invalidPairs.length > 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*Invalid Pairs (need fixing):*'
      }
    });
    
    invalidPairs.forEach(pair => {
      let statusText = `Line ${pair.lineNumber}: \`${pair.originalLine}\`\n`;
      statusText += `Error: ${pair.error}`;
      
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: statusText
        }
      });
    });
    
    blocks.push({ type: 'divider' });
  }
  
  // Show valid pairs
  if (validPairs.length > 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*Valid Pairs (ready to create):*'
      }
    });
    
    validPairs.forEach(pair => {
      const user1Name = pair.user1.found.realName || pair.user1.found.name;
      const user2Name = pair.user2.found.realName || pair.user2.found.name;
      
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `Line ${pair.lineNumber}: ${user1Name} & ${user2Name}`
        }
      });
    });
  }
  
  return blocks;
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

  try {
    await client.views.open({
      trigger_id: command.trigger_id,
      view: {
        type: 'modal',
        callback_id: 'upload_pairs_modal',
        title: { type: 'plain_text', text: 'Upload Pairs' },
        submit: { type: 'plain_text', text: 'Validate' },
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '*Upload your pairs list:*\nPaste your pairs below (one pair per line)\nFormat: user1, user2'
            }
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
                text: '@alice, @bob\ncharlie@company.com, diana@company.com\nJohn Smith, Jane Doe'
              }
            },
            label: { type: 'plain_text', text: 'Pairs List' }
          }
        ]
      }
    });
  } catch (error) {
    console.error('Error opening modal:', error);
    await respond('Error opening form. Please try again.');
  }
});

// Handle validation step
app.view('upload_pairs_modal', async ({ ack, body, view, client }) => {
  await ack();
  
  const pairsText = view.state.values.pairs_input.pairs_text.value;
  
  if (!pairsText || !pairsText.trim()) {
    await client.chat.postMessage({
      channel: body.user.id,
      text: "Error: Please provide a pairs list."
    });
    return;
  }
  
  // Build user cache and validate
  const users = await getUserCache(client);
  const validatedPairs = validatePairs(pairsText, users);
  const validPairs = validatedPairs.filter(p => p.valid);
  
  // Create validation report
  const validationBlocks = createValidationBlocks(validatedPairs);
  
  // Add action buttons
  const actionBlocks = [];
  
  if (validPairs.length > 0) {
    actionBlocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: `Create ${validPairs.length} Valid Pairs`
          },
          value: JSON.stringify({
            pairs: validPairs,
            introMessage: "Hi! You've been paired together. This is a great opportunity to connect!"
          }),
          action_id: 'create_validated_pairs',
          style: 'primary'
        }
      ]
    });
  }
  
  if (validatedPairs.some(p => !p.valid)) {
    actionBlocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: 'Edit & Re-validate'
          },
          value: pairsText,
          action_id: 'edit_pairs'
        }
      ]
    });
  }
  
  // Send validation report
  await client.chat.postMessage({
    channel: body.user.id,
    text: `Validation complete: ${validPairs.length} valid, ${validatedPairs.length - validPairs.length} invalid`,
    blocks: [...validationBlocks, ...actionBlocks]
  });
});

// Handle "Edit & Re-validate" button
app.action('edit_pairs', async ({ ack, body, client }) => {
  await ack();
  
  const originalPairs = body.actions[0].value;
  
  try {
    await client.views.open({
      trigger_id: body.trigger_id,
      view: {
        type: 'modal',
        callback_id: 'upload_pairs_modal',
        title: { type: 'plain_text', text: 'Edit Pairs' },
        submit: { type: 'plain_text', text: 'Re-validate' },
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '*Edit your pairs and re-validate:*'
            }
          },
          {
            type: 'input',
            block_id: 'pairs_input',
            element: {
              type: 'plain_text_input',
              action_id: 'pairs_text',
              multiline: true,
              initial_value: originalPairs
            },
            label: { type: 'plain_text', text: 'Pairs List' }
          }
        ]
      }
    });
  } catch (error) {
    console.error('Error opening edit modal:', error);
  }
});

// Handle "Create Valid Pairs" button
app.action('create_validated_pairs', async ({ ack, body, client }) => {
  await ack();
  
  const data = JSON.parse(body.actions[0].value);
  const validPairs = data.pairs;
  const introMessage = data.introMessage;
  
  const results = [];
  
  // Create DMs for valid pairs
  for (const pair of validPairs) {
    try {
      // Create DM between the two users (admin NOT included)
      const conversation = await client.conversations.open({
        users: [pair.user1.found.id, pair.user2.found.id].join(',')
      });
      
      // Send intro message
      await client.chat.postMessage({
        channel: conversation.channel.id,
        text: introMessage
      });
      
      results.push({
        success: true,
        pair: `${pair.user1.found.realName || pair.user1.found.name} & ${pair.user2.found.realName || pair.user2.found.name}`
      });
      
      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 200));
      
    } catch (error) {
      console.error(`Error creating DM for line ${pair.lineNumber}:`, error);
      results.push({
        success: false,
        pair: pair.originalLine,
        error: error.message
      });
    }
  }
  
  // Send final summary
  const successful = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  
  let summary = `Pair creation complete!\n\nCreated ${successful} pair DMs`;
  if (failed > 0) {
    summary += `\nFailed: ${failed} pairs`;
    results.filter(r => !r.success).forEach(r => {
      summary += `\n• ${r.pair}: ${r.error}`;
    });
  }
  
  await client.chat.postMessage({
    channel: body.user.id,
    text: summary
  });
});

// Start the app
(async () => {
  try {
    const port = parseInt(process.env.PORT) || 10000;
    await app.start(port);
    console.log(`Upload & Validate Bot running on port ${port}`);
  } catch (error) {
    console.error('Error starting bot:', error);
    process.exit(1);
  }
})();

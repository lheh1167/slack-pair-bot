// bot-config.js - Configuration file for customizing bot appearance and behavior

module.exports = {
  // Bot Identity & Branding
  botName: "Pair Matcher Bot",
  botIcon: "🎯", // Emoji that represents your bot
  
  // Color scheme (hex colors for Slack blocks)
  colors: {
    primary: "#2eb67d",    // Green
    secondary: "#ecb22e",  // Yellow  
    danger: "#e01e5a",     // Red
    info: "#36c5f0"        // Blue
  },

  // Bot Appearance Customization
  appearance: {
    // Modal titles and buttons
    modalTitle: "🎯 Pair Matcher",
    submitButtonText: "✨ Create Pairs",
    
    // Header messages
    welcomeHeader: "👋 *Welcome to Pair Matcher!*",
    resultsHeader: "🎯 Pair Matching Results",
    successHeader: "🎉 Successfully created DMs for:",
    failureHeader: "⚠️ Failed to create DMs for:",
    
    // Emojis used throughout
    emojis: {
      success: "✅",
      failure: "❌", 
      lock: "🔒",
      robot: "🤖",
      lightbulb: "💡",
      people: "👥",
      chat: "💬",
      target: "🎯",
      sparkles: "✨",
      warning: "⚠️",
      party: "🎉"
    }
  },

  // Messages & Copy
  messages: {
    defaultIntro: "👋 Welcome! You've both been paired together by our matching system. This is a great opportunity to connect, collaborate, and get to know each other better!",
    
    gettingStartedTips: [
      "Introduce yourselves",
      "Share what you're working on", 
      "Find common interests or goals",
      "Schedule a time to chat further"
    ]
  },

  // Admin Configuration
  adminConfig: {
    // Whether to allow all users if no admins are configured
    allowAllIfNoAdmins: true
  },

  // Bot Behavior Settings
  behavior: {
    // Delay between DM creations (ms) to avoid rate limits
    dmCreationDelay: 100,
    
    // Whether to include getting started tips in DMs
    includeGettingStartedTips: true
  }
};

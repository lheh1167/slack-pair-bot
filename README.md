# Slack Pair Matcher Bot

A Slack bot that helps administrators create structured pair matching by automatically setting up DM conversations between matched users with customizable introduction messages.

## Features

- 🎯 Admin-only access control
- 👥 Flexible user matching (emails, @mentions, display names)
- 💬 Customizable introduction messages
- ✨ Beautiful UI with rich Slack blocks
- 📊 Detailed success/failure reporting

## Setup

1. Create Slack app with provided manifest
2. Deploy to Render with environment variables
3. Configure Slack app URLs
4. Add admin users to ADMIN_USERS environment variable

## Usage

Type `/pair-match` in Slack to start the pair matching process.

## Environment Variables

- `SLACK_BOT_TOKEN` - Your Slack bot token (xoxb-...)
- `SLACK_SIGNING_SECRET` - Your Slack signing secret
- `ADMIN_USERS` - Comma-separated list of admin emails or user IDs
- `PORT` - Server port (automatically set by Render)

## Admin Users

Add admin users in the format:

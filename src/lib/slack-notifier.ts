/**
 * Slack Notifier for Production Errors
 * Sends critical errors to #errors channel in real-time
 */

interface SlackMessage {
  channel: string;
  username: string;
  icon_emoji: string;
  text: string;
  attachments: Array<{
    color: string;
    title: string;
    text: string;
    fields: Array<{
      title: string;
      value: string;
      short: boolean;
    }>;
    ts: number;
  }>;
}

const SLACK_WEBHOOK = process.env.SLACK_ERROR_WEBHOOK;
const SEVERITY_COLORS = {
  critical: '#ff0000',
  error: '#ff6b6b',
  warning: '#ffa500',
  info: '#0099ff',
};

async function sendToSlack(message: SlackMessage) {
  if (!SLACK_WEBHOOK) {
    console.warn('SLACK_ERROR_WEBHOOK not configured');
    return;
  }

  try {
    const response = await fetch(SLACK_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
    });

    if (!response.ok) {
      console.error('Failed to send Slack notification:', response.statusText);
    }
  } catch (error) {
    console.error('Error sending Slack notification:', error);
  }
}

export async function notifyError(
  error: Error,
  context: {
    url?: string;
    userId?: string;
    route?: string;
    severity?: 'critical' | 'error' | 'warning';
    metadata?: Record<string, any>;
  } = {}
) {
  const severity = context.severity || 'error';
  const color = SEVERITY_COLORS[severity];

  const message: SlackMessage = {
    channel: '#errors',
    username: 'Error Monitor',
    icon_emoji: severity === 'critical' ? ':rotating_light:' : ':warning:',
    text: `${severity === 'critical' ? '@here' : ''} ${error.name}: ${error.message}`,
    attachments: [
      {
        color,
        title: `${severity.toUpperCase()} - ${error.name}`,
        text: error.message,
        fields: [
          {
            title: 'Environment',
            value: process.env.NODE_ENV || 'unknown',
            short: true,
          },
          {
            title: 'URL',
            value: context.url || 'N/A',
            short: true,
          },
          {
            title: 'Route',
            value: context.route || 'N/A',
            short: true,
          },
          {
            title: 'User',
            value: context.userId || 'Anonymous',
            short: true,
          },
          {
            title: 'Stack Trace',
            value: `\`\`\`${error.stack || 'No stack trace'}\`\`\``,
            short: false,
          },
          ...(context.metadata
            ? [
                {
                  title: 'Metadata',
                  value: `\`\`\`${JSON.stringify(context.metadata, null, 2)}\`\`\``,
                  short: false,
                },
              ]
            : []),
        ],
        ts: Math.floor(Date.now() / 1000),
      },
    ],
  };

  await sendToSlack(message);
}

export async function notifyDeployment(
  status: 'success' | 'failure',
  info: {
    branch: string;
    commit: string;
    author: string;
    duration?: number;
  }
) {
  const color = status === 'success' ? '#36a64f' : '#ff0000';

  const message: SlackMessage = {
    channel: '#deployments',
    username: 'Deploy Bot',
    icon_emoji: status === 'success' ? ':rocket:' : ':x:',
    text: `Deployment ${status === 'success' ? 'successful' : 'failed'}`,
    attachments: [
      {
        color,
        title: `Deployment ${status.toUpperCase()}`,
        text: `Branch: ${info.branch}`,
        fields: [
          {
            title: 'Branch',
            value: info.branch,
            short: true,
          },
          {
            title: 'Commit',
            value: info.commit.substring(0, 7),
            short: true,
          },
          {
            title: 'Author',
            value: info.author,
            short: true,
          },
          {
            title: 'Duration',
            value: info.duration ? `${info.duration}s` : 'N/A',
            short: true,
          },
        ],
        ts: Math.floor(Date.now() / 1000),
      },
    ],
  };

  await sendToSlack(message);
}

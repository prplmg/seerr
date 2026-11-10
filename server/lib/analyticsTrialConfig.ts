export interface AnalyticsTrialConfig {
  enabled: boolean;
  token?: string;
  host?: string;
  experiment?: string;
}
export function analyticsTrialConfig(): AnalyticsTrialConfig {
  const token = process.env.POSTHOG_PROJECT_TOKEN;
  const host = process.env.POSTHOG_HOST;
  return process.env.POSTHOG_TRIAL_ENABLED === 'true' &&
    token &&
    ['https://us.i.posthog.com', 'https://eu.i.posthog.com'].includes(
      host || ''
    )
    ? { enabled: true, token, host, experiment: 'normal-startup-v1' }
    : { enabled: false };
}

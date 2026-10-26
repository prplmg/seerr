// Shared by the scheduler and review composer; never promise a different cadence.
export const LETTERBOXD_PUBLICATION_TIMEZONE = 'America/Merida';
export const LETTERBOXD_PUBLICATION_CRON = '0 0 9,21 * * *';
export function publicationSchedule(configured?: string) {
  // Replace only the unfinished pilot's old default; preserve explicit overrides.
  const cron =
    !configured || configured === '0 */15 * * * *'
      ? LETTERBOXD_PUBLICATION_CRON
      : configured;
  const match = /^0 (\d{1,2}) (\d{1,2}(?:,\d{1,2})*) \* \* \*$/.exec(cron);
  const hours = match?.[2].split(',').map(Number);
  const times =
    match && Number(match[1]) < 60 && hours?.every((h) => h < 24)
      ? [...new Set(hours)]
          .sort((a, b) => a - b)
          .map(
            (h) => `${String(h).padStart(2, '0')}:${match[1].padStart(2, '0')}`
          )
      : null;
  return { cron, timeZone: LETTERBOXD_PUBLICATION_TIMEZONE, times };
}

const DATE_TIME_FORMAT = new Intl.DateTimeFormat("en-PH", {
  timeZone: "Asia/Manila",
  dateStyle: "medium",
  timeStyle: "short",
});

const DATE_FORMAT = new Intl.DateTimeFormat("en-PH", {
  timeZone: "Asia/Manila",
  dateStyle: "medium",
});

export function formatDateTime(value: Date | string): string {
  return DATE_TIME_FORMAT.format(new Date(value));
}

export function formatDate(value: Date | string): string {
  return DATE_FORMAT.format(new Date(value));
}

/** Formats a calendar day (YYYY-MM-DD, Asia/Manila) as a date, e.g. "Sep 20, 2026". */
export function formatCalendarDay(day: string): string {
  return formatDate(`${day}T12:00:00+08:00`);
}

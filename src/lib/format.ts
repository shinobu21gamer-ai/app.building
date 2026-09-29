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

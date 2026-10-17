import Holidays from "date-holidays";

const TIME_ZONE = "Asia/Manila";
const WORK_START_HOUR = 8;
const WORK_END_HOUR = 17;
const WORKDAY_HOURS = WORK_END_HOUR - WORK_START_HOUR;
const philippinesHolidays = new Holidays("PH");
const holidayCache = new Map<number, Set<string>>();

function localParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

function localDateKey(parts: ReturnType<typeof localParts>) {
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function holidayDates(year: number) {
  let dates = holidayCache.get(year);
  if (!dates) {
    dates = new Set(
      philippinesHolidays
        .getHolidays(year)
        .filter(
          (holiday) =>
            holiday.type === "public" ||
            (holiday.type === "optional" &&
              "note" in holiday &&
              typeof holiday.note === "string" &&
              holiday.note.toLowerCase().includes("non-working day")),
        )
        .map((holiday) => holiday.date.slice(0, 10)),
    );
    holidayCache.set(year, dates);
  }
  return dates;
}

function isWorkingDay(date: Date) {
  const parts = localParts(date);
  const dayOfWeek = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    weekday: "short",
  }).format(date);
  return (
    dayOfWeek !== "Sat" &&
    dayOfWeek !== "Sun" &&
    !holidayDates(parts.year).has(localDateKey(parts))
  );
}

function atManilaTime(date: Date, hour: number) {
  const parts = localParts(date);
  // Manila is UTC+8 year-round. Rebuild the instant from local wall-clock parts.
  return new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day, hour - 8, 0, 0, 0),
  );
}

function nextLocalDay(date: Date) {
  return new Date(date.getTime() + 24 * 60 * 60 * 1000);
}

/**
 * One business day is nine working hours, Monday–Friday 08:00–17:00 Manila
 * time, excluding PH regular and published special non-working holidays. The returned instant is kept in UTC.
 */
export function loginReportDueAt(reportedAt: Date): Date {
  let cursor = new Date(reportedAt);
  let remainingMs = WORKDAY_HOURS * 60 * 60 * 1000;

  for (let guard = 0; guard < 370; guard += 1) {
    if (!isWorkingDay(cursor)) {
      cursor = atManilaTime(nextLocalDay(cursor), WORK_START_HOUR);
      continue;
    }

    const parts = localParts(cursor);
    const currentMs =
      ((parts.hour * 60 + parts.minute) * 60 + parts.second) * 1000 +
      cursor.getUTCMilliseconds();
    const startMs = WORK_START_HOUR * 60 * 60 * 1000;
    const endMs = WORK_END_HOUR * 60 * 60 * 1000;

    if (currentMs < startMs) {
      cursor = atManilaTime(cursor, WORK_START_HOUR);
      continue;
    }
    if (currentMs >= endMs) {
      cursor = atManilaTime(nextLocalDay(cursor), WORK_START_HOUR);
      continue;
    }

    const availableMs = endMs - currentMs;
    if (remainingMs <= availableMs) {
      return new Date(cursor.getTime() + remainingMs);
    }

    remainingMs -= availableMs;
    cursor = atManilaTime(nextLocalDay(cursor), WORK_START_HOUR);
  }

  throw new Error("Could not calculate the login report response deadline.");
}

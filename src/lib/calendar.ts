export type DateFormat = "MM/DD/YYYY" | "DD/MM/YYYY" | "YYYY/MM/DD";

export type CourseMeeting = {
  id: string;
  code: string;
  name: string;
  section: string;
  type: string;
  days: string[];
  startTime: string;
  endTime: string;
  location: string;
  instructor: string;
  startDate: Date;
  endDate: Date;
  /** Specific session dates for meetings that don't repeat weekly; empty for weekly meetings. */
  oneOffDates: Date[];
};

export type ParseResult = {
  meetings: CourseMeeting[];
  skipped: number;
};

// Quest component codes and their full names, per UW's class schedule legend.
const TYPE_NAMES: Record<string, string> = {
  LEC: "Lecture",
  TUT: "Tutorial",
  LAB: "Lab",
  SEM: "Seminar",
  PRJ: "Project",
  TST: "Test Slot",
  PRA: "Practicum",
  CLN: "Clinic",
  DIS: "Discussion",
  ENS: "Ensemble",
  ESS: "Essay",
  FLD: "Field Studies",
  ORL: "Oral Conversation",
  RDG: "Reading",
  RSC: "Research",
  STU: "Studio",
  WRK: "Work Term",
  WSP: "Workshop",
};

export function typeName(code: string): string {
  return TYPE_NAMES[code.toUpperCase()] ?? code;
}

const DAY_CODES: Record<string, string> = {
  M: "MO",
  T: "TU",
  W: "WE",
  H: "TH",
  F: "FR",
  S: "SA",
  U: "SU",
};

const COURSE_HEADER = /^([A-Z]{2,8}\s+\d{3,4}[A-Z]?)\s+-\s+(.+)$/gm;
const DATE = "\\d{1,4}\\/\\d{1,2}\\/\\d{1,4}";
const TIME = "(?:1?\\d:[0-5]\\d(?:AM|PM)|[0-2]?\\d:[0-5]\\d)";
// Fields may be separated by spaces (copied as one line) or newlines (Quest's
// list view copies each table cell onto its own line). Rows without the
// class-number prefix are continuation rows: extra meeting dates for the
// section that precedes them.
const MEETING_ROW = new RegExp(
  String.raw`(?:^|\n)\s*(?:(\d{4,6})\s+(\d{3})\s+([A-Z]{2,4})\s+)?((?:M|T|W|Th|F|S|U)+|TBA)\s+(${TIME}|TBA)(?:\s*-\s*(${TIME}))?\s+([^\n]+?(?:\n[^\n]+?)*?)\s+(${DATE})\s*-\s*(${DATE})(?=\s*(?:\n|$))`,
  "gi",
);

export function parseQuestSchedule(text: string, dateFormat: DateFormat): ParseResult {
  const normalized = text.replace(/\r/g, "").replace(/\u00a0/g, " ");
  const headers = [...normalized.matchAll(COURSE_HEADER)];
  const meetings: CourseMeeting[] = [];
  let skipped = 0;

  headers.forEach((header, index) => {
    const bodyStart = (header.index ?? 0) + header[0].length;
    const bodyEnd = headers[index + 1]?.index ?? normalized.length;
    const body = normalized.slice(bodyStart, bodyEnd);

    let current: { classNumber: string; section: string; type: string } | null = null;
    for (const row of body.matchAll(MEETING_ROW)) {
      const [, classNumber, section, type, rawDays, startTime, endTime = "", details, start, end] =
        row;
      if (classNumber) current = { classNumber, section, type };
      if (!current) continue;
      if (rawDays.toUpperCase() === "TBA" || startTime.toUpperCase() === "TBA") {
        skipped += 1;
        continue;
      }

      const { location, instructor } = splitDetails(details);
      const days = parseDays(rawDays);
      if (!days.length) {
        skipped += 1;
        continue;
      }

      meetings.push({
        id: `${header[1]}-${current.classNumber}-${current.section}-${current.type}-${start}-${startTime}`,
        code: header[1].replace(/\s+/g, " ").trim(),
        name: header[2].trim(),
        section: current.section,
        type: current.type.toUpperCase(),
        days,
        startTime: normalizeTime(startTime),
        endTime: normalizeTime(endTime),
        location,
        instructor,
        startDate: parseDate(start, dateFormat),
        endDate: parseDate(end, dateFormat),
        oneOffDates: [],
      });
    }
  });

  return { meetings: groupOneOffs(meetings), skipped };
}

// Quest lists irregular schedules (biweekly tutorials, lab sessions, seminar
// dates) as one row per date. Collapse rows that differ only by date into a
// single meeting so they export as one recurring event instead of many.
function groupOneOffs(meetings: CourseMeeting[]): CourseMeeting[] {
  const result: CourseMeeting[] = [];
  const groups = new Map<string, CourseMeeting>();

  for (const meeting of meetings) {
    if (meeting.startDate.getTime() !== meeting.endDate.getTime()) {
      result.push(meeting);
      continue;
    }

    const key = [
      meeting.code,
      meeting.section,
      meeting.type,
      meeting.days.join(","),
      meeting.startTime,
      meeting.endTime,
      meeting.location,
      meeting.instructor,
    ].join("|");
    const existing = groups.get(key);
    if (existing) {
      existing.oneOffDates.push(meeting.startDate);
    } else {
      const grouped = { ...meeting, oneOffDates: [meeting.startDate] };
      groups.set(key, grouped);
      result.push(grouped);
    }
  }

  for (const grouped of groups.values()) {
    grouped.oneOffDates.sort((a, b) => a.getTime() - b.getTime());
    grouped.startDate = grouped.oneOffDates[0];
    grouped.endDate = grouped.oneOffDates[grouped.oneOffDates.length - 1];
  }

  return result;
}

function splitDetails(value: string): { location: string; instructor: string } {
  const flattened = value.replace(/\s+/g, " ").trim();
  const tbaIndex = flattened.indexOf(" TBA");
  if (tbaIndex >= 0) {
    return { location: flattened.slice(0, tbaIndex).trim(), instructor: "TBA" };
  }

  // Quest room names normally end in a room number (e.g. MC 2034 or ONLINE).
  const match = flattened.match(/^(.+?\b(?:\d{1,5}[A-Z]?|ONLINE|REMOTE|TBA))\s+(.+)$/i);
  if (match) return { location: match[1].trim(), instructor: match[2].trim() };
  return { location: flattened, instructor: "TBA" };
}

function parseDays(value: string): string[] {
  return value
    .replace(/Th/gi, "H")
    .split("")
    .map((day) => DAY_CODES[day.toUpperCase()])
    .filter(Boolean);
}

function normalizeTime(value: string): string {
  const match = value
    .trim()
    .toUpperCase()
    .match(/^(\d{1,2}):(\d{2})(AM|PM)?$/);
  if (!match) throw new Error(`Could not read time “${value}”`);
  let hour = Number(match[1]);
  if (match[3] === "PM" && hour !== 12) hour += 12;
  if (match[3] === "AM" && hour === 12) hour = 0;
  return `${String(hour).padStart(2, "0")}:${match[2]}`;
}

function parseDate(value: string, format: DateFormat): Date {
  const parts = value.split("/").map(Number);
  let year: number;
  let month: number;
  let day: number;

  if (format === "MM/DD/YYYY") [month, day, year] = parts;
  else if (format === "DD/MM/YYYY") [day, month, year] = parts;
  else [year, month, day] = parts;

  if (year < 100) year += 2000;
  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.getTime())) throw new Error(`Could not read date “${value}”`);
  return date;
}

export function fillTemplate(
  template: string,
  meeting: CourseMeeting,
  longTypeNames = false,
): string {
  const values: Record<string, string> = {
    "@code": meeting.code,
    "@name": meeting.name,
    "@section": meeting.section,
    "@type": longTypeNames ? typeName(meeting.type) : meeting.type,
    "@location": meeting.location,
    "@prof": meeting.instructor,
  };
  return Object.entries(values).reduce(
    (result, [key, value]) => result.replaceAll(key, value),
    template,
  );
}

export type CalendarFile = { filename: string; content: string };

export type CalendarOptions = {
  recurring?: boolean;
  calendarName?: string;
  longTypeNames?: boolean;
};

export type ExportOptions = {
  recurring: boolean;
  separateFiles: boolean;
  longTypeNames?: boolean;
};

export function createCalendarFiles(
  meetings: CourseMeeting[],
  titleTemplate: string,
  descriptionTemplate: string,
  options: ExportOptions,
): CalendarFile[] {
  const shared = { recurring: options.recurring, longTypeNames: options.longTypeNames };

  if (!options.separateFiles) {
    return [
      {
        filename: "quest-schedule.ics",
        content: createCalendar(meetings, titleTemplate, descriptionTemplate, shared),
      },
    ];
  }

  const byCourse = new Map<string, CourseMeeting[]>();
  for (const meeting of meetings) {
    const group = byCourse.get(meeting.code) ?? [];
    group.push(meeting);
    byCourse.set(meeting.code, group);
  }

  return [...byCourse].map(([code, group]) => ({
    filename: `${code.toLowerCase().replace(/\s+/g, "-")}.ics`,
    content: createCalendar(group, titleTemplate, descriptionTemplate, {
      ...shared,
      calendarName: code,
    }),
  }));
}

export function createCalendar(
  meetings: CourseMeeting[],
  titleTemplate: string,
  descriptionTemplate: string,
  options: CalendarOptions = {},
): string {
  const { recurring = true, calendarName = "Quest Schedule", longTypeNames = false } = options;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "PRODID:-//Quest Calendar Creator//EN",
    `X-WR-CALNAME:${escapeIcs(calendarName)}`,
    "X-WR-TIMEZONE:America/Toronto",
    // RFC 5545 requires a VTIMEZONE definition for every TZID referenced.
    "BEGIN:VTIMEZONE",
    "TZID:America/Toronto",
    "BEGIN:DAYLIGHT",
    "TZOFFSETFROM:-0500",
    "TZOFFSETTO:-0400",
    "TZNAME:EDT",
    "DTSTART:19700308T020000",
    "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU",
    "END:DAYLIGHT",
    "BEGIN:STANDARD",
    "TZOFFSETFROM:-0400",
    "TZOFFSETTO:-0500",
    "TZNAME:EST",
    "DTSTART:19701101T020000",
    "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU",
    "END:STANDARD",
    "END:VTIMEZONE",
  ];

  for (const meeting of meetings) {
    if (recurring) {
      lines.push(...recurringEvent(meeting, titleTemplate, descriptionTemplate, longTypeNames));
    } else {
      for (const date of meetingDates(meeting)) {
        lines.push(
          ...eventLines(meeting, date, [], titleTemplate, descriptionTemplate, longTypeNames),
        );
      }
    }
  }

  lines.push("END:VCALENDAR");
  return `${lines.map(foldLine).join("\r\n")}\r\n`;
}

function recurringEvent(
  meeting: CourseMeeting,
  titleTemplate: string,
  descriptionTemplate: string,
  longTypeNames: boolean,
): string[] {
  const hasDateList = meeting.oneOffDates.length > 0;
  const firstDate = hasDateList
    ? meeting.oneOffDates[0]
    : firstMeetingDate(meeting.startDate, meeting.days);

  const schedule: string[] = [];
  if (hasDateList) {
    const laterDates = meeting.oneOffDates.slice(1);
    if (laterDates.length) {
      schedule.push(
        `RDATE;TZID=America/Toronto:${laterDates
          .map((date) => formatLocal(withTime(date, meeting.startTime)))
          .join(",")}`,
      );
    }
  } else {
    schedule.push(
      `RRULE:FREQ=WEEKLY;BYDAY=${meeting.days.join(",")};UNTIL=${formatUntil(meeting.endDate)}`,
    );
  }

  return eventLines(meeting, firstDate, schedule, titleTemplate, descriptionTemplate, longTypeNames);
}

function eventLines(
  meeting: CourseMeeting,
  date: Date,
  schedule: string[],
  titleTemplate: string,
  descriptionTemplate: string,
  longTypeNames: boolean,
): string[] {
  return [
    "BEGIN:VEVENT",
    `UID:${escapeIcs(`${meeting.id}-${formatDate(date)}@quest-calendar.local`)}`,
    `DTSTAMP:${formatUtc(new Date())}`,
    `DTSTART;TZID=America/Toronto:${formatLocal(withTime(date, meeting.startTime))}`,
    `DTEND;TZID=America/Toronto:${formatLocal(withTime(date, meeting.endTime))}`,
    ...schedule,
    `SUMMARY:${escapeIcs(fillTemplate(titleTemplate, meeting, longTypeNames))}`,
    `DESCRIPTION:${escapeIcs(fillTemplate(descriptionTemplate, meeting, longTypeNames))}`,
    `LOCATION:${escapeIcs(meeting.location)}`,
    "END:VEVENT",
  ];
}

function meetingDates(meeting: CourseMeeting): Date[] {
  if (meeting.oneOffDates.length) return meeting.oneOffDates;

  const wanted = meeting.days.map((day) => ["SU", "MO", "TU", "WE", "TH", "FR", "SA"].indexOf(day));
  const dates: Date[] = [];
  const cursor = new Date(meeting.startDate);
  while (cursor.getTime() <= meeting.endDate.getTime()) {
    if (wanted.includes(cursor.getDay())) dates.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

function firstMeetingDate(start: Date, days: string[]): Date {
  const wanted = days.map((day) => ["SU", "MO", "TU", "WE", "TH", "FR", "SA"].indexOf(day));
  const date = new Date(start);
  while (!wanted.includes(date.getDay())) date.setDate(date.getDate() + 1);
  return date;
}

function withTime(date: Date, time: string): Date {
  const [hour, minute] = time.split(":").map(Number);
  const result = new Date(date);
  result.setHours(hour, minute, 0, 0);
  return result;
}

function formatDate(date: Date): string {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
}

function formatLocal(date: Date): string {
  return `${formatDate(date)}T${pad(date.getHours())}${pad(date.getMinutes())}00`;
}

// RFC 5545 requires UNTIL in UTC when DTSTART carries a TZID: convert
// 23:59:59 in Toronto on the meeting's end date to the equivalent UTC instant.
function formatUntil(date: Date): string {
  const wallAsUtc = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59);
  const offset = torontoWallTimeAsUtc(new Date(wallAsUtc)) - wallAsUtc;
  const utc = new Date(wallAsUtc - offset);
  return (
    `${utc.getUTCFullYear()}${pad(utc.getUTCMonth() + 1)}${pad(utc.getUTCDate())}` +
    `T${pad(utc.getUTCHours())}${pad(utc.getUTCMinutes())}${pad(utc.getUTCSeconds())}Z`
  );
}

// The Toronto wall-clock reading of an instant, encoded as a UTC timestamp,
// so subtracting the instant yields the zone's UTC offset at that moment.
function torontoWallTimeAsUtc(instant: Date): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second"),
  );
}

function formatUtc(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function escapeIcs(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function foldLine(line: string): string {
  const chunks: string[] = [];
  let remaining = line;
  while (new TextEncoder().encode(remaining).length > 74) {
    let end = Math.min(74, remaining.length);
    while (new TextEncoder().encode(remaining.slice(0, end)).length > 74) end -= 1;
    chunks.push(remaining.slice(0, end));
    remaining = ` ${remaining.slice(end)}`;
  }
  chunks.push(remaining);
  return chunks.join("\r\n");
}

export function downloadCalendar(content: string, filename = "quest-schedule.ics"): void {
  const blob = new Blob([content], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

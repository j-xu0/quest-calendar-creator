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
};

export type ParseResult = {
  meetings: CourseMeeting[];
  skipped: number;
};

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
      });
    }
  });

  return { meetings, skipped };
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

export function fillTemplate(template: string, meeting: CourseMeeting): string {
  const values: Record<string, string> = {
    "@code": meeting.code,
    "@name": meeting.name,
    "@section": meeting.section,
    "@type": meeting.type,
    "@location": meeting.location,
    "@prof": meeting.instructor,
  };
  return Object.entries(values).reduce(
    (result, [key, value]) => result.replaceAll(key, value),
    template,
  );
}

export function createCalendar(
  meetings: CourseMeeting[],
  titleTemplate: string,
  descriptionTemplate: string,
): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "PRODID:-//Quest Calendar Creator//EN",
    "X-WR-CALNAME:Quest Schedule",
    "X-WR-TIMEZONE:America/Toronto",
  ];

  for (const meeting of meetings) {
    const firstDate = firstMeetingDate(meeting.startDate, meeting.days);
    const start = withTime(firstDate, meeting.startTime);
    const end = withTime(firstDate, meeting.endTime);
    const uid = `${meeting.id}-${formatDate(firstDate)}@quest-calendar.local`;

    lines.push(
      "BEGIN:VEVENT",
      `UID:${escapeIcs(uid)}`,
      `DTSTAMP:${formatUtc(new Date())}`,
      `DTSTART;TZID=America/Toronto:${formatLocal(start)}`,
      `DTEND;TZID=America/Toronto:${formatLocal(end)}`,
      `RRULE:FREQ=WEEKLY;BYDAY=${meeting.days.join(",")};UNTIL=${formatUntil(meeting.endDate)}`,
      `SUMMARY:${escapeIcs(fillTemplate(titleTemplate, meeting))}`,
      `DESCRIPTION:${escapeIcs(fillTemplate(descriptionTemplate, meeting))}`,
      `LOCATION:${escapeIcs(meeting.location)}`,
      "END:VEVENT",
    );
  }

  lines.push("END:VCALENDAR");
  return `${lines.map(foldLine).join("\r\n")}\r\n`;
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

function formatUntil(date: Date): string {
  return `${formatDate(date)}T235959`;
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

export function downloadCalendar(content: string): void {
  const blob = new Blob([content], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "quest-schedule.ics";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

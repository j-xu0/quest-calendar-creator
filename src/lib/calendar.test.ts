import { describe, expect, it } from "bun:test";
import { createCalendar, createCalendarFiles, fillTemplate, parseQuestSchedule } from "./calendar";
import { SAMPLE_QUEST_DATA } from "./sample";

describe("parseQuestSchedule", () => {
  it("parses 12-hour Quest list view rows and Thursday correctly", () => {
    const result = parseQuestSchedule(SAMPLE_QUEST_DATA, "MM/DD/YYYY");

    expect(result.meetings).toHaveLength(4);
    expect(result.meetings[0]).toMatchObject({
      code: "CS 246",
      type: "LEC",
      days: ["MO", "WE", "FR"],
      startTime: "10:30",
      endTime: "11:20",
      location: "MC 2066",
      instructor: "Carmen Bruni",
    });
    expect(result.meetings[2].days).toEqual(["TU", "TH"]);
  });

  it("parses list view copied with each cell on its own line", () => {
    const input = `My Class Schedule
ECE 203 - Probability Theory & Stats 1
Status\tUnits\tGrading\tGrade\tDeadlines
Enrolled
0.50
Numeric Grading Basis
Class Nbr\tSection\tComponent\tDays & Times\tRoom\tInstructor\tStart/End Date
5069
002
LEC
TW 10:00AM - 11:20AM
E7 4043
Patrick Mitran
09/09/2026 - 12/08/2026



Th 10:30AM - 11:20AM
E7 4043
Patrick Mitran
09/10/2026 - 09/10/2026
5150
102
TUT
Th 8:30AM - 9:20AM
E7 4043
To be Announced
09/09/2026 - 12/08/2026
ECE 208 - Discrete Math & Logic 2
Class Nbr\tSection\tComponent\tDays & Times\tRoom\tInstructor\tStart/End Date
5229
201
PRJ
TBA
TBA
To be Announced
09/09/2026 - 12/08/2026`;
    const result = parseQuestSchedule(input, "MM/DD/YYYY");

    expect(result.meetings).toHaveLength(3);
    expect(result.meetings[0]).toMatchObject({
      code: "ECE 203",
      type: "LEC",
      days: ["TU", "WE"],
      startTime: "10:00",
      location: "E7 4043",
      instructor: "Patrick Mitran",
    });
    // Continuation row inherits the section it belongs to.
    expect(result.meetings[1]).toMatchObject({
      type: "LEC",
      section: "002",
      days: ["TH"],
      startTime: "10:30",
    });
    expect(result.meetings[1].startDate.getDate()).toBe(10);
    expect(result.meetings[2]).toMatchObject({
      type: "TUT",
      section: "102",
      location: "E7 4043",
      instructor: "To be Announced",
    });
    expect(result.skipped).toBe(1);
    expect(new Set(result.meetings.map((meeting) => meeting.id)).size).toBe(3);
  });

  it("groups one-off session dates into a single meeting", () => {
    const input = `ECE 202 - Information Session
Class Nbr\tSection\tComponent\tDays & Times\tRoom\tInstructor\tStart/End Date
5263
002
SEM
T 5:30PM - 6:20PM
E7 4043
Mahesh Tripunitara
09/22/2026 - 09/22/2026



T 5:30PM - 6:20PM
E7 4043
Mahesh Tripunitara
10/06/2026 - 10/06/2026



T 5:30PM - 6:20PM
E7 4043
Mahesh Tripunitara
10/27/2026 - 10/27/2026`;
    const result = parseQuestSchedule(input, "MM/DD/YYYY");

    expect(result.meetings).toHaveLength(1);
    expect(result.meetings[0].oneOffDates).toHaveLength(3);
    expect(result.meetings[0].startDate.getDate()).toBe(22);
    expect(result.meetings[0].endDate.getMonth()).toBe(9);

    const content = createCalendar(result.meetings, "@code", "@name");
    expect(content.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(content).toContain("DTSTART;TZID=America/Toronto:20260922T173000");
    expect(content).toContain(
      "RDATE;TZID=America/Toronto:20261006T173000,20261027T173000",
    );
    expect(content).not.toContain("RRULE");
  });

  it("supports 24-hour times and skips TBA meetings", () => {
    const input = `CS 100 - Sample Course
1234 001 LEC MW 14:30 - 15:20 MC 100 Jane Doe 2026/09/08 - 2026/12/04
1235 002 LEC TBA TBA ONLINE TBA 2026/09/08 - 2026/12/04`;
    const result = parseQuestSchedule(input, "YYYY/MM/DD");

    expect(result.meetings).toHaveLength(1);
    expect(result.meetings[0].startTime).toBe("14:30");
    expect(result.skipped).toBe(1);
  });
});

describe("createCalendarFiles", () => {
  it("produces one combined file by default", () => {
    const { meetings } = parseQuestSchedule(SAMPLE_QUEST_DATA, "MM/DD/YYYY");
    const files = createCalendarFiles(meetings, "@code", "@name", {
      recurring: true,
      separateFiles: false,
    });

    expect(files).toHaveLength(1);
    expect(files[0].filename).toBe("quest-schedule.ics");
    expect(files[0].content).toContain("X-WR-CALNAME:Quest Schedule");
    expect(files[0].content.match(/BEGIN:VEVENT/g)).toHaveLength(4);
  });

  it("splits meetings into one file per course", () => {
    const { meetings } = parseQuestSchedule(SAMPLE_QUEST_DATA, "MM/DD/YYYY");
    const files = createCalendarFiles(meetings, "@code", "@name", {
      recurring: true,
      separateFiles: true,
    });

    expect(files.map((file) => file.filename)).toEqual(["cs-246.ics", "math-239.ics"]);
    expect(files[0].content).toContain("X-WR-CALNAME:CS 246");
    expect(files[0].content.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(files[0].content).not.toContain("MATH 239");
    expect(files[1].content).toContain("X-WR-CALNAME:MATH 239");
    expect(files[1].content.match(/BEGIN:VEVENT/g)).toHaveLength(2);
  });
});

describe("calendar generation", () => {
  it("expands every session into its own event when recurring is off", () => {
    const input = `CS 100 - Sample Course
1234 001 LEC MW 14:30 - 15:20 MC 100 Jane Doe 09/07/2026 - 09/20/2026`;
    const { meetings } = parseQuestSchedule(input, "MM/DD/YYYY");
    const content = createCalendar(meetings, "@code", "@name", false);

    // Two weeks of Mon + Wed classes starting Mon Sep 7 2026.
    expect(content.match(/BEGIN:VEVENT/g)).toHaveLength(4);
    expect(content).toContain("DTSTART;TZID=America/Toronto:20260907T143000");
    expect(content).toContain("DTSTART;TZID=America/Toronto:20260916T143000");
    expect(content).not.toContain("RRULE");
    expect(content).not.toContain("RDATE");
    // UIDs stay unique across the expanded events.
    const uids = content.match(/UID:[^\r\n]+/g) ?? [];
    expect(new Set(uids).size).toBe(4);
  });

  it("fills labels and emits recurring Toronto calendar events", () => {
    const [meeting] = parseQuestSchedule(SAMPLE_QUEST_DATA, "MM/DD/YYYY").meetings;
    const content = createCalendar([meeting], "@code · @type", "@name with @prof");

    expect(fillTemplate("@code in @location", meeting)).toBe("CS 246 in MC 2066");
    expect(content).toContain("BEGIN:VCALENDAR\r\n");
    expect(content).toContain("DTSTART;TZID=America/Toronto:20260904T103000");
    expect(content).toContain("RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR;UNTIL=20261204T235959");
    expect(content).toContain("SUMMARY:CS 246 · LEC");
    expect(content).toContain("END:VCALENDAR\r\n");
  });
});

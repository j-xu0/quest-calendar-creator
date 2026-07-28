import { describe, expect, it } from "bun:test";
import { createCalendar, fillTemplate, parseQuestSchedule } from "./calendar";
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

describe("calendar generation", () => {
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

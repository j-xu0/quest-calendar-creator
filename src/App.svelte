<script lang="ts">
  import {
    createCalendarFiles,
    downloadCalendar,
    fillTemplate,
    parseQuestSchedule,
    type CourseMeeting,
    type DateFormat,
  } from './lib/calendar'
  import { SAMPLE_QUEST_DATA } from './lib/sample'

  const dayLabels: Record<string, string> = {
    MO: 'Mon', TU: 'Tue', WE: 'Wed', TH: 'Thu', FR: 'Fri', SA: 'Sat', SU: 'Sun',
  }

  let questData = ''
  let dateFormat: DateFormat = 'MM/DD/YYYY'
  let titleTemplate = '@code · @type'
  let descriptionTemplate = '@name — @section with @prof'
  let recurringEvents = true
  let separateFiles = false
  let meetings: CourseMeeting[] = []
  let skipped = 0
  let error = ''
  let hasParsed = false

  function parse(): void {
    error = ''
    try {
      const result = parseQuestSchedule(questData, dateFormat)
      meetings = result.meetings
      skipped = result.skipped
      hasParsed = true
      if (!meetings.length) {
        error = 'No scheduled classes found. Make sure you copied Quest’s entire List View.'
      }
    } catch (caught) {
      meetings = []
      hasParsed = true
      error = caught instanceof Error ? caught.message : 'That schedule could not be read.'
    }
  }

  function loadSample(): void {
    questData = SAMPLE_QUEST_DATA
    dateFormat = 'MM/DD/YYYY'
    parse()
  }

  function clearAll(): void {
    questData = ''
    meetings = []
    skipped = 0
    error = ''
    hasParsed = false
  }

  function exportCalendar(): void {
    const files = createCalendarFiles(meetings, titleTemplate, descriptionTemplate, {
      recurring: recurringEvents,
      separateFiles,
    })
    // Stagger multiple downloads so the browser does not drop any of them.
    files.forEach((file, index) => {
      window.setTimeout(() => downloadCalendar(file.content, file.filename), index * 250)
    })
  }

  function formatTime(value: string): string {
    const [hours, minutes] = value.split(':').map(Number)
    return new Intl.DateTimeFormat('en-CA', { hour: 'numeric', minute: '2-digit' })
      .format(new Date(2000, 0, 1, hours, minutes))
  }

  function dateRange(meeting: CourseMeeting): string {
    const format = new Intl.DateTimeFormat('en-CA', { month: 'short', day: 'numeric' })
    if (meeting.startDate.getTime() === meeting.endDate.getTime()) {
      return format.format(meeting.startDate)
    }
    const range = `${format.format(meeting.startDate)} – ${format.format(meeting.endDate)}`
    return meeting.oneOffDates.length > 1
      ? `${meeting.oneOffDates.length} dates, ${range}`
      : range
  }
</script>

<svelte:head>
  <title>Quest Calendar Creator</title>
</svelte:head>

<main>
  <section class="hero">
    <h1>Export your Quest schedule</h1>
    <p>Copy your class schedule from Quest and download it as an iCalendar (.ics) file. Your schedule is processed in this browser and is not uploaded anywhere.</p>
  </section>

  <section id="schedule" class="workspace" class:has-preview={hasParsed} aria-label="Calendar creator">
    <section class="input-panel">
      <h2>Paste from Quest</h2>

      <ol id="instructions" class="instructions">
        <li>Sign in to Quest and open <strong>My Class Schedule</strong>.</li>
        <li>Choose the term you want to export, then switch to <strong>List View</strong>.</li>
        <li>Select the whole page with <span class="shortcut"><kbd>Ctrl</kbd><span>/</span><kbd aria-label="Command">⌘</kbd><span>+</span><kbd>A</kbd></span></li>
        <li>Copy it with <span class="shortcut"><kbd>Ctrl</kbd><span>/</span><kbd aria-label="Command">⌘</kbd><span>+</span><kbd>C</kbd></span></li>
        <li>Return here, click the box below, and paste with <span class="shortcut"><kbd>Ctrl</kbd><span>/</span><kbd aria-label="Command">⌘</kbd><span>+</span><kbd>V</kbd></span></li>
      </ol>

      <label class="field-label" for="quest-data">Paste the copied Quest page here:</label>
      <textarea
        id="quest-data"
        bind:value={questData}
        oninput={() => { hasParsed = false; error = '' }}
        placeholder="Paste your copied Quest schedule here."
        spellcheck="false"
      ></textarea>
      <div class="textarea-meta">
        {#if questData}
          <button class="text-button" onclick={clearAll}>Clear schedule</button>
        {:else}
          <button class="sample-button" onclick={loadSample}>Try sample data</button>
        {/if}
        <span class="local-note">
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>
          Runs in your browser
        </span>
      </div>

      <div class="date-row">
        <div class="date-field">
          <label class="field-label" for="date-format">Date format used by Quest:</label>
          <select id="date-format" bind:value={dateFormat} onchange={() => { hasParsed = false }}>
            <option value="MM/DD/YYYY">MM / DD / YYYY</option>
            <option value="DD/MM/YYYY">DD / MM / YYYY</option>
            <option value="YYYY/MM/DD">YYYY / MM / DD</option>
          </select>
          <p>Choose the order used for dates in your schedule.</p>
        </div>

        <button class="primary-button" onclick={parse} disabled={!questData.trim()}>
          {hasParsed && meetings.length ? 'Update class list' : 'Read schedule'}
        </button>
      </div>

      <label class="export-toggle">
        <input type="checkbox" bind:checked={recurringEvents} />
        <span>
          Create recurring events
          <small>Turn off to add every class session as its own separate event.</small>
        </span>
      </label>

      <label class="export-toggle">
        <input type="checkbox" bind:checked={separateFiles} />
        <span>
          One calendar file per course
          <small>Downloads a separate .ics file for each course instead of one combined file.</small>
        </span>
      </label>

      {#if error}
        <div class="error-message" role="alert">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 17h.01"/></svg>
          <div><strong>We couldn’t find your classes.</strong><span>{error}</span></div>
        </div>
      {/if}
    </section>

    {#if hasParsed}
      <section id="calendar-preview" class="preview-panel" class:is-empty={!meetings.length}>
        <div class="preview-heading">
          <h2>Review & export</h2>
          {#if meetings.length}
            <span class="class-count">{meetings.length} {meetings.length === 1 ? 'class' : 'classes'}</span>
          {/if}
        </div>

        {#if meetings.length}
          <p class="calendar-label">
            <span>Classes found</span>
            <span>Time zone: America/Toronto</span>
          </p>

          <div class="course-list">
            {#each meetings as meeting (meeting.id)}
              <article class="course-row">
                <div class="course-title">
                  <div>
                    <h3>{fillTemplate(titleTemplate, meeting)}</h3>
                    <p>{meeting.name}</p>
                  </div>
                  <span class="type-label">{meeting.type}</span>
                </div>
                <p class="course-meta">
                  <span>
                    {meeting.days.map((day) => dayLabels[day]).join(' · ')} · {formatTime(meeting.startTime)}–{formatTime(meeting.endTime)}
                  </span>
                  <span>{meeting.location}</span>
                  <span>{dateRange(meeting)}</span>
                </p>
              </article>
            {/each}
          </div>

          {#if skipped}
            <p class="skipped-note">Skipped {skipped} unscheduled {skipped === 1 ? 'section' : 'sections'} marked TBA.</p>
          {/if}

          <details class="template-section">
            <summary>Change calendar event text</summary>
            <div class="template-fields">
              <label for="title-template">Event title</label>
              <input id="title-template" bind:value={titleTemplate} />
              <label for="description-template">Description</label>
              <input id="description-template" bind:value={descriptionTemplate} />
              <p>Use @code, @name, @section, @type, @location, or @prof.</p>
            </div>
          </details>

          {@const courseCount = new Set(meetings.map((meeting) => meeting.code)).size}
          <button class="download-button" onclick={exportCalendar}>
            {separateFiles && courseCount > 1
              ? `Download ${courseCount} calendar files (.ics)`
              : 'Download calendar file (.ics)'}
          </button>
          <p class="download-hint">
            {separateFiles && courseCount > 1
              ? 'One file per course. Works with Google Calendar, Outlook, and Apple Calendar.'
              : 'Works with Google Calendar, Outlook, and Apple Calendar.'}
          </p>
        {:else}
          <div class="empty-state">
            <h3>No classes loaded</h3>
            <p>Check the pasted schedule above and try again.</p>
          </div>
        {/if}
      </section>
    {/if}
  </section>

</main>

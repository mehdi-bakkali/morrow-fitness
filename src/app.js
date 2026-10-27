import { loadDatabase, saveDatabase, defaultDatabase, seedSampleDatabase, todayKey, removeSampleData } from './core/storage.js';
import { getDaySummary, getSleepScore, getStrain, getRecovery, formatDuration, friendlyDate, shiftDate, clamp } from './core/scoring.js';
import { normalizeCsv, normalizeJson } from './core/importers.js';
import { providers } from './adapters/index.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const db = loadDatabase();
let activePage = 'today';
let selectedDate = todayKey();
let workoutFilter = 'all';
let pendingImport = null;
let toastTimer = null;

const navItems = [
  { id: 'today', label: 'Today', icon: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>' },
  { id: 'recovery', label: 'Recovery', icon: '<path d="M3 12h3l2-6 4 12 3-8 2 2h4"/>' },
  { id: 'sleep', label: 'Sleep', icon: '<path d="M20 14.2A8.3 8.3 0 0 1 9.8 4 8.5 8.5 0 1 0 20 14.2Z"/><path d="M16.5 4v3m-1.5-1.5h3"/>' },
  { id: 'strain', label: 'Strain', icon: '<path d="M13.5 3.5c.6 3-1.1 4.2-1.1 4.2S11.3 5.5 9.8 5c.2 2.3-1.2 3.2-2.1 4.8-2.3 3.8-.1 8.7 4.4 8.7 4.2 0 6.5-3.2 5.5-7.1-.6-2.6-2.3-4.9-4.1-7.9Z"/><path d="M10.8 14.2c-1 1.4-.7 3.4 1.2 3.7 2 .2 3-1.6 2.3-3.3-.4-.9-1.1-1.7-1.8-2.5-.2 1.1-.9 1.6-1.7 2.1Z"/>' },
  { id: 'connect', label: 'Connect', icon: '<path d="m10 13.5 4-4"/><path d="M7.8 15.7 6 17.5a3.5 3.5 0 0 1-5-5L5 8.5a3.5 3.5 0 0 1 5 0"/><path d="m14.2 8.3 1.8-1.8a3.5 3.5 0 0 1 5 5L17 15.5a3.5 3.5 0 0 1-5 0" transform="translate(1)"/>' },
  { id: 'settings', label: 'Settings', icon: '<path d="M4 7h10M18 7h2M4 17h2m4 0h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>' }
];

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function workoutFingerprint(workout) {
  return [workout.date, workout.startTime || '12:00', String(workout.type).toLowerCase(), workout.durationMinutes, workout.effort, String(workout.notes || '').trim()].join('|');
}

function icon(path, className = '') {
  return `<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true">${path}</svg>`;
}

function renderNavigation() {
  const navHtml = navItems.map(item => `<button class="nav-item ${activePage === item.id ? 'active' : ''}" data-page="${item.id}" ${activePage === item.id ? 'aria-current="page"' : ''}>${icon(item.icon)}<span>${item.label}</span></button>`).join('');
  $('#desktop-nav').innerHTML = navHtml;
  $('#mobile-nav').innerHTML = navHtml;
  $('#sample-pill').hidden = !db.sampleIncluded;
  $('#topbar-context').textContent = activePage === 'today' || activePage === 'recovery' || activePage === 'sleep' || activePage === 'strain' ? friendlyDate(selectedDate, { weekday: 'long', month: 'long', day: 'numeric' }) : activePage === 'connect' ? 'Your data sources' : 'Your preferences';
}

function scoreRing(value, max = 100, color = 'var(--lime)', suffix = '') {
  const radius = 38, circumference = 2 * Math.PI * radius;
  const percentage = value === null || value === undefined ? 0 : clamp(value / max, 0, 1);
  const offset = circumference * (1 - percentage);
  const display = value === null || value === undefined ? '—' : Math.round(value);
  return `<div class="ring" style="--ring-color:${color}" aria-label="${display}${suffix ? ` ${suffix}` : ''}"><svg viewBox="0 0 100 100" aria-hidden="true"><circle class="ring-track" cx="50" cy="50" r="${radius}"/><circle class="ring-progress" cx="50" cy="50" r="${radius}" stroke-dasharray="${circumference}" stroke-dashoffset="${offset}"/></svg><span class="ring-number">${display}</span>${value === null || value === undefined ? '' : `<span class="ring-unit">${suffix || `/ ${max}`}</span>`}</div>`;
}

function scoreTone(value, type) {
  if (value === null) return { label: 'Not enough data', tone: 'muted' };
  if (type === 'strain') return value < 7 ? { label: 'Light day', tone: 'aqua' } : value < 14 ? { label: 'Building', tone: 'peach' } : { label: 'High load', tone: 'peach' };
  if (value >= 67) return { label: 'In a good place', tone: 'aqua' };
  if (value >= 34) return { label: 'Take it steady', tone: 'peach' };
  return { label: 'Recovery focus', tone: 'peach' };
}

function sourceText(source) {
  return ({ demo: 'SAMPLE DATA', manual: 'MANUAL', import: 'FILE IMPORT', apple: 'APPLE HEALTH', healthconnect: 'HEALTH CONNECT', fitbit: 'FITBIT', garmin: 'GARMIN', oura: 'OURA', whoop: 'WHOOP' })[source] || 'LOCAL ENTRY';
}

function localTime(date = new Date()) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function dateInput(value = selectedDate, id = 'selected-date') {
  return `<input class="date-select" id="${id}" aria-label="Choose a day" type="date" value="${escapeHtml(value)}" max="${todayKey()}" />`;
}

function pageHeader(title, subtitle, eyebrow, date = false) {
  return `<div class="page-head"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p class="page-subtitle">${subtitle}</p></div>${date ? dateInput() : ''}</div>`;
}

function miniStat(label, value, unit, note = '', iconPath = '') {
  return `<div class="card mini-stat"><div class="mini-stat-top"><span>${label}</span>${iconPath ? icon(iconPath) : ''}</div><div><div class="mini-stat-value">${value}${unit ? ` <small>${unit}</small>` : ''}</div>${note ? `<div class="mini-stat-note">${note}</div>` : ''}</div></div>`;
}

function scoreMetricCard(title, value, max, detail, color, toneType, iconPath) {
  const state = scoreTone(value, toneType);
  const shown = value === null ? '—' : Math.round(value);
  const unit = value === null ? '' : `<span class="out-of"> / ${max}</span>`;
  return `<article class="card metric-card"><div class="metric-top"><span class="eyebrow-label">${title}</span><span class="metric-icon ${color}">${icon(iconPath)}</span></div><div class="metric-value">${shown}${unit}</div><div class="metric-label"><span class="score-state ${state.tone}">${state.label}</span></div><div class="metric-foot">${detail}</div></article>`;
}

function renderDayChart(date, metric = 'strain', count = 7) {
  const days = Array.from({ length: count }, (_, index) => shiftDate(date, index - count + 1));
  const items = days.map(dayDate => {
    const summary = getDaySummary(db, dayDate);
    const value = metric === 'sleep' ? summary.sleep.value : summary.strain.value;
    const max = metric === 'sleep' ? 100 : 21;
    const height = value === null ? 3 : Math.max(5, value / max * 100);
    return `<button class="chart-col ${dayDate === selectedDate ? 'selected' : ''}" data-select-date="${dayDate}" aria-label="${friendlyDate(dayDate)}: ${value === null ? 'no data' : `${value} ${metric === 'sleep' ? 'sleep score' : 'strain'}`}"><span class="chart-value">${value === null ? '' : value}</span><span class="chart-bar-shell"><span class="chart-bar ${dayDate === selectedDate ? 'is-selected' : ''} ${value === null ? 'is-missing' : ''}" style="height:${height}%"></span></span><span class="chart-label">${new Intl.DateTimeFormat('en', { weekday: 'narrow' }).format(new Date(`${dayDate}T12:00:00`))}</span></button>`;
  }).join('');
  return `<div class="chart" role="group" aria-label="${metric === 'sleep' ? 'Sleep score' : 'Strain'} for recent days">${items}</div>`;
}

function workoutRow(workout, showDate = false) {
  const workoutIcon = workout.type.toLowerCase().includes('run') ? '<path d="m13 4 2 2-2 2-2-2 2-2Z"/><path d="m11 8-3 3 2 2-2 5m3-8 3 2 3-1m-6 1 3 3 3 1"/>' : workout.type.toLowerCase().includes('strength') ? '<path d="M4 9v6m3-8v10m10-10v10m3-8v6M7 12h10"/>' : '<path d="M4 12h3l2-6 4 12 3-8 2 2h2"/>';
  return `<div class="list-row" ${showDate ? `data-history-date="${escapeHtml(workout.date)}"` : ''}><span class="list-icon">${icon(workoutIcon)}</span><div class="list-main"><div class="list-title">${escapeHtml(workout.type)}</div><div class="list-sub">${escapeHtml(workout.startTime || '—')} · ${workout.durationMinutes} min · effort ${workout.effort}/10${workout.notes ? ` · ${escapeHtml(workout.notes)}` : ''}</div></div><span class="list-value">${showDate ? friendlyDate(workout.date, { month: 'short', day: 'numeric' }) : sourceText(workout.source)}</span></div>`;
}

function renderRecentWorkouts(date, limit = 3) {
  const workouts = db.workouts.filter(item => item.date === date).sort((a, b) => (a.startTime || '').localeCompare(b.startTime || '')).slice(0, limit);
  return workouts.length ? `<div class="list">${workouts.map(workoutRow).join('')}</div>` : `<div class="empty-inline">No workouts logged for this day yet. Add a session to start building your training history.</div>`;
}

function renderToday() {
  const summary = getDaySummary(db, selectedDate);
  const record = summary.record;
  const isToday = selectedDate === todayKey();
  const recoveryTone = scoreTone(summary.recovery.value, 'recovery');
  const sleepText = summary.sleep.value === null ? 'Add a sleep duration to begin your sleep estimate.' : `${formatDuration(summary.sleep.durationMinutes)} in bed-to-wake time · ${summary.sleep.components.length > 1 ? 'duration and regularity' : 'duration'} estimate.`;
  const strainText = summary.strain.value === null ? 'Log a workout or daily movement to estimate strain.' : `${summary.strain.workouts.length} logged workout${summary.strain.workouts.length === 1 ? '' : 's'} · activity estimate.`;
  const activityValue = record?.steps !== undefined ? Number(record.steps).toLocaleString() : '—';
  const activityPercent = record?.steps ? clamp(record.steps / db.profile.goals.stepTarget * 100, 0, 100) : 0;
  const latest = summary.workouts[0];
  const weekDays = Array.from({ length: 7 }, (_, index) => shiftDate(selectedDate, index - 6));
  const weeklyWorkouts = db.workouts.filter(item => weekDays.includes(item.date)).length;
  return `${pageHeader(isToday ? 'Today, in context' : 'Your day, in context', 'A calm read on your activity, sleep, and the signals behind recovery.', 'YOUR RHYTHM', true)}
    <div class="grid dashboard-grid">
      <section class="card hero-card"><div class="hero-topline"><span class="eyebrow-label">DAILY READINESS</span><span class="today-date">${friendlyDate(selectedDate, { weekday: 'short', month: 'short', day: 'numeric' })}</span></div><div class="hero-score-row">${scoreRing(summary.recovery.value)}<div class="hero-score-copy"><div class="score-state ${recoveryTone.tone}">${recoveryTone.label}</div><h2>${summary.recovery.value === null ? 'A little more signal' : summary.recovery.value >= 67 ? 'Ready for your day' : 'Make room to reset'}</h2><p>${summary.recovery.value === null ? `Recovery needs at least two available signals. Add sleep, HRV, resting heart rate, or a previous day activity reading. Current data: ${summary.recovery.signals.length} signal${summary.recovery.signals.length === 1 ? '' : 's'}.` : `Estimated from ${summary.recovery.signals.length} signals. See what contributed and what is still missing.`}</p></div></div><div class="quick-actions"><button class="button button-primary" data-action="open-daily">${icon('<path d="M12 5v14M5 12h14"/>')} Daily check-in</button><button class="button" data-action="open-workout">${icon('<path d="M12 5v14M5 12h14"/>')} Log a workout</button></div></section>
      ${scoreMetricCard('SLEEP SCORE', summary.sleep.value, 100, sleepText, 'aqua', 'recovery', '<path d="M20 14.2A8.3 8.3 0 0 1 9.8 4 8.5 8.5 0 1 0 20 14.2Z"/>')}
      ${scoreMetricCard('DAILY STRAIN', summary.strain.value, 21, strainText, 'peach', 'strain', '<path d="M13.5 3.5c.6 3-1.1 4.2-1.1 4.2S11.3 5.5 9.8 5c.2 2.3-1.2 3.2-2.1 4.8-2.3 3.8-.1 8.7 4.4 8.7 4.2 0 6.5-3.2 5.5-7.1-.6-2.6-2.3-4.9-4.1-7.9Z"/>')}
      <section class="card activity-card"><div class="section-heading"><div><h2>Activity snapshot</h2><p>Daily movement toward your goal</p></div><span class="eyebrow-label">${record ? sourceText(record.source) : 'NO ENTRY'}</span></div><div class="mini-stat-value">${activityValue} <small>steps</small></div><div class="goal-track"><span style="width:${activityPercent}%"></span></div><div class="mini-stat-note">${record?.steps !== undefined ? `${Math.min(100, Math.round(activityPercent))}% of ${Number(db.profile.goals.stepTarget).toLocaleString()} step goal` : 'Add steps in a daily check-in.'}</div><div class="list-row" style="margin-top:12px"><span class="list-icon">${icon('<path d="M4 12h3l2-6 4 12 3-8 2 2h2"/>')}</span><div class="list-main"><div class="list-title">${latest ? escapeHtml(latest.type) : 'No recent workout'}</div><div class="list-sub">${latest ? `${escapeHtml(latest.startTime)} · ${latest.durationMinutes} min · effort ${latest.effort}/10` : 'Your next workout will appear here.'}</div></div></div></section>
      <section class="card week-card trend-card"><div class="section-heading"><div><h2>Strain rhythm</h2><p>Daily activity estimate · last 7 days</p></div><button class="section-link" data-page="strain">See history →</button></div>${renderDayChart(selectedDate, 'strain')}<div class="chart-legend"><span><i class="legend-dot"></i> Strain on a 0–21 scale</span><span>Tap a day to review it</span></div></section>
      <section class="card workouts-card"><div class="section-heading"><div><h2>Workouts</h2><p>${weeklyWorkouts} logged in the past 7 days</p></div><button class="section-link" data-action="open-workout" aria-label="Log a workout">＋</button></div>${renderRecentWorkouts(selectedDate, 3)}</section>
      <div class="small-metrics" style="grid-column:1/-1">${miniStat('SLEEP DURATION', summary.sleep.durationMinutes ? formatDuration(summary.sleep.durationMinutes) : '—', '', record ? sourceText(record.source) : 'not recorded', '<path d="M20 14.2A8.3 8.3 0 0 1 9.8 4 8.5 8.5 0 1 0 20 14.2Z"/>')}${miniStat('HRV', record?.hrv ?? '—', record?.hrv ? 'ms' : '', record?.hrv ? sourceText(record.source) : 'not recorded', '<path d="M3 12h3l2-6 4 12 3-8 2 2h4"/>')}${miniStat('RESTING HR', record?.restingHr ?? '—', record?.restingHr ? 'bpm' : '', record?.restingHr ? sourceText(record.source) : 'not recorded', '<path d="M20.8 8.6a4.5 4.5 0 0 0-7.6-3.2L12 6.6l-1.2-1.2a4.5 4.5 0 0 0-6.4 6.4l1.2 1.2L12 19.4l6.4-6.4 1.2-1.2a4.5 4.5 0 0 0 1.2-3.2Z"/>')}${miniStat('ACTIVE MINUTES', record?.activeMinutes ?? '—', record?.activeMinutes !== undefined ? 'min' : '', record?.activeMinutes !== undefined ? sourceText(record.source) : 'not recorded', '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>')}</div>
    </div>`;
}

function renderRecovery() {
  const result = getRecovery(db, selectedDate);
  const weights = { sleep: 32, hrv: 36, restingHr: 20, recentLoad: 12, ...(db.profile.scoring?.recoveryWeights || {}) };
  const state = scoreTone(result.value, 'recovery');
  const hrvBaselineCount = db.days.filter(day => day.date < selectedDate && day.date >= shiftDate(selectedDate, -14) && Number.isFinite(day.hrv)).length;
  const rhrBaselineCount = db.days.filter(day => day.date < selectedDate && day.date >= shiftDate(selectedDate, -14) && Number.isFinite(day.restingHr)).length;
  const hrvSignal = Number.isFinite(result.record?.hrv) && result.hrvBaseline !== null && hrvBaselineCount >= 3 ? Math.round(clamp(70 + ((result.record.hrv - result.hrvBaseline) / result.hrvBaseline) * 200, 0, 100)) : null;
  const restingSignal = Number.isFinite(result.record?.restingHr) && result.rhrBaseline !== null && rhrBaselineCount >= 3 ? Math.round(clamp(72 + (result.rhrBaseline - result.record.restingHr) * 5, 0, 100)) : null;
  const recentSignal = result.previousStrain?.value === null || !result.previousStrain ? null : Math.round(clamp(100 - result.previousStrain.value * 2.4, 35, 100));
  const allSignals = [
    { label: 'Sleep', description: result.sleep.value === null ? 'No sleep duration recorded for this date.' : `${formatDuration(result.sleep.durationMinutes)} logged · sleep estimate ${result.sleep.value}/100.`, value: result.sleep.value },
    { label: 'HRV', description: result.hrvBaseline === null ? 'A personal baseline needs at least 3 prior readings in the last 14 days.' : `${result.record?.hrv ?? 'No reading'} ms · 14-day personal median ${Math.round(result.hrvBaseline)} ms.`, value: hrvSignal },
    { label: 'Resting heart rate', description: result.rhrBaseline === null ? 'A personal baseline needs at least 3 prior readings in the last 14 days.' : `${result.record?.restingHr ?? 'No reading'} bpm · 14-day personal median ${Math.round(result.rhrBaseline)} bpm.`, value: restingSignal },
    { label: 'Recent load', description: result.previousStrain?.value === null || !result.previousStrain ? 'No activity reading for the previous day.' : `Previous day strain ${result.previousStrain.value}/21.`, value: recentSignal }
  ];
  return `${pageHeader('Recovery', 'See the inputs behind your daily readiness estimate. Missing readings stay visible.', 'REST & ADAPT', true)}
    <div class="grid" style="grid-template-columns:1fr;gap:14px">
      <div class="grid" style="grid-template-columns:1fr;gap:14px">
        <section class="card"><div class="eyebrow-label" style="margin-bottom:16px">RECOVERY ESTIMATE · ${friendlyDate(selectedDate, { month: 'short', day: 'numeric' })}</div><div class="big-score">${scoreRing(result.value)}<div class="big-score-copy"><div class="score-state ${state.tone}">${state.label}</div><h2>${result.value === null ? 'Not enough data yet' : result.value >= 67 ? 'Your signals look settled' : 'A steadier day may fit'}</h2><p>${result.value === null ? `At least two of four signals are needed. ${result.signals.length} are available for this date.` : `Built from ${result.signals.length} available signals. This is a personal estimate, not a health assessment.`}</p></div></div><div class="signal-list">${allSignals.map(item => `<div class="signal-row"><div class="signal-copy"><strong>${item.label}</strong><span>${escapeHtml(item.description)}</span></div>${item.value === null ? '<span class="signal-missing">NOT ENOUGH DATA</span>' : `<span class="signal-score">${Math.round(item.value)}</span>`}</div>`).join('')}</div></section>
        <section class="card card-muted"><div class="section-heading"><div><h2>How this estimate works</h2><p>Inputs are weighted only when readings are available.</p></div></div><div class="formula-card"><div class="formula-row"><span class="formula-key">SLEEP · ${weights.sleep}%</span><div class="formula-copy">Your sleep score, based on time asleep versus your configured sleep need and recent schedule regularity.</div></div><div class="formula-row"><span class="formula-key">HRV · ${weights.hrv}%</span><div class="formula-copy">Compared with your rolling 14-day median. HRV is included after at least 3 previous readings.</div></div><div class="formula-row"><span class="formula-key">RESTING HR · ${weights.restingHr}%</span><div class="formula-copy">Compared with your rolling 14-day median. A lower reading relative to your own baseline scores higher.</div></div><div class="formula-row"><span class="formula-key">RECENT LOAD · ${weights.recentLoad}%</span><div class="formula-copy">Yesterday’s estimated strain. Lower recent load contributes more to this estimate.</div></div></div><p class="settings-footnote">Available signals are re-weighted to total 100%. The estimate is not WHOOP’s proprietary algorithm, medical advice, or a diagnosis. Readings can vary by device and context.</p></section>
      </div>
      <div class="notice">${icon('<circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8h.01"/>')}<div><strong>Use this as a reflection aid.</strong> A single score can’t describe how you feel. Your journal stays on this device unless you export a backup.</div></div>
    </div>`;
}

function stageHtml(record) {
  if (!record) return `<div class="empty-inline">Sleep stages have not been entered for this date. They are optional; duration scoring still works without them.</div>`;
  const keys = [ ['deepSleepMinutes', 'deep', 'Deep'], ['remSleepMinutes', 'rem', 'REM'], ['lightSleepMinutes', 'light', 'Light'], ['awakeMinutes', 'awake', 'Awake'] ];
  const values = keys.map(([key]) => Math.max(0, Number(record[key] || 0)));
  const total = values.reduce((sum, value) => sum + value, 0);
  if (!total) return `<div class="empty-inline">Sleep stages have not been entered for this date. They are optional; duration scoring still works without them.</div>`;
  return `<div class="stage-wrap"><div class="stage-bar" aria-label="Sleep stage breakdown">${keys.map(([, className], index) => `<span class="${className}" style="width:${values[index] / total * 100}%"></span>`).join('')}</div><div class="stage-legend">${keys.map(([, className, label], index) => `<span><i class="${className}" style="background:${className === 'deep' ? '#8d81dc' : className === 'rem' ? '#65b6ae' : className === 'light' ? '#83936c' : '#53605a'}"></i>${label} ${values[index] ? formatDuration(values[index]) : '—'}</span>`).join('')}</div></div>`;
}

function renderSleep() {
  const summary = getDaySummary(db, selectedDate), record = summary.record, score = summary.sleep;
  const history = db.days.filter(day => day.sleepMinutes).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 14);
  const average = history.length ? Math.round(history.reduce((sum, day) => sum + day.sleepMinutes, 0) / history.length) : null;
  const sleepNeed = record?.sleepNeedMinutes || Math.round(db.profile.goals.sleepTargetHours * 60);
  const deficit = score.durationMinutes ? Math.max(0, sleepNeed - score.durationMinutes) : null;
  const bedtimeConsistency = score.consistency;
  return `${pageHeader('Sleep', 'Duration, routine, and optional stages in one clear view.', 'REST & ROUTINE', true)}
    <div class="grid dashboard-grid">
      <section class="card hero-card" style="grid-column:span 2"><div class="hero-topline"><span class="eyebrow-label">SLEEP SCORE</span><span class="today-date">${record ? sourceText(record.source) : 'NO ENTRY'}</span></div><div class="hero-score-row">${scoreRing(score.value)}<div class="hero-score-copy"><div class="score-state ${score.value === null ? 'muted' : score.value >= 80 ? 'aqua' : 'peach'}">${score.value === null ? 'Not enough data' : score.value >= 80 ? 'Well covered' : 'Room to recover'}</div><h2>${score.durationMinutes ? formatDuration(score.durationMinutes) : 'No sleep logged'}</h2><p>${score.durationMinutes ? `Time asleep compared with ${formatDuration(sleepNeed)} of sleep need. ${score.components.length > 1 ? 'A regularity signal is included.' : 'Schedule consistency will appear after 3 bedtime entries.'}` : 'Add sleep duration in a daily check-in to start your history.'}</p></div></div><div class="quick-actions"><button class="button button-primary" data-action="open-daily">${icon('<path d="M12 5v14M5 12h14"/>')} Add sleep entry</button><button class="button button-quiet" data-page="settings">Set sleep goal →</button></div></section>
      <div class="grid" style="grid-template-columns:1fr 1fr;grid-column:span 1">${miniStat('SLEEP NEED', formatDuration(sleepNeed), '', `${db.profile.goals.sleepTargetHours}h default goal`)}${miniStat('SLEEP DEBT', deficit === null ? '—' : formatDuration(deficit), '', deficit === null ? 'not enough data' : deficit ? 'to your daily need' : 'need met')}${miniStat('14-NIGHT AVG', average === null ? '—' : formatDuration(average), '', `${history.length} nights recorded`)}${miniStat('ROUTINE', bedtimeConsistency === null ? '—' : bedtimeConsistency, bedtimeConsistency === null ? '' : '/ 100', bedtimeConsistency === null ? 'need 3 bedtimes' : 'schedule regularity')}</div>
      <section class="card week-card trend-card"><div class="section-heading"><div><h2>Sleep score history</h2><p>Last 7 nights · tap a bar to review</p></div></div>${renderDayChart(selectedDate, 'sleep')}<div class="chart-legend"><span><i class="legend-dot aqua"></i> Duration and regularity estimate</span></div></section>
      <section class="card"><div class="section-heading"><div><h2>Stages & timing</h2><p>${record?.bedTime && record?.wakeTime ? `${escapeHtml(record.bedTime)} bedtime → ${escapeHtml(record.wakeTime)} wake` : 'Stage readings are optional.'}</p></div></div>${stageHtml(record)}</section>
      <section class="card" style="grid-column:1/-1"><div class="section-heading"><div><h2>Recent nights</h2><p>Up to 14 logged nights · duration in local time</p></div></div><div class="history-list">${history.length ? history.map(day => `<div class="day-line"><button class="section-link day-line-date" data-select-date="${day.date}">${friendlyDate(day.date, { weekday: 'short', month: 'short', day: 'numeric' })}</button><div class="day-line-track"><span style="width:${clamp(day.sleepMinutes / (day.sleepNeedMinutes || 480) * 100, 2, 100)}%"></span></div><div class="day-line-value">${formatDuration(day.sleepMinutes)}</div></div>`).join('') : '<div class="empty-inline">Sleep history will appear after you add an entry.</div>'}</div></section>
    </div>`;
}

function renderStrain() {
  const summary = getDaySummary(db, selectedDate), strain = summary.strain, record = summary.record;
  const target = Number(db.profile.goals.weeklyWorkoutTarget || 4);
  const lastWeek = Array.from({ length: 7 }, (_, index) => shiftDate(selectedDate, index - 6));
  const thisWeekCount = db.workouts.filter(item => lastWeek.includes(item.date)).length;
  const filtered = db.workouts.filter(item => workoutFilter === 'all' || (workoutFilter === 'this-week' ? lastWeek.includes(item.date) : item.date === selectedDate)).sort((a, b) => b.date.localeCompare(a.date) || (b.startTime || '').localeCompare(a.startTime || ''));
  const activityText = record?.steps !== undefined ? `${Number(record.steps).toLocaleString()} steps` : record?.activeMinutes !== undefined ? `${record.activeMinutes} active minutes` : 'Add daily movement to the journal.';
  return `${pageHeader('Strain & activity', 'Review effort, movement, and training load over time.', 'MOVE WITH INTENTION', true)}
    <div class="grid dashboard-grid">
      <section class="card hero-card" style="grid-column:span 2"><div class="hero-topline"><span class="eyebrow-label">DAILY STRAIN</span><span class="today-date">0–21 ESTIMATE · ${friendlyDate(selectedDate, { month: 'short', day: 'numeric' })}</span></div><div class="hero-score-row">${scoreRing(strain.value, 21, 'var(--peach)', '/ 21')}<div class="hero-score-copy"><div class="score-state ${scoreTone(strain.value, 'strain').tone}">${scoreTone(strain.value, 'strain').label}</div><h2>${strain.value === null ? 'Log a little movement' : strain.value < 7 ? 'A lighter load' : strain.value < 14 ? 'A balanced build' : 'A demanding day'}</h2><p>${strain.value === null ? 'Strain needs workout effort, active minutes, or steps. Missing activity is never treated as zero.' : `${strain.workouts.length} workout${strain.workouts.length === 1 ? '' : 's'} logged · ${activityText}. This is a local estimate, not a proprietary score.`}</p></div></div><div class="quick-actions"><button class="button button-primary" data-action="open-workout">${icon('<path d="M12 5v14M5 12h14"/>')} Log a workout</button><button class="button button-quiet" data-action="open-daily">Add activity details →</button></div></section>
      <div class="grid" style="grid-template-columns:1fr 1fr;grid-column:span 1">${miniStat('WORKOUTS · 7D', thisWeekCount, '', `Goal ${target} / week`)}${miniStat('WEEKLY GOAL', `${Math.min(100, Math.round(thisWeekCount / target * 100))}%`, '', `${thisWeekCount} of ${target} sessions`)}${miniStat('STEPS', record?.steps !== undefined ? Number(record.steps).toLocaleString() : '—', '', record?.steps !== undefined ? sourceText(record.source) : 'not recorded')}${miniStat('ACTIVE TIME', record?.activeMinutes !== undefined ? record.activeMinutes : '—', record?.activeMinutes !== undefined ? 'min' : '', record?.activeMinutes !== undefined ? sourceText(record.source) : 'not recorded')}</div>
      <section class="card week-card trend-card"><div class="section-heading"><div><h2>Daily load</h2><p>Past 7 days · missing movement remains blank</p></div></div>${renderDayChart(selectedDate, 'strain')}<div class="chart-legend"><span><i class="legend-dot"></i> Estimated strain · 0–21</span><span>Tap a day to review</span></div></section>
      <section class="card"><div class="section-heading"><div><h2>Consistency</h2><p>Workouts across the past 7 days</p></div></div><div class="big-score"><div class="ring" style="--ring-color:var(--aqua)"><svg viewBox="0 0 100 100"><circle class="ring-track" cx="50" cy="50" r="38"/><circle class="ring-progress" cx="50" cy="50" r="38" stroke-dasharray="238.76" stroke-dashoffset="${238.76 * (1 - clamp(thisWeekCount / target, 0, 1))}"/></svg><span class="ring-number">${thisWeekCount}</span><span class="ring-unit">of ${target}</span></div><div class="big-score-copy"><div class="score-state aqua">${thisWeekCount >= target ? 'Goal reached' : 'Keep your rhythm'}</div><h2>${thisWeekCount} sessions</h2><p>Your weekly target is a simple consistency guide, not a requirement.</p></div></div></section>
      <section class="card" style="grid-column:1/-1"><div class="section-heading"><div><h2>Workout history</h2><p>${db.workouts.length} session${db.workouts.length === 1 ? '' : 's'} saved on this device</p></div><div class="filter-tabs"><button data-filter="all" class="${workoutFilter === 'all' ? 'active' : ''}">All</button><button data-filter="this-week" class="${workoutFilter === 'this-week' ? 'active' : ''}">7 days</button><button data-filter="selected" class="${workoutFilter === 'selected' ? 'active' : ''}">Selected</button></div></div>${filtered.length ? `<div class="list">${filtered.map(item => workoutRow(item, true)).join('')}</div>` : `<div class="empty-inline">No workouts in this view. Log a session to begin your history.</div>`}</section>
    </div>`;
}

function statusText(status) {
  return status === 'planned' ? 'Planned' : status === 'unavailable' ? 'Unavailable in this PWA' : status === 'import' ? 'Import available' : 'Connected';
}

function providerCards() {
  return providers.map(provider => `<article class="provider-card"><div class="provider-logo">${provider.name.split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase()}</div><div class="provider-copy"><h3>${provider.name}</h3><p>${provider.note}</p><div class="provider-method">${provider.method}</div></div><span class="status-badge ${provider.status}">${statusText(provider.status)}</span></article>`).join('');
}

function renderImportPreview() {
  if (!pendingImport) return '';
  const mode = pendingImport.errors.length ? 'review' : 'ready';
  return `<section class="card import-preview"><div class="section-heading"><div><h2>Import preview</h2><p>${escapeHtml(pendingImport.filename)} · ${mode === 'ready' ? 'Ready to import' : 'Review the notes before continuing'}</p></div><button class="icon-button" data-action="dismiss-import" aria-label="Dismiss import preview">×</button></div><div class="preview-summary"><span class="preview-chip">${pendingImport.days.length} day${pendingImport.days.length === 1 ? '' : 's'}</span><span class="preview-chip">${pendingImport.workouts.length} workout${pendingImport.workouts.length === 1 ? '' : 's'}</span><span class="preview-chip">${pendingImport.errors.length} issue${pendingImport.errors.length === 1 ? '' : 's'}</span></div>${pendingImport.errors.length ? `<ul class="preview-errors">${pendingImport.errors.slice(0, 6).map(error => `<li>${escapeHtml(error)}</li>`).join('')}${pendingImport.errors.length > 6 ? `<li>And ${pendingImport.errors.length - 6} more issue(s).</li>` : ''}</ul>` : ''}<div class="import-options"><label><input type="radio" name="import-mode" value="merge" checked /> Merge with current journal</label><label><input type="radio" name="import-mode" value="replace" /> Replace journal entries</label></div><button class="button button-primary" data-action="apply-import">Import ${pendingImport.days.length + pendingImport.workouts.length} entries</button><p class="field-help" style="margin-top:8px">A merge updates matching days and adds workouts. Replace keeps your goals but replaces all journal entries.</p></section>`;
}

function renderConnect() {
  return `${pageHeader('Connect or import', 'Choose a source for your data. Tracker connections depend on platform permissions and provider setup.', 'YOUR DATA, YOUR WAY')}
    <div class="notice integration-note">${icon('<circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8h.01"/>')}<div><strong>This version runs as a static PWA.</strong> Your journal stays on this device. Direct wearable sync is not enabled here; the available connection paths and their requirements are listed below.</div></div>
    <section class="card"><div class="import-drop"><div><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:7px"><h3 style="margin:0">Bring in a CSV or JSON backup</h3><span class="status-badge import">Import available</span></div><p>Preview and validate entries before saving. CSV supports day metrics and workout columns; JSON supports Morrow backups.</p></div><div style="display:flex;gap:7px;flex-wrap:wrap;justify-content:flex-end"><button class="button button-small button-quiet" data-action="download-template">CSV template</button><button class="button button-small button-primary" data-action="choose-import">Choose file</button></div></div><input class="file-input" id="import-file" type="file" accept=".csv,.json,application/json,text/csv" />${renderImportPreview()}</section>
    <section style="margin-top:21px"><div class="section-heading"><div><h2>Tracker sources</h2><p>Current support for this browser-based build</p></div></div><div class="provider-grid">${providerCards()}</div></section>
    <section class="grid" style="grid-template-columns:1fr;gap:13px;margin-top:17px"><div class="card card-muted"><div class="section-heading"><div><h2>Manual entry always works</h2><p>Keep your daily picture useful even without a device connection.</p></div></div><div class="quick-actions" style="margin-top:0"><button class="button button-primary" data-action="open-daily">${icon('<path d="M12 5v14M5 12h14"/>')} Daily check-in</button><button class="button" data-action="open-workout">${icon('<path d="M12 5v14M5 12h14"/>')} Log a workout</button></div><p class="settings-footnote">Apple Health export files are XML; this version currently accepts CSV and Morrow JSON backups. Export transformations can be added in a future adapter.</p></div>
      <div class="card"><div class="section-heading"><div><h2>Adapter structure</h2><p>Providers can be added without changing the score or journal model.</p></div></div><div class="formula-card"><div class="formula-row"><span class="formula-key">AUTH</span><div class="formula-copy">Provider sign-in and permissions belong in a native client or a secure OAuth service.</div></div><div class="formula-row"><span class="formula-key">NORMALIZE</span><div class="formula-copy">Map provider readings to <strong>days</strong> and <strong>workouts</strong> with source labels and timestamps.</div></div><div class="formula-row"><span class="formula-key">SYNC</span><div class="formula-copy">Adapters reconcile updates and deletions, then save normalized records locally.</div></div></div></div></section>`;
}

function renderSettings() {
  const goals = db.profile.goals;
  const scoring = db.profile.scoring || { sleepRegularityPercent: 20, recoveryWeights: { sleep: 32, hrv: 36, restingHr: 20, recentLoad: 12 }, strainLoadScale: 520 };
  const weights = { sleep: 32, hrv: 36, restingHr: 20, recentLoad: 12, ...(scoring.recoveryWeights || {}) };
  const reminder = db.profile.reminder;
  const hasSamples = db.sampleIncluded || db.days.some(day => day.source === 'demo') || db.workouts.some(item => item.source === 'demo');
  return `${pageHeader('Settings', 'Adjust your goals, reminders, and local data controls.', 'YOUR JOURNAL')}
    <div class="settings-grid">
      <section class="card"><div class="section-heading"><div><h2>Your goals</h2><p>Used as context for your personal estimates.</p></div></div><form id="goals-form" class="form-grid two-col"><div class="field"><label for="step-target">Daily step goal</label><input id="step-target" name="stepTarget" type="number" min="500" max="50000" step="500" value="${goals.stepTarget}" required /><p class="field-help">A simple movement target.</p></div><div class="field"><label for="sleep-target">Sleep need</label><input id="sleep-target" name="sleepTargetHours" type="number" min="4" max="14" step="0.25" value="${goals.sleepTargetHours}" required /><p class="field-help">Used when an entry has no sleep-need value.</p></div><div class="field"><label for="workout-target">Weekly workout goal</label><input id="workout-target" name="weeklyWorkoutTarget" type="number" min="1" max="14" step="1" value="${goals.weeklyWorkoutTarget}" required /><p class="field-help">A consistency guide, not a prescription.</p></div><div class="field" style="justify-content:end"><button class="button button-primary" type="submit">Save goals</button></div></form></section>
      <section class="card"><div class="section-heading"><div><h2>Scoring preferences</h2><p>Adjust how estimates respond to available inputs.</p></div></div><form id="scoring-form" class="form-grid two-col"><div class="field"><label for="sleep-regularity-weight">Sleep schedule weight (%)</label><input id="sleep-regularity-weight" name="sleepRegularityPercent" type="number" min="0" max="40" step="5" value="${scoring.sleepRegularityPercent ?? 20}" required /><p class="field-help">0–40%. Remaining sleep score weight goes to duration.</p></div><div class="field"><label for="strain-scale">Strain response scale</label><input id="strain-scale" name="strainLoadScale" type="number" min="250" max="1200" step="10" value="${scoring.strainLoadScale ?? 520}" required /><p class="field-help">Lower values make strain rise faster from the same activity load.</p></div><div class="field"><label for="weight-sleep">Recovery · sleep weight</label><input id="weight-sleep" name="recoverySleep" type="number" min="0" max="100" value="${weights.sleep}" required /></div><div class="field"><label for="weight-hrv">Recovery · HRV weight</label><input id="weight-hrv" name="recoveryHrv" type="number" min="0" max="100" value="${weights.hrv}" required /></div><div class="field"><label for="weight-rhr">Recovery · resting HR weight</label><input id="weight-rhr" name="recoveryRestingHr" type="number" min="0" max="100" value="${weights.restingHr}" required /></div><div class="field"><label for="weight-load">Recovery · recent load weight</label><input id="weight-load" name="recoveryRecentLoad" type="number" min="0" max="100" value="${weights.recentLoad}" required /></div><div class="field" style="grid-column:1/-1"><p class="field-help">Recovery weights are relative; they do not need to total 100. Morrow rescales the available signals to total 100. A score still needs at least two signals with a nonzero weight.</p></div><div class="field" style="grid-column:1/-1"><button class="button button-primary" type="submit">Save scoring preferences</button></div></form></section>
      <section class="card"><div class="section-heading"><div><h2>Reminders</h2><p>Optional nudge, controlled by you.</p></div></div><div class="toggle-row"><div class="toggle-copy"><strong>Daily check-in reminder</strong><span>Ask for notification access only after you turn this on. If notifications are unavailable, Morrow shows an in-app reminder while open.</span></div><button class="toggle" id="reminder-toggle" aria-pressed="${reminder.enabled}" aria-label="${reminder.enabled ? 'Turn off' : 'Turn on'} daily reminder"><span></span></button></div><div class="field"><label for="reminder-time">Reminder time</label><input id="reminder-time" type="time" value="${escapeHtml(reminder.time || '20:30')}" /><p id="reminder-status" class="field-help">${reminder.enabled ? reminder.inAppOnly ? 'In-app reminder enabled.' : 'Reminder enabled for this browser.' : 'No reminders are enabled.'}</p></div></section>
      <section class="card"><div class="section-heading"><div><h2>Local data & privacy</h2><p>Your health journal is stored in this browser on this device.</p></div></div><ul class="privacy-list"><li>No account or health-data server is used by this version.</li><li>Data does not automatically sync to another browser or device.</li><li>Export a JSON backup to move or protect your journal.</li><li>Clearing browser site data can also remove this journal.</li></ul><div class="setting-actions" style="margin-top:15px"><button class="button button-primary" data-action="export-data">Export JSON backup</button><button class="button" data-page="connect">Import data</button><button class="button" data-action="choose-import">Choose file</button></div><input class="file-input" id="settings-import-file" type="file" accept=".csv,.json,application/json,text/csv" />${hasSamples ? `<div class="setting-actions" style="margin-top:9px"><button class="button" data-action="remove-samples">Remove sample entries</button></div>` : ''}<p class="settings-footnote">${db.days.length} day entries · ${db.workouts.length} workouts · saved locally in this browser.</p></section>
      <section class="card"><div class="section-heading"><div><h2>Sample data & reset</h2><p>Start clean or restore a fresh example journal.</p></div></div><div class="setting-actions"><button class="button" data-action="restore-sample">Restore sample data</button><button class="button button-danger" data-action="clear-data">Clear all local data</button></div><p class="settings-footnote">Restoring sample data replaces current entries. Clearing data removes scores, entries, goals, and reminders stored by Morrow on this device.</p></section>
      <section class="card card-muted" style="grid-column:1/-1"><div class="section-heading"><div><h2>How the estimates work</h2><p>Configurable first-version methods with readable inputs.</p></div></div><div class="formula-card"><div class="formula-row"><span class="formula-key">SLEEP · 0–100</span><div class="formula-copy"><strong>Time asleep versus sleep need</strong>, plus bedtime regularity when at least 3 bedtime readings exist. Optional stage totals are shown but not required.</div></div><div class="formula-row"><span class="formula-key">RECOVERY · 0–100</span><div class="formula-copy">A weighted blend using your saved relative weights for sleep, HRV versus personal 14-day median, resting heart rate versus median, and previous-day strain. Missing inputs are excluded and remaining weights are rescaled. At least 2 signals with nonzero weight are required.</div></div><div class="formula-row"><span class="formula-key">STRAIN · 0–21</span><div class="formula-copy">Load = workout minutes × effort, plus steps above 3,000 × 0.045; with no workout, active minutes × 4.2. The score is round(21 × (1 − e^(−load / response scale))). This Morrow estimate does not reproduce WHOOP’s proprietary method; missing activity stays blank.</div></div></div><p class="settings-footnote">These are Morrow estimates inspired by common fitness concepts; they do not reproduce WHOOP’s proprietary methods. They are not medical advice, diagnoses, or treatment recommendations. Wearable readings differ by device and context.</p></section>
    </div>`;
}

function render() {
  renderNavigation();
  const view = $('#view');
  view.innerHTML = ({ today: renderToday, recovery: renderRecovery, sleep: renderSleep, strain: renderStrain, connect: renderConnect, settings: renderSettings })[activePage]();
  const picker = $('#selected-date', view);
  if (picker) picker.addEventListener('change', () => { if (picker.value) { selectedDate = picker.value; render(); } });
}

function toast(message, subtle = false) {
  const root = $('#toast-root');
  root.innerHTML = `<div class="toast ${subtle ? 'subtle' : ''}">${escapeHtml(message)}</div>`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { root.innerHTML = ''; }, 3200);
}

function setPage(page) {
  if (!navItems.some(item => item.id === page)) return;
  activePage = page;
  render();
  $('#view').focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function closeModal() { $('#modal-root').innerHTML = ''; }

function openModal(title, content) {
  $('#modal-root').innerHTML = `<div class="modal-backdrop" data-action="backdrop-close"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-head"><h2 id="modal-title">${title}</h2><button class="modal-close" data-action="close-modal" aria-label="Close dialog">×</button></div><div class="modal-body">${content}</div></section></div>`;
  $('.modal', $('#modal-root')).addEventListener('click', event => event.stopPropagation());
  $('.modal-backdrop', $('#modal-root')).addEventListener('click', event => { if (event.target.classList.contains('modal-backdrop')) closeModal(); });
  const focusable = $('input,select,textarea,button', $('.modal', $('#modal-root')));
  if (focusable) focusable.focus();
}

function dailyForm() {
  const old = db.days.find(day => day.date === selectedDate) || {};
  const hours = old.sleepMinutes !== undefined ? (old.sleepMinutes / 60).toFixed(2).replace(/0+$/, '').replace(/\.$/, '') : '';
  const needHours = old.sleepNeedMinutes ? (old.sleepNeedMinutes / 60).toFixed(2).replace(/0+$/, '').replace(/\.$/, '') : db.profile.goals.sleepTargetHours;
  openModal('Daily check-in', `<form id="daily-form" class="modal-form"><div class="field"><label for="daily-date">Date</label><input id="daily-date" name="date" type="date" max="${todayKey()}" value="${selectedDate}" required /></div><div class="form-grid two-col"><div class="field"><label for="sleep-hours">Sleep duration (hours)</label><input id="sleep-hours" name="sleepHours" type="number" min="0.1" max="24" step="0.05" value="${hours}" placeholder="e.g. 7.5" /></div><div class="field"><label for="sleep-need">Sleep need (hours)</label><input id="sleep-need" name="sleepNeedHours" type="number" min="1" max="24" step="0.25" value="${needHours}" /></div><div class="field"><label for="bed-time">Bedtime</label><input id="bed-time" name="bedTime" type="time" value="${old.bedTime || ''}" /></div><div class="field"><label for="wake-time">Wake time</label><input id="wake-time" name="wakeTime" type="time" value="${old.wakeTime || ''}" /></div><div class="field"><label for="hrv">HRV (ms)</label><input id="hrv" name="hrv" type="number" min="1" max="300" step="1" value="${old.hrv ?? ''}" placeholder="optional" /></div><div class="field"><label for="rhr">Resting heart rate (bpm)</label><input id="rhr" name="restingHr" type="number" min="25" max="220" step="1" value="${old.restingHr ?? ''}" placeholder="optional" /></div><div class="field"><label for="steps">Steps</label><input id="steps" name="steps" type="number" min="0" max="200000" step="1" value="${old.steps ?? ''}" placeholder="optional" /></div><div class="field"><label for="active-minutes">Active minutes</label><input id="active-minutes" name="activeMinutes" type="number" min="0" max="1440" step="1" value="${old.activeMinutes ?? ''}" placeholder="optional" /></div></div><details><summary class="field-help" style="cursor:pointer;color:var(--soft)">Optional sleep stage totals</summary><div class="form-grid two-col" style="margin-top:11px"><div class="field"><label for="deep-hours">Deep sleep (hours)</label><input id="deep-hours" name="deepSleepHours" type="number" min="0" max="24" step="0.01" value="${old.deepSleepMinutes ? (old.deepSleepMinutes / 60).toFixed(2).replace(/0+$/, '').replace(/\.$/, '') : ''}" /></div><div class="field"><label for="rem-hours">REM sleep (hours)</label><input id="rem-hours" name="remSleepHours" type="number" min="0" max="24" step="0.01" value="${old.remSleepMinutes ? (old.remSleepMinutes / 60).toFixed(2).replace(/0+$/, '').replace(/\.$/, '') : ''}" /></div><div class="field"><label for="light-hours">Light sleep (hours)</label><input id="light-hours" name="lightSleepHours" type="number" min="0" max="24" step="0.01" value="${old.lightSleepMinutes ? (old.lightSleepMinutes / 60).toFixed(2).replace(/0+$/, '').replace(/\.$/, '') : ''}" /></div><div class="field"><label for="awake-minutes">Awake (minutes)</label><input id="awake-minutes" name="awakeMinutes" type="number" min="0" max="1440" step="1" value="${old.awakeMinutes ?? ''}" /></div></div></details><div class="notice">${icon('<circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8h.01"/>')}<div>Only fill in readings you have. Blank fields remain missing; they are not counted as zero.</div></div><div class="modal-footer"><button type="button" class="button button-quiet" data-action="close-modal">Cancel</button><button type="submit" class="button button-primary">Save check-in</button></div></form>`);
}

function workoutForm() {
  openModal('Log a workout', `<form id="workout-form" class="modal-form"><div class="field"><label for="workout-type">Workout type</label><select id="workout-type" name="type" required><option value="">Choose type</option><option>Outdoor run</option><option>Indoor run</option><option>Strength</option><option>Cycle</option><option>Walk</option><option>Swim</option><option>Mobility</option><option>Yoga</option><option>Sport</option><option>Other</option></select></div><div class="form-grid two-col"><div class="field"><label for="workout-date">Date</label><input id="workout-date" name="date" type="date" max="${todayKey()}" value="${selectedDate}" required /></div><div class="field"><label for="workout-start">Start time</label><input id="workout-start" name="startTime" type="time" value="${localTime()}" required /></div><div class="field"><label for="duration">Duration (minutes)</label><input id="duration" name="durationMinutes" type="number" min="1" max="1440" step="1" placeholder="45" required /></div><div class="field"><label for="effort">Perceived effort (1–10)</label><input id="effort" name="effort" type="number" min="1" max="10" step="1" value="5" required /><p class="field-help">1 = very easy · 10 = all-out</p></div></div><div class="field"><label for="workout-notes">Notes <span class="field-help">optional</span></label><textarea id="workout-notes" name="notes" maxlength="400" placeholder="How did it feel? Anything to remember?"></textarea></div><div class="modal-footer"><button type="button" class="button button-quiet" data-action="close-modal">Cancel</button><button type="submit" class="button button-primary">Save workout</button></div></form>`);
}

function saveDailyForm(form) {
  const values = new FormData(form), date = String(values.get('date'));
  if (!date || date > todayKey()) { toast('Choose a valid date.'); return; }
  const entry = { date, source: 'manual' };
  const mapping = [
    ['sleepHours', 'sleepMinutes', 0.1, 24, 60], ['sleepNeedHours', 'sleepNeedMinutes', 1, 24, 60], ['deepSleepHours', 'deepSleepMinutes', 0, 24, 60], ['remSleepHours', 'remSleepMinutes', 0, 24, 60], ['lightSleepHours', 'lightSleepMinutes', 0, 24, 60],
    ['awakeMinutes', 'awakeMinutes', 0, 1440, 1], ['hrv', 'hrv', 1, 300, 1], ['restingHr', 'restingHr', 25, 220, 1], ['steps', 'steps', 0, 200000, 1], ['activeMinutes', 'activeMinutes', 0, 1440, 1]
  ];
  for (const [inputKey, outputKey, min, max, multiplier] of mapping) {
    const raw = values.get(inputKey);
    if (raw !== '') {
      const number = Number(raw);
      if (!Number.isFinite(number) || number < min || number > max) { toast(`Check the ${inputKey.replace(/([A-Z])/g, ' $1').toLowerCase()} value.`); return; }
      entry[outputKey] = Math.round(number * multiplier);
    }
  }
  for (const key of ['bedTime', 'wakeTime']) if (values.get(key)) entry[key] = values.get(key);
  const existing = db.days.findIndex(item => item.date === date);
  if (existing >= 0) db.days[existing] = { ...db.days[existing], ...entry };
  else db.days.push(entry);
  saveDatabase(db);
  selectedDate = date;
  closeModal();
  render();
  toast('Daily check-in saved on this device.');
}

function saveWorkoutForm(form) {
  const values = new FormData(form);
  const workout = { id: `manual-${Date.now()}`, date: String(values.get('date')), startTime: String(values.get('startTime')), type: String(values.get('type')), durationMinutes: Number(values.get('durationMinutes')), effort: Number(values.get('effort')), notes: String(values.get('notes') || '').trim(), source: 'manual' };
  if (!workout.date || workout.date > todayKey() || !workout.type || !Number.isFinite(workout.durationMinutes) || workout.durationMinutes < 1 || !Number.isFinite(workout.effort) || workout.effort < 1 || workout.effort > 10) { toast('Review the workout details.'); return; }
  db.workouts.push(workout);
  saveDatabase(db);
  selectedDate = workout.date;
  closeModal();
  render();
  toast('Workout saved on this device.');
}

function downloadFile(filename, mime, content) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportData() {
  const output = { app: 'Morrow', formatVersion: 1, exportedAt: new Date().toISOString(), data: { version: db.version, profile: db.profile, days: db.days, workouts: db.workouts, sampleIncluded: db.sampleIncluded } };
  downloadFile(`morrow-backup-${todayKey()}.json`, 'application/json', JSON.stringify(output, null, 2));
  toast('JSON backup downloaded.');
}

function downloadTemplate() {
  const template = `date,sleepHours,sleepNeedHours,bedTime,wakeTime,hrv,restingHr,steps,activeMinutes,deepSleepHours,remSleepHours,lightSleepHours,awakeMinutes,workoutType,workoutStart,workoutDurationMinutes,workoutEffort,workoutNotes\n${todayKey()},7.5,8,22:45,06:15,58,54,8200,48,1.5,1.6,3.8,35,Outdoor run,07:15,35,6,Easy pace\n`;
  downloadFile('morrow-import-template.csv', 'text/csv;charset=utf-8', template);
}

async function handleImportFile(file) {
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) { toast('Choose a file smaller than 5 MB.'); return; }
  try {
    const text = await file.text();
    const imported = file.name.toLowerCase().endsWith('.csv') ? normalizeCsv(text) : normalizeJson(JSON.parse(text));
    pendingImport = { ...imported, filename: file.name };
    activePage = 'connect';
    render();
    $('#view').scrollIntoView({ behavior: 'smooth', block: 'start' });
    toast('Preview is ready. Review it before importing.', true);
  } catch (error) {
    toast(error?.message || 'This file could not be read.');
  }
}

function applyImport() {
  if (!pendingImport) return;
  const mode = $('input[name="import-mode"]:checked')?.value || 'merge';
  if (mode === 'replace') {
    db.days = pendingImport.days.map(item => ({ ...item }));
    db.workouts = pendingImport.workouts.map(item => ({ ...item }));
    db.sampleIncluded = Boolean(pendingImport.sampleIncluded);
    if (pendingImport.profile) db.profile = pendingImport.profile;
  } else {
    const dayMap = new Map(db.days.map(item => [item.date, item]));
    pendingImport.days.forEach(item => dayMap.set(item.date, { ...(dayMap.get(item.date) || {}), ...item, source: item.source || 'import' }));
    db.days = [...dayMap.values()].sort((a, b) => a.date.localeCompare(b.date));
    const existingIds = new Set(db.workouts.map(item => item.id));
    const existingFingerprints = new Set(db.workouts.map(workoutFingerprint));
    pendingImport.workouts.forEach(item => {
      const fingerprint = workoutFingerprint(item);
      if (existingFingerprints.has(fingerprint)) return;
      let id = item.id;
      if (existingIds.has(id)) id = `${id}-${Date.now()}`;
      existingIds.add(id);
      existingFingerprints.add(fingerprint);
      db.workouts.push({ ...item, id, source: item.source || 'import' });
    });
    db.sampleIncluded ||= Boolean(pendingImport.sampleIncluded);
  }
  selectedDate = pendingImport.days.at(-1)?.date || pendingImport.workouts.at(-1)?.date || todayKey();
  const total = pendingImport.days.length + pendingImport.workouts.length;
  pendingImport = null;
  saveDatabase(db);
  render();
  toast(`${total} entries imported to this device.`);
}

async function toggleReminder() {
  const enabled = !db.profile.reminder.enabled;
  const reminder = { ...db.profile.reminder, enabled };
  if (enabled) {
    if (!('Notification' in window)) reminder.inAppOnly = true;
    else if (Notification.permission === 'granted') reminder.inAppOnly = false;
    else if (Notification.permission === 'denied') reminder.inAppOnly = true;
    else {
      try { const permission = await Notification.requestPermission(); reminder.inAppOnly = permission !== 'granted'; }
      catch { reminder.inAppOnly = true; }
    }
  }
  db.profile.reminder = reminder;
  const time = $('#reminder-time')?.value;
  if (time) reminder.time = time;
  saveDatabase(db);
  render();
  if (enabled) toast(reminder.inAppOnly ? 'In-app reminder enabled while Morrow is open.' : 'Browser reminder enabled.');
  else toast('Daily reminder turned off.');
}

function checkReminder() {
  const reminder = db.profile.reminder;
  if (!reminder?.enabled || reminder._lastShown === todayKey()) return;
  const now = new Date();
  const time = localTime(now);
  if (time !== reminder.time) return;
  reminder._lastShown = todayKey();
  saveDatabase(db);
  if (!reminder.inAppOnly && 'Notification' in window && Notification.permission === 'granted') new Notification('A small Morrow check-in', { body: 'Add a few notes about your day and how it felt.', icon: './icon.svg' });
  else toast('A small check-in reminder: add a note about your day.', true);
}

function saveGoals(form) {
  const values = new FormData(form);
  db.profile.goals = { stepTarget: Number(values.get('stepTarget')), sleepTargetHours: Number(values.get('sleepTargetHours')), weeklyWorkoutTarget: Number(values.get('weeklyWorkoutTarget')) };
  saveDatabase(db);
  render();
  toast('Goals saved.');
}

function saveScoring(form) {
  const values = new FormData(form);
  db.profile.scoring = {
    sleepRegularityPercent: Number(values.get('sleepRegularityPercent')),
    strainLoadScale: Number(values.get('strainLoadScale')),
    recoveryWeights: {
      sleep: Number(values.get('recoverySleep')),
      hrv: Number(values.get('recoveryHrv')),
      restingHr: Number(values.get('recoveryRestingHr')),
      recentLoad: Number(values.get('recoveryRecentLoad'))
    }
  };
  saveDatabase(db);
  render();
  toast('Scoring preferences saved.');
}

function clearAll() {
  if (!window.confirm('Clear all Morrow data stored in this browser? This removes journal entries, goals, sample data, and reminder settings. Export a backup first if you want to keep a copy.')) return;
  const empty = defaultDatabase();
  Object.assign(db, empty);
  saveDatabase(db);
  pendingImport = null;
  selectedDate = todayKey();
  render();
  toast('Local journal cleared.');
}

function restoreSamples() {
  if (!window.confirm('Restore the sample journal? This replaces your current entries and goals on this device.')) return;
  Object.assign(db, seedSampleDatabase());
  selectedDate = todayKey();
  saveDatabase(db);
  render();
  toast('Sample journal restored.');
}

function removeSamples() {
  removeSampleData(db);
  saveDatabase(db);
  render();
  toast('Sample entries removed. Your own entries remain.');
}

document.addEventListener('click', event => {
  const pageButton = event.target.closest('[data-page]');
  if (pageButton) { setPage(pageButton.dataset.page); return; }
  const dateButton = event.target.closest('[data-select-date]');
  if (dateButton) { selectedDate = dateButton.dataset.selectDate; render(); return; }
  const filterButton = event.target.closest('[data-filter]');
  if (filterButton) { workoutFilter = filterButton.dataset.filter; render(); return; }
  const actionButton = event.target.closest('[data-action]');
  if (!actionButton) return;
  const action = actionButton.dataset.action;
  if (action === 'open-daily') dailyForm();
  else if (action === 'open-workout') workoutForm();
  else if (action === 'close-modal') closeModal();
  else if (action === 'choose-import') { ($('#import-file') || $('#settings-import-file'))?.click(); }
  else if (action === 'export-data') exportData();
  else if (action === 'download-template') downloadTemplate();
  else if (action === 'apply-import') applyImport();
  else if (action === 'dismiss-import') { pendingImport = null; render(); }
  else if (action === 'clear-data') clearAll();
  else if (action === 'restore-sample') restoreSamples();
  else if (action === 'remove-samples') removeSamples();
  else if (action === 'backdrop-close') closeModal();
});

document.addEventListener('change', event => {
  if (event.target.id === 'import-file' || event.target.id === 'settings-import-file') {
    const [file] = event.target.files || [];
    handleImportFile(file);
    event.target.value = '';
  }
  if (event.target.id === 'reminder-time') {
    db.profile.reminder.time = event.target.value || '20:30';
    saveDatabase(db);
    $('#reminder-status').textContent = db.profile.reminder.enabled ? db.profile.reminder.inAppOnly ? 'In-app reminder enabled.' : 'Reminder enabled for this browser.' : 'No reminders are enabled.';
  }
});

document.addEventListener('submit', event => {
  if (event.target.id === 'daily-form') { event.preventDefault(); saveDailyForm(event.target); }
  else if (event.target.id === 'workout-form') { event.preventDefault(); saveWorkoutForm(event.target); }
  else if (event.target.id === 'goals-form') { event.preventDefault(); saveGoals(event.target); }
  else if (event.target.id === 'scoring-form') { event.preventDefault(); saveScoring(event.target); }
});

document.addEventListener('click', event => {
  if (event.target.closest('#reminder-toggle')) toggleReminder();
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && $('#modal-root').innerHTML) closeModal();
});

render();
setInterval(checkReminder, 30_000);
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('./sw.js').catch(error => console.info('Offline support is unavailable in this browser.', error));

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validDate(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const date = new Date(`${value}T12:00:00`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function numberValue(value, min, max) {
  if (value === '' || value === undefined || value === null) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : NaN;
}

export function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"' && quoted && text[i + 1] === '"') { cell += '"'; i += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) { row.push(cell.trim()); cell = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell.trim());
      if (row.some(value => value !== '')) rows.push(row);
      row = []; cell = '';
    } else cell += char;
  }
  row.push(cell.trim());
  if (row.some(value => value !== '')) rows.push(row);
  if (rows.length < 2) throw new Error('This CSV has no data rows. Add a header row and at least one entry.');
  const headers = rows[0].map(header => header.replace(/^\uFEFF/, '').trim().toLowerCase().replace(/[^a-z0-9]/g, ''));
  return rows.slice(1).map(values => Object.fromEntries(headers.map((key, index) => [key, values[index] ?? ''])));
}

const aliases = {
  date: ['date', 'day', 'sleepdate', 'startdate'], sleepHours: ['sleephours', 'sleepdurationhours'], sleepMinutes: ['sleepminutes', 'sleepdurationminutes'], sleepNeedHours: ['sleepneedhours', 'targethours'], sleepNeedMinutes: ['sleepneedminutes'],
  bedTime: ['bedtime', 'sleepstart', 'bed'], wakeTime: ['waketime', 'sleepend', 'wake'], hrv: ['hrv', 'hrvms', 'heartratevariability'], restingHr: ['restinghr', 'restingheartrate', 'rhr'], steps: ['steps', 'stepcount'], activeMinutes: ['activeminutes', 'activetime'],
  deepSleepHours: ['deepsleephours'], deepSleepMinutes: ['deepsleepminutes'], remSleepHours: ['remsleephours'], remSleepMinutes: ['remsleepminutes'], lightSleepHours: ['lightsleephours'], lightSleepMinutes: ['lightsleepminutes'], awakeMinutes: ['awakeminutes'],
  workoutType: ['workouttype', 'activity', 'exercise'], workoutStart: ['workoutstart', 'starttime', 'workouttime'], workoutDurationMinutes: ['workoutdurationminutes', 'durationminutes', 'workoutminutes'], workoutEffort: ['workouteffort', 'effort', 'rpe'], workoutNotes: ['workoutnotes', 'notes']
};

function pick(row, key) {
  const found = aliases[key].find(alias => Object.hasOwn(row, alias));
  return found ? row[found] : '';
}

function hoursOrMinutes(row, hourKey, minuteKey, maxHours) {
  const hours = pick(row, hourKey);
  const minutes = pick(row, minuteKey);
  if (hours !== '') {
    const value = numberValue(hours, 0, maxHours);
    return Number.isNaN(value) ? NaN : value === null ? null : Math.round(value * 60);
  }
  if (minutes !== '') return numberValue(minutes, 0, maxHours * 60);
  return null;
}

export function normalizeCsv(text) {
  const rows = parseCsv(text);
  const days = new Map(), workouts = [], errors = [];
  rows.forEach((row, index) => {
    const line = index + 2;
    const date = pick(row, 'date');
    if (!validDate(date)) { errors.push(`Row ${line}: date must use YYYY-MM-DD.`); return; }
    const day = { date, source: 'import' };
    const sleep = hoursOrMinutes(row, 'sleepHours', 'sleepMinutes', 24);
    const need = hoursOrMinutes(row, 'sleepNeedHours', 'sleepNeedMinutes', 24);
    const deep = hoursOrMinutes(row, 'deepSleepHours', 'deepSleepMinutes', 24);
    const rem = hoursOrMinutes(row, 'remSleepHours', 'remSleepMinutes', 24);
    const light = hoursOrMinutes(row, 'lightSleepHours', 'lightSleepMinutes', 24);
    const fields = [
      ['sleepMinutes', sleep, 0, 1440], ['sleepNeedMinutes', need, 60, 1440], ['deepSleepMinutes', deep, 0, 1440], ['remSleepMinutes', rem, 0, 1440], ['lightSleepMinutes', light, 0, 1440],
      ['awakeMinutes', numberValue(pick(row, 'awakeMinutes'), 0, 1440), 0, 1440], ['hrv', numberValue(pick(row, 'hrv'), 1, 300), 1, 300], ['restingHr', numberValue(pick(row, 'restingHr'), 25, 220), 25, 220], ['steps', numberValue(pick(row, 'steps'), 0, 200000), 0, 200000], ['activeMinutes', numberValue(pick(row, 'activeMinutes'), 0, 1440), 0, 1440]
    ];
    let hasDayData = false, invalid = false;
    for (const [key, value, min, max] of fields) {
      if (Number.isNaN(value)) { errors.push(`Row ${line}: ${key} must be between ${min} and ${max}.`); invalid = true; }
      else if (value !== null) { day[key] = value; hasDayData = true; }
    }
    const bedTime = pick(row, 'bedTime'), wakeTime = pick(row, 'wakeTime');
    if (bedTime) { if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(bedTime)) { errors.push(`Row ${line}: bedtime must use HH:MM.`); invalid = true; } else { day.bedTime = bedTime; hasDayData = true; } }
    if (wakeTime) { if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(wakeTime)) { errors.push(`Row ${line}: wake time must use HH:MM.`); invalid = true; } else { day.wakeTime = wakeTime; hasDayData = true; } }
    if (!invalid && hasDayData) days.set(date, { ...(days.get(date) || {}), ...day });

    const type = pick(row, 'workoutType');
    if (type) {
      const duration = numberValue(pick(row, 'workoutDurationMinutes'), 1, 1440);
      const effortText = pick(row, 'workoutEffort');
      const effort = effortText === '' ? 5 : numberValue(effortText, 1, 10);
      const start = pick(row, 'workoutStart') || '12:00';
      if (Number.isNaN(duration) || Number.isNaN(effort) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(start)) errors.push(`Row ${line}: workout duration, effort (1–10), or start time is invalid.`);
      else workouts.push({ id: `import-${date}-${line}`, date, type, startTime: start, durationMinutes: duration, effort, notes: pick(row, 'workoutNotes'), source: 'import' });
    }
  });
  if (!days.size && !workouts.length) throw new Error(errors[0] || 'No usable daily metrics or workouts were found.');
  return { days: [...days.values()], workouts, errors };
}

export function normalizeJson(raw) {
  const payload = raw?.data && typeof raw.data === 'object' ? raw.data : raw;
  if (!payload || !Array.isArray(payload.days) || !Array.isArray(payload.workouts)) throw new Error('JSON must be a Morrow backup or contain “days” and “workouts” arrays.');
  const errors = [], days = [], workouts = [];
  payload.days.forEach((item, index) => {
    if (!item || !validDate(item.date)) { errors.push(`Day ${index + 1}: date must use YYYY-MM-DD.`); return; }
    const allowedSources = ['demo', 'manual', 'import', 'apple', 'healthconnect', 'fitbit', 'garmin', 'oura', 'whoop'];
    const day = { date: item.date, source: allowedSources.includes(item.source) ? item.source : 'import' };
    const ranges = { sleepMinutes: [0, 1440], sleepNeedMinutes: [60, 1440], deepSleepMinutes: [0, 1440], remSleepMinutes: [0, 1440], lightSleepMinutes: [0, 1440], awakeMinutes: [0, 1440], hrv: [1, 300], restingHr: [25, 220], steps: [0, 200000], activeMinutes: [0, 1440] };
    let invalid = false;
    for (const [key, [min, max]] of Object.entries(ranges)) if (item[key] !== undefined && item[key] !== null) {
      const value = Number(item[key]);
      if (!Number.isFinite(value) || value < min || value > max) { errors.push(`Day ${index + 1}: ${key} must be between ${min} and ${max}.`); invalid = true; }
      else day[key] = value;
    }
    for (const key of ['bedTime', 'wakeTime']) if (item[key]) {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(item[key])) { errors.push(`Day ${index + 1}: ${key} must use HH:MM.`); invalid = true; }
      else day[key] = item[key];
    }
    if (!invalid) days.push(day);
  });
  payload.workouts.forEach((item, index) => {
    const duration = Number(item?.durationMinutes), effort = Number(item?.effort);
    const start = item?.startTime || '12:00';
    if (!item || !validDate(item.date) || !item.type || !Number.isFinite(duration) || duration < 1 || duration > 1440 || !Number.isFinite(effort) || effort < 1 || effort > 10 || !/^([01]\d|2[0-3]):[0-5]\d$/.test(start)) { errors.push(`Workout ${index + 1}: date, type, time, duration, or effort is invalid.`); return; }
    const allowedSources = ['demo', 'manual', 'import', 'apple', 'healthconnect', 'fitbit', 'garmin', 'oura', 'whoop'];
    workouts.push({ id: `import-${item.id || `${item.date}-${index}`}`, date: item.date, type: String(item.type), startTime: start, durationMinutes: duration, effort, notes: String(item.notes || ''), source: allowedSources.includes(item.source) ? item.source : 'import' });
  });
  if (!days.length && !workouts.length) throw new Error(errors[0] || 'This file contains no usable data.');
  return { days, workouts, errors, sampleIncluded: Boolean(payload.sampleIncluded), profile: normalizeProfile(payload.profile) };
}

function normalizeProfile(profile) {
  if (!profile || typeof profile !== 'object') return null;
  const bounded = (value, min, max, fallback) => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
  };
  const goals = profile.goals || {};
  const scoring = profile.scoring || {};
  const recoveryWeights = scoring.recoveryWeights || {};
  const reminderTime = profile.reminder?.time;
  return {
    goals: {
      stepTarget: bounded(goals.stepTarget, 500, 50000, 8000),
      sleepTargetHours: bounded(goals.sleepTargetHours, 4, 14, 8),
      weeklyWorkoutTarget: bounded(goals.weeklyWorkoutTarget, 1, 14, 4)
    },
    scoring: {
      sleepRegularityPercent: bounded(scoring.sleepRegularityPercent, 0, 40, 20),
      strainLoadScale: bounded(scoring.strainLoadScale, 250, 1200, 520),
      recoveryWeights: {
        sleep: bounded(recoveryWeights.sleep, 0, 100, 32),
        hrv: bounded(recoveryWeights.hrv, 0, 100, 36),
        restingHr: bounded(recoveryWeights.restingHr, 0, 100, 20),
        recentLoad: bounded(recoveryWeights.recentLoad, 0, 100, 12)
      }
    },
    reminder: { enabled: false, time: typeof reminderTime === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(reminderTime) ? reminderTime : '20:30', inAppOnly: true }
  };
}

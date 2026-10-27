export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
export const round = value => Math.round(value);
export const dayRecord = (db, date) => db.days.find(day => day.date === date) || null;

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function consistencyScore(db, date) {
  const days = db.days.filter(day => day.date <= date && day.bedTime).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 7);
  if (days.length < 3) return null;
  const minutes = days.map(day => {
    const [hour, minute] = day.bedTime.split(':').map(Number);
    const value = hour * 60 + minute;
    return value < 12 * 60 ? value + 24 * 60 : value;
  });
  const mean = minutes.reduce((sum, item) => sum + item, 0) / minutes.length;
  const variance = minutes.reduce((sum, item) => sum + (item - mean) ** 2, 0) / minutes.length;
  return round(clamp(100 - Math.sqrt(variance) * 2.1, 0, 100));
}

export function getSleepScore(db, date) {
  const record = dayRecord(db, date);
  if (!record || !record.sleepMinutes) return { value: null, components: [], durationMinutes: record?.sleepMinutes ?? null };
  const need = record.sleepNeedMinutes || Math.round((db.profile.goals.sleepTargetHours || 8) * 60);
  const duration = round(clamp(record.sleepMinutes / need * 100, 0, 100));
  const consistency = consistencyScore(db, date);
  const regularityWeight = clamp(Number(db.profile.scoring?.sleepRegularityPercent ?? 20), 0, 40) / 100;
  const components = [{ label: 'Time asleep', value: duration, weight: consistency === null ? 1 : 1 - regularityWeight, detail: `${formatDuration(record.sleepMinutes)} of ${formatDuration(need)} target` }];
  if (consistency !== null && regularityWeight > 0) components.push({ label: 'Schedule regularity', value: consistency, weight: regularityWeight, detail: 'Bedtime variation across recent nights' });
  const weight = components.reduce((sum, item) => sum + item.weight, 0);
  const score = round(components.reduce((sum, item) => sum + item.value * item.weight, 0) / weight);
  return { value: score, components, durationMinutes: record.sleepMinutes, needMinutes: need, consistency };
}

export function getStrain(db, date) {
  const record = dayRecord(db, date);
  const workouts = db.workouts.filter(workout => workout.date === date);
  const hasSteps = Number.isFinite(record?.steps);
  const hasMinutes = Number.isFinite(record?.activeMinutes);
  if (!workouts.length && !hasSteps && !hasMinutes) return { value: null, load: null, workouts };
  const scoring = db.profile.scoring || {};
  let load = workouts.reduce((sum, workout) => sum + workout.durationMinutes * workout.effort, 0);
  if (!workouts.length && hasMinutes) load += record.activeMinutes * 4.2;
  if (hasSteps) load += Math.max(0, record.steps - 3000) * 0.045;
  const scale = clamp(Number(scoring.strainLoadScale ?? 520), 250, 1200);
  const value = round(clamp(21 * (1 - Math.exp(-load / scale)), 0, 21));
  return { value, load: round(load), workouts };
}

export function getRecovery(db, date) {
  const record = dayRecord(db, date);
  const previousDate = shiftDate(date, -1);
  const sleep = getSleepScore(db, date);
  const weights = { sleep: 32, hrv: 36, restingHr: 20, recentLoad: 12, ...(db.profile.scoring?.recoveryWeights || {}) };
  const candidates = [];
  if (sleep.value !== null && weights.sleep > 0) candidates.push({ label: 'Sleep', value: sleep.value, weight: weights.sleep, detail: `${formatDuration(sleep.durationMinutes)} recorded` });

  const history = db.days.filter(day => day.date < date && day.date >= shiftDate(date, -14));
  const hrvBaseline = median(history.filter(day => Number.isFinite(day.hrv)).map(day => day.hrv));
  const rhrBaseline = median(history.filter(day => Number.isFinite(day.restingHr)).map(day => day.restingHr));
  if (Number.isFinite(record?.hrv) && hrvBaseline !== null && history.filter(day => Number.isFinite(day.hrv)).length >= 3) {
    const value = round(clamp(70 + ((record.hrv - hrvBaseline) / hrvBaseline) * 200, 0, 100));
    if (weights.hrv > 0) candidates.push({ label: 'HRV', value, weight: weights.hrv, detail: `${record.hrv} ms · 14-day median ${round(hrvBaseline)} ms` });
  }
  if (Number.isFinite(record?.restingHr) && rhrBaseline !== null && history.filter(day => Number.isFinite(day.restingHr)).length >= 3) {
    const value = round(clamp(72 + (rhrBaseline - record.restingHr) * 5, 0, 100));
    if (weights.restingHr > 0) candidates.push({ label: 'Resting heart rate', value, weight: weights.restingHr, detail: `${record.restingHr} bpm · 14-day median ${round(rhrBaseline)} bpm` });
  }
  const previousStrain = getStrain(db, previousDate);
  if (previousStrain.value !== null) {
    const value = round(clamp(100 - previousStrain.value * 2.4, 35, 100));
    if (weights.recentLoad > 0) candidates.push({ label: 'Recent load', value, weight: weights.recentLoad, detail: `Previous day strain ${previousStrain.value} / 21` });
  }
  if (candidates.length < 2) return { value: null, signals: candidates, sleep, record, hrvBaseline, rhrBaseline, previousStrain, missing: recoveryMissing(record, sleep, hrvBaseline, rhrBaseline, previousStrain) };
  const weight = candidates.reduce((sum, item) => sum + item.weight, 0);
  const value = round(candidates.reduce((sum, item) => sum + item.value * item.weight, 0) / weight);
  return { value, signals: candidates, sleep, record, hrvBaseline, rhrBaseline, previousStrain, missing: recoveryMissing(record, sleep, hrvBaseline, rhrBaseline, previousStrain) };
}

function recoveryMissing(record, sleep, hrvBaseline, rhrBaseline, previousStrain) {
  const missing = [];
  if (!record?.hrv || hrvBaseline === null) missing.push('HRV baseline');
  if (!record?.restingHr || rhrBaseline === null) missing.push('resting heart rate baseline');
  if (sleep.value === null) missing.push('sleep');
  if (previousStrain?.value === null || !previousStrain) missing.push('previous day activity');
  return missing;
}

export function getDaySummary(db, date) {
  return { record: dayRecord(db, date), sleep: getSleepScore(db, date), strain: getStrain(db, date), recovery: getRecovery(db, date), workouts: db.workouts.filter(item => item.date === date).sort((a, b) => (a.startTime || '').localeCompare(b.startTime || '')) };
}

export function shiftDate(date, amount) {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + amount);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function formatDuration(minutes) {
  if (!Number.isFinite(minutes)) return '—';
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return hours ? `${hours}h ${String(remainder).padStart(2, '0')}m` : `${remainder}m`;
}

export function friendlyDate(date, options = { weekday: 'short', month: 'short', day: 'numeric' }) {
  return new Intl.DateTimeFormat('en', options).format(new Date(`${date}T12:00:00`));
}

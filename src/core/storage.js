export const STORAGE_KEY = 'morrow.local.v1';

export function todayKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function defaultDatabase() {
  return { version: 1, profile: { goals: { stepTarget: 8000, sleepTargetHours: 8, weeklyWorkoutTarget: 4 }, scoring: { sleepRegularityPercent: 20, recoveryWeights: { sleep: 32, hrv: 36, restingHr: 20, recentLoad: 12 }, strainLoadScale: 520 }, reminder: { enabled: false, time: '20:30', inAppOnly: true } }, days: [], workouts: [], sampleIncluded: false };
}

export function seedSampleDatabase(now = new Date()) {
  const db = defaultDatabase();
  db.sampleIncluded = true;
  const sleepOffsets = [0.2, -0.4, 0.1, 0.7, -0.2, 0.4, -0.6, 0.1, 0.3, -0.1, 0.4, -0.3, 0.1, 0.5];
  for (let i = 13; i >= 0; i -= 1) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const date = todayKey(d);
    const sleepHours = 7.25 + sleepOffsets[i];
    db.days.push({
      date,
      sleepMinutes: Math.round(sleepHours * 60),
      sleepNeedMinutes: 480,
      bedTime: ['22:38', '22:51', '23:04', '22:42', '23:16', '22:49', '22:35'][i % 7],
      wakeTime: ['06:21', '06:44', '06:51', '06:17', '06:53', '06:34', '06:08'][i % 7],
      deepSleepMinutes: Math.round(sleepHours * 0.21 * 60),
      remSleepMinutes: Math.round(sleepHours * 0.23 * 60),
      lightSleepMinutes: Math.round(sleepHours * 0.48 * 60),
      awakeMinutes: Math.round(sleepHours * 0.08 * 60),
      hrv: Math.round(56 + Math.sin(i * 0.74) * 5 + (i % 4)),
      restingHr: Math.round(54 + Math.cos(i * 0.61) * 3),
      steps: Math.round(6300 + ((i * 953) % 5500)),
      activeMinutes: [0, 2, 5, 8, 10, 12, 13].includes(i) ? 38 + (i % 3) * 9 : 24 + (i % 4) * 6,
      source: 'demo'
    });
  }
  const workoutPlan = [
    { offset: 0, type: 'Outdoor run', startTime: '07:12', durationMinutes: 38, effort: 7, notes: 'Easy pace, kept it conversational.' },
    { offset: 1, type: 'Strength', startTime: '18:10', durationMinutes: 46, effort: 7, notes: 'Full body · steady session.' },
    { offset: 3, type: 'Cycle', startTime: '07:35', durationMinutes: 52, effort: 6, notes: '' },
    { offset: 5, type: 'Strength', startTime: '17:50', durationMinutes: 42, effort: 8, notes: '' },
    { offset: 7, type: 'Walk', startTime: '12:15', durationMinutes: 31, effort: 3, notes: 'Lunch break.' },
    { offset: 9, type: 'Outdoor run', startTime: '07:05', durationMinutes: 34, effort: 7, notes: '' },
    { offset: 11, type: 'Mobility', startTime: '19:00', durationMinutes: 24, effort: 2, notes: '' }
  ];
  workoutPlan.forEach((item, index) => {
    const d = new Date(now);
    d.setDate(d.getDate() - item.offset);
    db.workouts.push({ id: `demo-${index}-${todayKey(d)}`, date: todayKey(d), ...item, source: 'demo' });
  });
  return db;
}

export function loadDatabase() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (parsed && Array.isArray(parsed.days) && Array.isArray(parsed.workouts) && parsed.profile) return parsed;
    } catch (error) {
      console.error('Morrow could not read local data; using an empty journal.', error);
    }
    return defaultDatabase();
  }
  const seeded = seedSampleDatabase();
  saveDatabase(seeded);
  return seeded;
}

export function saveDatabase(db) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
}

export function removeSampleData(db) {
  db.days = db.days.filter(day => day.source !== 'demo');
  db.workouts = db.workouts.filter(workout => workout.source !== 'demo');
  db.sampleIncluded = false;
  return db;
}

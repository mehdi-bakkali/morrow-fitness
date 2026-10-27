/**
 * Provider adapter contract for future native/backend integrations.
 * A provider adapter should implement: beginConnection(), disconnect(), sync(),
 * and normalize(rawPayload) => { days, workouts }. Never place provider client
 * secrets in this static frontend. See README for the present connection limits.
 */
export const providers = [
  { id: 'apple-health', name: 'Apple Health', status: 'unavailable', method: 'Native iOS app', note: 'HealthKit permissions are available to native iOS apps. This PWA cannot read the Health store. Apple Health XML exports are not parsed yet.' },
  { id: 'health-connect', name: 'Android Health Connect', status: 'unavailable', method: 'Native Android app', note: 'Health Connect uses an Android SDK and device permissions. A browser-installed PWA cannot access that local store.' },
  { id: 'garmin', name: 'Garmin Connect', status: 'planned', method: 'Approved API integration', note: 'Garmin offers cloud-to-cloud APIs through its developer program. Production access and a secure service are needed.' },
  { id: 'fitbit', name: 'Fitbit', status: 'planned', method: 'OAuth app', note: 'Fitbit data is available through its Web API after user authorization and developer app setup.' },
  { id: 'oura', name: 'Oura', status: 'planned', method: 'OAuth app + secure token handling', note: 'Oura provides OAuth access. A production multi-user integration needs registered app configuration and secure token handling.' },
  { id: 'whoop', name: 'WHOOP', status: 'planned', method: 'OAuth app + secure token handling', note: 'WHOOP provides user-authorized OAuth APIs for recovery, sleep, cycles, and workouts. App registration and secure token handling are required.' }
];

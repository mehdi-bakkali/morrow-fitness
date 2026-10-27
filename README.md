# Morrow

Morrow is a local-first activity, sleep, and recovery journal. It is a static Progressive Web App with an original visual identity, sample data on first launch, manual check-ins, workout logging, estimates, history, goals, reminders, and CSV/JSON import and export.

## Stack

The app uses browser-native HTML, CSS, and JavaScript modules. That keeps the first version small, dependency-free, and straightforward to host on GitHub Pages. The service worker caches the app shell for offline reopening; journal data is stored in the browser's local storage.

## Run locally

Use a local HTTP server so the browser can load JavaScript modules and register the service worker:

```sh
python3 -m http.server 8000
```

Then open [http://localhost:8000](http://localhost:8000). You can also use any static file server. Opening `index.html` directly with a `file://` URL is not supported.

## Deploy to GitHub Pages

1. Put the project files at the root of a GitHub repository and push them to the branch you want to publish.
2. In the repository, open **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**, choose the branch and the `/ (root)` folder, then save.
4. Open the Pages URL over HTTPS. The app uses relative paths and can be served from a repository subpath.

No build step, server, API key, or environment variable is required. If you change the cached shell files, update the cache name in `sw.js` so returning devices fetch the new version.

## First launch and daily use

- First launch seeds a clearly labeled 14-day sample journal. It lives in the same local store as future entries.
- Use **Daily check-in** for sleep, HRV, resting heart rate, steps, active minutes, and optional sleep stages.
- Use **Log a workout** for workout type, date, start time, duration, perceived effort from 1–10, and notes.
- Select a date or tap a trend bar to review that day. Use the Connect page to import a file.
- Export a JSON backup before moving browsers or clearing site data. Imports show a preview and can merge or replace journal entries.
- Settings can remove sample entries, restore a fresh sample journal, clear local data, adjust goals, and enable optional reminders.

## File formats

### JSON

The app imports its own exported backup, or JSON with `days` and `workouts` arrays. A day may include `date`, `sleepMinutes`, `sleepNeedMinutes`, `bedTime`, `wakeTime`, `deepSleepMinutes`, `remSleepMinutes`, `lightSleepMinutes`, `awakeMinutes`, `hrv`, `restingHr`, `steps`, and `activeMinutes`. A workout uses `date`, `type`, `startTime`, `durationMinutes`, `effort`, and optional `notes`. Replacing from a Morrow backup also restores goals and scoring preferences; reminder delivery stays off until it is enabled again on that browser.

### CSV

Use **CSV template** on the Connect page for an example. Each row may contain day metrics, a workout, or both. Supported columns include `date`, `sleepHours` or `sleepMinutes`, `sleepNeedHours` or `sleepNeedMinutes`, `bedTime`, `wakeTime`, `hrv`, `restingHr`, `steps`, `activeMinutes`, `deepSleepHours` or `deepSleepMinutes`, `remSleepHours` or `remSleepMinutes`, `lightSleepHours` or `lightSleepMinutes`, `awakeMinutes`, `workoutType`, `workoutStart`, `workoutDurationMinutes`, `workoutEffort`, and `workoutNotes`. Dates use `YYYY-MM-DD`, and times use `HH:MM` in local time. The importer accepts files up to 5 MB and reports row-level issues before import.

## Privacy behavior

Morrow does not require an account and this build does not send health entries to an app server. Its static files are served by whichever host you choose; the service worker caches those files. Journal records, goals, reminder settings, and the sample data are stored in the current browser profile on the current device. Browser local storage is not encrypted by Morrow, so device and browser access controls still matter. Clearing browser site data may delete the journal. Data does not automatically sync between devices; use a JSON backup to move it.

Reminder notifications are off until enabled in Settings. Only then does Morrow ask the browser for notification permission. If notifications are unsupported or permission is unavailable, an in-app reminder can appear while the app is open. Browser scheduling is not guaranteed while the PWA is closed.

## Tracker connection status and limitations

This GitHub Pages build has no direct wearable connections. It does not ask for API secrets or store OAuth tokens. CSV and Morrow JSON imports are available now; manual data entry works without a tracker.

| Source | Current status | What a future connection needs |
| --- | --- | --- |
| Apple Watch / Apple Health | Unavailable in this PWA | HealthKit access is provided to apps on supported Apple platforms with user permission. A native iOS app and HealthKit capability are needed. Health exports are XML, which this importer does not currently parse. |
| Android Health Connect | Unavailable in this PWA | Google documents Health Connect as an Android SDK/client app integration with per-data permissions. A native Android app is needed. |
| Garmin | Planned | Garmin exposes cloud-to-cloud APIs through its developer program. Multi-user availability, approval, and server-side integration must be set up for the product. |
| Fitbit | Planned | Fitbit provides a Web API, but an app registration, OAuth consent flow, and production token handling must be configured before this product can connect. |
| Oura | Planned | Oura provides an OAuth API. A registered application and secure token exchange/storage are required for a multi-user service. |
| WHOOP | Planned | WHOOP provides user-authorized OAuth endpoints and requires a registered app. Client secrets must stay server-side; they must never be placed in this static frontend. |

Relevant current documentation: [Apple HealthKit](https://developer.apple.com/documentation/healthkit), [Android Health Connect setup](https://developer.android.com/health-and-fitness/health-connect/get-started), [Garmin Connect Developer Program](https://developer.garmin.com/gc-developer-program/overview/), [Fitbit Web API](https://dev.fitbit.com/build/reference/web-api/explore/), [Oura API authentication](https://cloud.ouraring.com/docs/authentication), and [WHOOP developer getting started](https://developer.whoop.com/docs/developing/getting-started/).

The adapter placeholder lives in `src/adapters/index.js`. A future provider adapter should authenticate through the appropriate platform or secure service, normalize provider payloads into local `days` and `workouts`, preserve the source and timestamp, and handle revocation, duplicates, and deleted readings. Do not put a provider client secret in JavaScript shipped to the browser.

## Estimates and limits

Scores are Morrow's configurable first-version estimates inspired by common fitness concepts. They are not WHOOP's proprietary calculations and are not medical advice, diagnosis, or treatment recommendations.

- **Sleep (0–100):** time asleep divided by sleep need, capped at 100. When at least three recent bedtime readings exist, the default estimate blends 80% sleep duration with 20% bedtime regularity. Settings let users change the regularity weight from 0–40%. Sleep stages are optional and shown as a breakdown only.
- **Recovery (0–100):** the default relative weights are sleep (32), HRV against a rolling 14-day median (36), resting heart rate against a rolling 14-day median (20), and previous-day strain (12). Settings let users adjust each relative weight. HRV and resting-heart-rate comparisons need at least three previous readings. Missing inputs are excluded, remaining weights are rescaled, and at least two nonzero-weight signals are needed to show a score.
- **Strain (0–21):** an activity-load estimate. Logged workout duration × perceived effort is combined with available steps; when no workout is logged, active minutes can contribute. The load is workout minutes × perceived effort plus max(0, steps − 3,000) × 0.045; when there is no logged workout, active minutes × 4.2 can contribute instead. The score is round(21 × (1 − exp(−load / response scale))). Settings adjust the response scale (250–1200; default 520). With no activity reading, strain stays blank rather than displaying zero.

Wearable readings vary by device and context. One day's score is only a summary of the available inputs; it should be considered alongside how the user feels.

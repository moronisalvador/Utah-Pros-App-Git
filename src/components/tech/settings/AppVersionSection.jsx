/**
 * ════════════════════════════════════════════════
 * FILE: AppVersionSection.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Shows the version and build embedded in the installed iPhone app. The card
 *   is omitted from browser/PWA Settings because web metadata is not an iOS
 *   release identity.
 *
 * WHERE IT LIVES:
 *   Route:        /tech/settings (native app only)
 *   Rendered by:  src/pages/tech/TechSettings.jsx
 *
 * DEPENDS ON:
 *   Packages:  react, @capacitor/core
 *   Internal:  @/lib/nativeAppInfo
 *   Data:      reads → installed bundle metadata
 * ════════════════════════════════════════════════
 */

import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { getInstalledAppInfo } from '@/lib/nativeAppInfo';

export function AppVersionDetails({ info }) {
  let value = 'Checking installed version…';
  if (info.state === 'ready') {
    value = `Version ${info.version} (${info.build})`;
  } else if (info.state === 'unavailable') {
    value = 'Version unavailable';
  }

  return (
    <div className="tech-settings-row">
      <div className="tech-settings-row-main">
        <div className="tech-settings-row-label">Installed app</div>
        <div className="tech-settings-row-value" aria-live="polite">
          {value}
        </div>
      </div>
    </div>
  );
}

export default function AppVersionSection() {
  const native = Capacitor.isNativePlatform();
  const [info, setInfo] = useState({ state: 'loading' });

  useEffect(() => {
    if (!native) return undefined;
    let current = true;
    getInstalledAppInfo().then((result) => {
      if (current) setInfo(result);
    });
    return () => { current = false; };
  }, [native]);

  if (!native) return null;

  return (
    <section className="tech-settings-card" aria-labelledby="app-version-title">
      <div className="tech-settings-card-head">
        <h2
          id="app-version-title"
          className="tech-settings-card-title"
          style={{ margin: 0 }}
        >
          App information
        </h2>
        <div className="tech-settings-card-sub">
          Use this version and build when reporting an app issue.
        </div>
      </div>
      <AppVersionDetails info={info} />
    </section>
  );
}

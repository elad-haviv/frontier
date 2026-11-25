/**
 * Settings (stage 18): a menu of sections, each its own address. On a wide screen the menu is a
 * rail beside the open section; on a phone `/settings` is the menu as a list, and a section opens
 * on its own with "Settings" to go back. Only Offline copy works without a connection; the rest
 * say so and open by themselves when the connection comes back.
 */
import type { SettingsResponse } from "@frontier/schema";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { api, ApiFailure } from "../../api.ts";
import { Icon } from "../../components/ui/Icon.tsx";
import { Problem } from "../../components/ui/Problem.tsx";
import { useNeedsConnection } from "../../sync/connection.ts";
import { Account } from "./Account.tsx";
import { Backups } from "./Backups.tsx";
import { Device } from "./Device.tsx";
import { FolderRun } from "./FolderRun.tsx";
import { KeepGoing } from "./KeepGoing.tsx";
import { Models } from "./Models.tsx";
import { Providers } from "./Providers.tsx";
import {
  NeedsConnection,
  SECTIONS,
  type Section,
  SettingsDataProvider,
  useWide,
} from "./shared.tsx";
import { Spending } from "./Spending.tsx";
import { Types } from "./Types.tsx";
import "./settings.css";

/** A section's one-line state, for the rail and the phone's list. */
function stateOf(
  section: Section,
  settings: SettingsResponse | null,
  offline: boolean,
): { text: string; problem?: boolean } | null {
  if (!section.offline && offline && !settings) return { text: "Needs a connection" };
  if (!settings) return null;
  const ai = settings.ai;
  switch (section.path) {
    case "ai/providers": {
      const bad = ai.providers.filter((p) => p.keyUnreadable || p.check?.ok === false).length;
      if (bad > 0) return { text: bad === 1 ? "1 problem" : `${bad} problems`, problem: true };
      const on = ai.providers.filter((p) => p.keySet && p.enabled);
      return on.length === 0
        ? { text: "None connected", problem: true }
        : { text: `Connected: ${on.map((p) => p.name).join(", ")}` };
    }
    case "ai/models": {
      const off = Object.values(ai.models).filter((m) => m === null).length;
      return off === 3 ? { text: "off" } : off > 0 ? { text: `${off} off` } : { text: "All set" };
    }
    case "ai/spending":
      return { text: `$${ai.spentUsd.toFixed(2)} of $${ai.monthlyCapUsd.toFixed(0)}` };
    case "account": {
      const n = settings.signIn.passkeys.length;
      return { text: n === 0 ? "Password" : n === 1 ? "1 passkey" : `${n} passkeys` };
    }
    default:
      return null;
  }
}

/** The section to open at `/settings` on a wide screen: the first that needs attention. */
function firstSection(settings: SettingsResponse | null): string {
  if (!settings) return "ai/providers";
  const ai = settings.ai;
  const providersBad =
    ai.providers.every((p) => !p.keySet) ||
    ai.providers.some((p) => p.keyUnreadable || p.check?.ok === false);
  if (providersBad) return "ai/providers";
  if (Object.values(ai.models).some((m) => m === null)) return "ai/models";
  return "ai/providers";
}

function Menu({
  current,
  settings,
  offline,
  list,
}: {
  current: string | null;
  settings: SettingsResponse | null;
  offline: boolean;
  /** Drawn as the phone's list of rows rather than the rail. */
  list: boolean;
}) {
  const groups = [...new Set(SECTIONS.map((s) => s.group))];
  return (
    <nav className={list ? "settings-list" : "settings-rail"} aria-label="Settings">
      {!list && <h1>Settings</h1>}
      {groups.map((g) => (
        <div key={g} className="settings-group">
          <h2 className="settings-group-name">{g}</h2>
          <ul>
            {SECTIONS.filter((s) => s.group === g).map((s) => {
              const state = stateOf(s, settings, offline);
              const on = current === s.path;
              return (
                <li key={s.path}>
                  <Link
                    to={`/settings/${s.path}`}
                    className={on ? "on" : undefined}
                    aria-current={on ? "page" : undefined}
                  >
                    <span className="settings-link-text">
                      <span>{s.title}</span>
                      {state && (list || state.problem) && (
                        <small className={state.problem ? "problem" : undefined}>
                          {state.text}
                        </small>
                      )}
                    </span>
                    {list && <Icon icon={ChevronRight} size="sm" className="settings-chevron" />}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function Open({ section }: { section: Section }) {
  switch (section.path) {
    case "ai/providers":
      return <Providers />;
    case "ai/models":
      return <Models />;
    case "ai/spending":
      return <Spending />;
    case "ai/folder-run":
      return <FolderRun />;
    case "library/types":
      return <Types />;
    case "library/keep-going":
      return <KeepGoing />;
    case "library/backups":
      return <Backups />;
    case "device":
      return <Device />;
    default:
      return <Account />;
  }
}

export function SettingsPage() {
  const { pathname } = useLocation();
  const wide = useWide();
  const offline = useNeedsConnection() !== undefined;
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [error, setError] = useState<ApiFailure | null>(null);
  const reload = useCallback(async () => {
    try {
      setSettings(await api.settings());
      setError(null);
    } catch (err) {
      setError(err instanceof ApiFailure ? err : new ApiFailure(0, "unknown", String(err)));
    }
  }, []);
  useEffect(() => void reload(), [reload]);
  // When the connection comes back, the open section loads by itself.
  useEffect(() => {
    if (!offline && error) void reload();
  }, [offline, error, reload]);

  const rest = pathname.replace(/^\/settings\/?/, "").replace(/\/+$/, "");
  const section = SECTIONS.find((s) => rest === s.path || rest.startsWith(`${s.path}/`)) ?? null;

  if (rest !== "" && !section) return <Navigate to="/settings" replace />;
  if (rest === "" && wide) return <Navigate to={`/settings/${firstSection(settings)}`} replace />;

  const body = !section ? null : section.offline || settings ? (
    <Open section={section} />
  ) : error && (offline || error.status === 0) ? (
    <NeedsConnection>
      AI and library settings live on your server. They open when you're connected.{" "}
      <Link to="/settings/device">Offline copy</Link> works now.
    </NeedsConnection>
  ) : error ? (
    <Problem reason={error.message} onRetry={() => void reload()} />
  ) : (
    <p className="muted">Loading…</p>
  );

  return (
    <SettingsDataProvider value={{ settings, error, reload }}>
      <div className={`settings-page ${wide ? "is-wide" : "is-narrow"}`}>
        {offline && (
          <p className="settings-offline-banner">No connection: only Offline copy works now.</p>
        )}
        {wide ? (
          <div className="settings-columns">
            <Menu
              current={section?.path ?? null}
              settings={settings}
              offline={offline}
              list={false}
            />
            <article className="settings settings-section">
              {section && <h1>{section.title}</h1>}
              {body}
            </article>
          </div>
        ) : section ? (
          <article className="settings settings-section">
            <Link to="/settings" className="settings-back">
              <Icon icon={ChevronLeft} size="sm" /> Settings
            </Link>
            <h1>{section.title}</h1>
            {body}
          </article>
        ) : (
          <div className="settings settings-home">
            <h1>Settings</h1>
            <Menu current={null} settings={settings} offline={offline} list />
          </div>
        )}
      </div>
    </SettingsDataProvider>
  );
}

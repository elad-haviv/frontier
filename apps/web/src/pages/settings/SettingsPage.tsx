/**
 * Settings (stage 18): a menu of sections, each its own address. On a wide screen the menu is a
 * rail beside the open section; on a phone `/settings` is the menu as a list, and a section opens
 * on its own with "Settings" to go back. Only the sections that read the device (AI keys, Offline
 * copy) work without a connection; the rest say so and open by themselves when it comes back.
 */
import type { MeResponse, SettingsResponse } from "@frontier/schema";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, useLocation } from "../../nav.tsx";
import { api, ApiFailure } from "../../api.ts";
import { useDeviceKeys } from "../../aiKeys.ts";
import { Icon } from "../../components/ui/Icon.tsx";
import { Problem } from "../../components/ui/Problem.tsx";
import { useNeedsConnection } from "../../sync/connection.ts";
import { missing, useMe } from "../../me.ts";
import { Account } from "./Account.tsx";
import { AiKeys } from "./AiKeys.tsx";
import { Backups } from "./Backups.tsx";
import { General } from "./General.tsx";
import { useProjectOrNull } from "../../components/projectContext.ts";
import { Device } from "./Device.tsx";
import { FolderRun } from "./FolderRun.tsx";
import { KeepGoing } from "./KeepGoing.tsx";
import { Models } from "./Models.tsx";
import { Profile } from "./Profile.tsx";
import {
  movedSection,
  NeedsConnection,
  type Section,
  sectionsFor,
  SettingsDataProvider,
  useWide,
} from "./shared.tsx";
import { Spending } from "./Spending.tsx";
import { Types } from "./Types.tsx";
import "./settings.css";

/** What this device holds, for the state of the AI keys section. */
interface KeyState {
  count: number;
  failing: number;
}

/** A section's one-line state, for the rail and the phone's list. */
function stateOf(
  section: Section,
  settings: SettingsResponse | null,
  offline: boolean,
  me: MeResponse | null,
  keys: KeyState,
): { text: string; problem?: boolean } | null {
  // The AI keys are read from the device, so they have a state with no connection too.
  if (section.path === "device/ai-keys") {
    if (keys.failing > 0) {
      return { text: keys.failing === 1 ? "1 problem" : `${keys.failing} problems`, problem: true };
    }
    return keys.count === 0
      ? { text: "No key on this device", problem: true }
      : { text: keys.count === 1 ? "1 key in this browser" : `${keys.count} keys in this browser` };
  }
  if (!section.offline && offline && !settings) return { text: "Needs a connection" };
  if (section.group === "You") return youStateOf(section, me);
  if (!settings) return null;
  const ai = settings.ai;
  switch (section.path) {
    case "you/ai-models": {
      const off = Object.values(ai.models).filter((m) => m === null).length;
      return off === 3 ? { text: "off" } : off > 0 ? { text: `${off} off` } : { text: "All set" };
    }
    case "you/ai-spending":
      return { text: `$${ai.spentUsd.toFixed(2)} this month` };
    default:
      return null;
  }
}

/** The state of the sections about you, which come from the account and not the settings. */
function youStateOf(
  section: Section,
  me: MeResponse | null,
): { text: string; problem?: boolean } | null {
  if (!me) return null;
  if (section.path === "profile") {
    return me.needsProfile
      ? { text: `Add your ${missing(me.name, me.email)}`, problem: true }
      : { text: me.email };
  }
  if (section.path === "account") {
    const n = me.passkeys.length;
    const password = me.passwordSet && !me.passwordOff;
    if (n === 0) return { text: "Password" };
    return { text: `${password ? "Password and " : ""}${n === 1 ? "1 passkey" : `${n} passkeys`}` };
  }
  return null;
}

/** The section to open at `/settings` on a wide screen: the first that needs attention. */
function firstSection(
  settings: SettingsResponse | null,
  me: MeResponse | null,
  keys: KeyState,
): string {
  // Logging in needs the email, and saved versions the name: asking comes first.
  if (me?.needsProfile) return "profile";
  if (keys.count === 0 || keys.failing > 0) return "device/ai-keys";
  return "you/ai-models";
}

function Menu({
  current,
  settings,
  offline,
  keys,
  list,
  sections,
}: {
  /** The sections that can open here: the project's only inside a project. */
  sections: Section[];
  current: string | null;
  settings: SettingsResponse | null;
  offline: boolean;
  keys: KeyState;
  /** Drawn as the phone's list of rows rather than the rail. */
  list: boolean;
}) {
  const groups = [...new Set(sections.map((s) => s.group))];
  const me = useMe();
  const project = useProjectOrNull();
  return (
    <nav className={list ? "settings-list" : "settings-rail"} aria-label="Settings">
      {!list && <h1>Settings</h1>}
      {groups.map((g) => (
        <div key={g} className="settings-group">
          <h2 className="settings-group-name">
            {g === "This project" && project ? `This project · ${project.name}` : g}
          </h2>
          <ul>
            {sections
              .filter((s) => s.group === g)
              .map((s) => {
                const state = stateOf(s, settings, offline, me, keys);
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
    case "you/ai-models":
      return <Models />;
    case "you/ai-spending":
      return <Spending />;
    case "you/folder-run":
      return <FolderRun />;
    case "device/ai-keys":
      return <AiKeys />;
    case "general":
      return <General />;
    case "types":
      return <Types />;
    case "you/keep-going":
      return <KeepGoing />;
    case "backups":
      return <Backups />;
    case "device/offline":
      return <Device />;
    case "profile":
      return <Profile />;
    default:
      return <Account />;
  }
}

export function SettingsPage() {
  const { pathname } = useLocation();
  const wide = useWide();
  const project = useProjectOrNull();
  const sections = sectionsFor(project !== null);
  const offline = useNeedsConnection() !== undefined;
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [error, setError] = useState<ApiFailure | null>(null);
  const held = useDeviceKeys();
  const keys: KeyState = {
    count: Object.keys(held.keys).length,
    failing: Object.keys(held.keys).filter(
      (k) => held.checks[k as keyof typeof held.checks]?.ok === false,
    ).length,
  };
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

  const me = useMe();
  const rest = pathname.replace(/^\/settings\/?/, "").replace(/\/+$/, "");
  const section = sections.find((s) => rest === s.path || rest.startsWith(`${s.path}/`)) ?? null;

  // Sections that moved keep working at their old addresses.
  const moved = movedSection(rest);
  if (moved) return <Navigate to={`/settings/${moved}`} replace />;
  if (rest !== "" && !section) return <Navigate to="/settings" replace />;
  if (rest === "" && wide) {
    return <Navigate to={`/settings/${firstSection(settings, me, keys)}`} replace />;
  }
  // Settings with no project shows what is yours and the device's: the project's sections
  // need one, and the account menu of All projects is how this page is reached.

  const body = !section ? null : section.offline || settings ? (
    <Open section={section} />
  ) : error && (offline || error.status === 0) ? (
    <NeedsConnection>
      AI models and library settings live on your server. They open when you're connected.{" "}
      <Link to="/settings/device/ai-keys">AI keys</Link> and{" "}
      <Link to="/settings/device/offline">Offline copy</Link> work now.
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
          <p className="settings-offline-banner">
            No connection: only AI keys and Offline copy work now.
          </p>
        )}
        {wide ? (
          <div className="settings-columns">
            <Menu
              current={section?.path ?? null}
              settings={settings}
              offline={offline}
              keys={keys}
              sections={sections}
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
            <Menu
              current={null}
              settings={settings}
              offline={offline}
              keys={keys}
              sections={sections}
              list
            />
          </div>
        )}
      </div>
    </SettingsDataProvider>
  );
}

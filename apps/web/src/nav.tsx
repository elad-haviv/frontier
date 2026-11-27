/**
 * Links and navigation inside the app (stage 27b). The router's own `Link`, `NavLink`, `Navigate`,
 * `useNavigate` and `useLocation` are used only through here, so a page writes an address as if
 * there were one library (`/e/Notes.md`, `/maps`, `/unpublished`) and these put the open project in
 * front of it (`inProject`, `project.ts`), and take it off the location the page reads.
 * `nav.test.ts` fails when a file reaches for the router's own.
 */
import { useMemo } from "react";
import {
  Link as RouterLink,
  type LinkProps,
  type Location,
  Navigate as RouterNavigate,
  type NavigateProps,
  type NavigateOptions,
  NavLink as RouterNavLink,
  type NavLinkProps,
  type To,
  useLocation as useRouterLocation,
  useNavigate as useRouterNavigate,
} from "react-router-dom";
import { inProject, useProjectRef, withoutProject } from "./project.ts";

/** A destination with the open project put in front of it. */
function placed(to: To, project: ReturnType<typeof useProjectRef>): To {
  if (typeof to === "string") return inProject(to, project);
  return to.pathname === undefined ? to : { ...to, pathname: inProject(to.pathname, project) };
}

export function Link(props: LinkProps) {
  const project = useProjectRef();
  return <RouterLink {...props} to={placed(props.to, project)} />;
}

export function NavLink(props: NavLinkProps) {
  const project = useProjectRef();
  return <RouterNavLink {...props} to={placed(props.to, project)} />;
}

export function Navigate(props: NavigateProps) {
  const project = useProjectRef();
  return <RouterNavigate {...props} to={placed(props.to, project)} />;
}

/** Navigates as the router does, to an address written without its project. */
export function useNavigate(): (
  to: To | number,
  options?: NavigateOptions,
) => void | Promise<void> {
  const navigate = useRouterNavigate();
  const project = useProjectRef();
  return useMemo(
    () => (to: To | number, options?: NavigateOptions) =>
      typeof to === "number" ? navigate(to) : navigate(placed(to, project), options),
    [navigate, project],
  );
}

/** The location with the project taken off its path, as the pages' own patterns expect. */
export function useLocation(): Location {
  const location = useRouterLocation();
  return useMemo(() => {
    const { slug, rest } = withoutProject(location.pathname);
    return slug === null ? location : { ...location, pathname: rest };
  }, [location]);
}

export type { LinkProps };
export type NavigateFunction = ReturnType<typeof useNavigate>;

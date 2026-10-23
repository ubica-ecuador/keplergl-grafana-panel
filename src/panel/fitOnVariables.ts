/**
 * Decides when the map frames its data again because a dashboard variable
 * changed.
 *
 * The panel frames its data once, on load; a refresh leaves the viewport where
 * it is, so it never fights the user panning. A map whose rows move elsewhere
 * when a variable changes — another state, another route, another day's fleet
 * — needs the load's framing again, and only then: `fitOnVariables` names the
 * variables that mean "the data moved".
 *
 * Why this is more than "fit on the next refresh": the rows a variable change
 * brings can arrive in steps. A chain of browser datasets re-runs one dataset
 * after another and the map's query answers each time — with the old state's
 * rows while its own datasets have not reloaded yet, with nothing while they
 * disagree (the new state's shapes joined to the old state's values), and at
 * last with the new rows, seconds later. Neither of the first two says where
 * the data went: an empty answer still reports the old rows' bounds, since
 * kepler keeps a layer's bounds when its rows are replaced by none.
 *
 * So a change *arms* the fit and remembers the layers' bounds at that moment.
 * Rows framed somewhere else than those bounds are the new data: they are
 * framed, and so are the later steps of the same change during a short grace
 * after that; then the arm is spent and the map is the user's. Rows that keep
 * the old bounds are framed once — the user may have panned away from them —
 * and the arm waits on, up to `FIT_ARM_MAX_MS`, in case the new rows are still
 * coming. The same extent is never framed twice, so a refresh inside the grace
 * that brings nothing new does not undo a pan.
 *
 * Free of kepler, React and @grafana/runtime so the rules can be tested with
 * literal values; bounds travel as comparable strings.
 */

/** After the rows first move, how long later steps of the same change are still framed. */
export const FIT_GRACE_MS = 4_000;

/** How long an armed change waits for its rows to move before it gives up. Grafana's query timeout. */
export const FIT_ARM_MAX_MS = 60_000;

/** An armed change. */
export interface FitArm {
  armedAt: number;
  /** The layers' bounds when the variables changed: rows that keep them are the old ones. */
  armBounds: string;
  /** The extent last framed, so that the same one is never framed twice. */
  fittedBounds: string | null;
  /** When rows elsewhere than `armBounds` were first framed: the grace runs from there. */
  movedAt: number | null;
}

/**
 * The values of the named variables, as one comparable string. `read` returns
 * what the URL holds: undefined, one string, or a list for a multi-value variable.
 */
export function variablesKey(variables: readonly string[], read: (name: string) => unknown): string {
  return JSON.stringify(
    variables.map((name) => {
      const value = read(name);
      return [name, Array.isArray(value) ? value.map(String) : value === undefined ? null : String(value)];
    })
  );
}

/**
 * Whether a URL change arms a fit: only a change of the named variables'
 * values, and never the first reading, which is the dashboard loading.
 */
export function armsFit(previousKey: string | null, nextKey: string): boolean {
  return previousKey !== null && previousKey !== nextKey;
}

/** A fresh arm, taken when the variables change, over the layers' bounds at that moment. */
export function armFit(now: number, bounds: string): FitArm {
  return { armedAt: now, armBounds: bounds, fittedBounds: null, movedAt: null };
}

/**
 * What to do with a refresh that has just landed in kepler: frame it or not,
 * and the arm that remains. `frame` is the extent of its rows, or null when it
 * brought none.
 */
export function decideFit(arm: FitArm | null, now: number, frame: string | null): { fit: boolean; arm: FitArm | null } {
  if (!arm) {
    return { fit: false, arm: null };
  }
  if (arm.movedAt !== null ? now - arm.movedAt > FIT_GRACE_MS : now - arm.armedAt > FIT_ARM_MAX_MS) {
    return { fit: false, arm: null };
  }
  if (frame === null || frame === arm.fittedBounds) {
    return { fit: false, arm };
  }
  const moved = frame !== arm.armBounds;
  return {
    fit: true,
    arm: { ...arm, fittedBounds: frame, movedAt: arm.movedAt ?? (moved ? now : null) },
  };
}

import { Icon } from "./Icon.js";

interface Props {
  pass: "before" | "after";
  defaultReset: boolean;
  onChoose: (reset: boolean) => void;
}

/**
 * Blocking nudge at the start of a pass (before recording): reset the app to a
 * clean session, or keep it as-is. Centered modal over the stage with two
 * option tiles; a scrim behind it blocks the app until the user decides.
 */
export function ResetPopup({ pass, defaultReset, onChoose }: Props) {
  return (
    <div class="reset-modal" role="alertdialog" aria-modal="true">
      <div class="reset-modal-icon">
        <Icon name="restart" />
      </div>
      <h2 class="reset-modal-title">Start the {pass.toUpperCase()} recording fresh?</h2>
      <p class="reset-modal-sub">
        Pick how this clip begins — replay starts from exactly the state you choose here.
      </p>

      <div class="reset-modal-options">
        <button
          type="button"
          class={`reset-tile ${defaultReset ? "reset-tile--rec" : ""}`}
          onClick={() => onChoose(true)}
        >
          <span class="reset-tile-head">
            <Icon name="restart" /> Reset &amp; start fresh
            {defaultReset && <span class="reset-tile-badge">Default</span>}
          </span>
          <span class="reset-tile-desc">
            Clears network, cookies, localStorage &amp; the session, then reloads. Best when the
            journey includes signing in.
          </span>
        </button>

        <button
          type="button"
          class={`reset-tile ${!defaultReset ? "reset-tile--rec" : ""}`}
          onClick={() => onChoose(false)}
        >
          <span class="reset-tile-head">
            <Icon name="arrowRight" /> Keep &amp; continue
            {!defaultReset && <span class="reset-tile-badge">Default</span>}
          </span>
          <span class="reset-tile-desc">
            Keeps the app exactly as it is now — your manual login / setup stays.
          </span>
        </button>
      </div>
    </div>
  );
}

import { Icon } from "./Icon.js";

interface Props {
  label: string;
  onContinue: () => void;
}

/**
 * A blocking nudge at the bottom of the stage for a hands-off moment (e.g. in
 * --url mode: "switch your app to the PR branch, then Continue"). The user acts
 * in the app, then clicks Continue.
 */
export function PausePopup({ label, onContinue }: Props) {
  return (
    <div class="pause-popup" role="alertdialog">
      <div class="pause-popup-icon">
        <Icon name="play" />
      </div>
      <div class="pause-popup-text">
        <strong>Your turn</strong>
        <p>{label}</p>
      </div>
      <button class="btn btn--confirm pause-popup-btn" onClick={onContinue}>
        <Icon name="play" /> Continue
      </button>
    </div>
  );
}

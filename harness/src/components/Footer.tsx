import { Icon } from "./Icon.js";

/** Sits below the action bar — links to the project site. */
export function Footer() {
  return (
    <footer class="footer">
      <a class="footer-link" href="https://pr-preview.com" target="_blank" rel="noreferrer">
        pr-preview.com <Icon name="external" />
      </a>
    </footer>
  );
}

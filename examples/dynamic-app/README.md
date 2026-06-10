# dynamic-app — pr-preview adverse-conditions fixture

A deliberately *unreliable* app for testing pr-preview's replay engine against
real-world dynamics. Adversity is toggled via URL query flags:

| Flag | Default | Effect |
| --- | --- | --- |
| `lat` | `1500` | base latency (ms) for every async action |
| `spinner` | `1` | cover the UI with a spinner during async work (occludes buttons) |
| `otp` | `0` | require a 2FA code after login |
| `modal` | `0` | show a welcome modal that must be dismissed |
| `feed` | `0` | stream feed items over time (websocket-like) |
| `popup` | `0` | offer an OAuth-style popup sign-in |
| `flaky` | `0` | briefly drop the list mid-reload (transient detach) |

Example: `http://localhost:5174/?lat=2500&spinner=1&otp=1`

Test credentials: `demo@example.com` / `demo`, OTP `000000`.

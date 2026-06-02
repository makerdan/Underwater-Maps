import "./lib/suppressThreeClockWarn";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { installTestHelpers } from "./lib/testHelpers";
import { assertDevAuthBypassSafe, installDevAuthFetchPatch } from "./lib/devAuth";
import { patchPerformanceMeasure } from "./lib/patchPerformanceMeasure";

patchPerformanceMeasure();
assertDevAuthBypassSafe();
installDevAuthFetchPatch();
// Hard call-site gate: in a production build, `import.meta.env.DEV` is
// statically replaced with `false`, the whole `if` body becomes dead code,
// and the `installTestHelpers` import is tree-shaken away — so `__bathyTest`
// (and the forge-auth-headers helpers it exposes) cannot reach the bundle.
// See `lib/testHelpers.ts` header for the full defense-in-depth story.
if (
  import.meta.env.DEV &&
  import.meta.env.VITE_DEV_AUTH_BYPASS === "1"
) {
  installTestHelpers();
}

createRoot(document.getElementById("root")!).render(<App />);

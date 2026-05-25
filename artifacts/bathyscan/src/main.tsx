import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { installTestHelpers } from "./lib/testHelpers";
import { assertDevAuthBypassSafe, installDevAuthFetchPatch } from "./lib/devAuth";
import { patchPerformanceMeasure } from "./lib/patchPerformanceMeasure";

patchPerformanceMeasure();
assertDevAuthBypassSafe();
installDevAuthFetchPatch();
installTestHelpers();

createRoot(document.getElementById("root")!).render(<App />);

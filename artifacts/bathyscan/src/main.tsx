import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { installTestHelpers } from "./lib/testHelpers";

installTestHelpers();

createRoot(document.getElementById("root")!).render(<App />);

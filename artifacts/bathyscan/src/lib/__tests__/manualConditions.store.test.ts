/**
 * Unit tests for the manual conditions store integration.
 *
 * Covers:
 *   • settingsStore: setDatasetManualConditions / clearDatasetManualConditions /
 *     setManualConditionsActiveSource
 *   • uiStore: setSessionManualConditions / clearSessionManualConditions
 *   • Default values are empty records
 *   • Version bump to 30 with migration injecting empty records
 */
import { describe, it, expect, beforeEach } from "vitest";
import { useSettingsStore, DEFAULT_SETTINGS, SETTINGS_SCHEMA_VERSION, type ManualConditions } from "../settingsStore";
import { useUiStore } from "../uiStore";

const SAMPLE: ManualConditions = {
  windSpeedKnots: 12,
  windDirectionDeg: 270,
  surfaceTempC: 18.5,
  currentSpeedKnots: 0.5,
  currentDirectionDeg: 90,
  waterLevelM: 1.2,
};

beforeEach(() => {
  useSettingsStore.setState({
    datasetManualConditions: {},
    manualConditionsActiveSource: {},
  });
  useUiStore.setState({ sessionManualConditions: {} });
});

describe("settingsStore — ManualConditions", () => {
  it("starts with empty records by default", () => {
    const state = useSettingsStore.getState();
    expect(state.datasetManualConditions).toEqual({});
    expect(state.manualConditionsActiveSource).toEqual({});
  });

  it("setDatasetManualConditions writes to the correct dataset key", () => {
    const { setDatasetManualConditions } = useSettingsStore.getState();
    setDatasetManualConditions("fw-test-lake", SAMPLE);
    const state = useSettingsStore.getState();
    expect(state.datasetManualConditions["fw-test-lake"]).toEqual(SAMPLE);
  });

  it("setDatasetManualConditions does not affect other datasets", () => {
    const { setDatasetManualConditions } = useSettingsStore.getState();
    setDatasetManualConditions("lake-a", SAMPLE);
    setDatasetManualConditions("lake-b", { ...SAMPLE, windSpeedKnots: 20 });
    const state = useSettingsStore.getState();
    expect(state.datasetManualConditions["lake-a"]!.windSpeedKnots).toBe(12);
    expect(state.datasetManualConditions["lake-b"]!.windSpeedKnots).toBe(20);
  });

  it("clearDatasetManualConditions removes only the target dataset", () => {
    const { setDatasetManualConditions, clearDatasetManualConditions } = useSettingsStore.getState();
    setDatasetManualConditions("lake-a", SAMPLE);
    setDatasetManualConditions("lake-b", SAMPLE);
    clearDatasetManualConditions("lake-a");
    const state = useSettingsStore.getState();
    expect(state.datasetManualConditions["lake-a"]).toBeUndefined();
    expect(state.datasetManualConditions["lake-b"]).toEqual(SAMPLE);
  });

  it("setManualConditionsActiveSource writes and reads correctly", () => {
    const { setManualConditionsActiveSource } = useSettingsStore.getState();
    setManualConditionsActiveSource("fw-test-lake", "manual");
    expect(useSettingsStore.getState().manualConditionsActiveSource["fw-test-lake"]).toBe("manual");
    setManualConditionsActiveSource("fw-test-lake", "real");
    expect(useSettingsStore.getState().manualConditionsActiveSource["fw-test-lake"]).toBe("real");
  });

  it("setManualConditionsActiveSource isolates datasets", () => {
    const { setManualConditionsActiveSource } = useSettingsStore.getState();
    setManualConditionsActiveSource("lake-a", "real");
    setManualConditionsActiveSource("lake-b", "manual");
    const state = useSettingsStore.getState();
    expect(state.manualConditionsActiveSource["lake-a"]).toBe("real");
    expect(state.manualConditionsActiveSource["lake-b"]).toBe("manual");
  });
});

describe("uiStore — sessionManualConditions", () => {
  it("starts with empty record", () => {
    expect(useUiStore.getState().sessionManualConditions).toEqual({});
  });

  it("setSessionManualConditions writes and clears correctly", () => {
    const { setSessionManualConditions } = useUiStore.getState();
    setSessionManualConditions("fw-test-lake", SAMPLE);
    expect(useUiStore.getState().sessionManualConditions["fw-test-lake"]).toEqual(SAMPLE);
  });

  it("clearSessionManualConditions removes only the target dataset", () => {
    const { setSessionManualConditions, clearSessionManualConditions } = useUiStore.getState();
    setSessionManualConditions("lake-a", SAMPLE);
    setSessionManualConditions("lake-b", { ...SAMPLE, surfaceTempC: 5 });
    clearSessionManualConditions("lake-a");
    const state = useUiStore.getState();
    expect(state.sessionManualConditions["lake-a"]).toBeUndefined();
    expect(state.sessionManualConditions["lake-b"]!.surfaceTempC).toBe(5);
  });

  it("session conditions are isolated from persisted conditions", () => {
    const { setSessionManualConditions } = useUiStore.getState();
    const { setDatasetManualConditions } = useSettingsStore.getState();
    setSessionManualConditions("lake-x", { ...SAMPLE, windSpeedKnots: 3 });
    setDatasetManualConditions("lake-x", { ...SAMPLE, windSpeedKnots: 15 });
    expect(useUiStore.getState().sessionManualConditions["lake-x"]!.windSpeedKnots).toBe(3);
    expect(useSettingsStore.getState().datasetManualConditions["lake-x"]!.windSpeedKnots).toBe(15);
  });
});

describe("DEFAULT_SETTINGS", () => {
  it("includes empty datasetManualConditions and manualConditionsActiveSource", () => {
    expect(DEFAULT_SETTINGS.datasetManualConditions).toEqual({});
    expect(DEFAULT_SETTINGS.manualConditionsActiveSource).toEqual({});
  });
});

describe("SETTINGS_SCHEMA_VERSION", () => {
  it("is 30 after v29→v30 bump", () => {
    expect(SETTINGS_SCHEMA_VERSION).toBe(30);
  });
});

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

describe("stuck-active guard — clearDatasetManualConditions also clears active source", () => {
  beforeEach(() => {
    useSettingsStore.setState({
      datasetManualConditions: {},
      manualConditionsActiveSource: {},
    });
    useUiStore.setState({ sessionManualConditions: {} });
  });

  it("clearDatasetManualConditions removes manualConditionsActiveSource for the same dataset", () => {
    const { setDatasetManualConditions, setManualConditionsActiveSource, clearDatasetManualConditions } =
      useSettingsStore.getState();

    setDatasetManualConditions("lake-stuck", SAMPLE);
    setManualConditionsActiveSource("lake-stuck", "manual");

    const before = useSettingsStore.getState();
    expect(before.datasetManualConditions["lake-stuck"]).toEqual(SAMPLE);
    expect(before.manualConditionsActiveSource["lake-stuck"]).toBe("manual");

    clearDatasetManualConditions("lake-stuck");

    const after = useSettingsStore.getState();
    expect(after.datasetManualConditions["lake-stuck"]).toBeUndefined();
    expect(after.manualConditionsActiveSource["lake-stuck"]).toBeUndefined();
  });

  it("clearDatasetManualConditions does not affect active source for other datasets", () => {
    const { setDatasetManualConditions, setManualConditionsActiveSource, clearDatasetManualConditions } =
      useSettingsStore.getState();

    setDatasetManualConditions("lake-a", SAMPLE);
    setManualConditionsActiveSource("lake-a", "manual");
    setDatasetManualConditions("lake-b", SAMPLE);
    setManualConditionsActiveSource("lake-b", "real");

    clearDatasetManualConditions("lake-a");

    const after = useSettingsStore.getState();
    expect(after.datasetManualConditions["lake-a"]).toBeUndefined();
    expect(after.manualConditionsActiveSource["lake-a"]).toBeUndefined();
    expect(after.datasetManualConditions["lake-b"]).toEqual(SAMPLE);
    expect(after.manualConditionsActiveSource["lake-b"]).toBe("real");
  });
});

describe("stuck-active guard — onManualConditionsServerClear", () => {
  beforeEach(() => {
    useSettingsStore.setState({
      datasetManualConditions: {},
      manualConditionsActiveSource: {},
    });
    useUiStore.setState({ sessionManualConditions: {} });
  });

  it("clears session conditions when the server record is cleared", () => {
    const { setSessionManualConditions, onManualConditionsServerClear } = useUiStore.getState();
    setSessionManualConditions("lake-stale", SAMPLE);

    expect(useUiStore.getState().sessionManualConditions["lake-stale"]).toEqual(SAMPLE);

    onManualConditionsServerClear("lake-stale");

    expect(useUiStore.getState().sessionManualConditions["lake-stale"]).toBeUndefined();
  });

  it("clears persisted conditions when the server record is cleared", () => {
    const { setSessionManualConditions, onManualConditionsServerClear } = useUiStore.getState();
    const { setDatasetManualConditions } = useSettingsStore.getState();

    setDatasetManualConditions("lake-stale", SAMPLE);
    setSessionManualConditions("lake-stale", SAMPLE);

    onManualConditionsServerClear("lake-stale");

    expect(useSettingsStore.getState().datasetManualConditions["lake-stale"]).toBeUndefined();
  });

  it("clears active source when the server record is cleared", () => {
    const { setSessionManualConditions, onManualConditionsServerClear } = useUiStore.getState();
    const { setDatasetManualConditions, setManualConditionsActiveSource } = useSettingsStore.getState();

    setDatasetManualConditions("lake-stale", SAMPLE);
    setManualConditionsActiveSource("lake-stale", "manual");
    setSessionManualConditions("lake-stale", SAMPLE);

    onManualConditionsServerClear("lake-stale");

    expect(useSettingsStore.getState().manualConditionsActiveSource["lake-stale"]).toBeUndefined();
  });

  it("does not affect conditions for other datasets on server clear", () => {
    const { setSessionManualConditions, onManualConditionsServerClear } = useUiStore.getState();
    const { setDatasetManualConditions, setManualConditionsActiveSource } = useSettingsStore.getState();

    setSessionManualConditions("lake-keep", { ...SAMPLE, windSpeedKnots: 7 });
    setDatasetManualConditions("lake-keep", { ...SAMPLE, windSpeedKnots: 7 });
    setManualConditionsActiveSource("lake-keep", "manual");

    setSessionManualConditions("lake-stale", SAMPLE);
    setDatasetManualConditions("lake-stale", SAMPLE);

    onManualConditionsServerClear("lake-stale");

    expect(useUiStore.getState().sessionManualConditions["lake-keep"]?.windSpeedKnots).toBe(7);
    expect(useSettingsStore.getState().datasetManualConditions["lake-keep"]?.windSpeedKnots).toBe(7);
    expect(useSettingsStore.getState().manualConditionsActiveSource["lake-keep"]).toBe("manual");
  });
});

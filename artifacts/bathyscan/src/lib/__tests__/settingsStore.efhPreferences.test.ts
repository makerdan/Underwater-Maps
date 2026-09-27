import { afterEach, describe, expect, it } from "vitest";
import { useSettingsStore } from "@/lib/settingsStore";

describe("settingsStore EFH species preferences", () => {
  const originalPreferences = {
    ...useSettingsStore.getState().efhSpeciesPreferences,
  };

  afterEach(() => {
    useSettingsStore.setState({ efhSpeciesPreferences: { ...originalPreferences } });
  });

  it("clears only the selected dataset's remembered pair", () => {
    useSettingsStore.setState({
      efhSpeciesPreferences: {
        "dataset-a": ["Pacific Halibut", "Pacific Cod"],
        "dataset-b": ["Sablefish", "Walleye Pollock"],
      },
    });

    useSettingsStore.getState().clearEfhSpeciesPreference(" dataset-a ");

    expect(useSettingsStore.getState().efhSpeciesPreferences).toEqual({
      "dataset-b": ["Sablefish", "Walleye Pollock"],
    });
  });
});
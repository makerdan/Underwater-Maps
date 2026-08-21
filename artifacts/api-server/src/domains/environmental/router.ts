import { Router } from "express";
import tidalRouter from "../../routes/tidal.js";
import tidesRouter from "../../routes/tides.js";
import surfaceConditionsRouter from "../../routes/surface-conditions.js";
import trollingPresetsRouter from "../../routes/trolling-presets.js";
import trollingPresetFoldersRouter from "../../routes/trolling-preset-folders.js";
import waterTemperatureRouter from "../../routes/water-temperature.js";
import temperatureProfileRouter from "../../routes/temperature-profile.js";
import weatherStationsRouter from "../../routes/weather-stations.js";
import weatherStationObsRouter from "../../routes/weather-station-obs.js";
import rawsStationsRouter from "../../routes/raws-stations.js";
import rawsWeatherRouter from "../../routes/raws-weather.js";
import envPackRouter from "../../routes/env-pack.js";
import { createDomain, type ApiDomain } from "../domain.js";

const router = Router();
router.use(tidalRouter);
router.use(tidesRouter);
router.use(surfaceConditionsRouter);
router.use(trollingPresetsRouter);
router.use(trollingPresetFoldersRouter);
router.use(waterTemperatureRouter);
router.use(temperatureProfileRouter);
router.use(weatherStationsRouter);
router.use(weatherStationObsRouter);
router.use(rawsStationsRouter);
router.use(rawsWeatherRouter);
router.use(envPackRouter);

export const environmentalDomain: ApiDomain = createDomain(
  "environmental-observations",
  router,
);
export default environmentalDomain;
import { startWeatherCacheRefresher } from "../../lib/weatherCacheRefresher.js";

export function startEnvironmentalRefresh(): () => Promise<void> {
  return startWeatherCacheRefresher();
}
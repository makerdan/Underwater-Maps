/**
 * intertidalScorer.ts — Tidepool & Beachcombing spot scoring algorithm.
 *
 * Implements two 0–100 integer scoring functions that rate ShoreZone /
 * AOOS intertidal features for recreational use:
 *
 *   scoreTidepool(props)      — weights bedrock/rubble substrate, coarse rock
 *                               size, high invertebrate/algae bioband density,
 *                               and high zone relief.
 *
 *   scoreBeachcombing(props)  — weights sand/cobble substrate, rounded stones,
 *                               debris load 3–5, and high wave energy/dynamism.
 *                               Subtracts points when zone_use > 3 (crowds out
 *                               the remote-wilderness bonus).
 *
 * All attribute fields are optional — the scorer gracefully degrades to the
 * fields present in the current bundle (szMaterial / szForm / substrate).
 * When extended ShoreZone fields (znRelief, znBioAlg/Inv, znDebris…) are
 * present from the updated bundle builder they add finer resolution.
 */

/**
 * Subset of SubstrateFeatureProperties consumed by the scorer.
 * Defined here so intertidalScorer has no circular dependency on shoreZoneData.
 */
export interface IntertidalScoringProps {
  substrate?: string | null;
  szMaterial?: string | null;
  szForm?: string | null;
  /** ITZ_SUBCLS — ShoreZone intertidal subclass string */
  itzSubclass?: string | null;
  /** ROCK_SZ_LO/MED/HI — numeric rock-size code (1 fine → 8 boulder/bedrock) */
  rockSzLo?: number | null;
  rockSzMed?: number | null;
  rockSzHi?: number | null;
  /** ZN_RELIEF — zone surface roughness (1 flat → 5 very rough) */
  znRelief?: number | null;
  /** ZN_BIO_ALG — algal bioband density (1 sparse → 5 dense) */
  znBioAlg?: number | null;
  /** ZN_BIO_INV — invertebrate bioband density (1 sparse → 5 dense) */
  znBioInv?: number | null;
  /** ZN_DEBRIS — debris volume rating (1 none → 5 heavy) */
  znDebris?: number | null;
  /** ROUNDNESS — particle roundness string ("angular" → "well-rounded") */
  roundness?: string | null;
  /** ZN_ENERGY — wave fetch energy rating (1 sheltered → 5 exposed) */
  znEnergy?: number | null;
  /** ZN_DYNAMIC — seasonal dynamism (1 stable → 5 highly dynamic) */
  znDynamic?: number | null;
  /** ZN_USE — human use intensity (1 remote → 5 heavily used) */
  znUse?: number | null;
}

// ---------------------------------------------------------------------------
// Tidepool scoring
// ---------------------------------------------------------------------------

/**
 * Rate a shoreline segment for tidepool exploration.
 * Returns an integer 0–100.
 */
export function scoreTidepool(props: IntertidalScoringProps): number {
  let score = 0;

  const sub = (props.substrate ?? "").toLowerCase();
  const szMat = (props.szMaterial ?? "").toLowerCase();
  const szForm = (props.szForm ?? "").toLowerCase();
  const itzSubcls = (props.itzSubclass ?? "").toLowerCase();

  // --- Substrate class: 0–40 pts ---
  if (
    sub === "bedrock" ||
    szMat === "rock" ||
    itzSubcls.includes("bedrock") ||
    itzSubcls.includes("boulder") ||
    itzSubcls.includes("rubble")
  ) {
    score += 40;
  } else if (
    sub === "gravel" ||
    itzSubcls.includes("cobble") ||
    itzSubcls.includes("gravel")
  ) {
    score += 22;
  } else if (sub === "sand") {
    score += 5;
  }
  // mud → 0

  // --- Rock size: 0–15 pts ---
  const rockSz = props.rockSzHi ?? props.rockSzMed ?? props.rockSzLo ?? null;
  if (rockSz !== null) {
    if (rockSz >= 6) score += 15;
    else if (rockSz >= 4) score += 8;
    else if (rockSz >= 2) score += 2;
  } else if (szForm === "cliff" || szForm === "platform" || szForm === "ramp") {
    score += 10;
  }

  // --- Zone relief / roughness: 0–15 pts ---
  const relief = props.znRelief ?? null;
  if (relief !== null) {
    if (relief >= 4) score += 15;
    else if (relief >= 3) score += 10;
    else if (relief >= 2) score += 5;
  } else if (szForm === "cliff") {
    score += 8;
  } else if (szForm === "platform") {
    score += 12;
  }

  // --- Invertebrate bioband density: 0–15 pts ---
  const bioInv = props.znBioInv ?? null;
  if (bioInv !== null) {
    score += Math.round((bioInv / 5) * 15);
  }

  // --- Algae bioband density: 0–10 pts ---
  const bioAlg = props.znBioAlg ?? null;
  if (bioAlg !== null) {
    score += Math.round((bioAlg / 5) * 10);
  }

  // --- Remote-wilderness penalty: −5 if zone_use > 3 ---
  const zoneUse = props.znUse ?? null;
  if (zoneUse !== null && zoneUse > 3) {
    score -= 5;
  }

  return Math.max(0, Math.min(100, score));
}

// ---------------------------------------------------------------------------
// Beachcombing scoring
// ---------------------------------------------------------------------------

/**
 * Rate a shoreline segment for beachcombing.
 * Returns an integer 0–100.
 */
export function scoreBeachcombing(props: IntertidalScoringProps): number {
  let score = 0;

  const sub = (props.substrate ?? "").toLowerCase();
  const szMat = (props.szMaterial ?? "").toLowerCase();
  const szForm = (props.szForm ?? "").toLowerCase();
  const itzSubcls = (props.itzSubclass ?? "").toLowerCase();
  const roundness = (props.roundness ?? "").toLowerCase();

  // --- Substrate class: 0–35 pts ---
  if (sub === "sand" || itzSubcls.includes("sand") || szForm === "beach") {
    score += 35;
  } else if (
    sub === "gravel" ||
    itzSubcls.includes("cobble") ||
    itzSubcls.includes("gravel") ||
    (szMat === "clastic" && szForm !== "tidal flat" && szForm !== "marsh")
  ) {
    score += 25;
  } else if (sub === "bedrock") {
    score += 5;
  }

  // --- Stone roundness: 0–20 pts ---
  if (roundness.includes("well-rounded") || roundness === "5" || roundness === "6") {
    score += 20;
  } else if (roundness.includes("rounded") || roundness === "4") {
    score += 15;
  } else if (roundness.includes("sub-rounded") || roundness === "3") {
    score += 8;
  } else if (roundness.includes("angular") || roundness === "1" || roundness === "2") {
    score += 2;
  } else if (sub === "sand" || sub === "gravel") {
    // Fallback: sand/gravel imply rounded
    score += 10;
  }

  // --- Debris load: 0–25 pts (higher debris = more to find) ---
  const debris = props.znDebris ?? null;
  if (debris !== null) {
    if (debris >= 4) score += 25;
    else if (debris >= 3) score += 18;
    else if (debris >= 2) score += 8;
    else score += 2;
  }

  // --- Wave energy: 0–10 pts ---
  const energy = props.znEnergy ?? null;
  if (energy !== null) {
    if (energy >= 4) score += 10;
    else if (energy >= 3) score += 6;
    else if (energy >= 2) score += 3;
  }

  // --- Dynamism: 0–5 pts ---
  const dynamic = props.znDynamic ?? null;
  if (dynamic !== null) {
    if (dynamic >= 4) score += 5;
    else if (dynamic >= 3) score += 3;
    else if (dynamic >= 2) score += 1;
  }

  // --- Remote-wilderness penalty: −5 if zone_use > 3 ---
  const zoneUse = props.znUse ?? null;
  if (zoneUse !== null && zoneUse > 3) {
    score -= 5;
  }

  return Math.max(0, Math.min(100, score));
}

// ---------------------------------------------------------------------------
// Score signals — human-readable breakdown for the score card
// ---------------------------------------------------------------------------

export interface ScoreSignals {
  substrate: string;
  bioband: string | null;
  debris: string | null;
  energy: string | null;
  humanUse: string | null;
  whySummary: string;
}

const DEBRIS_LABELS = ["None", "Trace", "Light", "Moderate", "Heavy"] as const;
const ENERGY_LABELS = ["Calm", "Low", "Moderate", "High", "Very high"] as const;
const USE_LABELS = ["Remote", "Light", "Moderate", "Heavy", "Very heavy"] as const;

/** Derive the top-2 contributing signal chips + "Why this spot?" summary line. */
export function buildScoreSignals(
  props: IntertidalScoringProps,
  activityType: "tidepool" | "beachcombing",
): ScoreSignals {
  const sub = (props.substrate ?? "").toLowerCase();
  const szForm = (props.szForm ?? "").toLowerCase();

  const substrateLabel =
    props.itzSubclass
      ? props.itzSubclass
      : props.szMaterial
      ? [props.szMaterial, props.szForm].filter(Boolean).join(" / ")
      : sub.charAt(0).toUpperCase() + sub.slice(1);

  const debris = props.znDebris ?? null;
  const debrisLabel =
    debris !== null
      ? `Debris: ${DEBRIS_LABELS[Math.min(Math.max(debris - 1, 0), 4)]}`
      : null;

  const energy = props.znEnergy ?? null;
  const energyLabel =
    energy !== null
      ? `Wave energy: ${ENERGY_LABELS[Math.min(Math.max(energy - 1, 0), 4)]}`
      : null;

  const bioInv = props.znBioInv ?? null;
  const bioAlg = props.znBioAlg ?? null;
  const biobandParts: string[] = [];
  if (bioInv != null) biobandParts.push(`inv ${bioInv}/5`);
  if (bioAlg != null) biobandParts.push(`alg ${bioAlg}/5`);
  const biobandLabel = biobandParts.length > 0 ? `Bioband: ${biobandParts.join(", ")}` : null;

  const zoneUse = props.znUse ?? null;
  const humanUseLabel =
    zoneUse !== null
      ? `Human use: ${USE_LABELS[Math.min(Math.max(zoneUse - 1, 0), 4)]}`
      : null;

  // "Why this spot?" — from the top two signals
  const reasons: string[] = [];
  if (activityType === "tidepool") {
    if (sub === "bedrock" || szForm === "platform" || szForm === "cliff") {
      reasons.push("rocky intertidal substrate");
    }
    if (props.znRelief != null && props.znRelief >= 3) reasons.push("high zone relief");
    if (bioInv != null && bioInv >= 3) reasons.push("rich invertebrate bioband");
    if (bioAlg != null && bioAlg >= 3) reasons.push("dense algal canopy");
  } else {
    if (sub === "sand" || szForm === "beach") reasons.push("sandy beach");
    else if (sub === "gravel") reasons.push("cobble/gravel beach");
    if (debris != null && debris >= 3) reasons.push("active debris wrack line");
    if (energy != null && energy >= 3) reasons.push("high wave energy");
  }

  const whySummary =
    reasons.length > 0
      ? `Good for ${activityType} due to ${reasons.slice(0, 2).join(" and ")}.`
      : `Moderate ${activityType} potential based on substrate type.`;

  return {
    substrate: substrateLabel,
    bioband: biobandLabel,
    debris: debrisLabel,
    energy: energyLabel,
    humanUse: humanUseLabel,
    whySummary,
  };
}

// export function detectDuplicates(subscriptions: any[]) {
//   const duplicates: any[] = []
//   const subscriptionGroups: Record<string, any[]> = {}

//   subscriptions.forEach((sub) => {
//     // Normalize name for better matching
//     const normalizedName = normalizeName(sub.name)

//     if (!subscriptionGroups[normalizedName]) {
//       subscriptionGroups[normalizedName] = []
//     }
//     subscriptionGroups[normalizedName].push(sub)
//   })

//   Object.entries(subscriptionGroups).forEach(([normalizedName, subs]) => {
//     if (subs.length > 1) {
//       const totalCost = subs.reduce((sum, s) => sum + s.price, 0)
//       const potentialSavings = totalCost - Math.min(...subs.map((s) => s.price))

//       duplicates.push({
//         name: subs[0].name,
//         normalizedName,
//         count: subs.length,
//         subscriptions: subs,
//         totalCost,
//         potentialSavings,
//         priceConflict: hasPriceConflict(subs),
//       })
//     }
//   })

//   return duplicates
// }


import type {
  BillingCycle,
  CheckDuplicateRequest,
  DuplicateCheckResult,
  DuplicateConfidence,
  DuplicateGroup,
  DuplicateMatch,
  MatchSignals,
  Subscription,
} from "./types";


function normalizeName(name: string): string {
  // Remove common suffixes and normalize
  return name
    .toLowerCase()
    .replace(/\s+(plus|pro|premium|basic|standard|enterprise|team|business)$/i, "")
    .replace(/[^a-z0-9]/g, "")
    .trim()
}

function hasPriceConflict(subscriptions: any[]): boolean {
  const prices = subscriptions.map((s) => s.price)
  return new Set(prices).size > 1
}


export function fuzzyMatch(str1: string, str2: string): boolean {
  const normalized1 = normalizeName(str1)
  const normalized2 = normalizeName(str2)

  // Exact match after normalization
  if (normalized1 === normalized2) return true

  // Levenshtein distance for fuzzy matching
  const distance = levenshteinDistance(normalized1, normalized2)
  const maxLength = Math.max(normalized1.length, normalized2.length)

  // Allow 20% difference
  return distance / maxLength < 0.2
}


function levenshteinDistance(str1: string, str2: string): number {
  const matrix = []

  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i]
  }

  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j
  }

  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1]
      } else {
        matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1)
      }
    }
  }

  return matrix[str2.length][str1.length]
}


/**
 * duplicate-detection.ts
 *
 * Core duplicate-detection utility for SYNCRO subscriptions.
 * This module is intentionally pure (no I/O, no framework deps) so it can be
 * used identically on the client and inside the API route handler.
 */




// ─────────────────────────────────────────────────────────────────────────────
// Signal matchers
// ─────────────────────────────────────────────────────────────────────────────

function matchesPriceAndCycle(
  a: { price: number; billingCycle: BillingCycle },
  b: { price: number; billingCycle: BillingCycle }
): boolean {
  return a.billingCycle === b.billingCycle && Math.abs(a.price - b.price) < 0.01;
}

function extractDomain(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function matchesUrlDomain(a: Subscription, b: CheckDuplicateRequest): boolean {
  if (!a.renewalUrl || !b.renewalUrl) return false;
  const domainA = extractDomain(a.renewalUrl);
  const domainB = extractDomain(b.renewalUrl);
  return domainA !== null && domainB !== null && domainA === domainB;
}


/**
 * Three signals → confidence level per the issue spec:
 *   all three  → "high"
 *   any two    → "probable"
 *   one        → "low"  (not surfaced to the user by default)
 */
function scoreConfidence(signals: MatchSignals): DuplicateConfidence {
  const matchCount = [
    signals.nameMatch,
    signals.priceAndCycleMatch,
    signals.urlDomainMatch,
  ].filter(Boolean).length;

  if (matchCount >= 3) return "high";
  if (matchCount >= 2) return "probable";
  return "low";
}


/**
 * Checks a candidate subscription against an existing list and returns all
 * probable/high-confidence matches.
 *
 * Only "probable" and "high" confidence matches are included in the result —
 * single-signal "low" matches are deliberately filtered out to reduce noise.
 *
 * @param candidate   The subscription the user is about to create / import.
 * @param existing    The current list of subscriptions to compare against.
 */
export function checkForDuplicate(
  candidate: CheckDuplicateRequest,
  existing: Subscription[]
): DuplicateCheckResult {
  const matches: DuplicateMatch[] = [];

  for (const sub of existing) {
    const signals: MatchSignals = {
      nameMatch: fuzzyMatch(candidate.name, sub.name),
      priceAndCycleMatch: matchesPriceAndCycle(candidate, sub),
      urlDomainMatch: matchesUrlDomain(sub, candidate),
    };

    const confidence = scoreConfidence(signals);

    // Only surface matches with at least two signals.
    if (confidence === "high" || confidence === "probable") {
      matches.push({ existing: sub, confidence, signals });
    }
  }

  // Sort: high confidence first.
  matches.sort((a, b) => (a.confidence === "high" ? -1 : 1));

  return {
    hasDuplicate: matches.length > 0,
    confidence: matches[0]?.confidence ?? null,
    matches,
  };
}


/**
 * Scans the entire subscription list and groups probable/definite duplicates.
 * Used by the "Find duplicates" settings page feature.
 *
 * @param subscriptions  Full list of the user's subscriptions.
 */
export function detectDuplicates(subscriptions: Subscription[]): DuplicateGroup[] {
  // Step 1 — group by normalised name.
  const groups: Record<string, Subscription[]> = {};

  for (const sub of subscriptions) {
    const key = normalizeName(sub.name);
    if (!groups[key]) groups[key] = [];
    groups[key].push(sub);
  }

  // Step 2 — within each name group, further cluster by fuzzy match so that
  // e.g. "Spotify" and "Spotfy" (typo) end up in the same group.
  const mergedGroups: Subscription[][] = [];
  const visited = new Set<string>();

  for (const [key, subs] of Object.entries(groups)) {
    if (visited.has(key)) continue;
    visited.add(key);

    let cluster = [...subs];

    // Merge in any other normalised-name groups that fuzzy-match this key.
    for (const [otherKey, otherSubs] of Object.entries(groups)) {
      if (otherKey === key || visited.has(otherKey)) continue;
      if (fuzzyMatch(key, otherKey)) {
        cluster = cluster.concat(otherSubs);
        visited.add(otherKey);
      }
    }

    if (cluster.length > 1) mergedGroups.push(cluster);
  }

  // Step 3 — build DuplicateGroup output.
  return mergedGroups.map((subs) => {
    const totalCost = subs.reduce((sum, s) => sum + s.price, 0);
    const minPrice = Math.min(...subs.map((s) => s.price));
    const potentialSavings = totalCost - minPrice;

    // Determine confidence for the group.
    const allSameCycle = new Set(subs.map((s) => s.billingCycle)).size === 1;
    const priceConflict = hasPriceConflict(subs);
    const confidence: DuplicateConfidence =
      !priceConflict && allSameCycle ? "high" : "probable";

    return {
      normalizedName: normalizeName(subs[0].name),
      displayName: subs[0].name,
      subscriptions: subs,
      totalCost,
      potentialSavings,
      priceConflict,
      confidence,
    };
  });
}


/**
 * Produces a merged `Subscription` object from two existing subscriptions.
 * The `primary` subscription wins for all fields unless an explicit override
 * is supplied. History from both subscriptions is concatenated and a
 * `"merged"` event is appended.
 *
 * The caller is responsible for persisting the result and deleting the
 * duplicate record.
 *
 * @param primary   The subscription to keep.
 * @param duplicate The subscription to absorb.
 * @param overrides Field values to take from the duplicate instead of the primary.
 */
export function mergeSubscriptions(
  primary: Subscription,
  duplicate: Subscription,
  overrides: Partial<
    Pick<Subscription, "name" | "price" | "billingCycle" | "renewalUrl">
  > = {}
): Subscription {
  const combinedHistory = [
    ...(primary.history ?? []),
    ...(duplicate.history ?? []),
    {
      date: new Date().toISOString(),
      event: "merged" as const,
      note: `Merged duplicate subscription "${duplicate.name}" (id: ${duplicate.id}) into "${primary.name}" (id: ${primary.id})`,
      previousValue: { primary, duplicate },
    },
  ];

  return {
    ...primary,
    ...overrides,
    history: combinedHistory,
    updatedAt: new Date().toISOString(),
  };
}
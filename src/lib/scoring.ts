import type { Match, MatchPrediction, ScoreBreakdown, UserBet } from "../types";

const roundPoints = {
  group: { winner: 1, exact: 3 },
  round32: { winner: 3, exact: 5 },
  round16: { winner: 5, exact: 7 },
  quarter: { winner: 7, exact: 9 },
  semi: { winner: 10, exact: 12 },
  final: { winner: 12, exact: 15 }
} as const;

function hasScore(prediction?: MatchPrediction) {
  return (
    prediction?.homeScore !== undefined &&
    prediction?.awayScore !== undefined &&
    Number.isFinite(prediction.homeScore) &&
    Number.isFinite(prediction.awayScore)
  );
}

function outcome(homeScore: number, awayScore: number) {
  if (homeScore > awayScore) return "home";
  if (awayScore > homeScore) return "away";
  return "draw";
}

function winnerKey(match: Match, winnerTeamId?: string) {
  if (!winnerTeamId) return undefined;
  if (winnerTeamId === "home" || winnerTeamId === "away") return winnerTeamId;
  if (winnerTeamId === match.homeTeamId) return "home";
  if (winnerTeamId === match.awayTeamId) return "away";
  return winnerTeamId;
}

function actualKnockoutWinner(match: Match) {
  const selectedWinner = winnerKey(match, match.winnerTeamId);
  if (selectedWinner) return selectedWinner;
  const actualOutcome = outcome(match.actualHomeScore!, match.actualAwayScore!);
  return actualOutcome === "draw" ? undefined : actualOutcome;
}

function predictedKnockoutWinner(match: Match, prediction: MatchPrediction) {
  const selectedWinner = winnerKey(match, prediction.winnerTeamId);
  if (selectedWinner) return selectedWinner;
  const predictedOutcome = outcome(prediction.homeScore!, prediction.awayScore!);
  return predictedOutcome === "draw" ? undefined : predictedOutcome;
}

export function scoreMatch(match: Match, prediction?: MatchPrediction) {
  if (
    match.status !== "completed" ||
    match.actualHomeScore === undefined ||
    match.actualAwayScore === undefined ||
    !hasScore(prediction)
  ) {
    return { points: 0, exact: false, winner: false };
  }

  const exact =
    prediction!.homeScore === match.actualHomeScore &&
    prediction!.awayScore === match.actualAwayScore;

  if (match.round !== "group") {
    const actualWinner = actualKnockoutWinner(match);
    const predictedWinner = predictedKnockoutWinner(match, prediction!);
    const winner = Boolean(actualWinner && predictedWinner && actualWinner === predictedWinner);
    return {
      points: winner ? (exact ? roundPoints[match.round].exact : roundPoints[match.round].winner) : 0,
      exact: winner && exact,
      winner
    };
  }

  if (exact) {
    return { points: roundPoints[match.round].exact, exact: true, winner: true };
  }

  const winner =
    outcome(match.actualHomeScore, match.actualAwayScore) ===
    outcome(prediction!.homeScore!, prediction!.awayScore!);
  return { points: winner ? roundPoints[match.round].winner : 0, exact: false, winner };
}

function normalizeName(value?: string) {
  return value?.trim().toLocaleLowerCase("es-ES");
}

export function scoreBet(
  bet: UserBet,
  matches: Match[],
  actualAwards: { championTeamId?: string; mvpName?: string; topScorerName?: string }
): ScoreBreakdown {
  const matchScore = scoreMatches(bet, matches);
  let total = matchScore.total;

  const championHit = Boolean(
    actualAwards.championTeamId && bet.awards.championTeamId === actualAwards.championTeamId
  );
  const mvpHit = Boolean(
    normalizeName(actualAwards.mvpName) && normalizeName(bet.awards.mvpName) === normalizeName(actualAwards.mvpName)
  );
  const topScorerHit = Boolean(
    normalizeName(actualAwards.topScorerName) &&
      normalizeName(bet.awards.topScorerName) === normalizeName(actualAwards.topScorerName)
  );
  total += championHit ? 15 : 0;
  total += mvpHit ? 15 : 0;
  total += topScorerHit ? 15 : 0;

  return {
    total,
    exactHits: matchScore.exactHits,
    winnerHits: matchScore.winnerHits,
    championHit,
    mvpHit,
    topScorerHit
  };
}

export function scoreMatches(bet: UserBet, matches: Match[]): ScoreBreakdown {
  let total = 0;
  let exactHits = 0;
  let winnerHits = 0;

  for (const match of matches) {
    const result = scoreMatch(match, bet.matchPredictions[match.id]);
    total += result.points;
    if (result.exact) exactHits += 1;
    if (result.winner) winnerHits += 1;
  }

  return {
    total,
    exactHits,
    winnerHits,
    championHit: false,
    mvpHit: false,
    topScorerHit: false
  };
}

export function compareScoreboards(
  a: { score: ScoreBreakdown },
  b: { score: ScoreBreakdown }
) {
  return (
    b.score.total - a.score.total ||
    b.score.exactHits - a.score.exactHits ||
    b.score.winnerHits - a.score.winnerHits ||
    Number(b.score.championHit) - Number(a.score.championHit) ||
    Number(b.score.mvpHit) - Number(a.score.mvpHit) ||
    Number(b.score.topScorerHit) - Number(a.score.topScorerHit)
  );
}

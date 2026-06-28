import type { Match, MatchPrediction, Round, Team, UserBet } from "../types";

type Side = "home" | "away";

export type GroupStanding = {
  teamId: string;
  group: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
  position: number;
};

export type PredictedMatchView = {
  matchId: string;
  homeSlot?: string;
  awaySlot?: string;
  predictedHomeTeamId?: string;
  predictedAwayTeamId?: string;
  playableHomeTeamId?: string;
  playableAwayTeamId?: string;
};

export type PlayableMatchTeams = {
  homeTeamId?: string;
  awayTeamId?: string;
  canPredict: boolean;
  message?: string;
};

const knockoutRounds: Round[] = ["round32", "round16", "quarter", "semi", "final"];

function hasScore(prediction?: MatchPrediction) {
  return (
    prediction?.homeScore !== undefined &&
    prediction?.awayScore !== undefined &&
    Number.isFinite(prediction.homeScore) &&
    Number.isFinite(prediction.awayScore)
  );
}

function scoreFromPrediction(prediction?: MatchPrediction) {
  return hasScore(prediction)
    ? { homeScore: prediction!.homeScore!, awayScore: prediction!.awayScore! }
    : { homeScore: 0, awayScore: 0 };
}

function scoreFromActual(match: Match) {
  if (match.actualHomeScore === undefined || match.actualAwayScore === undefined) return undefined;
  return { homeScore: match.actualHomeScore, awayScore: match.actualAwayScore };
}

function createStanding(team: Team): GroupStanding {
  return {
    teamId: team.id,
    group: team.group,
    played: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    goalDifference: 0,
    points: 0,
    position: 0
  };
}

function applyResult(standing: GroupStanding, goalsFor: number, goalsAgainst: number) {
  standing.played += 1;
  standing.goalsFor += goalsFor;
  standing.goalsAgainst += goalsAgainst;
  standing.goalDifference = standing.goalsFor - standing.goalsAgainst;

  if (goalsFor > goalsAgainst) {
    standing.wins += 1;
    standing.points += 3;
  } else if (goalsFor === goalsAgainst) {
    standing.draws += 1;
    standing.points += 1;
  } else {
    standing.losses += 1;
  }
}

function sortStandings(a: GroupStanding, b: GroupStanding) {
  return (
    b.points - a.points ||
    b.goalDifference - a.goalDifference ||
    b.goalsFor - a.goalsFor ||
    b.wins - a.wins ||
    a.teamId.localeCompare(b.teamId)
  );
}

function buildGroupStandings(
  teams: Team[],
  groupMatches: Match[],
  getScore: (match: Match) => { homeScore: number; awayScore: number } | undefined
) {
  const byGroup = new Map<string, GroupStanding[]>();
  const byTeam = new Map(teams.map((team) => [team.id, createStanding(team)]));

  for (const match of groupMatches) {
    if (!match.homeTeamId || !match.awayTeamId) continue;
    const score = getScore(match);
    if (!score) continue;

    const home = byTeam.get(match.homeTeamId);
    const away = byTeam.get(match.awayTeamId);
    if (!home || !away) continue;

    applyResult(home, score.homeScore, score.awayScore);
    applyResult(away, score.awayScore, score.homeScore);
  }

  for (const standing of byTeam.values()) {
    const group = byGroup.get(standing.group) ?? [];
    group.push(standing);
    byGroup.set(standing.group, group);
  }

  for (const group of byGroup.values()) {
    group.sort(sortStandings);
    group.forEach((standing, index) => {
      standing.position = index + 1;
    });
  }

  return byGroup;
}

function buildQualificationSlots(standingsByGroup: Map<string, GroupStanding[]>) {
  const slotToTeam = new Map<string, string>();
  const teamToSlot = new Map<string, string>();
  const thirdPlaced: GroupStanding[] = [];

  for (const [group, standings] of Array.from(standingsByGroup.entries()).sort(([a], [b]) => a.localeCompare(b))) {
    for (const standing of standings.slice(0, 2)) {
      const slot = `${standing.position}${group}`;
      slotToTeam.set(slot, standing.teamId);
      teamToSlot.set(standing.teamId, slot);
    }

    const third = standings[2];
    if (third) thirdPlaced.push(third);
  }

  thirdPlaced.sort(sortStandings);
  for (const standing of thirdPlaced.slice(0, 8)) {
    const slot = `3${standing.group}`;
    slotToTeam.set(slot, standing.teamId);
    teamToSlot.set(standing.teamId, slot);
  }

  return { slotToTeam, teamToSlot };
}

function resolveWinner(
  prediction: MatchPrediction | undefined,
  homeTeamId: string | undefined,
  awayTeamId: string | undefined
) {
  if (!homeTeamId || !awayTeamId) return undefined;

  if (prediction?.winnerTeamId === homeTeamId || prediction?.winnerTeamId === "home") return homeTeamId;
  if (prediction?.winnerTeamId === awayTeamId || prediction?.winnerTeamId === "away") return awayTeamId;

  if (!hasScore(prediction) || prediction!.homeScore === prediction!.awayScore) return undefined;
  return prediction!.homeScore! > prediction!.awayScore! ? homeTeamId : awayTeamId;
}

function compactTeamIds(teamIds: Array<string | undefined>) {
  return teamIds.filter((teamId): teamId is string => Boolean(teamId));
}

export function getPlayableMatchTeams(
  match: Match,
  bet: UserBet,
  predictedView?: PredictedMatchView
): PlayableMatchTeams {
  if (match.round === "group") {
    return {
      homeTeamId: match.homeTeamId,
      awayTeamId: match.awayTeamId,
      canPredict: true
    };
  }

  let homeTeamId = predictedView?.predictedHomeTeamId;
  let awayTeamId = predictedView?.predictedAwayTeamId;

  for (const item of bet.restructures) {
    if (item.matchId !== match.id || item.phase !== match.round) continue;
    if (item.side === "home") homeTeamId = item.teamInId;
    if (item.side === "away") awayTeamId = item.teamInId;
  }

  const playableTeams = compactTeamIds([homeTeamId, awayTeamId]);
  const realTeams = compactTeamIds([match.homeTeamId, match.awayTeamId]);
  const sharesRealTeam = realTeams.length === 0 || realTeams.some((teamId) => playableTeams.includes(teamId));
  const canPredict = playableTeams.length === 2 && sharesRealTeam;

  return {
    homeTeamId,
    awayTeamId,
    canPredict,
    message: canPredict
      ? undefined
      : "Pronostico bloqueado: reestructura este partido antes de introducir un marcador."
  };
}

function sourceTeam(
  previousRoundViews: PredictedMatchView[],
  previousRoundMatches: Match[],
  bet: UserBet,
  matchIndex: number,
  side: Side
) {
  const sourceIndex = matchIndex * 2 + (side === "home" ? 0 : 1);
  const sourceView = previousRoundViews[sourceIndex];
  const sourceMatch = previousRoundMatches[sourceIndex];
  if (!sourceView || !sourceMatch) return undefined;

  return resolveWinner(
    bet.matchPredictions[sourceMatch.id],
    sourceView.playableHomeTeamId,
    sourceView.playableAwayTeamId
  );
}

export function buildPredictedMatchViews(bet: UserBet, matches: Match[], teams: Team[]) {
  const groupMatches = matches.filter((match) => match.round === "group");
  const actualSlots = buildQualificationSlots(
    buildGroupStandings(teams, groupMatches, (match) => scoreFromActual(match))
  );
  const predictedSlots = buildQualificationSlots(
    buildGroupStandings(teams, groupMatches, (match) => scoreFromPrediction(bet.matchPredictions[match.id]))
  );

  const views = new Map<string, PredictedMatchView>();
  let previousRoundViews: PredictedMatchView[] = [];
  let previousRoundMatches: Match[] = [];

  for (const round of knockoutRounds) {
    const roundMatches = matches
      .filter((match) => match.round === round)
      .sort((a, b) => a.order - b.order);

    const roundViews = roundMatches.map((match, index): PredictedMatchView => {
      let predictedView: PredictedMatchView;
      if (round === "round32") {
        const homeSlot = match.homeTeamId ? actualSlots.teamToSlot.get(match.homeTeamId) : undefined;
        const awaySlot = match.awayTeamId ? actualSlots.teamToSlot.get(match.awayTeamId) : undefined;
        predictedView = {
          matchId: match.id,
          homeSlot,
          awaySlot,
          predictedHomeTeamId: homeSlot ? predictedSlots.slotToTeam.get(homeSlot) : undefined,
          predictedAwayTeamId: awaySlot ? predictedSlots.slotToTeam.get(awaySlot) : undefined
        };
      } else {
        predictedView = {
          matchId: match.id,
          predictedHomeTeamId: sourceTeam(previousRoundViews, previousRoundMatches, bet, index, "home"),
          predictedAwayTeamId: sourceTeam(previousRoundViews, previousRoundMatches, bet, index, "away")
        };
      }

      const playable = getPlayableMatchTeams(match, bet, predictedView);
      return {
        ...predictedView,
        playableHomeTeamId: playable.homeTeamId,
        playableAwayTeamId: playable.awayTeamId
      };
    });

    for (const view of roundViews) {
      views.set(view.matchId, view);
    }

    previousRoundViews = roundViews;
    previousRoundMatches = roundMatches;
  }

  return views;
}

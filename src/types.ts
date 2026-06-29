export type Round =
  | "group"
  | "round32"
  | "round16"
  | "quarter"
  | "semi"
  | "final";

export type WriteScope = "initial" | "round32" | "round16" | "quarter" | "closed";

export type Team = {
  id: string;
  name: string;
  shortName: string;
  group: string;
  flagCode: string;
  emoji: string;
};

export type Match = {
  id: string;
  order: number;
  round: Round;
  group?: string;
  date?: string;
  venue?: string;
  homeTeamId?: string;
  awayTeamId?: string;
  homeSlot?: string;
  awaySlot?: string;
  actualHomeScore?: number;
  actualAwayScore?: number;
  actualHomePenalties?: number;
  actualAwayPenalties?: number;
  winnerTeamId?: string;
  status: "scheduled" | "completed";
  predictionsLocked?: boolean;
};

export type MatchPrediction = {
  homeScore?: number;
  awayScore?: number;
  winnerTeamId?: string;
  updatedAt?: string;
};

export type AwardsPrediction = {
  championTeamId?: string;
  mvpName?: string;
  topScorerName?: string;
};

export type UserBet = {
  uid: string;
  displayName: string;
  matchPredictions: Record<string, MatchPrediction>;
  awards: AwardsPrediction;
  submittedScopes?: Partial<Record<WriteScope, string>>;
  updatedAt?: string;
};

export type UserProfile = {
  uid: string;
  displayName: string;
  email: string;
  role: "admin" | "participant";
};

export type AppConfig = {
  writeEnabled: boolean;
  writeScope: WriteScope;
  activeRound: Round;
  lockedMessage: string;
  actualAwards: AwardsPrediction;
};

export type ScoreBreakdown = {
  total: number;
  exactHits: number;
  winnerHits: number;
  championHit: boolean;
  mvpHit: boolean;
  topScorerHit: boolean;
};

import { defaultAppConfig, matches } from "../data/worldCup2026";
import type { AppConfig, Match, UserBet, UserProfile } from "../types";

export const demoProfile: UserProfile = {
  uid: "demo-user",
  displayName: "Invitado",
  email: "demo@worldcup.local",
  role: "admin"
};

export const demoBet: UserBet = {
  uid: demoProfile.uid,
  displayName: demoProfile.displayName,
  status: "draft",
  matchPredictions: {},
  awards: {}
};

export const demoState: {
  config: AppConfig;
  matches: Match[];
  bets: UserBet[];
} = {
  config: { ...defaultAppConfig, writeEnabled: true, writeScope: "initial" },
  matches,
  bets: [demoBet]
};

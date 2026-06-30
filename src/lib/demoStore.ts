import { defaultAppConfig, matches } from "../data/worldCup2026";
import type { AppConfig, Match, UserBet, UserProfile } from "../types";

export const demoProfile: UserProfile = {
  uid: "demo-user",
  displayName: "Invitado",
  email: "demo@worldcup.local",
  role: "admin"
};

export const demoParticipantProfile: UserProfile = {
  uid: "demo-player",
  displayName: "Participante demo",
  email: "player@worldcup.local",
  role: "participant"
};

export const demoBet: UserBet = {
  uid: demoParticipantProfile.uid,
  displayName: demoParticipantProfile.displayName,
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

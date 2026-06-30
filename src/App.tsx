import { useEffect, useMemo, useState } from "react";
import {
  Award,
  BarChart3,
  CalendarDays,
  ChevronDown,
  CircleAlert,
  Lock,
  LogIn,
  LogOut,
  Save,
  Settings,
  Shield,
  Trophy,
  Unlock,
  Users
} from "lucide-react";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User
} from "firebase/auth";
import {
  collection,
  deleteField,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc
} from "firebase/firestore";
import { defaultAppConfig, matches as seedMatches, roundLabels, teams } from "./data/worldCup2026";
import { demoBet, demoProfile, demoState } from "./lib/demoStore";
import { firebase } from "./lib/firebase";
import { compareScoreboards, scoreBet, scoreMatch, scoreMatches } from "./lib/scoring";
import type {
  AppConfig,
  Match,
  MatchPrediction,
  Round,
  UserBet,
  UserProfile,
  WriteScope
} from "./types";

const selectableRounds: Array<{ round: Round; limit: number }> = [
  { round: "round32", limit: 32 },
  { round: "round16", limit: 16 },
  { round: "quarter", limit: 8 },
  { round: "semi", limit: 4 },
  { round: "final", limit: 2 }
];

const writeScopeLabels: Record<WriteScope, string> = {
  initial: "Predicciones iniciales",
  round32: "Pronosticos dieciseisavos",
  round16: "Pronosticos octavos",
  quarter: "Pronosticos cuartos",
  closed: "Cerrado"
};

const preBetGroupMatchCount = 8;
const appVersion = import.meta.env.VITE_APP_VERSION;

function nowIso() {
  return new Date().toISOString();
}

function useVersionRefresh() {
  useEffect(() => {
    if (!appVersion) return;

    let cancelled = false;

    async function checkVersion() {
      try {
        const versionUrl = `${import.meta.env.BASE_URL}version.json?t=${Date.now()}`;
        const response = await fetch(versionUrl, { cache: "no-store" });
        if (!response.ok) return;

        const remote = (await response.json()) as { version?: string };
        if (cancelled || !remote.version || remote.version === appVersion) return;

        const url = new URL(window.location.href);
        if (url.searchParams.get("appVersion") === remote.version) return;
        url.searchParams.set("appVersion", remote.version);
        window.location.replace(url.toString());
      } catch {
        // A failed version check should never interrupt the app.
      }
    }

    checkVersion();
    const interval = window.setInterval(checkVersion, 5 * 60 * 1000);
    const onFocus = () => checkVersion();
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") checkVersion();
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);
}

function emptyBet(profile: UserProfile): UserBet {
  return {
    uid: profile.uid,
    displayName: profile.displayName,
    matchPredictions: {},
    awards: {},
    submittedScopes: {},
    updatedAt: nowIso()
  };
}

function getTeam(teamId?: string) {
  return teams.find((team) => team.id === teamId);
}

function isPredictionLocked(match?: Match) {
  return Boolean(getPredictionLockMessage(match));
}

function getPredictionLockMessage(match?: Match) {
  if (!match) return "";
  if (match.round === "group" && match.order >= 1 && match.order <= preBetGroupMatchCount) {
    return "Pronostico cerrado: partido previo al inicio de la porra.";
  }
  if (match.predictionsLocked) {
    return "Pronostico cerrado: partido jugado.";
  }
  return "";
}

function toNumber(value: string) {
  if (value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function toFirestorePatch(patch: Partial<Match>) {
  return Object.fromEntries(
    Object.entries(patch).map(([key, value]) => [key, value === undefined ? deleteField() : value])
  );
}

function removeUndefinedFields(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(removeUndefinedFields).filter((item) => item !== undefined);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .map(([key, item]) => [key, removeUndefinedFields(item)] as const)
        .filter(([, item]) => item !== undefined)
    );
  }

  return value;
}

function getWinnerTeamIdFromScore(
  match: Match,
  homeScore?: number,
  awayScore?: number,
  homePenalties?: number,
  awayPenalties?: number
) {
  if (homeScore === undefined || awayScore === undefined) return undefined;
  if (homeScore !== awayScore) return homeScore > awayScore ? match.homeTeamId : match.awayTeamId;
  if (homePenalties === undefined || awayPenalties === undefined || homePenalties === awayPenalties) {
    return undefined;
  }
  return homePenalties > awayPenalties ? match.homeTeamId : match.awayTeamId;
}

function hasOfficialScore(match: Match) {
  return (
    match.status === "completed" &&
    match.actualHomeScore !== undefined &&
    match.actualAwayScore !== undefined
  );
}

function formatScorePart(score: number, penalties?: number) {
  return penalties === undefined ? `${score}` : `${score}(${penalties})`;
}

function formatOfficialScore(match: Match, fallback = "Pendiente") {
  if (!hasOfficialScore(match)) return fallback;
  const hasPenaltyScore =
    match.actualHomeScore === match.actualAwayScore &&
    match.actualHomePenalties !== undefined && match.actualAwayPenalties !== undefined;
  return [
    formatScorePart(match.actualHomeScore!, hasPenaltyScore ? match.actualHomePenalties : undefined),
    formatScorePart(match.actualAwayScore!, hasPenaltyScore ? match.actualAwayPenalties : undefined)
  ].join(" - ");
}

function uniqueTeamIds(teamIds: Array<string | undefined>) {
  return Array.from(new Set(teamIds.filter(Boolean) as string[]));
}

function getQualifiedTeamIds(matches: Match[], round: Round) {
  if (round === "round32") {
    return uniqueTeamIds(
      matches
        .filter((match) => match.round === "round32")
        .flatMap((match) => [match.homeTeamId, match.awayTeamId])
    );
  }

  const previousRoundByQualifiedRound: Partial<Record<Round, Round>> = {
    round16: "round32",
    quarter: "round16",
    semi: "quarter",
    final: "semi"
  };
  const previousRound = previousRoundByQualifiedRound[round];
  if (!previousRound) return [];

  return uniqueTeamIds(
    matches
      .filter((match) => match.round === previousRound && hasOfficialScore(match))
      .map((match) => match.winnerTeamId)
  );
}

function isScopeSubmitted(bet: UserBet, writeScope: WriteScope) {
  if (writeScope === "closed") return true;
  return Boolean(bet.submittedScopes?.[writeScope]);
}

function LoginView() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function submit() {
    setError("");
    if (!firebase.enabled || !firebase.auth) {
      return;
    }
    try {
      const result = await signInWithEmailAndPassword(firebase.auth, email, password);
      if (firebase.db) {
        await ensureUserDocuments(result.user);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se ha podido iniciar sesion.");
    }
  }

  return (
    <main className="login-shell">
      <section className="login-card">
        <div className="brand-mark">
          <Trophy size={28} />
        </div>
        <h1>Porra Mundial 2026</h1>
        <p>Predicciones y puntuacion en tiempo real.</p>

        {!firebase.enabled && (
          <div className="notice">
            <CircleAlert size={18} />
            <span>Faltan variables de Firebase. La app arrancara en modo demo al continuar.</span>
          </div>
        )}

        <div className="segmented">
          <button className="active">
            Acceder
          </button>
          <button disabled title="El registro esta cerrado">
            Crear cuenta
          </button>
        </div>

        <div className="notice subtle">
          <Lock size={18} />
          <span>El registro esta cerrado. Solo pueden acceder usuarios ya creados.</span>
        </div>

        <label>
          Email
          <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="tu@email.com" />
        </label>
        <label>
          Password
          <input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            type="password"
            placeholder="Minimo 6 caracteres"
          />
        </label>
        {error && <p className="form-error">{error}</p>}
        <button className="primary-btn" onClick={submit}>
          <LogIn size={18} />
          {firebase.enabled ? "Entrar" : "Entrar en demo"}
        </button>
      </section>
    </main>
  );
}

async function ensureUserDocuments(user: User, displayName?: string) {
  if (!firebase.db) return;

  const profileRef = doc(firebase.db, "users", user.uid);
  const betRef = doc(firebase.db, "bets", user.uid);
  const [profileSnapshot, betSnapshot] = await Promise.all([getDoc(profileRef), getDoc(betRef)]);

  const profile: UserProfile = profileSnapshot.exists()
    ? (profileSnapshot.data() as UserProfile)
    : {
        uid: user.uid,
        email: user.email ?? "",
        displayName: displayName || user.email?.split("@")[0] || "Participante",
        role: "participant"
      };

  if (!profileSnapshot.exists()) {
    await setDoc(profileRef, profile);
  }

  if (!betSnapshot.exists()) {
    await setDoc(betRef, emptyBet(profile));
  }
}

function TeamBadge({ teamId, slot }: { teamId?: string; slot?: string }) {
  const team = getTeam(teamId);
  if (!team) {
    return (
      <div className="team-badge muted">
        <span className="flag-fallback">?</span>
        <span>{slot ?? "Por definir"}</span>
      </div>
    );
  }
  return (
    <div className="team-badge">
      <span className="flag-wrap">
        <img
          alt={`Bandera ${team.name}`}
          src={`https://flagcdn.com/w80/${team.flagCode}.png`}
          onError={(event) => {
            event.currentTarget.style.display = "none";
          }}
        />
        <span>{team.emoji}</span>
      </span>
      <span>{team.name}</span>
    </div>
  );
}

function teamLabel(teamId?: string, fallback = "Por definir") {
  return teamId ? (getTeam(teamId)?.name ?? teamId) : fallback;
}

function getMatchAvailabilityMessage(match: Match) {
  if (match.round !== "group" && (!match.homeTeamId || !match.awayTeamId)) {
    return "Pronostico bloqueado: partido real pendiente de definicion.";
  }
  return "";
}

function getWinnerTeamIdFromPredictionScore(
  homeScore: number | undefined,
  awayScore: number | undefined,
  homeWinnerValue: string,
  awayWinnerValue: string
) {
  if (homeScore === undefined || awayScore === undefined || homeScore === awayScore) {
    return undefined;
  }
  return homeScore > awayScore ? homeWinnerValue : awayWinnerValue;
}

function ScoreInputs({
  prediction,
  disabled,
  onChange
}: {
  prediction?: MatchPrediction;
  disabled: boolean;
  onChange: (prediction: MatchPrediction) => void;
}) {
  const [draft, setDraft] = useState<MatchPrediction>({
    homeScore: prediction?.homeScore,
    awayScore: prediction?.awayScore,
    winnerTeamId: prediction?.winnerTeamId
  });

  useEffect(() => {
    setDraft({
      homeScore: prediction?.homeScore,
      awayScore: prediction?.awayScore,
      winnerTeamId: prediction?.winnerTeamId
    });
  }, [prediction?.awayScore, prediction?.homeScore, prediction?.winnerTeamId]);

  function updateScore(patch: MatchPrediction) {
    const next = { ...draft, ...patch, updatedAt: nowIso() };
    setDraft(next);
    onChange(next);
  }

  return (
    <div className="score-inputs">
      <input
        aria-label="Goles local"
        disabled={disabled}
        min={0}
        type="number"
        value={draft.homeScore ?? ""}
        onChange={(event) => updateScore({ homeScore: toNumber(event.target.value) })}
      />
      <span>:</span>
      <input
        aria-label="Goles visitante"
        disabled={disabled}
        min={0}
        type="number"
        value={draft.awayScore ?? ""}
        onChange={(event) => updateScore({ awayScore: toNumber(event.target.value) })}
      />
    </div>
  );
}

function MatchCard({
  match,
  bet,
  canWrite,
  isAdmin,
  onPrediction,
  onOfficialResult,
  onBlocked
}: {
  match: Match;
  bet: UserBet;
  canWrite: boolean;
  isAdmin: boolean;
  onPrediction: (matchId: string, prediction: MatchPrediction) => void;
  onOfficialResult: (matchId: string, patch: Partial<Match>) => void;
  onBlocked: (message?: string) => void;
}) {
  const prediction = bet.matchPredictions[match.id];
  const result = scoreMatch(match, prediction);
  const lockMessage = getPredictionLockMessage(match);
  const availabilityMessage = getMatchAvailabilityMessage(match);
  const predictionLocked = Boolean(lockMessage);
  const disabled = !canWrite || predictionLocked || Boolean(availabilityMessage);
  const homeWinnerTeamId = match.homeTeamId;
  const awayWinnerTeamId = match.awayTeamId;
  const homeWinnerValue = homeWinnerTeamId ?? "home";
  const awayWinnerValue = awayWinnerTeamId ?? "away";
  const officialScore = formatOfficialScore(match, "");
  const predictionScoreWinnerTeamId =
    match.round === "group"
      ? undefined
      : getWinnerTeamIdFromPredictionScore(
          prediction?.homeScore,
          prediction?.awayScore,
          homeWinnerValue,
          awayWinnerValue
        );

  function updateMatchPrediction(next: MatchPrediction) {
    const automaticWinnerTeamId =
      match.round === "group"
        ? undefined
        : getWinnerTeamIdFromPredictionScore(
            next.homeScore,
            next.awayScore,
            homeWinnerValue,
            awayWinnerValue
          );
    onPrediction(match.id, {
      ...next,
      winnerTeamId: automaticWinnerTeamId ?? next.winnerTeamId
    });
  }

  return (
    <article className="match-card">
      <header>
        <span>{match.group ? `Grupo ${match.group}` : roundLabels[match.round]}</span>
        <strong>{predictionLocked ? "Cerrado" : match.status === "completed" ? `${result.points} pts` : match.date ?? "TBD"}</strong>
      </header>

      <div className="match-teams">
        <TeamBadge teamId={match.homeTeamId} slot={match.homeSlot} />
        <TeamBadge teamId={match.awayTeamId} slot={match.awaySlot} />
      </div>

      {officialScore && (
        <div className="official-score" aria-label="Resultado final">
          <span>Resultado final</span>
          <strong>{officialScore}</strong>
        </div>
      )}

      <div className="score-shell" onClick={() => disabled && onBlocked(availabilityMessage || lockMessage)}>
        <ScoreInputs
          prediction={prediction}
          disabled={disabled}
          onChange={updateMatchPrediction}
        />
      </div>

      {lockMessage && <p className="locked-copy">{lockMessage}</p>}
      {availabilityMessage && <p className="locked-copy">{availabilityMessage}</p>}

      {match.round !== "group" && (
        <label className="winner-select">
          Ganador tras 120 min/penaltis
          <select
            disabled={disabled || Boolean(predictionScoreWinnerTeamId)}
            value={predictionScoreWinnerTeamId ?? prediction?.winnerTeamId ?? ""}
            onChange={(event) => onPrediction(match.id, { ...prediction, winnerTeamId: event.target.value || undefined })}
          >
            <option value="">Selecciona</option>
            <option value={homeWinnerValue}>{teamLabel(homeWinnerTeamId, match.homeSlot ?? "Local")}</option>
            <option value={awayWinnerValue}>{teamLabel(awayWinnerTeamId, match.awaySlot ?? "Visitante")}</option>
          </select>
        </label>
      )}

      {isAdmin && (
        <details className="admin-result">
          <summary>
            <Shield size={15} />
            Resultado oficial
            <ChevronDown size={15} />
          </summary>
          <ScoreInputs
            disabled={false}
            prediction={{ homeScore: match.actualHomeScore, awayScore: match.actualAwayScore }}
            onChange={(next) => {
              const isCompleted = next.homeScore !== undefined && next.awayScore !== undefined;
              onOfficialResult(match.id, {
                actualHomeScore: next.homeScore,
                actualAwayScore: next.awayScore,
                actualHomePenalties: isCompleted ? match.actualHomePenalties : undefined,
                actualAwayPenalties: isCompleted ? match.actualAwayPenalties : undefined,
                winnerTeamId: isCompleted
                  ? getWinnerTeamIdFromScore(
                      match,
                      next.homeScore,
                      next.awayScore,
                      match.actualHomePenalties,
                      match.actualAwayPenalties
                    )
                  : undefined,
                status: isCompleted ? "completed" : "scheduled",
                predictionsLocked: isCompleted ? true : match.predictionsLocked
              });
            }}
          />
          {match.round !== "group" && (
            <label className="penalty-score">
              Penaltis (si aplica)
              <ScoreInputs
                disabled={false}
                prediction={{ homeScore: match.actualHomePenalties, awayScore: match.actualAwayPenalties }}
                onChange={(next) =>
                  onOfficialResult(match.id, {
                    actualHomePenalties: next.homeScore,
                    actualAwayPenalties: next.awayScore,
                    winnerTeamId: getWinnerTeamIdFromScore(
                      match,
                      match.actualHomeScore,
                      match.actualAwayScore,
                      next.homeScore,
                      next.awayScore
                    )
                  })
                }
              />
            </label>
          )}
          <select
            value={match.winnerTeamId ?? ""}
            onChange={(event) => onOfficialResult(match.id, { winnerTeamId: event.target.value || undefined })}
          >
            <option value="">Empate / no definido</option>
            <option value={homeWinnerValue}>{getTeam(match.homeTeamId)?.name ?? "Local"}</option>
            <option value={awayWinnerValue}>{getTeam(match.awayTeamId)?.name ?? "Visitante"}</option>
          </select>
          <label className="inline-check">
            <input
              checked={Boolean(match.predictionsLocked)}
              type="checkbox"
              onChange={(event) => onOfficialResult(match.id, { predictionsLocked: event.target.checked })}
            />
            Bloquear pronosticos
          </label>
        </details>
      )}
    </article>
  );
}

function AwardsPanel({
  bet,
  config,
  canWrite,
  isAdmin,
  onBet,
  onConfig,
  onBlocked
}: {
  bet: UserBet;
  config: AppConfig;
  canWrite: boolean;
  isAdmin: boolean;
  onBet: (patch: Partial<UserBet>) => void;
  onConfig: (patch: Partial<AppConfig>) => void;
  onBlocked: (message?: string) => void;
}) {
  return (
    <section className="bento-card awards-panel">
      <div className="section-title">
        <Award size={19} />
        <h2>Bonus</h2>
      </div>
      <label>
        Campeon
        <select
          disabled={!canWrite}
          value={bet.awards.championTeamId ?? ""}
          onClick={() => !canWrite && onBlocked()}
          onChange={(event) => onBet({ awards: { ...bet.awards, championTeamId: event.target.value } })}
        >
          <option value="">Selecciona equipo</option>
          {teams.map((team) => (
            <option key={team.id} value={team.id}>
              {team.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        MVP del torneo
        <input
          disabled={!canWrite}
          value={bet.awards.mvpName ?? ""}
          onClick={() => !canWrite && onBlocked()}
          onChange={(event) => onBet({ awards: { ...bet.awards, mvpName: event.target.value } })}
        />
      </label>
      <label>
        Maximo goleador
        <input
          disabled={!canWrite}
          value={bet.awards.topScorerName ?? ""}
          onClick={() => !canWrite && onBlocked()}
          onChange={(event) => onBet({ awards: { ...bet.awards, topScorerName: event.target.value } })}
        />
      </label>

      {isAdmin && (
        <div className="admin-awards">
          <strong>Valores oficiales</strong>
          <select
            value={config.actualAwards.championTeamId ?? ""}
            onChange={(event) =>
              onConfig({ actualAwards: { ...config.actualAwards, championTeamId: event.target.value } })
            }
          >
            <option value="">Campeon oficial</option>
            {teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>
          <input
            placeholder="MVP oficial"
            value={config.actualAwards.mvpName ?? ""}
            onChange={(event) => onConfig({ actualAwards: { ...config.actualAwards, mvpName: event.target.value } })}
          />
          <input
            placeholder="Goleador oficial"
            value={config.actualAwards.topScorerName ?? ""}
            onChange={(event) =>
              onConfig({ actualAwards: { ...config.actualAwards, topScorerName: event.target.value } })
            }
          />
        </div>
      )}
    </section>
  );
}

function QualifiedPanel({ matches }: { matches: Match[] }) {
  return (
    <section className="bento-card qualified-panel">
      <div className="section-title">
        <Users size={19} />
        <h2>Clasificados</h2>
      </div>
      <div className="round-grid">
        {selectableRounds.map(({ round, limit }) => {
          const qualifiedTeamIds = getQualifiedTeamIds(matches, round);
          return (
            <details key={round} open={round === "round32" || qualifiedTeamIds.length > 0}>
              <summary>
                {roundLabels[round]}
                <span>
                  {qualifiedTeamIds.length}/{limit}
                </span>
              </summary>
              {qualifiedTeamIds.length ? (
                <div className="qualified-grid">
                  {qualifiedTeamIds.map((teamId) => {
                    const team = getTeam(teamId);
                    return (
                      <div className="qualified-team" key={`${round}-${teamId}`} title={team?.name ?? teamId}>
                        <span>{team?.emoji ?? "?"}</span>
                        <strong>{team?.shortName ?? teamId}</strong>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="empty-copy">Pendiente de resultados oficiales.</p>
              )}
            </details>
          );
        })}
      </div>
    </section>
  );
}

function AdminPanel({
  config,
  onConfig
}: {
  config: AppConfig;
  onConfig: (patch: Partial<AppConfig>) => void;
}) {
  return (
    <section className="bento-card admin-panel">
      <div className="section-title">
        <Settings size={19} />
        <h2>Admin</h2>
      </div>
      <button
        className={config.writeEnabled ? "toggle on" : "toggle"}
        onClick={() => onConfig({ writeEnabled: !config.writeEnabled })}
      >
        {config.writeEnabled ? <Unlock size={17} /> : <Lock size={17} />}
        {config.writeEnabled ? "Escritura abierta" : "Escritura cerrada"}
      </button>
      <label>
        Ventana
        <select value={config.writeScope} onChange={(event) => onConfig({ writeScope: event.target.value as WriteScope })}>
          <option value="initial">Predicciones iniciales</option>
          <option value="round32">Pronosticos dieciseisavos</option>
          <option value="round16">Pronosticos octavos</option>
          <option value="quarter">Pronosticos cuartos</option>
          <option value="closed">Cerrado</option>
        </select>
      </label>
      <label>
        Mensaje de bloqueo
        <input value={config.lockedMessage} onChange={(event) => onConfig({ lockedMessage: event.target.value })} />
      </label>
    </section>
  );
}

function Leaderboard({
  bets,
  matches,
  config
}: {
  bets: UserBet[];
  matches: Match[];
  config: AppConfig;
}) {
  const rows = useMemo(
    () =>
      bets
        .map((bet) => ({ bet, score: scoreBet(bet, matches, config.actualAwards) }))
        .sort(compareScoreboards),
    [bets, config.actualAwards, matches]
  );

  return (
    <section className="bento-card leaderboard">
      <div className="section-title">
        <Trophy size={19} />
        <h2>Clasificacion</h2>
      </div>
      {rows.map((row, index) => (
        <div className="leader-row" key={row.bet.uid}>
          <span>{index + 1}</span>
          <strong>{row.bet.displayName}</strong>
          <em>{row.score.total} pts</em>
        </div>
      ))}
    </section>
  );
}

function formatMatchScore(match: Match) {
  return formatOfficialScore(match);
}

function formatPrediction(prediction?: MatchPrediction) {
  if (prediction?.homeScore === undefined || prediction.awayScore === undefined) {
    return "Sin pronostico";
  }
  return `${prediction.homeScore} - ${prediction.awayScore}`;
}

function formatPredictionWinner(match: Match, prediction?: MatchPrediction) {
  if (!prediction?.winnerTeamId) return "";
  if (prediction.winnerTeamId === "home") return teamLabel(match.homeTeamId, match.homeSlot ?? "Local");
  if (prediction.winnerTeamId === "away") return teamLabel(match.awayTeamId, match.awaySlot ?? "Visitante");
  return teamLabel(prediction.winnerTeamId);
}

function AdminSummaryPage({
  bets,
  matches
}: {
  bets: UserBet[];
  matches: Match[];
}) {
  const [dateFilter, setDateFilter] = useState("");

  const availableDates = useMemo(
    () =>
      Array.from(new Set(matches.map((match) => match.date).filter(Boolean) as string[])).sort(),
    [matches]
  );

  const visibleMatches = useMemo(
    () => matches.filter((match) => !dateFilter || match.date === dateFilter),
    [dateFilter, matches]
  );

  const rows = useMemo(
    () =>
      bets
        .map((bet) => ({ bet, score: scoreMatches(bet, visibleMatches) }))
        .sort((a, b) => compareScoreboards(a, b) || a.bet.displayName.localeCompare(b.bet.displayName, "es")),
    [bets, visibleMatches]
  );

  return (
    <section className="admin-summary-grid">
      <section className="bento-card summary-comparison">
        <div className="section-title">
          <BarChart3 size={19} />
          <h2>Resumen admin</h2>
        </div>

        <div className="summary-filter">
          <label>
            Fecha
            <select value={dateFilter} onChange={(event) => setDateFilter(event.target.value)}>
              <option value="">Todos los partidos</option>
              {availableDates.map((date) => (
                <option key={date} value={date}>
                  {date}
                </option>
              ))}
            </select>
          </label>
          <button className="secondary-btn" onClick={() => setDateFilter("")} disabled={!dateFilter}>
            <CalendarDays size={16} />
            Ver todos
          </button>
        </div>

        <div className="summary-match-list">
          {visibleMatches.map((match) => {
            const isPending =
              match.status !== "completed" ||
              match.actualHomeScore === undefined ||
              match.actualAwayScore === undefined;
            return (
              <article className={isPending ? "summary-match pending" : "summary-match"} key={match.id}>
                <header>
                  <div>
                    <span>{match.date ?? "Sin fecha"} · {match.group ? `Grupo ${match.group}` : roundLabels[match.round]}</span>
                    <strong>
                      {getTeam(match.homeTeamId)?.name ?? match.homeSlot ?? "Local"} vs{" "}
                      {getTeam(match.awayTeamId)?.name ?? match.awaySlot ?? "Visitante"}
                    </strong>
                  </div>
                  <em>{formatMatchScore(match)}</em>
                </header>

                <div className="summary-predictions">
                  {bets.map((bet) => {
                    const prediction = bet.matchPredictions[match.id];
                    const score = scoreMatch(match, prediction);
                    const winnerLabel = formatPredictionWinner(match, prediction);
                    const statusClass = isPending
                      ? "pending"
                      : score.exact
                        ? "exact"
                        : score.winner
                          ? "winner"
                          : "miss";
                    return (
                      <div className={`summary-prediction ${statusClass}`} key={`${match.id}-${bet.uid}`}>
                        <strong>{bet.displayName}</strong>
                        <span className="summary-prediction-pick">
                          <span>{formatPrediction(prediction)}</span>
                          {winnerLabel && <small>Ganador: {winnerLabel}</small>}
                        </span>
                        <em>{isPending ? "-" : `${score.points} pts`}</em>
                      </div>
                    );
                  })}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="bento-card summary-leaderboard">
        <div className="section-title">
          <Trophy size={19} />
          <h2>Clasificacion</h2>
        </div>
        <p>{dateFilter ? `Solo partidos del ${dateFilter}` : "Todos los partidos visibles"}</p>
        {rows.map((row, index) => (
          <div className="leader-row" key={row.bet.uid}>
            <span>{index + 1}</span>
            <strong>{row.bet.displayName}</strong>
            <em>{row.score.total} pts</em>
          </div>
        ))}
      </section>
    </section>
  );
}

export default function App() {
  useVersionRefresh();

  const [authUser, setAuthUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(firebase.enabled ? null : demoProfile);
  const [config, setConfig] = useState<AppConfig>(
    firebase.enabled ? ({ ...defaultAppConfig } as AppConfig) : demoState.config
  );
  const [matches, setMatches] = useState<Match[]>(firebase.enabled ? [] : demoState.matches);
  const [bets, setBets] = useState<UserBet[]>(firebase.enabled ? [] : demoState.bets);
  const [toast, setToast] = useState("");
  const [bootstrapError, setBootstrapError] = useState("");
  const [roundFilter, setRoundFilter] = useState<Round>("group");
  const [adminView, setAdminView] = useState<"main" | "summary">("main");

  useEffect(() => {
    if (!firebase.enabled || !firebase.auth || !firebase.db) return;
    return onAuthStateChanged(firebase.auth, async (user) => {
      setAuthUser(user);
      setBootstrapError("");
      if (!user) {
        setProfile(null);
        return;
      }
      try {
        await ensureUserDocuments(user);
      } catch (err) {
        setBootstrapError(
          err instanceof Error
            ? err.message
            : "No se ha podido crear el perfil del usuario en Firestore."
        );
      }
    });
  }, []);

  useEffect(() => {
    if (!firebase.enabled || !firebase.db || !authUser) return;
    const unsubProfile = onSnapshot(doc(firebase.db, "users", authUser.uid), (snapshot) => {
      setProfile(snapshot.exists() ? (snapshot.data() as UserProfile) : null);
    });
    const unsubConfig = onSnapshot(doc(firebase.db, "app", "config"), (snapshot) => {
      setConfig(snapshot.exists() ? ({ ...defaultAppConfig, ...snapshot.data() } as AppConfig) : ({ ...defaultAppConfig } as AppConfig));
    });
    const unsubMatches = onSnapshot(query(collection(firebase.db, "matches"), orderBy("order", "asc")), (snapshot) => {
      const remoteMatches = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as Match);
      setMatches(remoteMatches.length ? remoteMatches : seedMatches);
    });
    const unsubBets = onSnapshot(collection(firebase.db, "bets"), (snapshot) => {
      setBets(snapshot.docs.map((item) => item.data() as UserBet));
    });
    return () => {
      unsubProfile();
      unsubConfig();
      unsubMatches();
      unsubBets();
    };
  }, [authUser]);

  const currentBet = useMemo(() => {
    if (!profile) return null;
    return bets.find((bet) => bet.uid === profile.uid) ?? emptyBet(profile);
  }, [bets, profile]);

  const isAdmin = profile?.role === "admin";
  const currentScopeSubmitted = currentBet ? isScopeSubmitted(currentBet, config.writeScope) : false;
  const canWriteBet = Boolean(
    isAdmin ||
      (config.writeEnabled &&
        config.writeScope !== "closed" &&
        currentBet &&
        !currentScopeSubmitted)
  );
  const currentScore = currentBet ? scoreBet(currentBet, matches, config.actualAwards) : null;
  const filteredMatches = matches.filter((match) => match.round === roundFilter);

  function blocked(message?: string) {
    setToast(message || config.lockedMessage);
    window.setTimeout(() => setToast(""), 2800);
  }

  async function saveBet(next: UserBet) {
    if (!profile) return false;
    if (!canWriteBet) {
      blocked();
      return false;
    }
    const { status: _legacyStatus, submittedAt: _legacySubmittedAt, ...betWithoutLegacySubmission } = next as UserBet & {
      status?: unknown;
      submittedAt?: unknown;
    };
    const normalized = {
      ...betWithoutLegacySubmission,
      uid: profile.uid,
      displayName: profile.displayName,
      updatedAt: nowIso()
    };
    try {
      if (firebase.enabled && firebase.db) {
        await setDoc(doc(firebase.db, "bets", profile.uid), removeUndefinedFields(normalized) as UserBet);
        setBets((current) => [normalized, ...current.filter((bet) => bet.uid !== profile.uid)]);
      } else {
        demoState.bets = [normalized, ...demoState.bets.filter((bet) => bet.uid !== profile.uid)];
        setBets([...demoState.bets]);
      }
      return true;
    } catch (error) {
      console.error(error);
      setToast("No se ha podido guardar el pronostico.");
      window.setTimeout(() => setToast(""), 2800);
      return false;
    }
  }

  async function updateBet(patch: Partial<UserBet>) {
    if (!currentBet) return;
    await saveBet({ ...currentBet, ...patch });
  }

  async function updatePrediction(matchId: string, prediction: MatchPrediction) {
    if (!currentBet) return;
    const match = matches.find((item) => item.id === matchId);
    if (!match) return;
    if (isPredictionLocked(match)) {
      blocked();
      return;
    }
    const availabilityMessage = getMatchAvailabilityMessage(match);
    if (availabilityMessage) {
      setToast(availabilityMessage);
      window.setTimeout(() => setToast(""), 2800);
      return;
    }
    const cleanPrediction = removeUndefinedFields(prediction) as MatchPrediction;
    const hasPredictionValue =
      cleanPrediction.homeScore !== undefined ||
      cleanPrediction.awayScore !== undefined ||
      Boolean(cleanPrediction.winnerTeamId);
    const nextPredictions = { ...currentBet.matchPredictions };
    if (hasPredictionValue) {
      nextPredictions[matchId] = cleanPrediction;
    } else {
      delete nextPredictions[matchId];
    }
    await updateBet({ matchPredictions: nextPredictions });
  }

  async function submitBet() {
    if (!currentBet) return;
    const scopeSubmittedAt = nowIso();
    const saved = await saveBet({
      ...currentBet,
      submittedScopes: {
        ...currentBet.submittedScopes,
        [config.writeScope]: scopeSubmittedAt
      }
    });
    if (saved) {
      setToast("Porra enviada.");
      window.setTimeout(() => setToast(""), 2800);
    }
  }

  async function updateConfig(patch: Partial<AppConfig>) {
    if (!isAdmin) return;
    const next = { ...config, ...patch };
    if (firebase.enabled && firebase.db) {
      await setDoc(doc(firebase.db, "app", "config"), next, { merge: true });
    } else {
      demoState.config = next;
      setConfig(next);
    }
  }

  async function updateOfficialResult(matchId: string, patch: Partial<Match>) {
    if (!isAdmin) return;
    try {
      if (firebase.enabled && firebase.db) {
        await updateDoc(doc(firebase.db, "matches", matchId), toFirestorePatch(patch));
      } else {
        demoState.matches = demoState.matches.map((match) => (match.id === matchId ? { ...match, ...patch } : match));
        setMatches([...demoState.matches]);
      }
    } catch (error) {
      console.error(error);
      setToast("No se ha podido actualizar el resultado oficial.");
      window.setTimeout(() => setToast(""), 2800);
    }
  }

  async function handleSignOut() {
    if (firebase.enabled && firebase.auth) {
      await signOut(firebase.auth);
    } else {
      setProfile(null);
    }
  }

  if (!profile || !currentBet) {
    if (bootstrapError) {
      return (
        <main className="login-shell">
          <section className="login-card">
            <div className="brand-mark">
              <CircleAlert size={28} />
            </div>
            <h1>Error de Firestore</h1>
            <p>No se ha podido crear o leer el perfil del usuario.</p>
            <div className="notice">
              <CircleAlert size={18} />
              <span>{bootstrapError}</span>
            </div>
            <button className="secondary-btn" onClick={handleSignOut}>
              <LogOut size={17} />
              Salir
            </button>
          </section>
        </main>
      );
    }
    if (!firebase.enabled) {
      return <AppShell profile={demoProfile} onEnterDemo={() => setProfile(demoProfile)} />;
    }
    return <LoginView />;
  }

  return (
    <main className="app-shell">
      {toast && (
        <div className="toast">
          <Lock size={18} />
          {toast}
        </div>
      )}

      <section className="hero-panel">
        <div>
          <span className="eyebrow">Mundial 2026</span>
          <h1>Hola {profile.displayName}, tienes {currentScore?.total ?? 0} puntos.</h1>
          <p>
            Escritura {config.writeEnabled ? "abierta" : "cerrada"} · {writeScopeLabels[config.writeScope]} ·{" "}
            {currentScopeSubmitted ? "enviado" : "borrador"}
          </p>
        </div>
        <div className="hero-actions">
          <button className="secondary-btn" onClick={handleSignOut}>
            <LogOut size={17} />
            Salir
          </button>
          <button className="primary-btn" onClick={submitBet} disabled={!canWriteBet}>
            <Save size={17} />
            Enviar porra
          </button>
        </div>
      </section>

      <section className="stats-row">
        <div>
          <strong>{currentScore?.exactHits ?? 0}</strong>
          <span>exactos</span>
        </div>
        <div>
          <strong>{currentScore?.winnerHits ?? 0}</strong>
          <span>ganadores</span>
        </div>
        <div>
          <strong>{roundLabels[config.activeRound]}</strong>
          <span>ronda</span>
        </div>
        <div>
          <strong>{bets.length}</strong>
          <span>jugadores</span>
        </div>
      </section>

      {isAdmin && (
        <nav className="admin-view-tabs" aria-label="Vistas de administracion">
          <button className={adminView === "main" ? "active" : ""} onClick={() => setAdminView("main")}>
            <Settings size={16} />
            Principal
          </button>
          <button className={adminView === "summary" ? "active" : ""} onClick={() => setAdminView("summary")}>
            <BarChart3 size={16} />
            Resumen
          </button>
        </nav>
      )}

      {isAdmin && adminView === "summary" ? (
        <AdminSummaryPage bets={bets} matches={matches} />
      ) : (
        <section className="dashboard-grid">
        <section className="bento-card match-panel">
          <div className="section-title">
            <Trophy size={19} />
            <h2>Partidos</h2>
          </div>
          <div className="round-tabs">
            {(Object.keys(roundLabels) as Round[]).map((round) => (
              <button key={round} className={roundFilter === round ? "active" : ""} onClick={() => setRoundFilter(round)}>
                {roundLabels[round]}
              </button>
            ))}
          </div>
          <div className="matches-grid">
            {filteredMatches.map((match) => (
              <MatchCard
                key={match.id}
                match={match}
                bet={currentBet}
                canWrite={canWriteBet}
                isAdmin={Boolean(isAdmin)}
                onPrediction={updatePrediction}
                onOfficialResult={updateOfficialResult}
                onBlocked={blocked}
              />
            ))}
          </div>
        </section>

        <Leaderboard bets={bets} matches={matches} config={config} />
        <AwardsPanel
          bet={currentBet}
          config={config}
          canWrite={canWriteBet}
          isAdmin={Boolean(isAdmin)}
          onBet={updateBet}
          onConfig={updateConfig}
          onBlocked={blocked}
        />
        <QualifiedPanel matches={matches} />
        {isAdmin && <AdminPanel config={config} onConfig={updateConfig} />}

        <section className="bento-card rules-panel">
          <div className="section-title">
            <CircleAlert size={19} />
            <h2>Reglas</h2>
          </div>
          <div className="rules-list">
            <span>Grupos: ganador 1, exacto 3</span>
            <span>Dieciseisavos: ganador 3, exacto 5</span>
            <span>Octavos: ganador 5, exacto 7</span>
            <span>Cuartos: ganador 7, exacto 9</span>
            <span>Semis: ganador 10, exacto 12</span>
            <span>Final: ganador 12, exacto 15</span>
            <span>Campeon, MVP y goleador: 15 cada uno</span>
          </div>
        </section>
        </section>
      )}
    </main>
  );
}

function AppShell({ profile, onEnterDemo }: { profile: UserProfile; onEnterDemo: () => void }) {
  return (
    <main className="login-shell">
      <section className="login-card">
        <div className="brand-mark">
          <Trophy size={28} />
        </div>
        <h1>Porra Mundial 2026</h1>
        <p>Modo demo local hasta que configures Firebase.</p>
        <button className="primary-btn" onClick={onEnterDemo}>
          <LogIn size={18} />
          Entrar como {profile.displayName}
        </button>
      </section>
    </main>
  );
}

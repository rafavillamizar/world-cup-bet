import { useEffect, useMemo, useState } from "react";
import {
  Award,
  Check,
  ChevronDown,
  CircleAlert,
  Lock,
  LogIn,
  LogOut,
  Save,
  Settings,
  Shield,
  Sparkles,
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
import { compareScoreboards, scoreBet, scoreMatch } from "./lib/scoring";
import type {
  AppConfig,
  Match,
  MatchPrediction,
  Restructure,
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

const restructureCosts: Record<Restructure["phase"], number> = {
  round32: 4,
  round16: 6,
  quarter: 8
};

const writeScopeLabels: Record<WriteScope, string> = {
  initial: "Predicciones iniciales",
  round32: "Reestructuracion dieciseisavos",
  round16: "Reestructuracion octavos",
  quarter: "Reestructuracion cuartos",
  closed: "Cerrado"
};

function nowIso() {
  return new Date().toISOString();
}

function emptyBet(profile: UserProfile): UserBet {
  return {
    uid: profile.uid,
    displayName: profile.displayName,
    status: "draft",
    matchPredictions: {},
    advancement: {},
    awards: {},
    restructures: [],
    updatedAt: nowIso()
  };
}

function getTeam(teamId?: string) {
  return teams.find((team) => team.id === teamId);
}

function toNumber(value: string) {
  if (value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
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
        <p>Predicciones, reestructuraciones y puntuacion en tiempo real.</p>

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

function ScoreInputs({
  prediction,
  disabled,
  onChange
}: {
  prediction?: MatchPrediction;
  disabled: boolean;
  onChange: (prediction: MatchPrediction) => void;
}) {
  return (
    <div className="score-inputs">
      <input
        aria-label="Goles local"
        disabled={disabled}
        min={0}
        type="number"
        value={prediction?.homeScore ?? ""}
        onChange={(event) => onChange({ ...prediction, homeScore: toNumber(event.target.value), updatedAt: nowIso() })}
      />
      <span>:</span>
      <input
        aria-label="Goles visitante"
        disabled={disabled}
        min={0}
        type="number"
        value={prediction?.awayScore ?? ""}
        onChange={(event) => onChange({ ...prediction, awayScore: toNumber(event.target.value), updatedAt: nowIso() })}
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
  onBlocked: () => void;
}) {
  const prediction = bet.matchPredictions[match.id];
  const result = scoreMatch(match, prediction);
  const predictionLocked = Boolean(match.predictionsLocked);
  const disabled = !canWrite || predictionLocked;
  const homeWinnerValue = match.homeTeamId ?? "home";
  const awayWinnerValue = match.awayTeamId ?? "away";

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

      <div className="score-shell" onClick={() => disabled && onBlocked()}>
        <ScoreInputs
          prediction={prediction}
          disabled={disabled}
          onChange={(next) => onPrediction(match.id, next)}
        />
      </div>

      {predictionLocked && <p className="locked-copy">Pronostico cerrado: partido previo al inicio de la porra.</p>}

      {match.round !== "group" && (
        <label className="winner-select">
          Ganador tras 120 min/penaltis
          <select
            disabled={disabled}
            value={prediction?.winnerTeamId ?? ""}
            onChange={(event) => onPrediction(match.id, { ...prediction, winnerTeamId: event.target.value })}
          >
            <option value="">Selecciona</option>
            <option value={homeWinnerValue}>{getTeam(match.homeTeamId)?.name ?? match.homeSlot ?? "Local"}</option>
            <option value={awayWinnerValue}>{getTeam(match.awayTeamId)?.name ?? match.awaySlot ?? "Visitante"}</option>
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
            onChange={(next) =>
              onOfficialResult(match.id, {
                actualHomeScore: next.homeScore,
                actualAwayScore: next.awayScore,
                status: next.homeScore === undefined || next.awayScore === undefined ? "scheduled" : "completed"
              })
            }
          />
          <select
            value={match.winnerTeamId ?? ""}
            onChange={(event) => onOfficialResult(match.id, { winnerTeamId: event.target.value || undefined })}
          >
            <option value="">Empate / no definido</option>
            <option value={homeWinnerValue}>{getTeam(match.homeTeamId)?.name ?? "Local"}</option>
            <option value={awayWinnerValue}>{getTeam(match.awayTeamId)?.name ?? "Visitante"}</option>
          </select>
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
  onBlocked: () => void;
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

function AdvancementPanel({
  bet,
  canWrite,
  onBet,
  onBlocked
}: {
  bet: UserBet;
  canWrite: boolean;
  onBet: (patch: Partial<UserBet>) => void;
  onBlocked: () => void;
}) {
  function toggle(round: Round, teamId: string, limit: number) {
    if (!canWrite) {
      onBlocked();
      return;
    }
    const current = bet.advancement[round] ?? [];
    const next = current.includes(teamId)
      ? current.filter((id) => id !== teamId)
      : current.length < limit
        ? [...current, teamId]
        : current;
    onBet({ advancement: { ...bet.advancement, [round]: next } });
  }

  return (
    <section className="bento-card advancement-panel">
      <div className="section-title">
        <Users size={19} />
        <h2>Clasificados</h2>
      </div>
      <div className="round-grid">
        {selectableRounds.map(({ round, limit }) => (
          <details key={round}>
            <summary>
              {roundLabels[round]}
              <span>
                {(bet.advancement[round] ?? []).length}/{limit}
              </span>
            </summary>
            <div className="team-chip-grid">
              {teams.map((team) => {
                const selected = (bet.advancement[round] ?? []).includes(team.id);
                return (
                  <button
                    key={`${round}-${team.id}`}
                    className={selected ? "team-chip selected" : "team-chip"}
                    onClick={() => toggle(round, team.id, limit)}
                  >
                    {selected && <Check size={14} />}
                    {team.shortName}
                  </button>
                );
              })}
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}

function RestructurePanel({
  bet,
  config,
  canWrite,
  onBet,
  onBlocked
}: {
  bet: UserBet;
  config: AppConfig;
  canWrite: boolean;
  onBet: (patch: Partial<UserBet>) => void;
  onBlocked: () => void;
}) {
  const [phase, setPhase] = useState<Restructure["phase"]>("round32");
  const [teamOutId, setTeamOutId] = useState("");
  const [teamInId, setTeamInId] = useState("");

  function addRestructure() {
    if (!canWrite) {
      onBlocked();
      return;
    }
    if (!teamOutId || !teamInId) return;
    const item: Restructure = {
      id: crypto.randomUUID(),
      phase,
      teamOutId,
      teamInId,
      cost: restructureCosts[phase],
      createdAt: nowIso()
    };
    onBet({ restructures: [...bet.restructures, item] });
    setTeamOutId("");
    setTeamInId("");
  }

  return (
    <section className="bento-card restructure-panel">
      <div className="section-title">
        <Sparkles size={19} />
        <h2>Reestructuracion</h2>
      </div>
      <p>Disponible hasta cuartos si el administrador abre escritura. Ventana actual: {writeScopeLabels[config.writeScope]}.</p>
      <div className="restructure-form">
        <select value={phase} onChange={(event) => setPhase(event.target.value as Restructure["phase"])}>
          <option value="round32">Dieciseisavos (-4)</option>
          <option value="round16">Octavos (-6)</option>
          <option value="quarter">Cuartos (-8)</option>
        </select>
        <select value={teamOutId} onChange={(event) => setTeamOutId(event.target.value)}>
          <option value="">Sale</option>
          {teams.map((team) => (
            <option key={team.id} value={team.id}>
              {team.name}
            </option>
          ))}
        </select>
        <select value={teamInId} onChange={(event) => setTeamInId(event.target.value)}>
          <option value="">Entra</option>
          {teams.map((team) => (
            <option key={team.id} value={team.id}>
              {team.name}
            </option>
          ))}
        </select>
        <button onClick={addRestructure}>
          <Save size={16} />
          Aplicar
        </button>
      </div>
      <div className="restructure-list">
        {bet.restructures.map((item) => (
          <div key={item.id}>
            <span>{roundLabels[item.phase]}</span>
            <strong>
              {getTeam(item.teamOutId)?.shortName} {"->"} {getTeam(item.teamInId)?.shortName}
            </strong>
            <em>-{item.cost}</em>
          </div>
        ))}
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
          <option value="round32">Reestructuracion dieciseisavos</option>
          <option value="round16">Reestructuracion octavos</option>
          <option value="quarter">Reestructuracion cuartos</option>
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

export default function App() {
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
  const canWriteBet = Boolean(
    isAdmin ||
      (config.writeEnabled &&
        config.writeScope !== "closed" &&
        currentBet &&
        (currentBet.status !== "submitted" || config.writeScope !== "initial"))
  );
  const currentScore = currentBet ? scoreBet(currentBet, matches, config.actualAwards) : null;
  const filteredMatches = matches.filter((match) => match.round === roundFilter);

  function blocked() {
    setToast(config.lockedMessage);
    window.setTimeout(() => setToast(""), 2800);
  }

  async function saveBet(next: UserBet) {
    if (!profile) return;
    if (!canWriteBet) {
      blocked();
      return;
    }
    const normalized = { ...next, uid: profile.uid, displayName: profile.displayName, updatedAt: nowIso() };
    if (firebase.enabled && firebase.db) {
      await setDoc(doc(firebase.db, "bets", profile.uid), normalized, { merge: true });
    } else {
      demoState.bets = [normalized, ...demoState.bets.filter((bet) => bet.uid !== profile.uid)];
      setBets([...demoState.bets]);
    }
  }

  async function updateBet(patch: Partial<UserBet>) {
    if (!currentBet) return;
    await saveBet({ ...currentBet, ...patch });
  }

  async function updatePrediction(matchId: string, prediction: MatchPrediction) {
    if (!currentBet) return;
    if (matches.find((match) => match.id === matchId)?.predictionsLocked) {
      blocked();
      return;
    }
    await updateBet({ matchPredictions: { ...currentBet.matchPredictions, [matchId]: prediction } });
  }

  async function submitBet() {
    if (!currentBet) return;
    await saveBet({ ...currentBet, status: "submitted", submittedAt: nowIso() });
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
    if (firebase.enabled && firebase.db) {
      await updateDoc(doc(firebase.db, "matches", matchId), patch);
    } else {
      demoState.matches = demoState.matches.map((match) => (match.id === matchId ? { ...match, ...patch } : match));
      setMatches([...demoState.matches]);
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
            {currentBet.status === "submitted" ? "enviado" : "borrador"}
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
          <strong>-{currentScore?.restructureCost ?? 0}</strong>
          <span>coste</span>
        </div>
        <div>
          <strong>{bets.length}</strong>
          <span>jugadores</span>
        </div>
      </section>

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
        <AdvancementPanel bet={currentBet} canWrite={canWriteBet} onBet={updateBet} onBlocked={blocked} />
        <RestructurePanel bet={currentBet} config={config} canWrite={canWriteBet} onBet={updateBet} onBlocked={blocked} />
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

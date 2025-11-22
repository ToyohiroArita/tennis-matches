"use client";

import { useEffect, useState } from "react";

type Gender = "M" | "F";

type Team = [string, string];
type CourtMatch = {
  court: number;
  team1: string[];
  team2?: string[];
};
type RoundView = {
  roundIndex: number;
  courts: CourtMatch[];
  restingPlayers: string[];
  score?: number;
};

type PlayerSettings = {
  level: number;
  gender: Gender;
};

type Player = {
  name: string;
  level: number;
  gender: Gender;
};

type PriorityMode = "none" | "level" | "gender";

const MEMBER_DATABASE: string[] = [
  "Aさん",
  "Bさん",
  "Cさん",
  "Dさん",
  "Eさん",
  "Fさん",
  "Gさん",
  "Hさん",
  "Iさん",
  "Jさん",
  "Kさん",
  "Lさん",
];

const INITIAL_PARTICIPANTS: string[] = [
  "Aさん",
  "Bさん",
  "Cさん",
  "Dさん",
  "Eさん",
  "Fさん",
  "Gさん",
  "Hさん",
];

const DEFAULT_SETTINGS: PlayerSettings = {
  level: 4,
  gender: "M",
};

const STORAGE_KEY = "tennis-matches-state-v1";

type StoredState = {
  participants: string[];
  playerSettings: Record<string, PlayerSettings>;
  fixedPairs: Team[];
  forbiddenPairs: Team[];
  courtCount: number;
  matchCount: number;
  priorityMode: PriorityMode;
};

function shuffleArray<T>(array: T[]): T[] {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function pairKey(a: string, b: string): string {
  const [x, y] = [a, b].sort();
  return `${x}::${y}`;
}

function matchupKey(team1: Team, team2: Team): string {
  const names = [...team1, ...team2].sort();
  return names.join("::");
}

// 1試合分のペアを作る（前試合ペア・禁止ペア・優先モードを考慮）
function findRoundPairing(
  players: Player[],
  prevPairsSet: Set<string> | null,
  forbiddenPairs: Team[],
  priorityMode: PriorityMode
): { teams: Team[]; resting: string[] } | null {
  // ★ 渡された順序（sortedPlayers）をそのまま使う
  const order = [...players];

  const forbiddenSet = new Set(forbiddenPairs.map(([a, b]) => pairKey(a, b)));

  const used = new Set<string>();
  const teams: Team[] = [];

  function backtrack(): boolean {
    const remaining = order.filter((p) => !used.has(p.name));
    if (remaining.length <= 1) {
      return true; // 0〜1人残りは休憩
    }

    const p1 = remaining[0];
    let candidates: Player[] = remaining.slice(1);

    if (priorityMode === "level") {
      candidates.sort(
        (a, b) => Math.abs(a.level - p1.level) - Math.abs(b.level - p1.level)
      );
    } else if (priorityMode === "gender") {
      const genderScore = (p: Player) => (p.gender === p1.gender ? 1 : 0); // 0: 異性, 1: 同性
      candidates.sort((a, b) => {
        const gDiff = genderScore(a) - genderScore(b);
        if (gDiff !== 0) return gDiff; // 異性優先
        const da = Math.abs(a.level - p1.level);
        const db = Math.abs(b.level - p1.level);
        return da - db; // 次にレベル差
      });
    }

    for (const p2 of candidates) {
      const key = pairKey(p1.name, p2.name);
      if (forbiddenSet.has(key)) continue;
      if (prevPairsSet && prevPairsSet.has(key)) continue; // 直前と同じペアは禁止

      used.add(p1.name);
      used.add(p2.name);
      teams.push([p1.name, p2.name]);

      if (backtrack()) return true;

      teams.pop();
      used.delete(p1.name);
      used.delete(p2.name);
    }

    return false;
  }

  const ok = backtrack();
  if (!ok) return null;

  const resting = order.filter((p) => !used.has(p.name)).map((p) => p.name);
  return { teams, resting };
}

// 1ラウンド分をスコアリング（スコアが小さいほど「良い」）
function scoreCandidateRound(
  courts: CourtMatch[],
  roundIndex: number,
  gamesCount: Record<string, number>,
  lastPlayedRound: Record<string, number>,
  levelMap: Record<string, number>,
  pastMatchupLastRound: Map<string, number>,
  pastMatchupCount: Map<string, number>,
  fixedPairs: Team[]
): number {
  let score = 0;

  const playedThisRound = new Set<string>();
  for (const court of courts) {
    court.team1.forEach((name) => playedThisRound.add(name));
    court.team2?.forEach((name) => playedThisRound.add(name));
  }

  // ① 連続出場ペナルティ
  for (const name of playedThisRound) {
    if ((lastPlayedRound[name] ?? -1) === roundIndex - 1) {
      score += 3;
    }
  }

  // このラウンドのチームIDマップ（固定ペア評価用）
  const teamIdByPlayer: Record<string, string> = {};
  for (const court of courts) {
    const t1id = `R${roundIndex}-C${court.court}-T1`;
    const t2id = `R${roundIndex}-C${court.court}-T2`;
    court.team1.forEach((name) => {
      teamIdByPlayer[name] = t1id;
    });
    court.team2?.forEach((name) => {
      teamIdByPlayer[name] = t2id;
    });
  }

  // ② 固定ペア（ソフト制約）
  for (const [a, b] of fixedPairs) {
    const aIn = playedThisRound.has(a);
    const bIn = playedThisRound.has(b);
    if (aIn && bIn) {
      const ta = teamIdByPlayer[a];
      const tb = teamIdByPlayer[b];
      if (ta && tb) {
        if (ta === tb) {
          // 同じチームで出たらちょっとご褒美
          score -= 5;
        } else {
          // 同じラウンドで別チームならペナルティ
          score += 20;
        }
      }
    }
  }

  // ③ 同じ4人カードの再登場ペナルティ
  //
  //   1日のプレーで1人2試合程度が前提なので、
  //   「同じ4人での再戦」はほぼ最後の手段にしたい。
  //   → 初回（prevCount=0）はOK
  //   → 2回目以降は、他のどの要素よりも重いペナルティを付ける。
  for (const court of courts) {
    if (!court.team2) continue;

    const key = matchupKey(court.team1 as Team, court.team2 as Team);
    const prevCount = pastMatchupCount.get(key) ?? 0;
    const lastRound = pastMatchupLastRound.get(key);

    if (prevCount > 0) {
      let penalty = 0;

      // ベースをかなり大きくする：
      //  prevCount=1（2回目）で 100,000点
      //  prevCount=2（3回目）で 400,000点…
      const BASE_SAME4 = 100_000;
      penalty += BASE_SAME4 * (prevCount * prevCount);

      if (lastRound !== undefined) {
        const gap = roundIndex - lastRound;
        // 近い間隔での再戦はさらに上乗せ（gap が小さいほど大きい）
        // 例）gap=1 → 20,000点, gap=3 → 8,000点, gap>=10 → 0
        const closePenalty = Math.max(0, 20_000 - gap * 2_000);
        penalty += closePenalty;
      }

      score += penalty;
    }
  }

  // ④ レベル差ペナルティ（差2から発動）
  for (const court of courts) {
    if (!court.team2) continue;
    const sum1 = court.team1.reduce(
      (acc, name) => acc + (levelMap[name] ?? 4),
      0
    );
    const sum2 = court.team2.reduce(
      (acc, name) => acc + (levelMap[name] ?? 4),
      0
    );
    const diff = Math.abs(sum1 - sum2);

    if (diff >= 2) {
      const over = diff - 1; // diff=2 → over=1（軽め）、diff=3 → over=2（かなり重い）
      score += over * over * 10;
    }
  }

  // ⑤ 出場回数の偏り ＋ ブロック制（割り切れるときだけ強く効かせる）

  // この案を採用した場合の仮 gamesCount
  const tmpGames: Record<string, number> = { ...gamesCount };
  for (const name of playedThisRound) {
    tmpGames[name] = (tmpGames[name] ?? 0) + 1;
  }

  const allNames = Object.keys(levelMap); // 参加者全員（levelMapに載っている人）
  if (allNames.length === 0) {
    return score;
  }

  // ⑤-1 出場回数の差（min/max の差に強めのペナルティ）
  let minGames = Infinity;
  let maxGames = -Infinity;
  for (const name of allNames) {
    const g = tmpGames[name] ?? 0;
    if (g < minGames) minGames = g;
    if (g > maxGames) maxGames = g;
  }
  if (minGames !== Infinity && maxGames !== -Infinity) {
    const diffGames = maxGames - minGames;
    score += diffGames * 25;
  }

  // ⑤-2 ブロック制：
  //   blockRounds = （総人数） / （1ラウンドで出場できる人数）が整数のときだけ適用
  //
  //   例）12人・1面 → 1ラウンド4人 → 12/4=3 → blockRounds=3
  //        → 1〜3試合目が第1ブロック、4〜6試合目が第2ブロック
  //
  //   各ブロックの最終ラウンドで、
  //   「そのブロックまでに全員が最低 blockIndex+1 回 出ていること」を強く意識する。
  const totalPlayers = allNames.length;

  // このラウンドで実際にコートに立っている人数（1面なら常に4人）
  const playersThisRound = playedThisRound.size;

  if (playersThisRound > 0 && totalPlayers % playersThisRound === 0) {
    const blockRounds = totalPlayers / playersThisRound; // きれいに割り切れたとき

    if (Number.isInteger(blockRounds) && blockRounds > 0) {
      // このラウンドが第何ブロック目か（0始まり）
      const blockIndex = Math.floor(roundIndex / blockRounds);
      // ブロック内での位置（0,1,2,...）
      const posInBlock = roundIndex % blockRounds;

      // ブロックの最終ラウンドだけ、強く「全員が最低 blockIndex+1 回」を意識する
      if (posInBlock === blockRounds - 1) {
        const requiredMin = blockIndex + 1; // 第1ブロック末:1回以上, 第2ブロック末:2回以上…

        let missingSum = 0;
        for (const name of allNames) {
          const g = tmpGames[name] ?? 0;
          if (g < requiredMin) {
            // 必要回数に届いていない分だけカウント
            missingSum += requiredMin - g;
          }
        }

        if (missingSum > 0) {
          // ここはかなり重くして、「ブロック内で誰かが0回のまま」がほぼ起きないようにする
          score += missingSum * 5000;
        }
      }
    }
  }

  return score;
}

// 複数ラウンド生成
function generateRounds(
  players: Player[],
  courtCount: number,
  matchCount: number,
  fixedPairs: Team[],
  forbiddenPairs: Team[],
  priorityMode: PriorityMode
): RoundView[] | null {
  const rounds: RoundView[] = [];

  const gamesCount: Record<string, number> = {};
  const lastPlayedRound: Record<string, number> = {};
  const levelMap: Record<string, number> = {};
  for (const p of players) {
    gamesCount[p.name] = 0;
    lastPlayedRound[p.name] = -1;
    levelMap[p.name] = p.level;
  }

  let prevPairsSet: Set<string> | null = null;

  // 同じ4人カードの履歴（matchupKey = team1+team2 の4人）
  const pastMatchupLastRound = new Map<string, number>();
  const pastMatchupCount = new Map<string, number>();

  for (let roundIndex = 0; roundIndex < matchCount; roundIndex++) {
    let bestScore = Infinity;
    let bestCourts: CourtMatch[] | null = null;
    let bestResting: string[] = [];
    let bestTeamsForPrevPairs: Team[] | null = null;

    for (let attempt = 0; attempt < 60; attempt++) {
      // 出場回数が少ない人・最近出ていない人から優先的に並べる
      const sortedPlayers = [...players].sort((a, b) => {
        const ga = gamesCount[a.name] ?? 0;
        const gb = gamesCount[b.name] ?? 0;
        if (ga !== gb) return ga - gb;

        const la = lastPlayedRound[a.name] ?? -1;
        const lb = lastPlayedRound[b.name] ?? -1;
        if (la !== lb) return la - lb;

        return Math.random() - 0.5;
      });

      const pairing = findRoundPairing(
        sortedPlayers,
        prevPairsSet,
        forbiddenPairs,
        priorityMode
      );
      if (!pairing) continue;

      const teams = pairing.teams;
      const restingPlayers = [...pairing.resting];

      const courts: CourtMatch[] = [];
      const teamsForCourt = [...teams];

      let courtNo = 1;
      while (courtNo <= courtCount && teamsForCourt.length >= 2) {
        const team1 = teamsForCourt.shift()!;
        const team2 = teamsForCourt.shift()!;
        courts.push({ court: courtNo, team1, team2 });
        courtNo++;
      }
      teamsForCourt.forEach((team) => {
        restingPlayers.push(...team);
      });

      // ★ 追加：同じ4人セット（team1+team2）の再登場をハード禁止
      let invalidSameFour = false;
      for (const court of courts) {
        if (!court.team2) continue; // 念のため

        // matchupKey は team1+team2 の4人をソートしてキー化する想定
        const key = matchupKey(court.team1 as Team, court.team2 as Team);
        if (pastMatchupCount.has(key)) {
          // この4人セットはすでにどこかのラウンドで登場済み → この候補は捨てる
          invalidSameFour = true;
          break;
        }
      }
      if (invalidSameFour) {
        continue; // 別の attempt を試す
      }
      // ★ ここまでフィルター

      const score = scoreCandidateRound(
        courts,
        roundIndex,
        gamesCount,
        lastPlayedRound,
        levelMap,
        pastMatchupLastRound,
        pastMatchupCount,
        fixedPairs
      );

      if (score < bestScore) {
        bestScore = score;
        bestCourts = courts;
        bestResting = restingPlayers;
        bestTeamsForPrevPairs = teams;
        if (score === 0) break;
      }
    }

    if (!bestCourts || !bestTeamsForPrevPairs) {
      return null;
    }

    const playedThisRound = new Set<string>();
    for (const court of bestCourts) {
      court.team1.forEach((name) => playedThisRound.add(name));
      court.team2?.forEach((name) => playedThisRound.add(name));
    }
    for (const name of playedThisRound) {
      gamesCount[name] = (gamesCount[name] ?? 0) + 1;
      lastPlayedRound[name] = roundIndex;
    }

    const currentPairs: string[] = [];
    for (const court of bestCourts) {
      if (court.team1.length === 2) {
        currentPairs.push(pairKey(court.team1[0], court.team1[1]));
      }
      if (court.team2 && court.team2.length === 2) {
        currentPairs.push(pairKey(court.team2[0], court.team2[1]));
      }
    }
    prevPairsSet = new Set(currentPairs);

    // 同じ4人カードの履歴更新
    for (const court of bestCourts) {
      if (!court.team2) continue;
      const key = matchupKey(court.team1 as Team, court.team2 as Team);
      const prevCount = pastMatchupCount.get(key) ?? 0;
      pastMatchupLastRound.set(key, roundIndex);
      pastMatchupCount.set(key, prevCount + 1);
    }

    rounds.push({
      roundIndex,
      courts: bestCourts,
      restingPlayers: bestResting,
      score: bestScore,
    });
  }

  return rounds;
}

export default function Page() {
  // localStorage 初期値読み込み
  const [participants, setParticipants] = useState<string[]>(() => {
    if (typeof window === "undefined") return INITIAL_PARTICIPANTS;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return INITIAL_PARTICIPANTS;
      const data = JSON.parse(raw) as Partial<StoredState>;
      if (Array.isArray(data.participants) && data.participants.length > 0) {
        return data.participants;
      }
      return INITIAL_PARTICIPANTS;
    } catch {
      return INITIAL_PARTICIPANTS;
    }
  });

  const [playerSettings, setPlayerSettings] = useState<
    Record<string, PlayerSettings>
  >(() => {
    if (typeof window === "undefined") return {};
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return {};
      const data = JSON.parse(raw) as Partial<StoredState>;
      if (data.playerSettings && typeof data.playerSettings === "object") {
        return data.playerSettings;
      }
      return {};
    } catch {
      return {};
    }
  });

  const [fixedPairs, setFixedPairs] = useState<Team[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const data = JSON.parse(raw) as Partial<StoredState>;
      if (Array.isArray(data.fixedPairs)) return data.fixedPairs as Team[];
      return [];
    } catch {
      return [];
    }
  });

  const [forbiddenPairs, setForbiddenPairs] = useState<Team[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const data = JSON.parse(raw) as Partial<StoredState>;
      if (Array.isArray(data.forbiddenPairs))
        return data.forbiddenPairs as Team[];
      return [];
    } catch {
      return [];
    }
  });

  const [courtCount, setCourtCount] = useState<number>(() => {
    if (typeof window === "undefined") return 2;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return 2;
      const data = JSON.parse(raw) as Partial<StoredState>;
      if (typeof data.courtCount === "number") return data.courtCount;
      return 2;
    } catch {
      return 2;
    }
  });

  const [matchCount, setMatchCount] = useState<number>(() => {
    if (typeof window === "undefined") return 5;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return 5;
      const data = JSON.parse(raw) as Partial<StoredState>;
      if (typeof data.matchCount === "number") return data.matchCount;
      return 5;
    } catch {
      return 5;
    }
  });

  const [priorityMode, setPriorityMode] = useState<PriorityMode>(() => {
    if (typeof window === "undefined") return "none";
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return "none";
      const data = JSON.parse(raw) as Partial<StoredState>;
      if (
        data.priorityMode === "none" ||
        data.priorityMode === "level" ||
        data.priorityMode === "gender"
      ) {
        return data.priorityMode;
      }
      return "none";
    } catch {
      return "none";
    }
  });

  const [newParticipantName, setNewParticipantName] = useState("");
  const [newParticipantLevel, setNewParticipantLevel] = useState(4);
  const [newParticipantGender, setNewParticipantGender] = useState<Gender>("M");

  const [pairPickerOpen, setPairPickerOpen] = useState<
    null | "fixed" | "forbidden"
  >(null);
  const [pairPickerSelection, setPairPickerSelection] = useState<string[]>([]);

  const [rounds, setRounds] = useState<RoundView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const getSettings = (name: string): PlayerSettings =>
    playerSettings[name] ?? DEFAULT_SETTINGS;

  const updateSettings = (name: string, patch: Partial<PlayerSettings>) => {
    setPlayerSettings((prev) => {
      const current = prev[name] ?? DEFAULT_SETTINGS;
      return {
        ...prev,
        [name]: { ...current, ...patch },
      };
    });
  };

  // 状態が変わるたび localStorage に保存
  useEffect(() => {
    if (typeof window === "undefined") return;
    const data: StoredState = {
      participants,
      playerSettings,
      fixedPairs,
      forbiddenPairs,
      courtCount,
      matchCount,
      priorityMode,
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.error("Failed to save state", e);
    }
  }, [
    participants,
    playerSettings,
    fixedPairs,
    forbiddenPairs,
    courtCount,
    matchCount,
    priorityMode,
  ]);

  const PlayerCard = ({ name }: { name: string }) => {
    const s = getSettings(name);
    const isMale = s.gender === "M";
    const baseClasses =
      "flex flex-col items-center justify-center rounded-lg border px-2 py-1 min-w-[72px]";
    const colorClasses = isMale
      ? "bg-sky-100 border-sky-300"
      : "bg-rose-100 border-rose-300";
    return (
      <div className={`${baseClasses} ${colorClasses}`}>
        <div className="text-[10px] font-semibold text-slate-600">
          Lv{s.level}
        </div>
        <div className="text-[11px] font-medium text-slate-800">{name}</div>
      </div>
    );
  };

  const addParticipant = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setParticipants((prev) =>
      prev.includes(trimmed) ? prev : [...prev, trimmed]
    );
  };

  const removeParticipant = (name: string) => {
    setParticipants((prev) => prev.filter((p) => p !== name));
    setFixedPairs((prev) => prev.filter(([a, b]) => a !== name && b !== name));
    setForbiddenPairs((prev) =>
      prev.filter(([a, b]) => a !== name && b !== name)
    );
  };

  const toggleMemberParticipant = (member: string) => {
    setParticipants((prev) =>
      prev.includes(member)
        ? prev.filter((p) => p !== member)
        : [...prev, member]
    );
    if (participants.includes(member)) {
      setFixedPairs((prev) =>
        prev.filter(([a, b]) => a !== member && b !== member)
      );
      setForbiddenPairs((prev) =>
        prev.filter(([a, b]) => a !== member && b !== member)
      );
    }
  };

  const handleAddNewParticipant = () => {
    const name = newParticipantName.trim();
    if (!name) return;
    addParticipant(name);
    updateSettings(name, {
      level: newParticipantLevel,
      gender: newParticipantGender,
    });
    setNewParticipantName("");
    setNewParticipantLevel(4);
    setNewParticipantGender("M");
  };

  const openPairPicker = (mode: "fixed" | "forbidden") => {
    setPairPickerOpen(mode);
    setPairPickerSelection([]);
  };

  const togglePairSelection = (name: string) => {
    setPairPickerSelection((prev) => {
      if (prev.includes(name)) {
        return prev.filter((n) => n !== name);
      }
      if (prev.length >= 2) return prev;
      return [...prev, name];
    });
  };

  const handleConfirmPair = () => {
    if (!pairPickerOpen || pairPickerSelection.length !== 2) return;
    const sorted = [...pairPickerSelection].sort() as Team;
    if (pairPickerOpen === "fixed") {
      setFixedPairs((prev) =>
        prev.some((p) => p[0] === sorted[0] && p[1] === sorted[1])
          ? prev
          : [...prev, sorted]
      );
    } else {
      setForbiddenPairs((prev) =>
        prev.some((p) => p[0] === sorted[0] && p[1] === sorted[1])
          ? prev
          : [...prev, sorted]
      );
    }
    setPairPickerOpen(null);
    setPairPickerSelection([]);
  };

  const removeFixedPair = (pair: Team) => {
    setFixedPairs((prev) =>
      prev.filter((p) => !(p[0] === pair[0] && p[1] === pair[1]))
    );
  };

  const removeForbiddenPair = (pair: Team) => {
    setForbiddenPairs((prev) =>
      prev.filter((p) => !(p[0] === pair[0] && p[1] === pair[1]))
    );
  };

  const handleGenerate = () => {
    const uniqueNames = Array.from(new Set(participants));

    if (uniqueNames.length < 4) {
      setError("最低でも4人以上の参加者が必要です。");
      setRounds(null);
      return;
    }
    if (courtCount <= 0) {
      setError("コート数は1以上を指定してください。");
      setRounds(null);
      return;
    }

    const players: Player[] = uniqueNames.map((name) => {
      const s = getSettings(name);
      return { name, level: s.level, gender: s.gender };
    });

    const effectiveFixed = fixedPairs.filter(
      ([a, b]) => uniqueNames.includes(a) && uniqueNames.includes(b)
    );
    const effectiveForbidden = forbiddenPairs.filter(
      ([a, b]) => uniqueNames.includes(a) && uniqueNames.includes(b)
    );

    const result = generateRounds(
      players,
      courtCount,
      matchCount,
      effectiveFixed,
      effectiveForbidden,
      priorityMode
    );

    if (!result) {
      setError(
        "条件が厳しすぎて組み合わせを生成できませんでした。\n固定ペア・禁止ペア・優先モード・コート数・試合数などを少し緩めてみてください。"
      );
      setRounds(null);
    } else {
      setError(null);
      setRounds(result);
    }
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-sky-50 via-slate-50 to-emerald-50 px-3 py-6 md:px-6 md:py-10">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 md:flex-row">
        {/* 左パネル */}
        <section className="w-full space-y-4 md:w-[45%]">
          {/* タイトル */}
          <div className="rounded-2xl bg-white/90 p-4 shadow-md ring-1 ring-slate-200 md:p-5">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-sky-600">
                  Awesome Tennis
                </p>
                <h1 className="text-lg font-bold text-slate-900 md:text-xl">
                  テニス対戦表ジェネレーター
                </h1>
                <p className="mt-1 text-xs text-slate-600">
                  サークルメンバーとビジターから参加者を選択し、
                  レベルや性別を考慮したダブルスの組み合わせを自動生成します。
                </p>
              </div>
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-sky-100 text-lg">
                🎾
              </span>
            </div>
            <div className="mt-2 flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-xs">
              <div className="space-x-3">
                <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 font-semibold text-sky-800">
                  参加者 {participants.length} 名
                </span>
                <span className="text-[11px] text-slate-500">
                  コート数 {courtCount}・{matchCount} 試合
                </span>
              </div>
              <span className="text-[11px] text-slate-500">
                メンバーDB: {MEMBER_DATABASE.length} 名
              </span>
            </div>
          </div>

          {/* 参加者設定 */}
          <div className="rounded-2xl bg-white/90 p-4 shadow-md ring-1 ring-slate-200 md:p-5">
            <h2 className="mb-2 text-sm font-semibold text-slate-800">
              参加者の設定
            </h2>

            {/* サークルメンバー一覧 */}
            <div className="mb-3">
              <div className="mb-1 flex items-center justify-between text-[11px] text-slate-600">
                <span>サークルメンバー（チェックすると参加者に登録）</span>
                <span>レベル/性別は右で設定</span>
              </div>
              <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs">
                {MEMBER_DATABASE.map((member) => {
                  const checked = participants.includes(member);
                  const s = getSettings(member);
                  return (
                    <div
                      key={member}
                      className="flex items-center justify-between rounded-md px-1 py-0.5 hover:bg-sky-50"
                    >
                      <label className="flex flex-1 cursor-pointer items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleMemberParticipant(member)}
                          className="h-3.5 w-3.5 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                        />
                        <span>{member}</span>
                      </label>
                      <div className="flex items-center gap-1.5 text-[10px]">
                        <select
                          value={s.level}
                          onChange={(e) =>
                            updateSettings(member, {
                              level: Number(e.target.value) || 4,
                            })
                          }
                          className="rounded border border-slate-300 bg-white px-1 py-0.5"
                        >
                          {Array.from({ length: 8 }, (_, i) => i + 1).map(
                            (lv) => (
                              <option key={lv} value={lv}>
                                Lv{lv}
                              </option>
                            )
                          )}
                        </select>
                        <select
                          value={s.gender}
                          onChange={(e) =>
                            updateSettings(member, {
                              gender: e.target.value as Gender,
                            })
                          }
                          className="rounded border border-slate-300 bg-white px-1 py-0.5"
                        >
                          <option value="M">男</option>
                          <option value="F">女</option>
                        </select>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ビジター追加 */}
            <div className="mb-3">
              <label className="mb-1 block text-xs font-semibold text-slate-700">
                ビジター / 個別追加
                <span className="ml-1 text-[11px] font-normal text-slate-500">
                  ※名前・レベル・性別を設定して参加者に追加
                </span>
              </label>
              <div className="flex flex-col gap-2 md:flex-row md:items-center">
                <input
                  type="text"
                  value={newParticipantName}
                  onChange={(e) => setNewParticipantName(e.target.value)}
                  placeholder="例）ビジターAさん"
                  className="flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-xs md:text-sm shadow-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                />
                <div className="flex items-center gap-2 text-[11px]">
                  <div className="flex items-center gap-1">
                    <span className="text-slate-600">Lv</span>
                    <select
                      value={newParticipantLevel}
                      onChange={(e) =>
                        setNewParticipantLevel(Number(e.target.value) || 4)
                      }
                      className="rounded border border-slate-300 bg-white px-1.5 py-0.5"
                    >
                      {Array.from({ length: 8 }, (_, i) => i + 1).map((lv) => (
                        <option key={lv} value={lv}>
                          {lv}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-slate-600">性別</span>
                    <select
                      value={newParticipantGender}
                      onChange={(e) =>
                        setNewParticipantGender(e.target.value as Gender)
                      }
                      className="rounded border border-slate-300 bg-white px-1.5 py-0.5"
                    >
                      <option value="M">男</option>
                      <option value="F">女</option>
                    </select>
                  </div>
                  <button
                    type="button"
                    onClick={handleAddNewParticipant}
                    className="inline-flex items-center rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-emerald-700 active:bg-emerald-800"
                  >
                    追加
                  </button>
                </div>
              </div>
            </div>

            {/* 現在の参加者 */}
            <div className="mb-3">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-700">
                  現在の参加者
                </span>
                <span className="text-[11px] text-slate-500">
                  バッジをクリックで削除
                </span>
              </div>
              {participants.length === 0 ? (
                <p className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
                  まだ参加者が登録されていません。メンバーにチェックを入れるか、ビジターを追加してください。
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5 rounded-lg bg-slate-50 px-2.5 py-2">
                  {participants.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => removeParticipant(p)}
                      className="group inline-flex items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 text-[11px] text-sky-800 hover:bg-red-100 hover:text-red-700"
                    >
                      <span>{p}</span>
                      <span className="text-[10px] text-sky-500 group-hover:text-red-600">
                        ×
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* 参加者のレベル・性別 */}
            {participants.length > 0 && (
              <div>
                <div className="mb-1 text-xs font-semibold text-slate-700">
                  参加者のレベル・性別
                </div>
                <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-200 bg-white text-[11px]">
                  {participants.map((name) => {
                    const s = getSettings(name);
                    return (
                      <div
                        key={name}
                        className="flex items-center justify-between gap-2 border-b border-slate-100 px-2 py-1 last:border-b-0"
                      >
                        <span className="truncate">{name}</span>
                        <div className="flex items-center gap-1.5">
                          <select
                            value={s.level}
                            onChange={(e) =>
                              updateSettings(name, {
                                level: Number(e.target.value) || 4,
                              })
                            }
                            className="rounded border border-slate-300 bg-white px-1 py-0.5"
                          >
                            {Array.from({ length: 8 }, (_, i) => i + 1).map(
                              (lv) => (
                                <option key={lv} value={lv}>
                                  Lv{lv}
                                </option>
                              )
                            )}
                          </select>
                          <select
                            value={s.gender}
                            onChange={(e) =>
                              updateSettings(name, {
                                gender: e.target.value as Gender,
                              })
                            }
                            className="rounded border border-slate-300 bg-white px-1 py-0.5"
                          >
                            <option value="M">男</option>
                            <option value="F">女</option>
                          </select>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* 条件・制約 */}
          <div className="rounded-2xl bg-white/90 p-4 shadow-md ring-1 ring-slate-200 md:p-5">
            <h2 className="mb-2 text-sm font-semibold text-slate-800">
              試合条件・制約
            </h2>

            {/* 優先モード */}
            <div className="mb-3">
              <div className="text-xs font-semibold text-slate-700">
                組み合わせの優先項目
              </div>
              <div className="mt-1 flex flex-wrap gap-3 text-[11px] text-slate-700">
                <label className="inline-flex items-center gap-1.5">
                  <input
                    type="radio"
                    name="priorityMode"
                    value="none"
                    checked={priorityMode === "none"}
                    onChange={() => setPriorityMode("none")}
                    className="h-3 w-3 text-sky-600 focus:ring-sky-500"
                  />
                  バランス考慮なし
                </label>
                <label className="inline-flex items-center gap-1.5">
                  <input
                    type="radio"
                    name="priorityMode"
                    value="level"
                    checked={priorityMode === "level"}
                    onChange={() => setPriorityMode("level")}
                    className="h-3 w-3 text-sky-600 focus:ring-sky-500"
                  />
                  レベル優先
                </label>
                <label className="inline-flex items-center gap-1.5">
                  <input
                    type="radio"
                    name="priorityMode"
                    value="gender"
                    checked={priorityMode === "gender"}
                    onChange={() => setPriorityMode("gender")}
                    className="h-3 w-3 text-sky-600 focus:ring-sky-500"
                  />
                  性別優先
                </label>
              </div>
              <p className="mt-1 text-[11px] text-slate-500">
                レベル優先：性別は無視してペアのレベル差が小さくなるように組みます。
                <br />
                性別優先：可能なら男女ペアを優先し、その中でレベル差を小さくします。
              </p>
            </div>

            <div className="mb-3 grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  コート数
                </label>
                <input
                  type="number"
                  min={1}
                  value={courtCount}
                  onChange={(e) =>
                    setCourtCount(Math.max(1, Number(e.target.value) || 1))
                  }
                  className="block w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm shadow-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  試合数（ラウンド数）
                </label>
                <select
                  value={matchCount}
                  onChange={(e) => setMatchCount(Number(e.target.value))}
                  className="block w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm shadow-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                >
                  {[5, 10, 15, 20].map((n) => (
                    <option key={n} value={n}>
                      {n} 試合分
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* 固定ペア・禁止ペア */}
            <div className="mb-3 grid gap-3 md:grid-cols-2">
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-700">
                    固定ペア
                  </span>
                  <button
                    type="button"
                    onClick={() => openPairPicker("fixed")}
                    className="text-[11px] font-semibold text-sky-700 hover:text-sky-800"
                  >
                    ＋ ペアを追加
                  </button>
                </div>
                {fixedPairs.length === 0 ? (
                  <p className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
                    特に固定したいペアがなければ空のままでOKです。
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-1.5 rounded-lg bg-slate-50 px-2.5 py-2">
                    {fixedPairs.map((pair) => (
                      <button
                        key={pair.join("::")}
                        type="button"
                        onClick={() => removeFixedPair(pair)}
                        className="group inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] text-emerald-800 hover:bg-red-100 hover:text-red-700"
                      >
                        <span>
                          {pair[0]} &amp; {pair[1]}
                        </span>
                        <span className="text-[10px] text-emerald-600 group-hover:text-red-600">
                          ×
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-700">
                    禁止ペア
                  </span>
                  <button
                    type="button"
                    onClick={() => openPairPicker("forbidden")}
                    className="text-[11px] font-semibold text-sky-700 hover:text-sky-800"
                  >
                    ＋ ペアを追加
                  </button>
                </div>
                {forbiddenPairs.length === 0 ? (
                  <p className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
                    一緒に組ませたくないペアがあれば追加してください。
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-1.5 rounded-lg bg-slate-50 px-2.5 py-2">
                    {forbiddenPairs.map((pair) => (
                      <button
                        key={pair.join("::")}
                        type="button"
                        onClick={() => removeForbiddenPair(pair)}
                        className="group inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] text-amber-800 hover:bg-red-100 hover:text-red-700"
                      >
                        <span>
                          {pair[0]} &amp; {pair[1]}
                        </span>
                        <span className="text-[10px] text-amber-600 group-hover:text-red-600">
                          ×
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={handleGenerate}
              className="mt-1 inline-flex w-full items-center justify-center rounded-full bg-sky-600 px-4 py-2 text-sm font-semibold text-white shadow-md shadow-sky-500/30 transition hover:bg-sky-700 active:bg-sky-800"
            >
              組み合わせを生成する
            </button>

            {error && (
              <p className="mt-2 whitespace-pre-wrap rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">
                {error}
              </p>
            )}
          </div>
        </section>

        {/* 右パネル：結果 */}
        <section className="w-full rounded-2xl bg-white/95 p-4 shadow-md ring-1 ring-slate-200 md:w-[55%] md:p-6">
          <div className="mb-4 flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800 md:text-base">
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-emerald-100 text-xs">
                ✓
              </span>
              組み合わせ結果
            </h2>
            <p className="text-[11px] text-slate-500">
              優先設定・固定/禁止ペア・出場回数・レベル差などを考慮してスコアが小さい案を選んでいます。
            </p>
          </div>

          {!rounds && (
            <div className="flex h-full min-h-[220px] items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50/60 px-4 text-center">
              <p className="text-xs text-slate-500 md:text-sm">
                左側で参加者や条件を設定し、「組み合わせを生成する」を押すと、
                <br className="hidden md:block" />
                ここに対戦表が表示されます。
              </p>
            </div>
          )}

          {rounds && (
            <div className="flex flex-col gap-3 md:gap-4">
              {rounds.map((round) => (
                <div
                  key={round.roundIndex}
                  className="rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-3 md:px-4 md:py-3.5"
                >
                  <div className="mb-2 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-semibold text-sky-700">
                        第 {round.roundIndex + 1} 試合
                      </span>
                    </div>
                    <div className="flex flex-col items-end leading-tight">
                      <span className="text-[11px] text-slate-500">
                        コート数: {round.courts.length}
                      </span>
                      {typeof round.score === "number" && (
                        <span className="text-[10px] text-slate-400">
                          スコア: {round.score}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    {round.courts.map((court) => (
                      <div
                        key={court.court}
                        className="rounded-lg border border-sky-100 bg-sky-50 px-2.5 py-2 text-xs md:text-sm"
                      >
                        <div className="mb-0.5 text-[11px] font-semibold text-sky-900">
                          コート {court.court}
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-slate-800">
                          <div className="flex gap-1.5">
                            <PlayerCard name={court.team1[0]} />
                            <PlayerCard name={court.team1[1]} />
                          </div>
                          {court.team2 && (
                            <>
                              <span className="text-[10px] text-slate-400">
                                vs
                              </span>
                              <div className="flex gap-1.5">
                                <PlayerCard name={court.team2[0]} />
                                <PlayerCard name={court.team2[1]} />
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  {round.restingPlayers.length > 0 && (
                    <div className="mt-2 flex flex-wrap items-center gap-1 text-[11px] text-slate-600">
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-700">
                        休憩
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {Array.from(new Set(round.restingPlayers)).map(
                          (name) => (
                            <PlayerCard key={name} name={name} />
                          )
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* ペア選択モーダル */}
      {pairPickerOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 px-3">
          <div className="w-full max-w-sm rounded-2xl bg-white p-4 shadow-xl ring-1 ring-slate-200">
            <h3 className="mb-1 text-sm font-semibold text-slate-800">
              {pairPickerOpen === "fixed" ? "固定ペアの追加" : "禁止ペアの追加"}
            </h3>
            <p className="mb-2 text-[11px] text-slate-500">
              参加者の中から<strong>2人</strong>
              を選択して「追加」ボタンを押してください。
            </p>

            <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs">
              {participants.length === 0 && (
                <p className="px-1 py-1 text-[11px] text-slate-500">
                  まず参加者を登録してください。
                </p>
              )}
              {participants.map((name) => {
                const checked = pairPickerSelection.includes(name);
                const disabled = !checked && pairPickerSelection.length >= 2;
                const s = getSettings(name);
                return (
                  <label
                    key={name}
                    className={`flex cursor-pointer items-center justify-between rounded-md px-1 py-0.5 hover:bg-sky-50 ${
                      disabled ? "cursor-not-allowed opacity-50" : ""
                    }`}
                  >
                    <span className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={disabled}
                        onChange={() => togglePairSelection(name)}
                        className="h-3.5 w-3.5 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                      />
                      <span>{name}</span>
                    </span>
                    <span className="text-[10px] text-slate-500">
                      Lv{s.level} / {s.gender === "M" ? "男" : "女"}
                    </span>
                  </label>
                );
              })}
            </div>

            <div className="mt-3 flex justify-end gap-2 text-xs">
              <button
                type="button"
                onClick={() => {
                  setPairPickerOpen(null);
                  setPairPickerSelection([]);
                }}
                className="rounded-full border border-slate-300 px-3 py-1.5 text-slate-600 hover:bg-slate-50"
              >
                キャンセル
              </button>
              <button
                type="button"
                disabled={pairPickerSelection.length !== 2}
                onClick={handleConfirmPair}
                className={`rounded-full px-3 py-1.5 font-semibold text-white ${
                  pairPickerSelection.length === 2
                    ? "bg-sky-600 hover:bg-sky-700"
                    : "cursor-not-allowed bg-sky-300"
                }`}
              >
                追加
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

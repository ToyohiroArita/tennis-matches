"use client";

import { useState, useEffect } from "react";

type Gender = "M" | "F";

type Team = [string, string]; // ペア（2人）: 名前
type CourtMatch = {
  court: number;
  team1: string[];
  team2?: string[];
};
type RoundView = {
  roundIndex: number;
  courts: CourtMatch[];
  restingPlayers: string[];
  score?: number; // ★ デバッグ用スコア
};

type PlayerSettings = {
  level: number; // 1〜8
  gender: Gender;
};

type Player = {
  name: string;
  level: number;
  gender: Gender;
};

type PriorityMode = "none" | "level" | "gender";

// 在籍メンバーの初期値
const INITIAL_MEMBERS: string[] = [
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

// 初期参加者（↑から何人か）
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
  members: string[];
  participants: string[];
  playerSettings: Record<string, PlayerSettings>;
  fixedPairs: Team[];
  forbiddenPairs: Team[];
  courtCount: number;
  matchCount: number;
  priorityMode: PriorityMode;
};

// localStorage から一度だけ読み込んでキャッシュする
let cachedStoredState: Partial<StoredState> | null | undefined;

function getStoredState(): Partial<StoredState> | null {
  if (cachedStoredState !== undefined) {
    return cachedStoredState;
  }
  if (typeof window === "undefined") {
    cachedStoredState = null;
    return null;
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      cachedStoredState = null;
      return null;
    }
    const data = JSON.parse(raw) as Partial<StoredState>;
    cachedStoredState = data;
    return data;
  } catch {
    cachedStoredState = null;
    return null;
  }
}

// 配列シャッフル（フィッシャー–イェーツ）
// eslint-disable-next-line @typescript-eslint/no-unused-vars
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
  // 4人分の名前をソートして一意なキーにする（順番・コートは関係なく同じ対戦とみなす）
  const names = [...team1, ...team2].sort();
  return names.join("::");
}

// 1ラウンド分の組み合わせにスコアを付ける
// スコアが小さいほど「良い」案
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

  // このラウンドで試合に出るプレーヤー集合
  const playedThisRound = new Set<string>();
  for (const court of courts) {
    court.team1.forEach((name) => playedThisRound.add(name));
    court.team2?.forEach((name) => playedThisRound.add(name));
  }

  // ① 連続出場ペナルティ（前ラウンドも出ていた人）
  for (const name of playedThisRound) {
    if ((lastPlayedRound[name] ?? -1) === roundIndex - 1) {
      score += 3; // 連続出場1人あたり +3
    }
  }

  // このラウンドの「どのプレーヤーがどのチームか」をマッピング
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

  // ② 固定ペアの扱い（ペナルティ方式）
  for (const [a, b] of fixedPairs) {
    const aIn = playedThisRound.has(a);
    const bIn = playedThisRound.has(b);

    if (aIn && bIn) {
      const ta = teamIdByPlayer[a];
      const tb = teamIdByPlayer[b];
      if (ta && tb) {
        if (ta === tb) {
          // 同じチームで出場 → ちょっとだけご褒美
          score -= 5;
        } else {
          // 同じラウンドに出ているのに別チーム → ペナルティ（少し軽め）
          score += 20;
        }
      }
    }
    // 片方だけ出ている / 片方休憩は今回はノーペナルティにしておく
  }

  // ③ レベル差 & 同じ対戦の繰り返し
  for (const court of courts) {
    if (!court.team2) continue; // 相手チームがいない場合はスキップ

    const sum1 = court.team1.reduce(
      (acc, name) => acc + (levelMap[name] ?? 4),
      0
    );
    const sum2 = court.team2.reduce(
      (acc, name) => acc + (levelMap[name] ?? 4),
      0
    );
    const diff = Math.abs(sum1 - sum2);

    // レベル差ペナルティ：差2まではOK、超えた分だけ二乗で重くする
    if (diff > 2) {
      const over = diff - 2;
      score += over * over * 10; // 重み10（必要に応じてチューニング）
    }

    // 同じ4人カードの繰り返し
    const key = matchupKey(court.team1 as Team, court.team2 as Team);
    const lastRound = pastMatchupLastRound.get(key);
    const countSoFar = pastMatchupCount.get(key) ?? 0; // これまで何回この4人で対戦したか

    if (lastRound !== undefined) {
      const gap = roundIndex - lastRound; // 何試合ぶりか

      // 他のペナルティ（レベル差・出場回数など）がせいぜい数百〜数千点なので、
      // ここは「桁を2〜3つ」上げて、ほぼ禁止レベルにする。
      const HARD_BASE = 1_000_000; // 基本スケール

      let basePenalty = 0;
      if (gap <= 5) {
        // 5試合以内に同じ4人は、原則ほぼNG
        basePenalty = HARD_BASE;
      } else if (gap <= 10) {
        // 6〜10試合ぶりでもかなり重め
        basePenalty = HARD_BASE / 5; // 200,000
      } else {
        // それ以降は「たまには同じ対戦もあり」程度だが、それでもそこそこ重い
        basePenalty = HARD_BASE / 20; // 50,000
      }

      // 繰り返し回数による増幅：
      // 2回目: (1+1)^2 = 4倍, 3回目: 9倍, 4回目: 16倍...
      const repeatFactor = (countSoFar + 1) * (countSoFar + 1);

      score += basePenalty * repeatFactor;
    }
  }

  // ④ 出場回数の偏り（この案を採用した場合の仮の gamesCount で評価）
  const tmpGames: Record<string, number> = { ...gamesCount };
  for (const name of playedThisRound) {
    tmpGames[name] = (tmpGames[name] ?? 0) + 1;
  }

  let minGames = Infinity;
  let maxGames = -Infinity;
  for (const name in tmpGames) {
    const g = tmpGames[name];
    if (g < minGames) minGames = g;
    if (g > maxGames) maxGames = g;
  }

  if (minGames !== Infinity && maxGames !== -Infinity) {
    const diffGames = maxGames - minGames;
    score += diffGames * 4; // 出場回数の差 ×4
  }

  return score;
}

// 1試合分のペアを作る
// 前試合のペア＋禁止ペア＋優先モード＋公平性（出場回数）を考慮
function findRoundPairing(
  players: Player[],
  prevPairsSet: Set<string> | null,
  fixedPairs: Team[], // ★ ここでは使わず、スコア側で評価する
  forbiddenPairs: Team[],
  priorityMode: PriorityMode,
  gamesCount: Record<string, number>,
  lastPlayedRound: Record<string, number>
): { teams: Team[]; resting: string[] } | null {
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

    // ★候補のソートに「出場回数」「最後に出たラウンド」も反映しつつ、
    //   level / gender の優先モードを加味する
    if (priorityMode === "level") {
      candidates.sort((a, b) => {
        const ga = gamesCount[a.name] ?? 0;
        const gb = gamesCount[b.name] ?? 0;
        if (ga !== gb) return ga - gb; // 試合数が少ない方優先

        const la = lastPlayedRound[a.name] ?? -1;
        const lb = lastPlayedRound[b.name] ?? -1;
        if (la !== lb) return la - lb; // 最近出ていない方優先

        const da = Math.abs(a.level - p1.level);
        const db = Math.abs(b.level - p1.level);
        return da - db; // その次にレベル差が小さい方
      });
    } else if (priorityMode === "gender") {
      candidates.sort((a, b) => {
        const ga = gamesCount[a.name] ?? 0;
        const gb = gamesCount[b.name] ?? 0;
        if (ga !== gb) return ga - gb;

        const la = lastPlayedRound[a.name] ?? -1;
        const lb = lastPlayedRound[b.name] ?? -1;
        if (la !== lb) return la - lb;

        const genderScore = (p: Player) => (p.gender === p1.gender ? 1 : 0); // 0: 異性, 1: 同性
        const gDiff = genderScore(a) - genderScore(b);
        if (gDiff !== 0) return gDiff; // ★公平性が同じならここで「異性優先」

        const da = Math.abs(a.level - p1.level);
        const db = Math.abs(b.level - p1.level);
        return da - db; // 最後にレベル差
      });
    }
    // priorityMode === 'none' のときは、order の順番のまま（公平性は外側の並び順に任せる）

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

// 複数試合分を生成（1〜matchCount）
// 公平性（出場回数・連続出場）とレベル差、同じ対戦の繰り返しをスコアリングして、
// スコアが最小の案を各ラウンドで採用する。
function generateRounds(
  players: Player[],
  courtCount: number,
  matchCount: number,
  fixedPairs: Team[],
  forbiddenPairs: Team[],
  priorityMode: PriorityMode
): RoundView[] | null {
  const rounds: RoundView[] = [];

  // 各プレーヤーの試合数と最後に出たラウンド
  const gamesCount: Record<string, number> = {};
  const lastPlayedRound: Record<string, number> = {};
  const levelMap: Record<string, number> = {};

  for (const p of players) {
    gamesCount[p.name] = 0;
    lastPlayedRound[p.name] = -1;
    levelMap[p.name] = p.level;
  }

  // 直前ラウンドで実際に試合したペア集合（次ラウンドで同じペアを禁止するため）
  let prevPairsSet: Set<string> | null = null;

  // 過去の「対戦カード（4人）」の最後に出たラウンド
  const pastMatchupLastRound = new Map<string, number>();
  // 過去の「対戦カード（4人）」が何回登場したか
  const pastMatchupCount = new Map<string, number>();

  for (let roundIndex = 0; roundIndex < matchCount; roundIndex++) {
    let bestScore = Infinity;
    let bestCourts: CourtMatch[] | null = null;
    let bestResting: string[] = [];
    let bestTeamsForPrevPairs: Team[] | null = null;

    // 同じ条件で複数パターンを試して、一番スコアの良いものを採用
    for (let attempt = 0; attempt < 60; attempt++) {
      // 公平性を考慮して並び替え（試合数が少ない & 最近出ていない人を優先）
      const sortedPlayers = [...players].sort((a, b) => {
        const ga = gamesCount[a.name] ?? 0;
        const gb = gamesCount[b.name] ?? 0;
        if (ga !== gb) return ga - gb;

        const la = lastPlayedRound[a.name] ?? -1;
        const lb = lastPlayedRound[b.name] ?? -1;
        if (la !== lb) return la - lb;

        return Math.random() - 0.5; // 完全同条件ならランダム
      });

      const pairing = findRoundPairing(
        sortedPlayers,
        prevPairsSet,
        fixedPairs,
        forbiddenPairs,
        priorityMode,
        gamesCount,
        lastPlayedRound
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
      // コートに載りきれなかったペアは休憩扱い
      teamsForCourt.forEach((team) => {
        restingPlayers.push(...team);
      });

      // ★ この案のスコアを計算
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

        // 全てのペナルティが0なら理想案なので、ここで打ち切り
        if (score === 0) break;
      }
    }

    // このラウンドの案がどうしても見つからなかった場合
    if (!bestCourts || !bestTeamsForPrevPairs) {
      return null;
    }

    // 実際に試合に出た人だけ、出場回数・最終出場ラウンドを更新
    const playedThisRound = new Set<string>();
    for (const court of bestCourts) {
      court.team1.forEach((name) => playedThisRound.add(name));
      court.team2?.forEach((name) => playedThisRound.add(name));
    }
    for (const name of playedThisRound) {
      gamesCount[name] = (gamesCount[name] ?? 0) + 1;
      lastPlayedRound[name] = roundIndex;
    }

    // 次ラウンドで「直前ペア禁止」にする集合を更新
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

    // 対戦カード（4人）の履歴を更新
    for (const court of bestCourts) {
      if (!court.team2) continue;
      const key = matchupKey(court.team1 as Team, court.team2 as Team);

      // 最後に出たラウンド番号
      pastMatchupLastRound.set(key, roundIndex);

      // 出現回数
      const prevCount = pastMatchupCount.get(key) ?? 0;
      pastMatchupCount.set(key, prevCount + 1);
    }

    rounds.push({
      roundIndex,
      courts: bestCourts,
      restingPlayers: bestResting,
      score: bestScore, // ★ このラウンドで採用された案のスコア
    });
  }

  return rounds;
}

export default function Page() {
  // ▼ 在籍メンバー（サークルメンバーDB）
  const [members, setMembers] = useState<string[]>(() => {
    const stored = getStoredState();
    if (stored && Array.isArray(stored.members)) {
      return stored.members;
    }
    return INITIAL_MEMBERS;
  });

  // ▼ 今日の「参加者」リスト（メンバー＋ビジター）
  const [participants, setParticipants] = useState<string[]>(() => {
    const stored = getStoredState();
    if (stored && Array.isArray(stored.participants)) {
      return stored.participants;
    }
    return INITIAL_PARTICIPANTS;
  });

  // 新規メンバー追加用（モーダル内）
  const [newMemberName, setNewMemberName] = useState("");

  // 新規ビジター（参加者）追加用
  const [newParticipantName, setNewParticipantName] = useState("");
  const [newParticipantLevel, setNewParticipantLevel] = useState(4);
  const [newParticipantGender, setNewParticipantGender] = useState<Gender>("M");

  // ▼ 各プレーヤーの設定（レベル・性別）
  const [playerSettings, setPlayerSettings] = useState<
    Record<string, PlayerSettings>
  >(() => {
    const stored = getStoredState();
    if (
      stored &&
      stored.playerSettings &&
      typeof stored.playerSettings === "object"
    ) {
      return stored.playerSettings;
    }
    return {};
  });

  const getSettings = (name: string): PlayerSettings => {
    return playerSettings[name] ?? DEFAULT_SETTINGS;
  };

  const updateSettings = (name: string, patch: Partial<PlayerSettings>) => {
    setPlayerSettings((prev) => {
      const current = prev[name] ?? DEFAULT_SETTINGS;
      return {
        ...prev,
        [name]: { ...current, ...patch },
      };
    });
  };

  // ▼ 制約：固定ペア・禁止ペア
  const [fixedPairs, setFixedPairs] = useState<Team[]>(() => {
    const stored = getStoredState();
    if (stored && Array.isArray(stored.fixedPairs)) {
      return stored.fixedPairs;
    }
    return [];
  });

  const [forbiddenPairs, setForbiddenPairs] = useState<Team[]>(() => {
    const stored = getStoredState();
    if (stored && Array.isArray(stored.forbiddenPairs)) {
      return stored.forbiddenPairs;
    }
    return [];
  });

  // ▼ ペア追加用ポップアップ
  const [pairPickerOpen, setPairPickerOpen] = useState<
    null | "fixed" | "forbidden"
  >(null);
  const [pairPickerSelection, setPairPickerSelection] = useState<string[]>([]);

  // ▼ メンバー管理 & 参加者追加用モーダル
  const [memberModalOpen, setMemberModalOpen] = useState(false);
  const [memberModalSelection, setMemberModalSelection] = useState<string[]>(
    []
  );

  // ▼ 優先モード
  const [priorityMode, setPriorityMode] = useState<PriorityMode>(() => {
    const stored = getStoredState();
    if (
      stored &&
      (stored.priorityMode === "none" ||
        stored.priorityMode === "level" ||
        stored.priorityMode === "gender")
    ) {
      return stored.priorityMode;
    }
    return "none";
  });

  // ▼ 条件
  const [courtCount, setCourtCount] = useState(() => {
    const stored = getStoredState();
    if (stored && typeof stored.courtCount === "number") {
      return stored.courtCount;
    }
    return 2;
  });

  const [matchCount, setMatchCount] = useState(() => {
    const stored = getStoredState();
    if (stored && typeof stored.matchCount === "number") {
      return stored.matchCount;
    }
    return 3;
  });

  const [rounds, setRounds] = useState<RoundView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ▼ メンバー管理用関数
  const addMember = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setMembers((prev) => (prev.includes(trimmed) ? prev : [...prev, trimmed]));
  };

  const removeMember = (name: string) => {
    // 在籍メンバーから削除
    setMembers((prev) => prev.filter((m) => m !== name));
    // 参加者からも削除
    setParticipants((prev) => prev.filter((p) => p !== name));
    // 固定／禁止ペアから除外
    setFixedPairs((prev) => prev.filter(([a, b]) => a !== name && b !== name));
    setForbiddenPairs((prev) =>
      prev.filter(([a, b]) => a !== name && b !== name)
    );
    // 設定も削除
    setPlayerSettings((prev) => {
      const copy = { ...prev };
      delete copy[name];
      return copy;
    });
    // モーダル内の選択からも外す
    setMemberModalSelection((prev) => prev.filter((n) => n !== name));
  };

  // ▼ プレイヤーカード（名前 + Lv + 性別色）
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

  const handleAddNewMember = () => {
    addMember(newMemberName);
    setNewMemberName("");
  };

  const handleAddNewParticipant = () => {
    const name = newParticipantName.trim();
    if (!name) return;

    // 参加者として追加（ビジター）
    addParticipant(name);

    // レベル・性別も同時に設定
    updateSettings(name, {
      level: newParticipantLevel,
      gender: newParticipantGender,
    });

    // 入力欄をリセット
    setNewParticipantName("");
    setNewParticipantLevel(4);
    setNewParticipantGender("M");
  };

  // メンバー選択モーダル操作
  const openMemberModal = () => {
    setMemberModalOpen(true);
    setMemberModalSelection([]);
  };

  const closeMemberModal = () => {
    setMemberModalOpen(false);
    setMemberModalSelection([]);
  };

  const toggleMemberModalSelection = (name: string) => {
    setMemberModalSelection((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]
    );
  };

  const handleAddMembersToParticipants = () => {
    if (memberModalSelection.length > 0) {
      setParticipants((prev) => {
        const set = new Set(prev);
        memberModalSelection.forEach((n) => set.add(n));
        return Array.from(set);
      });
    }
    closeMemberModal();
  };

  // ペア選択モーダル
  const openPairPicker = (mode: "fixed" | "forbidden") => {
    setPairPickerOpen(mode);
    setPairPickerSelection([]);
  };

  const togglePairSelection = (name: string) => {
    setPairPickerSelection((prev) => {
      if (prev.includes(name)) {
        return prev.filter((n) => n !== name);
      }
      if (prev.length >= 2) {
        return prev; // 2人以上は選べない
      }
      return [...prev, name];
    });
  };

  const handleConfirmPair = () => {
    if (!pairPickerOpen || pairPickerSelection.length !== 2) {
      return;
    }
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

    if (uniqueNames.length < 2) {
      setError(
        "参加者は2人以上必要です。サークルメンバーやビジターを登録してください。"
      );
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
      return {
        name,
        level: s.level,
        gender: s.gender,
      };
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

  // ▼ 状態が変わるたびに localStorage に保存
  useEffect(() => {
    if (typeof window === "undefined") return;
    const data: StoredState = {
      members,
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
      console.error("Failed to save state to localStorage", e);
    }
  }, [
    members,
    participants,
    playerSettings,
    fixedPairs,
    forbiddenPairs,
    courtCount,
    matchCount,
    priorityMode,
  ]);

  return (
    <main className="min-h-screen bg-gradient-to-br from-sky-50 via-slate-50 to-emerald-50 px-3 py-6 md:px-6 md:py-10">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 md:flex-row">
        {/* 左側：参加者・条件の設定パネル */}
        <section className="w全 space-y-4 md:w-[45%]">
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

            {/* 参加者のサマリ */}
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
                サークルメンバー: {members.length} 名
              </span>
            </div>
          </div>

          {/* 参加者設定（メイン画面） */}
          <div className="rounded-2xl bg-white/90 p-4 shadow-md ring-1 ring-slate-200 md:p-5">
            <h2 className="mb-2 text-sm font-semibold text-slate-800">
              今日の参加者の設定
            </h2>

            {/* メンバーから追加ボタン */}
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="text-[11px] text-slate-600">
                サークル在籍メンバーを一覧で確認し、そこから今日の参加者を追加できます。
              </div>
              <button
                type="button"
                onClick={openMemberModal}
                className="inline-flex items-center rounded-full bg-slate-800 px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm hover:bg-slate-900"
              >
                メンバー一覧を開く
              </button>
            </div>

            {/* ビジター・個別追加 */}
            <div className="mb-3">
              <label className="mb-1 block text-xs font-semibold text-slate-700">
                ビジター / 個別追加
                <span className="ml-1 text-[11px] font-normal text-slate-500">
                  ※名前・レベル・性別を設定して今日の参加者に追加
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

            {/* 現在の参加者一覧（削除用） */}
            <div className="mb-3">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-700">
                  今日の参加者
                </span>
                <span className="text-[11px] text-slate-500">
                  バッジをクリックで参加者から削除（在籍は残ります）
                </span>
              </div>
              {participants.length === 0 ? (
                <p className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
                  まだ参加者が登録されていません。メンバー一覧を開くか、ビジターを追加してください。
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

            {/* 参加者ごとのレベル・性別設定 */}
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

          {/* 条件設定・制約 */}
          <div className="rounded-2xl bg-white/90 p-4 shadow-md ring-1 ring-slate-200 md:p-5">
            <h2 className="mb-2 text-sm font-semibold text-slate-800">
              試合条件・制約
            </h2>

            {/* 優先モード選択 */}
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
                  onChange={(e) => setCourtCount(Number(e.target.value) || 1)}
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

        {/* 右側：結果パネル */}
        <section className="w-full rounded-2xl bg-white/95 p-4 shadow-md ring-1 ring-slate-200 md:w-[55%] md:p-6">
          <div className="mb-4 flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800 md:text-base">
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-emerald-100 text-xs">
                ✓
              </span>
              組み合わせ結果
            </h2>
            <p className="text-[11px] text-slate-500">
              優先設定と固定/禁止ペアを考慮して組み合わせを生成しています。
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

      {/* ペア選択用ポップアップ */}
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

      {/* メンバー管理 & 参加者追加モーダル */}
      {memberModalOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 px-3">
          <div className="w-full max-w-md rounded-2xl bg-white p-4 shadow-xl ring-1 ring-slate-200">
            <h3 className="mb-1 text-sm font-semibold text-slate-800">
              サークルメンバー管理 & 参加者追加
            </h3>
            <p className="mb-2 text-[11px] text-slate-500">
              サークル在籍メンバーを管理し、今日の参加者として追加したい人にチェックを入れてください。
            </p>

            {/* メンバー追加 */}
            <div className="mb-2 flex flex-col gap-2 md:flex-row md:items-center">
              <input
                type="text"
                value={newMemberName}
                onChange={(e) => setNewMemberName(e.target.value)}
                placeholder="例）佐藤さん"
                className="flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-xs md:text-sm shadow-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
              />
              <button
                type="button"
                onClick={handleAddNewMember}
                className="inline-flex items-center justify-center rounded-full bg-slate-800 px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm hover:bg-slate-900"
              >
                メンバー追加
              </button>
            </div>

            {/* メンバー一覧 */}
            <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs">
              {members.length === 0 && (
                <p className="px-1 py-1 text-[11px] text-slate-500">
                  まだサークルメンバーが登録されていません。上の欄から追加してください。
                </p>
              )}
              {members.map((name) => {
                const checked = memberModalSelection.includes(name);
                const s = getSettings(name);
                return (
                  <div
                    key={name}
                    className="flex items-center justify-between gap-1 rounded-md px-1 py-0.5 hover:bg-sky-50"
                  >
                    <label className="flex flex-1 cursor-pointer items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleMemberModalSelection(name)}
                        className="h-3.5 w-3.5 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                      />
                      <span className="truncate">{name}</span>
                    </label>
                    <div className="flex items-center gap-1.5 text-[10px]">
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
                      <button
                        type="button"
                        onClick={() => removeMember(name)}
                        className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] text-red-600 hover:bg-red-100"
                      >
                        削除
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-3 flex justify-end gap-2 text-xs">
              <button
                type="button"
                onClick={closeMemberModal}
                className="rounded-full border border-slate-300 px-3 py-1.5 text-slate-600 hover:bg-slate-50"
              >
                閉じる
              </button>
              <button
                type="button"
                onClick={handleAddMembersToParticipants}
                disabled={memberModalSelection.length === 0}
                className={`rounded-full px-3 py-1.5 font-semibold text-white ${
                  memberModalSelection.length > 0
                    ? "bg-sky-600 hover:bg-sky-700"
                    : "cursor-not-allowed bg-sky-300"
                }`}
              >
                参加者に追加
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
